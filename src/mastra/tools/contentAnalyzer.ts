import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";
import axios from "axios";

const analyzeVideoContent = async ({
  videoData,
  logger,
}: {
  videoData: any;
  logger?: IMastraLogger;
}) => {
  logger?.info("🔧 [ContentAnalyzer] Starting content analysis", { 
    videoTitle: videoData.title,
    commentCount: videoData.comments?.length || 0 
  });

  try {
    const prompt = `Analyze this YouTube video content and extract insights for script writing:

VIDEO DATA:
Title: ${videoData.title}
Channel: ${videoData.channelName}
Views: ${videoData.views}
Description: ${videoData.description.substring(0, 1000)}...
Transcript: ${videoData.transcript.substring(0, 3000)}...

COMMENTS (${videoData.comments?.length || 0} total):
${videoData.comments?.slice(0, 30).join('\n---\n') || 'No comments available'}

Please analyze and extract:

1. AUDIENCE PROBLEMS & PAIN POINTS:
   - What specific problems do viewers mention in comments?
   - What challenges or frustrations are they expressing?
   - What solutions are they seeking?

2. EMOTIONAL HOOKS & TRIGGERS:
   - What emotional language and phrases resonate with viewers?
   - What triggers excitement, fear, curiosity, or urgency?
   - Key phrases viewers use to describe benefits or outcomes

3. MYTHS TO BUST:
   - What misconceptions do commenters reveal?
   - What common beliefs does the video challenge?
   - What "secrets" or insider knowledge is shared?

4. CONTENT PATTERNS & PACING:
   - How does the video structure information?
   - What storytelling techniques are used?
   - Key moments that generate engagement

5. AUDIENCE LANGUAGE:
   - Exact phrases and terminology viewers use
   - Slang, jargon, or specific vocabulary
   - How they describe problems and solutions

Return your analysis in structured JSON format with detailed insights for each category.`;

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        }
      }
    );

    const text = response.data.content[0].text;

    logger?.info("📝 [ContentAnalyzer] Generated analysis", { 
      analysisLength: text.length 
    });

    // Try to parse as JSON, fallback to structured text
    let analysis;
    try {
      analysis = JSON.parse(text);
    } catch {
      // If not valid JSON, create structured analysis from text
      analysis = {
        audienceProblems: text.match(/AUDIENCE PROBLEMS[\s\S]*?(?=EMOTIONAL HOOKS|$)/)?.[0] || "",
        emotionalHooks: text.match(/EMOTIONAL HOOKS[\s\S]*?(?=MYTHS TO BUST|$)/)?.[0] || "",
        mythsToBust: text.match(/MYTHS TO BUST[\s\S]*?(?=CONTENT PATTERNS|$)/)?.[0] || "",
        contentPatterns: text.match(/CONTENT PATTERNS[\s\S]*?(?=AUDIENCE LANGUAGE|$)/)?.[0] || "",
        audienceLanguage: text.match(/AUDIENCE LANGUAGE[\s\S]*$/)?.[0] || "",
        rawAnalysis: text
      };
    }

    return {
      ...videoData,
      analysis: {
        ...analysis,
        analyzedAt: new Date().toISOString(),
        analysisModel: "claude-3-5-sonnet-20241022"
      }
    };

  } catch (error) {
    logger?.error("❌ [ContentAnalyzer] Failed to analyze content", { 
      videoTitle: videoData.title,
      error: String(error) 
    });
    throw error;
  }
};

export const contentAnalysisTool = createTool({
  id: "content-analysis-tool",
  description: "Analyzes YouTube video content to extract audience insights, emotional hooks, and content patterns for script writing",
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
    })).describe("Array of scraped YouTube video data to analyze"),
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
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    const { videos } = context;
    
    // Add null check for videos
    if (!videos || !Array.isArray(videos)) {
      logger?.warn('⚠️ [ContentAnalyzer] No videos provided for analysis', { videos });
      return { analyzedVideos: [] };
    }
    
    logger?.info('🔧 [ContentAnalyzer] Starting batch content analysis', { videoCount: videos.length });
    
    const analyzedVideos = [];
    
    for (const video of videos) {
      try {
        logger?.info('📝 [ContentAnalyzer] Analyzing video', { title: video.title });
        const analyzedVideo = await analyzeVideoContent({ videoData: video, logger });
        analyzedVideos.push(analyzedVideo);
        
        // Add delay between API calls to respect rate limits
        if (videos.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        logger?.error('❌ [ContentAnalyzer] Failed to analyze video', { 
          videoTitle: video.title,
          error: String(error) 
        });
        // Continue with other videos even if one fails
      }
    }
    
    logger?.info('✅ [ContentAnalyzer] Completed batch analysis', { 
      analyzedCount: analyzedVideos.length,
      totalRequested: videos.length 
    });
    
    return { analyzedVideos };
  },
});