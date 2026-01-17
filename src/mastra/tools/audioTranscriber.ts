import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";
import * as fs from "fs";
import OpenAI from "openai";

const transcribeAudio = async ({
  audioPath,
  logger
}: {
  audioPath: string;
  logger?: IMastraLogger;
}) => {
  logger?.info('🎙️ [AudioTranscriber] Starting audio transcription', { audioPath });

  // Initialize OpenAI client
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key not found in environment variables');
  }

  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  const stats = fs.statSync(audioPath);
  logger?.info('📊 [AudioTranscriber] Audio file stats', { 
    path: audioPath,
    size: `${(stats.size / 1024 / 1024).toFixed(2)} MB`,
    exists: true
  });

  try {
    // Create a readable stream from the audio file
    const audioStream = fs.createReadStream(audioPath);
    
    logger?.info('🚀 [AudioTranscriber] Calling OpenAI Whisper API');
    
    const transcription = await openai.audio.transcriptions.create({
      file: audioStream,
      model: "whisper-1",
      response_format: "verbose_json", // Get detailed response with timestamps
      language: "en", // Optimize for English
    });

    logger?.info('✅ [AudioTranscriber] Transcription completed', { 
      textLength: transcription.text?.length || 0,
      duration: transcription.duration,
      language: transcription.language
    });

    return {
      text: transcription.text || '',
      duration: transcription.duration || 0,
      language: transcription.language || 'en',
      segments: transcription.segments || []
    };

  } catch (error) {
    logger?.error('❌ [AudioTranscriber] Transcription failed', { 
      error: (error as Error).message,
      audioPath 
    });
    throw error;
  }
};

export const audioTranscriberTool = createTool({
  id: "audio-transcriber-tool", 
  description: `Transcribes audio files to text using OpenAI's Whisper API. Optimized for YouTube video audio transcription with detailed output including timestamps and segments.`,
  inputSchema: z.object({
    audioPath: z.string().describe("Path to the audio file to transcribe"),
  }),
  outputSchema: z.object({
    text: z.string().describe("Transcribed text from the audio"),
    duration: z.number().describe("Duration of the audio in seconds"),
    language: z.string().describe("Detected language of the audio"),
    segments: z.array(z.any()).describe("Detailed transcription segments with timestamps"),
  }),
  execute: async ({ context: { audioPath }, mastra }) => {
    const logger = mastra?.getLogger();
    
    logger?.info('🔧 [AudioTranscriber] Starting execution with params:', { audioPath });
    
    try {
      const result = await transcribeAudio({ audioPath, logger });
      
      logger?.info('✅ [AudioTranscriber] Completed successfully, returning:', { 
        textLength: result.text.length,
        duration: result.duration,
        language: result.language,
        segmentCount: result.segments.length
      });
      
      return result;
    } catch (error) {
      logger?.error('❌ [AudioTranscriber] Execution failed:', { error: (error as Error).message });
      throw error;
    }
  },
});