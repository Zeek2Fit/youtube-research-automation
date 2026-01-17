# TubeAutomator - YouTube Research Automation

## Overview

This is a complete YouTube content research automation system built with the Mastra framework. The application helps fitness content creators (specifically targeting busy fathers aged 30-45) analyze competitor YouTube channels, extract insights from videos, and generate optimized content scripts. The system uses AI agents to scrape YouTube videos, analyze content patterns, store data, and generate video scripts based on competitor research and audience insights.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Agent Architecture
The system is built around the Mastra framework, which provides a comprehensive agent orchestration platform. The core architecture consists of:

- **Dynamic Agents**: Configurable agents that can adapt their behavior, model selection, and tool usage based on runtime context
- **Workflow Orchestration**: Event-driven workflow system using Inngest for reliable background job processing
- **Tool System**: Modular tools for specific tasks like web scraping, content analysis, and data storage

### Data Storage Strategy
The application uses a PostgreSQL database with Drizzle ORM for structured data management:

- **Primary Database**: PostgreSQL for persistent storage of video metadata, analysis results, and workflow tracking
- **Schema Design**: Separate tables for settings, videos, workflow runs, and content analysis
- **File Storage**: Local file system for temporary data exports and analysis reports
- **Backup Strategy**: Simple video tracking system using JSON files for redundancy

### Core Workflow Components
The system implements a multi-step YouTube research workflow:

1. **Video Scraping**: Automated collection of competitor video data including metadata, transcripts, and comments
2. **Content Analysis**: AI-powered analysis of video content to extract audience problems, emotional hooks, and content patterns
3. **Data Storage**: Persistent storage of analysis results with timestamped exports
4. **Script Generation**: AI-generated video scripts based on competitor insights and brand guidelines

### Web Scraping Architecture
The scraping system uses Puppeteer for browser automation with a download+transcribe approach:

- **Headless Browser**: Puppeteer configuration with environment-portable Chromium paths (uses PUPPETEER_EXECUTABLE_PATH or bundled Chromium)
- **Transcript Extraction**: Download+transcribe approach using yt-dlp and OpenAI Whisper (bypasses YouTube's blocked caption APIs)
- **Comment Scraping**: Dynamic content loading to capture user engagement data
- **Error Handling**: Graceful degradation when transcripts or comments are unavailable

### Local Development
For running locally or integrating into other projects:

- **Setup Script**: Run `./scripts/setup.sh` to install yt-dlp, ffmpeg, and npm dependencies
- **Tool Exports**: Import tools directly via `src/mastra/tools/index.ts` for library-style usage
- **Environment Config**: Copy `.env.example` to `.env` and configure your API keys
- **System Dependencies**: yt-dlp and ffmpeg are required for video download and transcription

### AI Integration
The system leverages multiple AI providers for different tasks:

- **Multi-Provider Support**: Integration with OpenAI, Anthropic, and OpenRouter
- **Model Selection**: Dynamic model selection based on user tier and task complexity
- **Content Analysis**: Specialized prompts for extracting audience insights and content patterns
- **Script Generation**: Brand-specific script generation with configurable voice and style

### Web Interface
The application features a complete web frontend for managing the automation:

- **Settings Management**: Toggle between manual and auto modes, configure schedules and video URLs
- **Workflow Control**: Manual trigger controls and real-time status monitoring
- **Transcript Viewer**: Search and view all scraped video transcripts
- **Data Export**: Export analysis results and generated scripts

### External Service Integration
Key integrations include:

- **Inngest**: Background job processing and workflow orchestration
- **YouTube APIs**: Transcript extraction and video metadata
- **Database Services**: PostgreSQL for persistent storage
- **AI Providers**: OpenAI, Anthropic, and OpenRouter for content analysis
- **Monitoring**: Pino logger for structured logging and debugging

## External Dependencies

### Core Framework Dependencies
- **@mastra/core**: Main framework for agent orchestration and workflow management
- **@mastra/inngest**: Integration with Inngest for background job processing
- **@mastra/pg**: PostgreSQL integration with connection pooling
- **@mastra/memory**: Memory management for agent contexts
- **@mastra/loggers**: Structured logging system

### AI and Machine Learning
- **@ai-sdk/openai**: OpenAI integration for GPT models
- **@ai-sdk/anthropic**: Anthropic Claude model integration
- **@openrouter/ai-sdk-provider**: OpenRouter API access for multiple AI providers
- **ai**: Vercel AI SDK for unified AI model interactions

### Web Scraping and Data Processing
- **puppeteer**: Browser automation for YouTube data scraping
- **cheerio**: Server-side HTML parsing and manipulation
- **youtube-transcript**: Automated transcript extraction from YouTube videos
- **axios**: HTTP client for API requests

### Database and Storage
- **drizzle-orm**: Type-safe SQL query builder and ORM
- **postgres**: PostgreSQL client for database connections
- **@types/pg**: TypeScript definitions for PostgreSQL

### Workflow and Processing
- **inngest**: Event-driven background job processing
- **inngest-cli**: Command-line tools for Inngest development
- **zod**: Schema validation for data integrity

### Development and Build Tools
- **typescript**: TypeScript compiler and type checking
- **tsx**: TypeScript execution environment
- **ts-node**: TypeScript execution for Node.js
- **prettier**: Code formatting
- **mastra**: CLI tool for project management and deployment

### Utility Libraries
- **dotenv**: Environment variable management
- **pino**: High-performance JSON logger
- **exa-js**: Search API integration for content research