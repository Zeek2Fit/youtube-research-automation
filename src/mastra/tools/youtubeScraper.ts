import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";
import puppeteer from "puppeteer";
import * as cheerio from "cheerio";
import axios from "axios";
import { chromium } from "playwright";
import { existsSync } from "fs";
import { execSync } from "child_process";

import { simpleVideoTrackerTool } from "./simpleVideoTracker";
import { videoDownloaderTool } from "./videoDownloader";
import { audioTranscriberTool } from "./audioTranscriber";
import { db } from "../storage";
import { videos as videosTable } from "../../../shared/schema";
import { inArray } from "drizzle-orm";

// Auto-detect Chromium path for different environments
const findChromiumPath = async (logger?: IMastraLogger): Promise<string | undefined> => {
  // 1. Check environment variables first (highest priority)
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    logger?.info("📍 [Chromium] Using PUPPETEER_EXECUTABLE_PATH", { path: process.env.PUPPETEER_EXECUTABLE_PATH });
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  if (process.env.CHROMIUM_PATH) {
    logger?.info("📍 [Chromium] Using CHROMIUM_PATH", { path: process.env.CHROMIUM_PATH });
    return process.env.CHROMIUM_PATH;
  }

  // 2. Check for Nix/Replit environment
  try {
    const nixChromium = execSync('ls /nix/store/*/bin/chromium 2>/dev/null | head -1', { encoding: 'utf8' }).trim();
    if (nixChromium && existsSync(nixChromium)) {
      logger?.info("📍 [Chromium] Found Nix Chromium", { path: nixChromium });
      return nixChromium;
    }
  } catch {
    // Nix not available, continue
  }

  // 3. Check common system paths
  const commonPaths = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ];

  for (const path of commonPaths) {
    if (existsSync(path)) {
      logger?.info("📍 [Chromium] Found system Chromium", { path });
      return path;
    }
  }

  // 4. Fallback to bundled Puppeteer Chromium (local dev default)
  logger?.info("📍 [Chromium] Using Puppeteer bundled Chromium");
  return undefined;
};

// Enhanced transcript extraction using Playwright for reliable access
const getTranscriptViaPlaywright = async (videoUrl: string, logger?: IMastraLogger): Promise<string> => {
  logger?.info("🎭 [YouTubeScraper] Starting Playwright transcript extraction", { videoUrl });
  
  const browser = await chromium.launch({ 
    headless: true, // Start headless for production
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security'
    ]
  });
  
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US'
    });
    
    const page = await context.newPage();
    
    // Navigate like a real user
    logger?.info("📄 [YouTubeScraper] Navigating to video page", { videoUrl });
    await page.goto(videoUrl);
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    
    // Wait for video to load
    await page.waitForTimeout(3000);
    
    // Try to find and click the transcript button
    logger?.info("🔍 [YouTubeScraper] Looking for transcript options");
    
    // Look for the three dots menu (More actions)
    const moreActionsButton = page.locator('[aria-label="More actions"], [aria-label="Show more"], button[aria-label*="menu"]').first();
    
    if (await moreActionsButton.isVisible({ timeout: 5000 })) {
      await moreActionsButton.click();
      await page.waitForTimeout(1000);
      
      // Look for "Show transcript" option
      const transcriptOption = page.locator('text="Show transcript", text="Transcript"').first();
      
      if (await transcriptOption.isVisible({ timeout: 3000 })) {
        logger?.info("📜 [YouTubeScraper] Found transcript option, clicking");
        await transcriptOption.click();
        await page.waitForTimeout(3000);
        
        // Wait for transcript to load and extract segments
        const transcriptSegments = await page.$$eval(
          'ytd-transcript-segment-renderer, [class*="transcript-segment"]',
          segments => segments.map(segment => {
            const textElement = segment.querySelector('.segment-text, [class*="segment-text"]');
            return textElement ? textElement.textContent?.trim() : null;
          }).filter(text => text && text.length > 0)
        );
        
        if (transcriptSegments.length > 0) {
          const fullTranscript = transcriptSegments.join(' ');
          logger?.info("✅ [YouTubeScraper] Successfully extracted transcript via Playwright", {
            transcriptLength: fullTranscript.length,
            segmentCount: transcriptSegments.length
          });
          return fullTranscript;
        }
      }
    }
    
    // Alternative: Extract captions from ytInitialPlayerResponse
    logger?.info("🔄 [YouTubeScraper] Trying caption extraction from ytInitialPlayerResponse");
    
    try {
      // Get ytInitialPlayerResponse from the page
      const playerResponse = await page.evaluate(() => {
        return (window as any).ytInitialPlayerResponse;
      });
      
      logger?.info("📊 [YouTubeScraper] Found ytInitialPlayerResponse, searching for caption tracks");
      
      if (playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
        const captionTracks = playerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
        
        // Find English caption track (prefer manual over auto-generated)
        const englishTrack = captionTracks.find((track: any) => 
          (track.languageCode === 'en' || track.languageCode?.startsWith('en')) && !track.kind
        ) || captionTracks.find((track: any) => 
          (track.languageCode === 'en' || track.languageCode?.startsWith('en')) && track.kind === 'asr'
        );
        
        if (englishTrack?.baseUrl) {
          logger?.info("🎯 [YouTubeScraper] Found English caption track", {
            language: englishTrack.languageCode,
            kind: englishTrack.kind || 'manual',
            name: englishTrack.name?.simpleText
          });
          
          // Fetch the transcript from the caption URL with proper format and headers
          const captionUrl = new URL(englishTrack.baseUrl);
          // Set proper JSON format parameters
          captionUrl.searchParams.set('fmt', 'json3'); // Use json3 for JSON response
          captionUrl.searchParams.set('xorb', '2');
          captionUrl.searchParams.set('xobt', '3'); 
          captionUrl.searchParams.set('xovt', '3');
          captionUrl.searchParams.set('hl', 'en');
          
          logger?.info("🌐 [YouTubeScraper] Fetching caption data", {
            url: captionUrl.origin + captionUrl.pathname + '?' + captionUrl.searchParams.toString().substring(0, 100) + '...',
            track: englishTrack.name?.simpleText
          });
          
          // Use the browser context to fetch captions with proper credentials
          const response = await page.evaluate(async (url) => {
            const response = await fetch(url, { 
              credentials: 'include', 
              redirect: 'follow' 
            });
            return {
              ok: response.ok,
              status: response.status,
              statusText: response.statusText,
              text: await response.text(),
              contentType: response.headers.get('content-type'),
              type: response.type
            };
          }, captionUrl.toString());
          
          if (!response.ok) {
            throw new Error(`Caption fetch failed: ${response.status} ${response.statusText}`);
          }
          
          let responseText = response.text;
          logger?.info("📄 [YouTubeScraper] Caption API response", {
            responseLength: responseText.length,
            contentType: response.contentType,
            status: response.status,
            type: response.type,
            responsePreview: responseText.substring(0, 200)
          });
          
          // Check for HTML error responses (blocked/gated access)
          if (response.contentType && response.contentType.includes('text/html')) {
            throw new Error("Got HTML error response instead of JSON captions");
          }
          
          if (!responseText || responseText.trim().length === 0) {
            throw new Error("Empty response from caption API");
          }
          
          // Strip YouTube's XSSI prefix before JSON parsing
          responseText = responseText.replace(/^\)\]\}'\n?/, '');
          
          const transcriptData = JSON.parse(responseText);
          
          if (transcriptData.events && Array.isArray(transcriptData.events)) {
            const transcript = transcriptData.events
              .filter((event: any) => event.segs && Array.isArray(event.segs))
              .flatMap((event: any) => event.segs)
              .map((seg: any) => seg.utf8)
              .filter((text: string) => text && text.trim() && text !== '\n')
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim();
            
            // Filter out obvious UI words as sanity check
            const uiWords = ['Subscribe', 'Premium', 'Terms', 'Unsubscribe', 'Cancel', 'Sign in', 'playlist'];
            const cleanTranscript = transcript.split(' ').filter((word: string) => 
              !uiWords.some((uiWord: string) => word.includes(uiWord))
            ).join(' ');
            
            if (cleanTranscript.length > 50) { // Ensure substantial content
              logger?.info("✅ [YouTubeScraper] Successfully extracted transcript from caption track", {
                transcriptLength: cleanTranscript.length,
                wordCount: cleanTranscript.split(' ').length,
                eventCount: transcriptData.events.length,
                preview: cleanTranscript.substring(0, 120) + '...'
              });
              return cleanTranscript;
            } else {
              logger?.info("⚠️ [YouTubeScraper] Caption track too short after filtering", {
                rawLength: transcript.length,
                cleanLength: cleanTranscript.length
              });
            }
          }
        } else {
          logger?.info("📝 [YouTubeScraper] No English caption tracks found", {
            availableTracks: captionTracks.map((t: any) => ({
              language: t.languageCode,
              kind: t.kind || 'manual',
              name: t.name?.simpleText
            }))
          });
        }
      } else {
        logger?.info("📝 [YouTubeScraper] No caption tracks available in player response");
      }
      
    } catch (playerError) {
      logger?.warn("⚠️ [YouTubeScraper] Failed to extract from ytInitialPlayerResponse", { 
        error: String(playerError) 
      });
    }
    
    logger?.warn("❌ [YouTubeScraper] No transcript found via Playwright");
    return "";
    
  } finally {
    await browser.close();
  }
};

// Download and transcribe approach to bypass YouTube's API blocking
const getYouTubeTranscriptViaDownload = async (
  videoUrl: string, 
  mastra: any, 
  runtimeContext: any,
  logger?: IMastraLogger
): Promise<string> => {
  logger?.info("🎵 [YouTubeScraper] Starting download+transcribe approach", { videoUrl });
  
  let cleanup: (() => void) | null = null;
  
  try {
    // Step 1: Download audio from YouTube video
    logger?.info("📥 [YouTubeScraper] Downloading audio from video");
    const downloadResult = await videoDownloaderTool.execute({
      context: { url: videoUrl },
      mastra,
      runtimeContext,
      tracingContext: {} as any
    });
    
    cleanup = downloadResult.cleanup;
    
    logger?.info("✅ [YouTubeScraper] Audio download completed", {
      audioPath: downloadResult.audioPath,
      fileSize: downloadResult.fileSize
    });
    
    // Step 2: Transcribe the downloaded audio
    logger?.info("🎙️ [YouTubeScraper] Transcribing audio to text");
    const transcriptionResult = await audioTranscriberTool.execute({
      context: { audioPath: downloadResult.audioPath },
      mastra,
      runtimeContext,
      tracingContext: {} as any
    });
    
    logger?.info("✅ [YouTubeScraper] Transcription completed successfully", {
      textLength: transcriptionResult.text.length,
      duration: transcriptionResult.duration,
      language: transcriptionResult.language
    });
    
    return transcriptionResult.text;
    
  } catch (error) {
    logger?.error("❌ [YouTubeScraper] Download+transcribe failed", { 
      error: (error as Error).message,
      videoUrl 
    });
    return ""; // Return empty string on failure, similar to old approach
  } finally {
    // Always clean up downloaded files
    if (cleanup) {
      try {
        cleanup();
      } catch (cleanupError) {
        logger?.warn("⚠️ [YouTubeScraper] Cleanup warning", { error: (cleanupError as Error).message });
      }
    }
  }
};


const getYouTubeVideoData = async ({
  videoUrl,
  mastra,
  runtimeContext,
  logger,
}: {
  videoUrl: string;
  mastra: any;
  runtimeContext: any;
  logger?: IMastraLogger;
}) => {
  logger?.info("🔧 [YouTubeScraper] Starting video data extraction", { videoUrl });

  try {
    // Extract video ID from URL
    const videoIdMatch = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (!videoIdMatch) {
      throw new Error("Invalid YouTube URL format");
    }
    const videoId = videoIdMatch[1];
    logger?.info("📝 [YouTubeScraper] Extracted video ID", { videoId });

    // Get transcript using download+transcribe approach
    const transcript = await getYouTubeTranscriptViaDownload(videoUrl, mastra, runtimeContext, logger);
    logger?.info("📝 [YouTubeScraper] Retrieved transcript via download+transcribe", { 
      transcriptLength: transcript.length 
    });

    // Launch browser for scraping video metadata and comments
    // Support both Replit (Nix Chromium) and local environments (Puppeteer's bundled Chromium)
    const chromiumPath = await findChromiumPath(logger);
    logger?.info("📝 [YouTubeScraper] Launching browser", { 
      chromiumPath: chromiumPath || 'bundled',
      usingCustomPath: !!chromiumPath
    });
    const browser = await puppeteer.launch({
      headless: true,
      ...(chromiumPath ? { executablePath: chromiumPath } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--no-first-run',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
        '--no-zygote'
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    // Navigate to video page
    await page.goto(videoUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Wait for content to load
    await page.waitForSelector('h1.ytd-watch-metadata', { timeout: 30000 });
    
    logger?.info("📝 [YouTubeScraper] Page loaded, extracting metadata");

    // Extract video metadata
    const videoData = await page.evaluate(() => {
      const titleElement = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
      const viewsElement = document.querySelector('.view-count');
      const likesElement = document.querySelector('#top-level-buttons-computed button[aria-label*="like"]');
      const descriptionElement = document.querySelector('#expand-singleline, #description');
      const channelElement = document.querySelector('#channel-name a, .ytd-channel-name a');
      const subscribersElement = document.querySelector('#owner-sub-count');
      const tagsElements = document.querySelectorAll('meta[property="og:video:tag"]');

      return {
        title: titleElement?.textContent?.trim() || 'Title not found',
        views: viewsElement?.textContent?.trim() || '0 views',
        likes: likesElement?.getAttribute('aria-label') || 'Likes not found',
        description: descriptionElement?.textContent?.trim() || 'Description not found',
        channelName: channelElement?.textContent?.trim() || 'Channel not found',
        subscribers: subscribersElement?.textContent?.trim() || 'Subscribers not found',
        tags: Array.from(tagsElements).map(tag => tag.getAttribute('content')).filter((tag): tag is string => tag !== null)
      };
    });

    logger?.info("📝 [YouTubeScraper] Extracted video metadata", videoData);

    // Scroll down to load comments
    logger?.info("📝 [YouTubeScraper] Loading comments");
    await page.evaluate(() => {
      window.scrollTo(0, 1000);
    });
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Try to load more comments by clicking "Show more"
    try {
      await page.waitForSelector('#comments', { timeout: 10000 });
      await page.evaluate(() => {
        window.scrollTo(0, 2000);
      });
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (error) {
      logger?.warn("⚠️ [YouTubeScraper] Could not load comments section", { error: String(error) });
    }

    // Extract comments
    const comments = await page.evaluate(() => {
      const commentElements = document.querySelectorAll('#content-text');
      const commentsArray = [];
      
      for (let i = 0; i < Math.min(commentElements.length, 50); i++) { // Limit to 50 comments
        const commentText = commentElements[i]?.textContent?.trim();
        if (commentText && commentText.length > 10) {
          commentsArray.push(commentText);
        }
      }
      
      return commentsArray;
    });

    logger?.info("📝 [YouTubeScraper] Extracted comments", { commentCount: comments.length });

    await browser.close();

    const result = {
      videoId,
      url: videoUrl,
      title: videoData.title,
      views: videoData.views,
      likes: videoData.likes,
      description: videoData.description,
      channelName: videoData.channelName,
      subscribers: videoData.subscribers,
      tags: videoData.tags,
      transcript,
      comments: comments.slice(0, 50), // Limit comments
      scrapedAt: new Date().toISOString()
    };

    logger?.info("✅ [YouTubeScraper] Successfully extracted video data", {
      title: result.title,
      commentCount: result.comments.length,
      transcriptLength: result.transcript.length
    });

    return result;

  } catch (error) {
    logger?.error("❌ [YouTubeScraper] Failed to extract video data", { 
      videoUrl, 
      error: String(error) 
    });
    throw error;
  }
};

export const youTubeScrapeTool = createTool({
  id: "youtube-scrape-tool",
  description: "Scrapes YouTube videos to extract metadata, transcripts, and comments for content analysis",
  inputSchema: z.object({
    videoUrls: z.array(z.string().url()).describe("Array of YouTube video URLs to scrape"),
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
  execute: async ({ context, mastra, runtimeContext }) => {
    const logger = mastra?.getLogger();
    const { videoUrls } = context;
    
    logger?.info('🔧 [YouTubeScraper] Starting execution with duplicate prevention', { 
      requestedVideos: videoUrls.length 
    });
    
    // Step 1: Check for duplicates using video tracker
    logger?.info('🔍 [YouTubeScraper] Checking for duplicate videos');
    const duplicateCheck = await simpleVideoTrackerTool.execute({
      context: { 
        action: "check", 
        videoUrls 
      },
      mastra,
      runtimeContext: runtimeContext || {},
      tracingContext: {}
    });
    
    if (!duplicateCheck.success) {
      logger?.error('❌ [YouTubeScraper] Failed to check duplicates', { error: duplicateCheck.message });
      throw new Error(`Duplicate check failed: ${duplicateCheck.message}`);
    }
    
    // Step 2: Check database presence to override file-based duplicate detection
    let finalVideosToScrape = duplicateCheck.summary?.newUrls || [];
    const fileTrackerDuplicates = duplicateCheck.summary?.duplicateUrls || [];
    
    logger?.info('📊 [YouTubeScraper] File tracker results', {
      total: videoUrls.length,
      fileTrackerDuplicates: fileTrackerDuplicates.length,
      newFromTracker: finalVideosToScrape.length
    });
    
    // Check database presence for videos marked as duplicates by file tracker
    if (fileTrackerDuplicates.length > 0) {
      logger?.info('🔍 [YouTubeScraper] Checking database presence for file-tracked duplicates');
      
      try {
        // Extract video IDs from URLs
        const videoIdsToCheck = fileTrackerDuplicates
          .map(url => {
            const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
            return match ? match[1] : null;
          })
          .filter((id): id is string => id !== null);
        
        logger?.info('🔍 [YouTubeScraper] Extracted video IDs to check', { 
          videoIds: videoIdsToCheck.slice(0, 5) // Log first 5 for debugging
        });
        
        // Query database for existing videos
        const existingVideos = await db.select({ videoId: videosTable.videoId })
          .from(videosTable)
          .where(inArray(videosTable.videoId, videoIdsToCheck));
        
        const existingVideoIds = new Set(existingVideos.map(v => v.videoId));
        
        logger?.info('💾 [YouTubeScraper] Database presence check', {
          checkedIds: videoIdsToCheck.length,
          foundInDb: existingVideoIds.size,
          missingFromDb: videoIdsToCheck.length - existingVideoIds.size
        });
        
        // Add videos that are in file tracker but NOT in database back to scrape list
        const videosToReAdd = fileTrackerDuplicates.filter(url => {
          const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
          const videoId = match ? match[1] : null;
          return videoId && !existingVideoIds.has(videoId);
        });
        
        if (videosToReAdd.length > 0) {
          finalVideosToScrape = [...finalVideosToScrape, ...videosToReAdd];
          logger?.info('🔄 [YouTubeScraper] Re-adding videos missing from database', { 
            reAddedCount: videosToReAdd.length,
            reAddedUrls: videosToReAdd
          });
        }
      } catch (dbError) {
        logger?.error('❌ [YouTubeScraper] Database check failed, falling back to file tracker only', {
          error: String(dbError)
        });
      }
    }
    
    const actualDuplicates = videoUrls.filter(url => !finalVideosToScrape.includes(url));
    
    logger?.info('📊 [YouTubeScraper] Final duplicate check results', {
      total: videoUrls.length,
      duplicates: actualDuplicates.length,
      toScrape: finalVideosToScrape.length
    });
    
    if (actualDuplicates.length > 0) {
      logger?.info('⏭️  [YouTubeScraper] Skipping videos (exist in database)', { actualDuplicates });
    }
    
    if (finalVideosToScrape.length === 0) {
      logger?.info('✅ [YouTubeScraper] All videos already exist in database, returning empty result');
      return { videos: [] };
    }
    
    // Step 3: Scrape videos that are missing from database
    const videos = [];
    
    for (const videoUrl of finalVideosToScrape) {
      try {
        logger?.info('📹 [YouTubeScraper] Scraping new video', { videoUrl });
        const videoData = await getYouTubeVideoData({ videoUrl, mastra, runtimeContext, logger });
        videos.push(videoData);
        
        // Step 4: Track the newly scraped video
        logger?.info('📝 [YouTubeScraper] Tracking scraped video', { videoId: videoData.videoId });
        await simpleVideoTrackerTool.execute({
          context: {
            action: "track",
            videoData: {
              videoId: videoData.videoId,
              url: videoData.url,
              title: videoData.title,
              channelName: videoData.channelName
            }
          },
          mastra,
          runtimeContext: runtimeContext || {},
          tracingContext: {}
        });
        
        // Add delay between requests to be respectful
        if (finalVideosToScrape.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        logger?.error('❌ [YouTubeScraper] Failed to scrape video', { 
          videoUrl, 
          error: String(error) 
        });
        // Continue with other videos even if one fails
      }
    }
    
    logger?.info('✅ [YouTubeScraper] Completed scraping with database-aware duplicate prevention', { 
      totalRequested: videoUrls.length,
      duplicatesSkipped: actualDuplicates.length,
      newVideosScraped: videos.length
    });
    
    return { videos };
  },
});