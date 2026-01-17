import { Mastra } from "@mastra/core";
import { MastraError } from "@mastra/core/error";
import { PinoLogger } from "@mastra/loggers";
import { LogLevel, MastraLogger } from "@mastra/core/logger";
import pino from "pino";
import { MCPServer } from "@mastra/mcp";
import { NonRetriableError } from "inngest";
import { z } from "zod";

import { sharedPostgresStorage, db } from "./storage";
import { inngest, inngestServe } from "./inngest";
import { sql } from "drizzle-orm";

// Import tools and workflows
import { youTubeScrapeTool } from "./tools/youtubeScraper";
import { contentAnalysisTool } from "./tools/contentAnalyzer";
import { dataStorageTool } from "./tools/dataStorage";
import { scriptGeneratorTool } from "./tools/scriptGenerator";
import { simpleVideoTrackerTool } from "./tools/simpleVideoTracker";
import { youtubeResearchWorkflow } from "./workflows/youtubeResearchWorkflow";
import { registerCronWorkflow, registerManualWorkflow } from "./inngest";

class ProductionPinoLogger extends MastraLogger {
  protected logger: pino.Logger;

  constructor(
    options: {
      name?: string;
      level?: LogLevel;
    } = {},
  ) {
    super(options);

    this.logger = pino({
      name: options.name || "app",
      level: options.level || LogLevel.INFO,
      base: {},
      formatters: {
        level: (label: string, _number: number) => ({
          level: label,
        }),
      },
      timestamp: () => `,"time":"${new Date(Date.now()).toISOString()}"`,
    });
  }

  debug(message: string, args: Record<string, any> = {}): void {
    this.logger.debug(args, message);
  }

  info(message: string, args: Record<string, any> = {}): void {
    this.logger.info(args, message);
  }

  warn(message: string, args: Record<string, any> = {}): void {
    this.logger.warn(args, message);
  }

  error(message: string, args: Record<string, any> = {}): void {
    this.logger.error(args, message);
  }
}

export const mastra = new Mastra({
  storage: sharedPostgresStorage,
  agents: {},
  workflows: { youtubeResearchWorkflow },
  mcpServers: {
    allTools: new MCPServer({
      name: "allTools",
      version: "1.0.0",
      tools: {
        youTubeScrapeTool,
        contentAnalysisTool,
        dataStorageTool,
        scriptGeneratorTool,
        simpleVideoTrackerTool,
      },
    }),
  },
  bundler: {
    // A few dependencies are not properly picked up by
    // the bundler if they are not added directly to the
    // entrypoint.
    externals: [
      "@slack/web-api",
      "inngest",
      "inngest/hono",
      "hono",
      "hono/streaming",
    ],
    // sourcemaps are good for debugging.
    sourcemap: true,
  },
  server: {
    host: "0.0.0.0",
    port: process.env.PORT ? parseInt(process.env.PORT) : 5000,
    middleware: [
      async (c, next) => {
        const mastra = c.get("mastra");
        const logger = mastra?.getLogger();
        logger?.debug("[Request]", { method: c.req.method, url: c.req.url });
        try {
          await next();
        } catch (error) {
          logger?.error("[Response]", {
            method: c.req.method,
            url: c.req.url,
            error,
          });
          if (error instanceof MastraError) {
            if (error.id === "AGENT_MEMORY_MISSING_RESOURCE_ID") {
              // This is typically a non-retirable error. It means that the request was not
              // setup correctly to pass in the necessary parameters.
              throw new NonRetriableError(error.message, { cause: error });
            }
          } else if (error instanceof z.ZodError) {
            // Validation errors are never retriable.
            throw new NonRetriableError(error.message, { cause: error });
          }

          throw error;
        }
      },
    ],
    apiRoutes: [
      // This API route is used to register the Mastra workflow (inngest function) on the inngest server
      {
        path: "/api/inngest",
        method: "ALL",
        createHandler: async ({ mastra }) => inngestServe({ mastra, inngest }),
        // The inngestServe function integrates Mastra workflows with Inngest by:
        // 1. Creating Inngest functions for each workflow with unique IDs (workflow.${workflowId})
        // 2. Setting up event handlers that:
        //    - Generate unique run IDs for each workflow execution
        //    - Create an InngestExecutionEngine to manage step execution
        //    - Handle workflow state persistence and real-time updates
        // 3. Establishing a publish-subscribe system for real-time monitoring
        //    through the workflow:${workflowId}:${runId} channel
      },
      
      // Settings API - Get current settings
      {
        path: "/api/settings",
        method: "GET",
        createHandler: async ({ mastra }) => {
          return async (c) => {
            const logger = mastra.getLogger();
            
            try {
              // Get the most recent settings or return defaults (map to camelCase)
              const result = await db.execute(sql`SELECT id, auto_mode as "autoMode", schedule, timezone, video_urls as "videoUrls", updated_at as "updatedAt" FROM settings ORDER BY id DESC LIMIT 1`);
              const settings = result[0] || {
                autoMode: false,
                schedule: "0 9 * * *",
                timezone: "America/Los_Angeles",
                videoUrls: [
                  "https://www.youtube.com/@FitFatherProject",
                  "https://www.youtube.com/@BusyDadTraining", 
                  "https://www.youtube.com/@DadBodWOD"
                ]
              };
              
              logger?.info('📋 [API] Retrieved settings', { settingsId: settings.id });
              return c.json(settings);
            } catch (error) {
              logger?.error('❌ [API] Failed to get settings', { error: String(error) });
              return c.json({ error: 'Failed to load settings' }, 500);
            }
          };
        }
      },
      
      // Settings API - Save settings
      {
        path: "/api/settings",
        method: "POST",
        createHandler: async ({ mastra }) => {
          return async (c) => {
            const logger = mastra.getLogger();
            
            try {
              const requestBody = await c.req.json();
              logger?.info('💾 [API] Saving settings', requestBody);
              
              // Insert new settings record
              const result = await db.execute(sql`
                INSERT INTO settings (auto_mode, schedule, timezone, video_urls, updated_at) 
                VALUES (${requestBody.autoMode}, ${requestBody.schedule}, ${requestBody.timezone}, ${JSON.stringify(requestBody.videoUrls)}, NOW()) 
                RETURNING id, auto_mode as "autoMode", schedule, timezone, video_urls as "videoUrls", updated_at as "updatedAt"
              `);
              
              logger?.info('✅ [API] Settings saved', { settingsId: result[0].id });
              return c.json({ 
                success: true, 
                settings: result[0],
                notice: "Note: Changes to auto/manual mode require an application restart to take effect."
              });
            } catch (error) {
              logger?.error('❌ [API] Failed to save settings', { error: String(error) });
              return c.json({ error: 'Failed to save settings' }, 500);
            }
          };
        }
      },
      
      // Workflow API - Manual run
      {
        path: "/api/workflow/run",
        method: "POST",
        createHandler: async ({ mastra }) => {
          return async (c) => {
            const logger = mastra.getLogger();
            
            try {
              const requestBody = await c.req.json().catch(() => ({}));
              let videoUrls = requestBody.videoUrls;
              
              // Handle different input formats
              if (typeof videoUrls === 'string') {
                videoUrls = [videoUrls];
              } else if (!Array.isArray(videoUrls)) {
                videoUrls = [];
              }
              
              // Validate YouTube URLs
              const validUrls = videoUrls.filter((url: string) => {
                try {
                  const urlObj = new URL(url);
                  return urlObj.hostname === 'www.youtube.com' || urlObj.hostname === 'youtube.com' || urlObj.hostname === 'youtu.be';
                } catch {
                  return false;
                }
              });
              
              logger?.info('🚀 [API] Starting manual workflow run', { 
                requestedUrls: videoUrls.length,
                validUrls: validUrls.length 
              });
              
              // Generate a unique run ID
              const runId = `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
              
              // Record the run start with URLs used
              await db.execute(sql`
                INSERT INTO workflow_runs (run_id, status, started_at, metadata) 
                VALUES (${runId}, 'running', NOW(), ${JSON.stringify({ 
                  trigger: 'manual', 
                  source: 'api',
                  videoUrls: validUrls
                })})
              `);
              
              // Trigger the manual workflow wrapper for proper failure handling
              await inngest.send({
                name: "workflow.manual.youtube-research",
                data: { 
                  inputData: { videoUrls: validUrls },
                  runId 
                }
              });
              
              logger?.info('✅ [API] Workflow started', { runId, urlCount: validUrls.length });
              return c.json({ 
                success: true, 
                runId, 
                message: 'Workflow started successfully',
                urlsUsed: validUrls.length
              });
            } catch (error) {
              logger?.error('❌ [API] Failed to start workflow', { error: String(error) });
              return c.json({ error: 'Failed to start workflow' }, 500);
            }
          };
        }
      },
      
      // Status API - Get current status
      {
        path: "/api/status",
        method: "GET",
        createHandler: async ({ mastra }) => {
          return async (c) => {
            const logger = mastra.getLogger();
            
            try {
              // Get current settings (map to camelCase)
              const settingsResult = await db.execute(sql`SELECT id, auto_mode as "autoMode", schedule, timezone, video_urls as "videoUrls", updated_at as "updatedAt" FROM settings ORDER BY id DESC LIMIT 1`);
              const settings = settingsResult[0];
              
              // Get last workflow run
              const lastRunResult = await db.execute(sql`SELECT * FROM workflow_runs ORDER BY started_at DESC LIMIT 1`);
              const lastRun = lastRunResult[0];
              
              const status = {
                autoMode: settings?.autoMode || false,
                schedule: settings?.schedule || "0 9 * * *",
                timezone: settings?.timezone || "America/Los_Angeles",
                workflowStatus: lastRun?.status || 'idle',
                lastRun: lastRun ? {
                  runId: lastRun.runId,
                  status: lastRun.status,
                  timestamp: lastRun.startedAt,
                  completedAt: lastRun.completedAt,
                  videoCount: lastRun.videoCount,
                  errorMessage: lastRun.errorMessage
                } : null
              };
              
              logger?.info('📊 [API] Status retrieved', { autoMode: status.autoMode, lastRunStatus: status.workflowStatus });
              return c.json(status);
            } catch (error) {
              logger?.error('❌ [API] Failed to get status', { error: String(error) });
              return c.json({ error: 'Failed to load status' }, 500);
            }
          };
        }
      },
      
      // Transcripts API - Get all transcripts
      {
        path: "/api/transcripts",
        method: "GET",
        createHandler: async ({ mastra }) => {
          return async (c) => {
            const logger = mastra.getLogger();
            
            try {
              // Get all videos with transcripts
              const videos = await db.execute(sql`
                SELECT video_id, title, channel_name, transcript, scraped_at, url, views 
                FROM videos 
                WHERE transcript IS NOT NULL AND transcript != '' 
                ORDER BY scraped_at DESC
              `);
              
              logger?.info('📄 [API] Transcripts retrieved', { count: videos.length });
              return c.json(videos);
            } catch (error) {
              logger?.error('❌ [API] Failed to get transcripts', { error: String(error) });
              return c.json({ error: 'Failed to load transcripts' }, 500);
            }
          };
        }
      },
      
      // Logs API - Get recent logs
      {
        path: "/api/logs",
        method: "GET",
        createHandler: async ({ mastra }) => {
          return async (c) => {
            const logger = mastra.getLogger();
            
            try {
              // Get recent workflow runs and their details
              const runs = await db.execute(sql`
                SELECT run_id, status, started_at, completed_at, metadata, error_message
                FROM workflow_runs 
                ORDER BY started_at DESC 
                LIMIT 5
              `);
              
              let logOutput = `=== RECENT WORKFLOW RUNS ===\n\n`;
              
              for (const run of runs) {
                logOutput += `Run ID: ${run.run_id}\n`;
                logOutput += `Status: ${run.status}\n`;
                logOutput += `Started: ${run.started_at}\n`;
                logOutput += `Completed: ${run.completed_at || 'Still running'}\n`;
                logOutput += `Metadata: ${JSON.stringify(run.metadata, null, 2)}\n`;
                if (run.error_message) {
                  logOutput += `Error: ${run.error_message}\n`;
                }
                logOutput += `\n${'='.repeat(50)}\n\n`;
              }
              
              logger?.info('📋 [API] Logs retrieved');
              return c.text(logOutput);
            } catch (error) {
              logger?.error('❌ [API] Failed to get logs', { error: String(error) });
              return c.text('Failed to load logs: ' + String(error));
            }
          };
        }
      },
      
      // Static file serving for the frontend
      {
        path: "/",
        method: "GET",
        createHandler: async () => {
          return async (c) => {
            const logger = mastra.getLogger();
            try {
              const fs = await import('fs/promises');
              const path = await import('path');
              
              // Try different possible paths for development vs production
              let htmlPath;
              const cwd = process.cwd();
              logger?.info('🌐 [Frontend] Process CWD:', { cwd });
              
              // Check if we're in a .mastra/output directory (development)
              if (cwd.includes('.mastra/output')) {
                const workspaceRoot = path.resolve(cwd, '..', '..');
                htmlPath = path.join(workspaceRoot, 'public', 'index.html');
                logger?.info('🌐 [Frontend] Development mode - workspace root:', { workspaceRoot });
              } else {
                // Production mode - try relative path first
                htmlPath = path.join(cwd, 'public', 'index.html');
                logger?.info('🌐 [Frontend] Production mode - direct path');
              }
              
              logger?.info('🌐 [Frontend] Attempting to serve file from:', { htmlPath });
              const html = await fs.readFile(htmlPath, 'utf-8');
              logger?.info('✅ [Frontend] Successfully served index.html');
              return c.html(html);
            } catch (error) {
              logger?.error('❌ [Frontend] Error serving frontend:', { error: String(error) });
              return c.text('Frontend not found', 404);
            }
          };
        }
      },
      
      // Serve transcripts page
      {
        path: "/transcripts.html",
        method: "GET",
        createHandler: async () => {
          return async (c) => {
            const logger = mastra.getLogger();
            try {
              const fs = await import('fs/promises');
              const path = await import('path');
              
              let htmlPath;
              const cwd = process.cwd();
              
              if (cwd.includes('.mastra/output')) {
                const workspaceRoot = path.resolve(cwd, '..', '..');
                htmlPath = path.join(workspaceRoot, 'public', 'transcripts.html');
              } else {
                htmlPath = path.join(cwd, 'public', 'transcripts.html');
              }
              
              const html = await fs.readFile(htmlPath, 'utf-8');
              logger?.info('✅ [Frontend] Successfully served transcripts.html');
              return c.html(html);
            } catch (error) {
              logger?.error('❌ [Frontend] Error serving transcripts page:', { error: String(error) });
              return c.text('Transcripts page not found', 404);
            }
          };
        }
      },
    ],
  },
  logger:
    process.env.NODE_ENV === "production"
      ? new ProductionPinoLogger({
          name: "Mastra",
          level: "info",
        })
      : new PinoLogger({
          name: "Mastra",
          level: "info",
        }),
});

// Function to conditionally register cron workflow based on user settings
async function setupCronWorkflow() {
  const logger = mastra.getLogger();
  try {
    // Get the most recent settings to check if auto mode is enabled
    const result = await db.execute(sql`SELECT auto_mode, schedule, timezone FROM settings ORDER BY id DESC LIMIT 1`);
    const settings = result[0];
    
    if (settings && settings.auto_mode) {
      // Auto mode is enabled, register the cron workflow
      const cronExpression = `TZ=${settings.timezone || process.env.SCHEDULE_CRON_TIMEZONE || 'America/Los_Angeles'} ${settings.schedule || process.env.SCHEDULE_CRON_EXPRESSION || '0 9 * * *'}`;
      logger?.info('🔄 [Startup] Auto mode enabled, registering cron workflow:', { cronExpression });
      registerCronWorkflow(cronExpression, youtubeResearchWorkflow);
    } else {
      // Auto mode is disabled or no settings found, use environment variables as fallback
      const autoModeFromEnv = process.env.AUTO_MODE === 'true';
      if (autoModeFromEnv) {
        const cronExpression = `TZ=${process.env.SCHEDULE_CRON_TIMEZONE || 'America/Los_Angeles'} ${process.env.SCHEDULE_CRON_EXPRESSION || '0 9 * * *'}`;
        logger?.info('🔄 [Startup] Auto mode enabled via environment, registering cron workflow:', { cronExpression });
        registerCronWorkflow(cronExpression, youtubeResearchWorkflow);
      } else {
        logger?.info('⏸️ [Startup] Auto mode disabled, skipping cron workflow registration');
      }
    }
  } catch (error) {
    // If there's an error checking settings, fall back to environment variables
    logger?.warn('⚠️ [Startup] Error checking settings, falling back to environment variables:', { error });
    const autoModeFromEnv = process.env.AUTO_MODE === 'true';
    if (autoModeFromEnv) {
      const cronExpression = `TZ=${process.env.SCHEDULE_CRON_TIMEZONE || 'America/Los_Angeles'} ${process.env.SCHEDULE_CRON_EXPRESSION || '0 9 * * *'}`;
      logger?.info('🔄 [Startup] Auto mode enabled via environment (fallback), registering cron workflow:', { cronExpression });
      registerCronWorkflow(cronExpression, youtubeResearchWorkflow);
    }
  }
}

// Setup cron workflow based on current settings
setupCronWorkflow();

// Setup manual workflow wrapper for proper failure handling
registerManualWorkflow(youtubeResearchWorkflow);

/*  Sanity check 1: Throw an error if there are more than 1 workflows.  */
// !!!!!! Do not remove this check. !!!!!!
if (Object.keys(mastra.getWorkflows()).length > 1) {
  throw new Error(
    "More than 1 workflows found. Currently, more than 1 workflows are not supported in the UI, since doing so will cause app state to be inconsistent.",
  );
}

/*  Sanity check 2: Throw an error if there are more than 1 agents.  */
// !!!!!! Do not remove this check. !!!!!!
if (Object.keys(mastra.getAgents()).length > 1) {
  throw new Error(
    "More than 1 agents found. Currently, more than 1 agents are not supported in the UI, since doing so will cause app state to be inconsistent.",
  );
}