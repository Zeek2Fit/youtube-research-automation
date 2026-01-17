# Contributing to TubeAutomator

Thank you for your interest in contributing to TubeAutomator! This document provides guidelines for contributing to the project.

## Getting Started

### Prerequisites

- Node.js 18 or higher
- PostgreSQL database
- OpenAI API key (for Whisper transcription)
- yt-dlp and ffmpeg installed on your system

### Local Development Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/tubeautomator.git
   cd tubeautomator
   ```

2. **Run the setup script**
   ```bash
   chmod +x scripts/setup.sh
   ./scripts/setup.sh
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys and database connection
   ```

4. **Start the development server**
   ```bash
   npx mastra dev
   ```

5. **Open the web interface**
   Navigate to `http://localhost:5000`

## Project Structure

```
├── src/
│   └── mastra/
│       ├── agents/          # AI agents for content analysis
│       ├── tools/           # Core automation tools
│       │   ├── index.ts     # Tool exports for library use
│       │   ├── youtubeScraper.ts
│       │   ├── videoDownloader.ts
│       │   ├── audioTranscriber.ts
│       │   └── ...
│       ├── workflows/       # Workflow definitions
│       └── index.ts         # Mastra instance registration
├── public/                  # Web interface (HTML/CSS/JS)
├── scripts/                 # Setup and utility scripts
├── shared/                  # Shared code (database schema)
├── tests/                   # Test files
└── docs/                    # Documentation
```

## Development Guidelines

### Code Style

- Use TypeScript for all new code
- Follow existing patterns in the codebase
- Add comprehensive logging using the Mastra logger
- Include JSDoc comments for public functions

### Adding New Tools

1. Create a new file in `src/mastra/tools/`
2. Use the `createTool` function from `@mastra/core/tools`
3. Include input/output schemas using Zod
4. Add logging throughout the tool execution
5. Export the tool from `src/mastra/tools/index.ts`
6. Register the tool with the Mastra instance in `src/mastra/index.ts`

Example tool structure:
```typescript
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const myNewTool = createTool({
  id: 'my-new-tool',
  description: 'Description of what the tool does',
  inputSchema: z.object({
    param1: z.string().describe('Parameter description'),
  }),
  outputSchema: z.object({
    result: z.string(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔧 [MyNewTool] Starting execution');
    
    // Tool logic here
    
    logger?.info('✅ [MyNewTool] Completed successfully');
    return { result: 'done' };
  },
});
```

### Testing

- Test tools individually using curl or the test scripts
- Use the Mastra Playground to test workflows
- Run the test automation script: `npx tsx tests/testCronAutomation.ts`

### Commit Messages

Use clear, descriptive commit messages:
- `feat: Add new video analysis tool`
- `fix: Handle missing transcripts gracefully`
- `docs: Update README with new installation steps`
- `refactor: Improve error handling in scraper`

## Submitting Changes

1. Create a feature branch from `main`
2. Make your changes following the guidelines above
3. Test your changes locally
4. Submit a pull request with a clear description

## Reporting Issues

When reporting issues, please include:
- Steps to reproduce the problem
- Expected vs actual behavior
- Environment details (OS, Node version, etc.)
- Relevant log output

## Questions?

Feel free to open an issue for questions or discussions about the project.
