import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const downloadYouTubeAudio = async ({
  url,
  logger
}: {
  url: string;
  logger?: IMastraLogger;
}) => {
  logger?.info('🎵 [VideoDownloader] Starting YouTube audio download', { url });
  
  // Create temporary directory for downloads
  const tempDir = path.join(os.tmpdir(), 'youtube-audio');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Generate unique filename
  const timestamp = Date.now();
  const filename = `audio_${timestamp}.%(ext)s`;
  const outputPath = path.join(tempDir, filename);

  logger?.info('📁 [VideoDownloader] Prepared download path', { 
    tempDir,
    outputPattern: filename
  });

  return new Promise<{ audioPath: string; cleanup: () => void }>((resolve, reject) => {
    // yt-dlp arguments optimized for smallest audio file
    const args = [
      url,
      '-o', outputPath,
      '--extract-audio', // Extract audio only
      '--audio-format', 'mp3', // Convert to MP3 for smaller size
      '--audio-quality', '9', // Lowest quality for smallest size
      '--no-playlist', // Download single video only
      '--no-video', // Audio only, no video
      '--prefer-free-formats', // Prefer free formats
      '--no-write-info-json', // Don't create info files
      '--no-write-description', // Don't write description
      '--no-write-annotations', // Don't write annotations
      '--quiet' // Suppress most output
    ];

    logger?.info('🚀 [VideoDownloader] Executing yt-dlp with args', { 
      command: 'yt-dlp',
      args: args.join(' ')
    });

    const ytdlp = spawn('yt-dlp', args);

    let stderr = '';
    let stdout = '';

    ytdlp.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ytdlp.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ytdlp.on('close', (code) => {
      logger?.info('📊 [VideoDownloader] yt-dlp process finished', { 
        exitCode: code,
        stdoutLength: stdout.length,
        stderrLength: stderr.length
      });

      if (code !== 0) {
        logger?.error('❌ [VideoDownloader] Download failed', { 
          exitCode: code,
          stderr: stderr.substring(0, 500)
        });
        reject(new Error(`yt-dlp failed with code ${code}: ${stderr}`));
        return;
      }

      // Find the actual downloaded file (yt-dlp replaces %(ext)s with actual extension)
      const files = fs.readdirSync(tempDir);
      const audioFile = files.find(f => f.startsWith(`audio_${timestamp}`));
      
      if (!audioFile) {
        reject(new Error('Downloaded audio file not found'));
        return;
      }

      const actualAudioPath = path.join(tempDir, audioFile);
      const stats = fs.statSync(actualAudioPath);
      
      logger?.info('✅ [VideoDownloader] Audio downloaded successfully', { 
        audioPath: actualAudioPath,
        fileSize: `${(stats.size / 1024 / 1024).toFixed(2)} MB`,
        extension: path.extname(audioFile)
      });

      // Cleanup function to remove temporary files
      const cleanup = () => {
        try {
          if (fs.existsSync(actualAudioPath)) {
            fs.unlinkSync(actualAudioPath);
            logger?.info('🗑️ [VideoDownloader] Cleaned up temporary audio file', { audioPath: actualAudioPath });
          }
        } catch (error) {
          logger?.warn('⚠️ [VideoDownloader] Failed to cleanup temp file', { error: (error as Error).message });
        }
      };

      resolve({ 
        audioPath: actualAudioPath,
        cleanup 
      });
    });

    ytdlp.on('error', (error) => {
      logger?.error('❌ [VideoDownloader] yt-dlp spawn error', { error: error.message });
      reject(error);
    });

    // Set timeout for downloads (5 minutes)
    setTimeout(() => {
      ytdlp.kill();
      reject(new Error('Download timeout after 5 minutes'));
    }, 5 * 60 * 1000);
  });
};

export const videoDownloaderTool = createTool({
  id: "video-downloader-tool",
  description: `Downloads audio from YouTube videos optimized for transcription. Downloads the smallest possible audio file (low quality MP3) to minimize bandwidth and storage while preserving speech quality for transcription.`,
  inputSchema: z.object({
    url: z.string().url().describe("YouTube video URL to download audio from"),
  }),
  outputSchema: z.object({
    audioPath: z.string().describe("Path to the downloaded audio file"),
    fileSize: z.string().describe("Size of the downloaded audio file"),
    cleanup: z.function().describe("Function to clean up temporary files"),
  }),
  execute: async ({ context: { url }, mastra }) => {
    const logger = mastra?.getLogger();
    
    logger?.info('🔧 [VideoDownloader] Starting execution with params:', { url });
    
    try {
      const result = await downloadYouTubeAudio({ url, logger });
      
      const stats = fs.statSync(result.audioPath);
      const fileSize = `${(stats.size / 1024 / 1024).toFixed(2)} MB`;
      
      logger?.info('✅ [VideoDownloader] Completed successfully, returning:', { 
        audioPath: result.audioPath,
        fileSize 
      });
      
      return {
        audioPath: result.audioPath,
        fileSize,
        cleanup: result.cleanup
      };
    } catch (error) {
      logger?.error('❌ [VideoDownloader] Execution failed:', { error: (error as Error).message });
      throw error;
    }
  },
});