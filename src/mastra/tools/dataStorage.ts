import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";
import { createWriteStream, promises as fs } from "fs";
import { join } from "path";
import { db } from "../storage";
import { videos, contentAnalysis, workflowRuns } from "../../../shared/schema";
import { eq, sql } from "drizzle-orm";

const ensureDataDirectory = async () => {
  const dataDir = join(process.cwd(), 'data');
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
  return dataDir;
};

const saveAnalysisData = async ({
  analyzedVideos,
  contextProfile,
  runId,
  logger,
}: {
  analyzedVideos: any[];
  contextProfile: any;
  runId?: string;
  logger?: IMastraLogger;
}) => {
  logger?.info("🔧 [DataStorage] Starting data storage", { 
    videoCount: analyzedVideos.length,
    runId
  });

  try {
    const dataDir = await ensureDataDirectory();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    // Create filenames with timestamp
    const analysisFile = join(dataDir, `analysis_${timestamp}.json`);
    const contextFile = join(dataDir, `context_profile_${timestamp}.json`);
    const summaryFile = join(dataDir, `summary_${timestamp}.json`);

    // Save structured analysis data
    const analysisData = {
      timestamp: new Date().toISOString(),
      videos: analyzedVideos,
      totalVideos: analyzedVideos.length,
      analysisMetadata: {
        analyzedAt: new Date().toISOString(),
        version: "1.0"
      }
    };

    await fs.writeFile(analysisFile, JSON.stringify(analysisData, null, 2), 'utf-8');
    logger?.info("📝 [DataStorage] Saved analysis data", { file: analysisFile });

    // Save context profile
    await fs.writeFile(contextFile, JSON.stringify(contextProfile, null, 2), 'utf-8');
    logger?.info("📝 [DataStorage] Saved context profile", { file: contextFile });

    // Create summary for quick reference
    const summary = {
      timestamp: new Date().toISOString(),
      totalVideos: analyzedVideos.length,
      channels: [...new Set(analyzedVideos.map(v => v.channelName))],
      topKeywords: contextProfile.topKeywords || [],
      emotionalHooks: contextProfile.emotionalHooks || [],
      commonProblems: contextProfile.commonProblems || [],
      files: {
        analysis: analysisFile,
        context: contextFile,
        summary: summaryFile
      }
    };

    await fs.writeFile(summaryFile, JSON.stringify(summary, null, 2), 'utf-8');
    logger?.info("📝 [DataStorage] Saved summary", { file: summaryFile });

    // NOW SAVE TO DATABASE - This was missing!
    logger?.info("💾 [DataStorage] Starting database persistence", { 
      videoCount: analyzedVideos.length 
    });

    let savedVideoCount = 0;
    let savedAnalysisCount = 0;

    // Use a database transaction to ensure consistency
    await db.transaction(async (tx) => {
      for (const video of analyzedVideos) {
        try {
          // Convert scrapedAt string to Date object
          const scrapedAtDate = video.scrapedAt ? new Date(video.scrapedAt) : new Date();
          
          // Upsert video data (insert or update if exists)
          const [savedVideo] = await tx.insert(videos).values({
            videoId: video.videoId,
            url: video.url,
            title: video.title,
            views: video.views || null,
            likes: video.likes || null,
            description: video.description || null,
            channelName: video.channelName || null,
            subscribers: video.subscribers || null,
            tags: video.tags || [],
            transcript: video.transcript || null,
            comments: video.comments || [],
            scrapedAt: scrapedAtDate,
          }).onConflictDoUpdate({
            target: videos.videoId,
            set: {
              url: video.url,
              title: video.title,
              views: video.views || null,
              likes: video.likes || null,
              description: video.description || null,
              channelName: video.channelName || null,
              subscribers: video.subscribers || null,
              tags: video.tags || [],
              transcript: video.transcript || null,
              comments: video.comments || [],
              scrapedAt: scrapedAtDate,
            }
          }).returning();
          
          savedVideoCount++;
          logger?.info("💾 [DataStorage] Saved video to DB", { 
            videoId: video.videoId, 
            title: video.title 
          });

          // Save analysis data if it exists
          if (video.analysis) {
            const analysis = video.analysis;
            
            // Implement defensive size checks for rawAnalysis
            const MAX_RAW_ANALYSIS_SIZE = 262144; // 256KB limit
            let safeRawAnalysis = null;
            if (analysis.rawAnalysis) {
              const rawText = typeof analysis.rawAnalysis === 'string' 
                ? analysis.rawAnalysis 
                : JSON.stringify(analysis.rawAnalysis);
              
              if (rawText.length > MAX_RAW_ANALYSIS_SIZE) {
                safeRawAnalysis = rawText.slice(0, MAX_RAW_ANALYSIS_SIZE - 100) + '...[truncated for database storage]';
                logger?.warn('🚨 [DataStorage] Truncating rawAnalysis for database storage', {
                  videoId: video.videoId,
                  originalSize: rawText.length,
                  truncatedSize: safeRawAnalysis.length
                });
              } else {
                safeRawAnalysis = rawText;
              }
            }
            
            // Helper function to safely extract field values
            const safeExtractField = (field: any, fallback: string = null): string | null => {
              if (!field || field === '') return fallback;
              if (typeof field === 'string' && field.trim() === '') return fallback;
              if (typeof field === 'string') return field.trim();
              if (typeof field === 'object') return JSON.stringify(field);
              return String(field);
            };
            
            // Add debug logging to see what analysis structure we're getting
            logger?.debug('🔍 [DataStorage] Analysis structure received', {
              videoId: video.videoId,
              analysisKeys: Object.keys(analysis),
              hasAudienceProblems: !!analysis.audienceProblems,
              hasEmotionalHooks: !!analysis.emotionalHooks,
              hasRawAnalysis: !!analysis.rawAnalysis,
              analysisType: typeof analysis
            });

            await tx.insert(contentAnalysis).values({
              videoId: video.videoId,
              audienceProblems: safeExtractField(analysis.audienceProblems, 'No specific audience problems identified - transcript unavailable'),
              emotionalHooks: safeExtractField(analysis.emotionalHooks, 'No emotional hooks identified - transcript unavailable'),
              mythsToBust: safeExtractField(analysis.mythsToBust, 'No myths identified - transcript unavailable'),
              contentPatterns: safeExtractField(analysis.contentPatterns, 'No content patterns identified - transcript unavailable'),
              audienceLanguage: safeExtractField(analysis.audienceLanguage, 'Unable to analyze audience language - transcript unavailable'),
              rawAnalysis: safeRawAnalysis,
              analyzedAt: analysis.analyzedAt ? new Date(analysis.analyzedAt) : new Date(),
              analysisModel: analysis.analysisModel || null,
            }).onConflictDoUpdate({
              target: contentAnalysis.videoId,
              set: {
                audienceProblems: safeExtractField(analysis.audienceProblems, 'No specific audience problems identified - transcript unavailable'),
                emotionalHooks: safeExtractField(analysis.emotionalHooks, 'No emotional hooks identified - transcript unavailable'),
                mythsToBust: safeExtractField(analysis.mythsToBust, 'No myths identified - transcript unavailable'),
                contentPatterns: safeExtractField(analysis.contentPatterns, 'No content patterns identified - transcript unavailable'),
                audienceLanguage: safeExtractField(analysis.audienceLanguage, 'Unable to analyze audience language - transcript unavailable'),
                rawAnalysis: safeRawAnalysis,
                analyzedAt: analysis.analyzedAt ? new Date(analysis.analyzedAt) : new Date(),
                analysisModel: analysis.analysisModel || null,
              }
            });
            
            savedAnalysisCount++;
            logger?.info("🧠 [DataStorage] Saved analysis to DB", { 
              videoId: video.videoId 
            });
          }
        } catch (videoError) {
          logger?.error("❌ [DataStorage] Failed to save video to DB", {
            videoId: video.videoId,
            error: String(videoError)
          });
          throw videoError;
        }
      }

      // Update workflow_runs video count if runId provided
      if (runId) {
        try {
          await tx.update(workflowRuns)
            .set({ videoCount: sql`${savedVideoCount}` })
            .where(eq(workflowRuns.runId, runId));
          
          logger?.info("📊 [DataStorage] Updated workflow run video count", {
            runId,
            videoCount: savedVideoCount
          });
        } catch (updateError) {
          logger?.error("❌ [DataStorage] Failed to update workflow run video count", {
            runId,
            error: String(updateError)
          });
          // Don't throw here - video data is saved, this is just metadata
        }
      }
    });

    logger?.info("✅ [DataStorage] Successfully persisted all data", {
      filesCreated: 3,
      videosStored: savedVideoCount,
      analysisStored: savedAnalysisCount,
      runId
    });

    return {
      success: true,
      files: {
        analysis: analysisFile,
        context: contextFile,
        summary: summaryFile
      },
      database: {
        videosStored: savedVideoCount,
        analysisStored: savedAnalysisCount
      },
      summary,
      contextProfile
    };

  } catch (error) {
    logger?.error("❌ [DataStorage] Failed to store data", { 
      error: String(error),
      runId 
    });
    throw error;
  }
};

export const dataStorageTool = createTool({
  id: "data-storage-tool",
  description: "Stores analyzed video data and creates reusable context profiles for script generation",
  inputSchema: z.object({
    analyzedVideos: z.array(z.object({
      videoId: z.string(),
      url: z.string(),
      title: z.string(),
      views: z.string(),
      likes: z.string(),
      description: z.string(),
      channelName: z.string(),
      subscribers: z.string(),
      tags: z.array(z.string()),
      transcript: z.string(),
      comments: z.array(z.string()),
      scrapedAt: z.string(),
      analysis: z.object({
        audienceProblems: z.any().optional(),
        emotionalHooks: z.any().optional(),
        mythsToBust: z.any().optional(),
        contentPatterns: z.any().optional(),
        audienceLanguage: z.any().optional(),
        rawAnalysis: z.string().optional(),
        analyzedAt: z.string(),
        analysisModel: z.string()
      })
    })).describe("Array of analyzed YouTube video data"),
    niche: z.string().default("YouTube content creation").describe("The target niche or industry"),
    targetAudience: z.string().default("Content creators and marketers").describe("Description of the target audience"),
    brandVoice: z.string().default("Informative and engaging").describe("Desired brand voice and tone"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    files: z.object({
      analysis: z.string(),
      context: z.string(),
      summary: z.string()
    }),
    database: z.object({
      videosStored: z.number(),
      analysisStored: z.number()
    }),
    summary: z.object({
      timestamp: z.string(),
      totalVideos: z.number(),
      channels: z.array(z.string()),
      topKeywords: z.array(z.string()),
      emotionalHooks: z.array(z.string()),
      commonProblems: z.array(z.string()),
      files: z.object({
        analysis: z.string(),
        context: z.string(),
        summary: z.string()
      })
    }),
    contextProfile: z.any()
  }),
  execute: async ({ context, mastra, runtimeContext }) => {
    const logger = mastra?.getLogger();
    const { analyzedVideos, niche, targetAudience, brandVoice } = context;
    const runId = (runtimeContext as any)?.runId;
    
    logger?.info('🔧 [DataStorage] Starting execution', { 
      videoCount: analyzedVideos.length,
      niche,
      targetAudience,
      runId
    });
    
    // Extract insights across all videos to create context profile
    const allComments = analyzedVideos.flatMap(v => v.comments);
    const allAnalyses = analyzedVideos.map(v => v.analysis);
    
    // Create aggregated context profile
    const contextProfile = {
      niche,
      targetAudience,
      brandVoice,
      createdAt: new Date().toISOString(),
      videos: {
        total: analyzedVideos.length,
        channels: [...new Set(analyzedVideos.map(v => v.channelName))],
        totalViews: analyzedVideos.reduce((sum, v) => {
          const viewCount = parseInt(v.views.replace(/[^\d]/g, '')) || 0;
          return sum + viewCount;
        }, 0)
      },
      insights: {
        topKeywords: extractTopKeywords(allComments),
        emotionalHooks: extractEmotionalHooks(allAnalyses),
        commonProblems: extractCommonProblems(allAnalyses),
        contentPatterns: extractContentPatterns(allAnalyses),
        audienceLanguage: extractAudienceLanguage(allComments)
      },
      rawData: {
        totalComments: allComments.length,
        averageCommentsPerVideo: Math.round(allComments.length / analyzedVideos.length),
        analysisModels: [...new Set(allAnalyses.map(a => a.analysisModel))]
      }
    };
    
    const result = await saveAnalysisData({
      analyzedVideos,
      contextProfile,
      runId,
      logger
    });
    
    logger?.info('✅ [DataStorage] Completed execution', { 
      success: result.success,
      fileCount: Object.keys(result.files).length,
      videosStored: result.database.videosStored,
      analysisStored: result.database.analysisStored,
      runId
    });
    
    return {
      ...result,
      contextProfile
    };
  },
});

// Helper functions to extract insights
function extractTopKeywords(comments: string[]): string[] {
  const words = comments.join(' ').toLowerCase().split(/\s+/);
  const wordCount = words.reduce((acc, word) => {
    if (word.length > 3 && !['this', 'that', 'with', 'they', 'have', 'will', 'from', 'they', 'been', 'said', 'each', 'which', 'their', 'time', 'would', 'there', 'could', 'other'].includes(word)) {
      acc[word] = (acc[word] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);
  
  return Object.entries(wordCount)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 20)
    .map(([word]) => word);
}

function extractEmotionalHooks(analyses: any[]): string[] {
  const hooks: string[] = [];
  analyses.forEach(analysis => {
    if (analysis.emotionalHooks) {
      const hookText = typeof analysis.emotionalHooks === 'string' 
        ? analysis.emotionalHooks 
        : JSON.stringify(analysis.emotionalHooks);
      hooks.push(hookText);
    }
  });
  return hooks.slice(0, 10);
}

function extractCommonProblems(analyses: any[]): string[] {
  const problems: string[] = [];
  analyses.forEach(analysis => {
    if (analysis.audienceProblems) {
      const problemText = typeof analysis.audienceProblems === 'string' 
        ? analysis.audienceProblems 
        : JSON.stringify(analysis.audienceProblems);
      problems.push(problemText);
    }
  });
  return problems.slice(0, 10);
}

function extractContentPatterns(analyses: any[]): string[] {
  const patterns: string[] = [];
  analyses.forEach(analysis => {
    if (analysis.contentPatterns) {
      const patternText = typeof analysis.contentPatterns === 'string' 
        ? analysis.contentPatterns 
        : JSON.stringify(analysis.contentPatterns);
      patterns.push(patternText);
    }
  });
  return patterns.slice(0, 10);
}

function extractAudienceLanguage(comments: string[]): string[] {
  // Extract common phrases and terminology
  const phrases = comments.flatMap(comment => {
    const sentences = comment.split(/[.!?]+/);
    return sentences
      .filter(s => s.trim().length > 10 && s.trim().length < 100)
      .map(s => s.trim());
  });
  
  return phrases.slice(0, 20);
}