import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";
import { promises as fs } from "fs";
import { join } from "path";

interface VideoRecord {
  videoId: string;
  url: string;
  title?: string;
  channelName?: string;
  scrapedAt: string;
  isAnalyzed: boolean;
  analysisFile?: string;
}

interface VideoTrackingData {
  videos: VideoRecord[];
  lastUpdated: string;
}

const TRACKING_FILE = join(process.cwd(), 'data', 'video_tracking.json');

const ensureTrackingFile = async (logger?: IMastraLogger): Promise<VideoTrackingData> => {
  try {
    // Ensure data directory exists
    const dataDir = join(process.cwd(), 'data');
    await fs.mkdir(dataDir, { recursive: true });
    
    // Try to read existing file
    const content = await fs.readFile(TRACKING_FILE, 'utf-8');
    return JSON.parse(content) as VideoTrackingData;
  } catch (error) {
    // File doesn't exist, create new tracking data
    logger?.info("📝 [SimpleVideoTracker] Creating new tracking file");
    const initialData: VideoTrackingData = {
      videos: [],
      lastUpdated: new Date().toISOString()
    };
    
    await fs.writeFile(TRACKING_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
    return initialData;
  }
};

const saveTrackingData = async (data: VideoTrackingData, logger?: IMastraLogger): Promise<void> => {
  data.lastUpdated = new Date().toISOString();
  await fs.writeFile(TRACKING_FILE, JSON.stringify(data, null, 2), 'utf-8');
  logger?.info("💾 [SimpleVideoTracker] Tracking data saved", { totalVideos: data.videos.length });
};

const extractVideoId = (url: string): string => {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/v\/([^&\n?#]+)/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  throw new Error(`Invalid YouTube URL format: ${url}`);
};

const checkDuplicates = async ({ videoUrls, logger }: { videoUrls: string[], logger?: IMastraLogger }) => {
  logger?.info("🔍 [SimpleVideoTracker] Checking for duplicate videos", { count: videoUrls.length });
  
  const trackingData = await ensureTrackingFile(logger);
  const results = [];
  
  for (const url of videoUrls) {
    try {
      const videoId = extractVideoId(url);
      const existingVideo = trackingData.videos.find(v => v.videoId === videoId);
      
      if (existingVideo) {
        logger?.info("✅ [SimpleVideoTracker] Video already exists", { 
          videoId, 
          title: existingVideo.title,
          scrapedAt: existingVideo.scrapedAt 
        });
        
        results.push({
          url,
          videoId,
          exists: true,
          existingVideo,
          shouldSkip: true
        });
      } else {
        logger?.info("🆕 [SimpleVideoTracker] New video to scrape", { videoId, url });
        results.push({
          url,
          videoId,
          exists: false,
          shouldSkip: false
        });
      }
    } catch (error) {
      logger?.error("❌ [SimpleVideoTracker] Invalid URL", { url, error: String(error) });
      results.push({
        url,
        videoId: null,
        exists: false,
        shouldSkip: false,
        error: String(error)
      });
    }
  }
  
  const newVideos = results.filter(r => !r.exists && !r.error);
  const duplicateVideos = results.filter(r => r.exists);
  
  logger?.info("📊 [SimpleVideoTracker] Duplicate check complete", {
    total: videoUrls.length,
    duplicates: duplicateVideos.length,
    new: newVideos.length,
    errors: results.filter(r => r.error).length
  });
  
  return {
    results,
    summary: {
      total: videoUrls.length,
      duplicates: duplicateVideos.length,
      new: newVideos.length,
      newUrls: newVideos.map(v => v.url),
      duplicateUrls: duplicateVideos.map(v => v.url)
    }
  };
};

const trackNewVideo = async ({
  videoId,
  url,
  title,
  channelName,
  logger
}: {
  videoId: string;
  url: string;
  title?: string;
  channelName?: string;
  logger?: IMastraLogger;
}) => {
  logger?.info("📝 [SimpleVideoTracker] Tracking new video", { videoId, title });
  
  const trackingData = await ensureTrackingFile(logger);
  
  // Check if video already exists
  const existingIndex = trackingData.videos.findIndex(v => v.videoId === videoId);
  
  const videoRecord: VideoRecord = {
    videoId,
    url,
    title,
    channelName,
    scrapedAt: new Date().toISOString(),
    isAnalyzed: false
  };
  
  if (existingIndex >= 0) {
    // Update existing record
    trackingData.videos[existingIndex] = { ...trackingData.videos[existingIndex], ...videoRecord };
    logger?.info("📝 [SimpleVideoTracker] Updated existing video record", { videoId });
  } else {
    // Add new record
    trackingData.videos.push(videoRecord);
    logger?.info("📝 [SimpleVideoTracker] Added new video record", { videoId });
  }
  
  await saveTrackingData(trackingData, logger);
  
  return videoRecord;
};

export const simpleVideoTrackerTool = createTool({
  id: "simple-video-tracker-tool",
  description: "Simple file-based video tracking system to prevent duplicate scraping and manage video history",
  inputSchema: z.object({
    action: z.enum(["check", "track", "list", "clear"]).describe("Action to perform"),
    videoUrls: z.array(z.string().url()).optional().describe("YouTube video URLs to check"),
    videoData: z.object({
      videoId: z.string(),
      url: z.string(),
      title: z.string().optional(),
      channelName: z.string().optional(),
    }).optional().describe("Video data to track"),
    limit: z.number().default(50).optional().describe("Limit for list action")
  }),
  outputSchema: z.object({
    action: z.string(),
    success: z.boolean(),
    results: z.any().optional(),
    summary: z.object({
      total: z.number().optional(),
      duplicates: z.number().optional(),
      new: z.number().optional(),
      newUrls: z.array(z.string()).optional(),
      duplicateUrls: z.array(z.string()).optional(),
    }).optional(),
    videos: z.array(z.any()).optional(),
    message: z.string().optional()
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    const { action, videoUrls, videoData, limit } = context;
    
    logger?.info('🔧 [SimpleVideoTracker] Starting execution', { action });
    
    try {
      if (action === "check" && videoUrls) {
        const checkResult = await checkDuplicates({ videoUrls, logger });
        
        return {
          action: "check",
          success: true,
          results: checkResult.results,
          summary: checkResult.summary
        };
        
      } else if (action === "track" && videoData) {
        const trackedVideo = await trackNewVideo({ ...videoData, logger });
        
        return {
          action: "track",
          success: true,
          results: [trackedVideo],
          summary: { total: 1, new: 1, duplicates: 0 }
        };
        
      } else if (action === "list") {
        const trackingData = await ensureTrackingFile(logger);
        const videos = trackingData.videos
          .sort((a, b) => new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime())
          .slice(0, limit);
        
        return {
          action: "list",
          success: true,
          videos,
          summary: { total: videos.length }
        };
        
      } else if (action === "clear") {
        const emptyData: VideoTrackingData = {
          videos: [],
          lastUpdated: new Date().toISOString()
        };
        await saveTrackingData(emptyData, logger);
        
        return {
          action: "clear",
          success: true,
          message: "Video tracking data cleared",
          summary: { total: 0, duplicates: 0, new: 0 }
        };
        
      } else {
        throw new Error(`Invalid action '${action}' or missing required parameters`);
      }
      
    } catch (error) {
      logger?.error('❌ [SimpleVideoTracker] Execution failed', { action, error: String(error) });
      return {
        action,
        success: false,
        message: String(error),
        summary: { total: 0, duplicates: 0, new: 0 }
      };
    }
  },
});