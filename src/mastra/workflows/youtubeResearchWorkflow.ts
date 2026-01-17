import { createWorkflow, createStep } from "../inngest";
import { z } from "zod";
import { RuntimeContext } from "@mastra/core/di";
import { youTubeScrapeTool } from "../tools/youtubeScraper";
import { contentAnalysisTool } from "../tools/contentAnalyzer";
import { dataStorageTool } from "../tools/dataStorage";
import { scriptGeneratorTool } from "../tools/scriptGenerator";

// Step 1: Scrape YouTube competitor videos
const scrapeYouTubeStep = createStep({
  id: "scrape-youtube-videos",
  description: "Scrapes competitor YouTube videos to extract metadata, transcripts, and comments",
  inputSchema: z.object({
    videoUrls: z.array(z.string().url()).optional().describe("YouTube video URLs to scrape for research"),
  }),
  outputSchema: z.object({
    videos: z.array(z.object({
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
      scrapedAt: z.string()
    })),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    let { videoUrls } = inputData;
    const runtimeContext = new RuntimeContext();

    // If no URLs provided, get from database settings
    if (!videoUrls || videoUrls.length === 0) {
      logger?.info('📋 [Workflow Step 1] Getting video URLs from database settings');
      try {
        const { db } = await import('../storage');
        const { sql } = await import('drizzle-orm');
        const result = await db.execute(sql`SELECT video_urls FROM settings ORDER BY id DESC LIMIT 1`);
        const settings = result[0] as { video_urls?: string | string[] } | undefined;
        
        if (settings && settings.video_urls) {
          const settingsUrls = Array.isArray(settings.video_urls) ? settings.video_urls : JSON.parse(settings.video_urls as string);
          videoUrls = settingsUrls || [];
          logger?.info('📋 [Workflow Step 1] Retrieved URLs from settings', { urlCount: videoUrls.length });
        } else {
          // Fallback to default individual video URLs if no settings
          videoUrls = [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ" // Example individual video URL
          ];
          logger?.info('📋 [Workflow Step 1] Using fallback URLs');
        }
      } catch (error) {
        logger?.error('❌ [Workflow Step 1] Failed to get settings, using fallback', { error: String(error) });
        videoUrls = [
          "https://www.youtube.com/watch?v=dQw4w9WgXcQ" // Fallback individual video URL
        ];
      }
    }

    // Ensure videoUrls is always an array
    videoUrls = videoUrls || [];

    logger?.info('🔧 [Workflow Step 1] Starting YouTube video scraping', { videoUrls });

    try {
      const scrapedData = await youTubeScrapeTool.execute({
        context: { videoUrls },
        mastra,
        runtimeContext,
        tracingContext: {}
      });

      logger?.info('✅ [Workflow Step 1] Successfully scraped videos', { 
        videoCount: scrapedData.videos?.length || 0 
      });

      return scrapedData;
    } catch (error) {
      logger?.error('❌ [Workflow Step 1] Failed to scrape videos', { error: String(error) });
      throw error;
    }
  }
});

// Step 2: Analyze content for audience insights
const analyzeContentStep = createStep({
  id: "analyze-content-insights",
  description: "Analyzes scraped video content to extract audience insights and emotional hooks",
  inputSchema: z.object({
    videos: z.array(z.object({
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
      scrapedAt: z.string()
    })),
  }),
  outputSchema: z.object({
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
    })),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const { videos } = inputData;
    const runtimeContext = new RuntimeContext();

    logger?.info('🔧 [Workflow Step 2] Starting content analysis', { videoCount: videos?.length || 0 });

    try {
      const analysisData = await contentAnalysisTool.execute({
        context: { videos },
        mastra,
        runtimeContext,
        tracingContext: {}
      });

      logger?.info('✅ [Workflow Step 2] Successfully analyzed content', { 
        analyzedCount: analysisData.analyzedVideos?.length || 0 
      });

      return analysisData;
    } catch (error) {
      logger?.error('❌ [Workflow Step 2] Failed to analyze content', { error: String(error) });
      throw error;
    }
  }
});

// Step 3: Store data and create context profile
const storeDataStep = createStep({
  id: "store-analysis-data",
  description: "Stores analyzed data and creates reusable context profiles",
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
    })),
    niche: z.string().default("Health & Fitness for Busy Fathers").describe("Health & fitness content for overwhelmed but ambitious fathers aged 30-45"),
    targetAudience: z.string().default("Overwhelmed but ambitious fathers (30-45) - married with kids, high-performing professionals struggling with time, energy, and guilt about self-care").describe("Busy dads who want to reclaim strength and energy without sacrificing family or work"),
    brandVoice: z.string().default("Motivational coach in the trenches - Direct, story-driven, authentic, anti-perfectionist. Key phrases: 'Lift Life!', 'Proof is proof', 'Strong Fathers. Strong Families.'").describe("Trusted coach voice with empathy and leadership"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    files: z.object({
      analysis: z.string(),
      context: z.string(),
      summary: z.string()
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
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const { analyzedVideos, niche, targetAudience, brandVoice } = inputData;
    const runtimeContext = new RuntimeContext();

    logger?.info('🔧 [Workflow Step 3] Starting data storage', { 
      videoCount: analyzedVideos?.length || 0,
      niche 
    });

    try {
      const storageResult = await dataStorageTool.execute({
        context: { 
          analyzedVideos, 
          niche, 
          targetAudience, 
          brandVoice 
        },
        mastra,
        runtimeContext,
        tracingContext: {}
      });

      logger?.info('✅ [Workflow Step 3] Successfully stored data and created context profile', { 
        files: storageResult.files 
      });

      return storageResult;
    } catch (error) {
      logger?.error('❌ [Workflow Step 3] Failed to store data', { error: String(error) });
      throw error;
    }
  }
});

// Step 4: Transform data for script generation
const transformDataStep = createStep({
  id: "transform-data-for-script",
  description: "Transforms stored data output to script generation input format",
  inputSchema: z.object({
    success: z.boolean(),
    files: z.object({
      analysis: z.string(),
      context: z.string(),
      summary: z.string()
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
  outputSchema: z.object({
    contextProfile: z.any(),
    topic: z.string(),
    duration: z.number(),
    scriptStyle: z.string()
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const { contextProfile } = inputData;
    
    logger?.info('🔧 [Workflow Step 4] Transforming data for script generation');
    
    // Use defaults for Busy Dad fitness content
    return {
      contextProfile,
      topic: "Busy Dad Fitness Strategy",
      duration: 10,
      scriptStyle: "dad-focused-coaching"
    };
  }
});

// Step 5: Generate long-form scripts  
const generateScriptStep = createStep({
  id: "generate-longform-script",
  description: "Generates long-form video scripts with beats, B-roll notes, and CTAs",
  inputSchema: z.object({
    contextProfile: z.any().describe("Context profile with audience insights"),
    topic: z.string().describe("Main topic for the script"),
    duration: z.number().describe("Target video duration in minutes"),
    scriptStyle: z.string().describe("Style: educational, entertaining, or inspiring"),
  }),
  outputSchema: z.object({
    title: z.string(),
    hook: z.string(),
    introduction: z.string(),
    mainBeats: z.array(z.object({
      beat: z.number(),
      title: z.string(),
      script: z.string(),
      brollSuggestion: z.string(),
      duration: z.string()
    })),
    callToAction: z.string(),
    thumbnailIdea: z.string(),
    seoKeywords: z.array(z.string()),
    estimatedEngagement: z.string(),
    metadata: z.object({
      topic: z.string(),
      duration: z.number(),
      niche: z.string(),
      targetAudience: z.string(),
      brandVoice: z.string(),
      basedOnVideos: z.number(),
      generatedAt: z.string(),
      estimatedWordCount: z.number()
    }).optional(),
    rawScript: z.string().optional(),
    savedToFile: z.string().optional()
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const { contextProfile, topic, duration, scriptStyle } = inputData;
    const runtimeContext = new RuntimeContext();

    logger?.info('🔧 [Workflow Step 4] Starting script generation', { 
      topic,
      duration,
      scriptStyle 
    });

    try {
      const scriptResult = await scriptGeneratorTool.execute({
        context: { 
          contextProfile, 
          topic, 
          duration, 
          scriptStyle 
        },
        mastra,
        runtimeContext,
        tracingContext: {}
      });

      logger?.info('✅ [Workflow Step 4] Successfully generated script', { 
        title: scriptResult.title,
        wordCount: scriptResult.metadata?.estimatedWordCount || 0 
      });

      return scriptResult;
    } catch (error) {
      logger?.error('❌ [Workflow Step 4] Failed to generate script', { error: String(error) });
      throw error;
    }
  }
});

// Final step: Mark workflow as completed
const markCompletedStep = createStep({
  id: "mark-workflow-completed",
  description: "Updates workflow status to completed in database",
  inputSchema: z.object({
    title: z.string(),
    hook: z.string(),
    introduction: z.string(),
    mainBeats: z.array(z.object({
      beat: z.number(),
      title: z.string(),
      script: z.string(),
      brollSuggestion: z.string(),
      duration: z.string()
    })),
    callToAction: z.string(),
    thumbnailIdea: z.string(),
    seoKeywords: z.array(z.string()),
    estimatedEngagement: z.string(),
    metadata: z.object({
      topic: z.string(),
      duration: z.number(),
      niche: z.string(),
      targetAudience: z.string(),
      brandVoice: z.string(),
      basedOnVideos: z.number(),
      generatedAt: z.string(),
      estimatedWordCount: z.number()
    }).optional(),
    rawScript: z.string().optional(),
    savedToFile: z.string().optional()
  }),
  outputSchema: z.object({
    title: z.string(),
    hook: z.string(),
    introduction: z.string(),
    mainBeats: z.array(z.object({
      beat: z.number(),
      title: z.string(),
      script: z.string(),
      brollSuggestion: z.string(),
      duration: z.string()
    })),
    callToAction: z.string(),
    thumbnailIdea: z.string(),
    seoKeywords: z.array(z.string()),
    estimatedEngagement: z.string(),
    metadata: z.object({
      topic: z.string(),
      duration: z.number(),
      niche: z.string(),
      targetAudience: z.string(),
      brandVoice: z.string(),
      basedOnVideos: z.number(),
      generatedAt: z.string(),
      estimatedWordCount: z.number()
    }).optional(),
    rawScript: z.string().optional(),
    savedToFile: z.string().optional()
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    
    logger?.info('🏁 [Workflow Completion] Workflow finished - status managed by wrapper');
    
    // The workflow status is handled by the manual/cron wrappers
    // This step just confirms successful completion to the logs
    return inputData;
  }
});

export const youtubeResearchWorkflow = createWorkflow({
  id: "youtube-research-to-script-workflow", 
  description: "Automated YouTube competitor research to long-form script generation pipeline",
  inputSchema: z.object({}), // Empty for time-based workflows
  outputSchema: z.object({
    title: z.string(),
    hook: z.string(),
    introduction: z.string(),
    mainBeats: z.array(z.object({
      beat: z.number(),
      title: z.string(),
      script: z.string(),
      brollSuggestion: z.string(),
      duration: z.string()
    })),
    callToAction: z.string(),
    thumbnailIdea: z.string(),
    seoKeywords: z.array(z.string()),
    estimatedEngagement: z.string(),
    metadata: z.object({
      topic: z.string(),
      duration: z.number(),
      niche: z.string(),
      targetAudience: z.string(),
      brandVoice: z.string(),
      basedOnVideos: z.number(),
      generatedAt: z.string(),
      estimatedWordCount: z.number()
    }).optional(),
    rawScript: z.string().optional(),
    savedToFile: z.string().optional()
  })
})
  .then(scrapeYouTubeStep)
  .then(analyzeContentStep)
  .then(storeDataStep)
  .then(transformDataStep)
  .then(generateScriptStep)
  .then(markCompletedStep)
  .commit();

