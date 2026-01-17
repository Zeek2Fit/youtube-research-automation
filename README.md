# TubeAutomator - YouTube Research Automation

A complete YouTube content research automation system for analyzing competitor videos, extracting transcripts, and generating optimized content scripts. Built with the [Mastra](https://mastra.ai) framework.

## Features

- **Video Scraping**: Automated collection of competitor video metadata, transcripts, and comments
- **AI Transcription**: Download and transcribe videos using OpenAI Whisper (bypasses YouTube's blocked caption APIs)
- **Content Analysis**: AI-powered extraction of audience problems, emotional hooks, and content patterns
- **Script Generation**: Generate video scripts based on competitor insights and brand guidelines
- **Web Interface**: Settings management, workflow triggers, and transcript viewer
- **Library Mode**: Import tools directly into your own projects

## Quick Start

### Prerequisites

Before you begin, make sure you have:

- **Node.js 18+** - [Download here](https://nodejs.org/)
- **PostgreSQL database** - Local installation or cloud service (Neon, Supabase, etc.)
- **OpenAI API key** - [Get one here](https://platform.openai.com/api-keys)

### Installation

#### Option 1: Automated Setup (Recommended)

1. **Clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/tubeautomator.git
   cd tubeautomator
   ```

2. **Run the setup script**
   
   This will install yt-dlp, ffmpeg, and all npm dependencies:
   ```bash
   chmod +x scripts/setup.sh
   ./scripts/setup.sh
   ```

3. **Configure your environment**
   ```bash
   # The setup script creates .env from .env.example
   # Edit .env and add your credentials:
   nano .env
   ```
   
   Required variables:
   ```
   DATABASE_URL=postgresql://user:password@localhost:5432/tubeautomator
   OPENAI_API_KEY=sk-your-openai-key-here
   ```

4. **Start the server**
   ```bash
   npx mastra dev
   ```

5. **Open the web interface**
   
   Navigate to `http://localhost:5000`

#### Option 2: Manual Setup

1. **Clone and install dependencies**
   ```bash
   git clone https://github.com/YOUR_USERNAME/tubeautomator.git
   cd tubeautomator
   npm install
   ```

2. **Install system dependencies**
   
   **macOS:**
   ```bash
   brew install yt-dlp ffmpeg
   ```
   
   **Ubuntu/Debian:**
   ```bash
   sudo apt-get update
   sudo apt-get install -y yt-dlp ffmpeg
   ```
   
   **Windows (with Chocolatey):**
   ```bash
   choco install yt-dlp ffmpeg
   ```
   
   **Via pip (any platform):**
   ```bash
   pip3 install yt-dlp
   # ffmpeg must be installed separately
   ```

3. **Set up PostgreSQL database**
   ```bash
   # Create database
   createdb tubeautomator
   
   # Or use psql
   psql -c "CREATE DATABASE tubeautomator;"
   ```

4. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

5. **Start the server**
   ```bash
   npx mastra dev
   ```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `OPENAI_API_KEY` | Yes | OpenAI API key for Whisper transcription |
| `PUPPETEER_EXECUTABLE_PATH` | No | Custom Chromium path (uses bundled by default) |
| `CHROMIUM_PATH` | No | Alternative Chromium path |
| `PORT` | No | Server port (default: 5000) |

## System Dependencies

The automation requires these system tools:

- **yt-dlp**: YouTube video/audio downloader
- **ffmpeg**: Audio/video processing (used by yt-dlp)

### Installing on macOS
```bash
brew install yt-dlp ffmpeg
```

### Installing on Ubuntu/Debian
```bash
sudo apt-get install yt-dlp ffmpeg
```

### Installing via pip
```bash
pip3 install yt-dlp
```

## Using as a Library

You can import the tools directly into your own projects:

```typescript
import { 
  youTubeScrapeTool, 
  videoDownloaderTool, 
  audioTranscriberTool,
  contentAnalysisTool,
  scriptGeneratorTool 
} from './src/mastra/tools';

// Example: Download and transcribe a video standalone
// Note: Tools require mastra context for logging. For standalone use:
const downloadResult = await videoDownloaderTool.execute({
  context: { url: 'https://www.youtube.com/watch?v=VIDEO_ID' },
  mastra: undefined as any,
  runtimeContext: undefined as any,
  tracingContext: {} as any
});

const transcription = await audioTranscriberTool.execute({
  context: { audioPath: downloadResult.audioPath },
  mastra: undefined as any,
  runtimeContext: undefined as any,
  tracingContext: {} as any
});

console.log(transcription.text);

// Clean up the downloaded audio file
downloadResult.cleanup();
```

### Integration with Mastra

If you're using the tools within a Mastra workflow or agent, pass the context objects:

```typescript
// Inside a Mastra workflow step
const result = await videoDownloaderTool.execute({
  context: { url: videoUrl },
  mastra,
  runtimeContext,
  tracingContext: {} as any
});
```

## Available Tools

| Tool | Description |
|------|-------------|
| `youTubeScrapeTool` | Scrape YouTube videos for metadata, transcripts, and comments |
| `videoDownloaderTool` | Download audio from YouTube videos using yt-dlp |
| `audioTranscriberTool` | Transcribe audio files using OpenAI Whisper |
| `contentAnalysisTool` | Analyze video content for audience insights |
| `scriptGeneratorTool` | Generate video scripts based on research |
| `dataStorageTool` | Store and retrieve analysis results |
| `simpleVideoTrackerTool` | Track processed videos to avoid duplicates |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/workflow/run` | POST | Trigger the research workflow |
| `/api/workflow/status` | GET | Get workflow status |
| `/api/settings` | GET/POST | Manage automation settings |
| `/api/transcripts` | GET | Retrieve all transcripts |

## Project Structure

```
├── src/
│   └── mastra/
│       ├── agents/          # AI agents
│       ├── tools/           # Core automation tools
│       │   ├── index.ts     # Tool exports for library use
│       │   ├── youtubeScraper.ts
│       │   ├── videoDownloader.ts
│       │   ├── audioTranscriber.ts
│       │   ├── contentAnalyzer.ts
│       │   └── scriptGenerator.ts
│       ├── workflows/       # Workflow definitions
│       └── index.ts         # Mastra instance
├── public/                  # Web interface
├── scripts/
│   └── setup.sh            # Local setup script
├── shared/
│   └── schema.ts           # Database schema
├── .env.example            # Environment template
└── package.json
```

## Troubleshooting

### Puppeteer/Chromium Issues

If you encounter browser launch errors:

1. **On Replit**: The `PUPPETEER_EXECUTABLE_PATH` is auto-configured
2. **Locally**: Leave `PUPPETEER_EXECUTABLE_PATH` empty to use Puppeteer's bundled Chromium
3. **Custom install**: Set `PUPPETEER_EXECUTABLE_PATH=/path/to/chromium`

### yt-dlp Download Failures

- Ensure yt-dlp is up to date: `pip3 install -U yt-dlp`
- Some videos may be geo-restricted or age-gated
- Check if ffmpeg is installed: `ffmpeg -version`

### Transcription Issues

- Verify your `OPENAI_API_KEY` is valid
- Check OpenAI API usage limits
- Large files (>25MB) may take longer to process

## License

MIT
