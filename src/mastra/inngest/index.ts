import { inngest } from "./client";
import { init, InngestWorkflow } from "@mastra/inngest";
import { registerApiRoute as originalRegisterApiRoute } from "@mastra/core/server";
import { type Mastra } from "@mastra/core";
import { type Inngest, InngestFunction, NonRetriableError } from "inngest";
import { serve as originalInngestServe } from "inngest/hono";

// Initialize Inngest with Mastra to get Inngest-compatible workflow helpers
const {
  createWorkflow: originalCreateWorkflow,
  createStep,
  cloneStep,
} = init(inngest);

export function createWorkflow(
  params: Parameters<typeof originalCreateWorkflow>[0],
): ReturnType<typeof originalCreateWorkflow> {
  return originalCreateWorkflow({
    ...params,
    retryConfig: {
      attempts: 3,
      ...(params.retryConfig ?? {}),
    },
  });
}

// Export the Inngest client and Inngest-compatible workflow helpers
export { inngest, createStep, cloneStep };

const inngestFunctions: InngestFunction.Any[] = [];

// Manual workflow wrapper for proper failure handling
export function registerManualWorkflow(workflow: any) {
  const f = inngest.createFunction(
    { id: "manual-workflow-wrapper" },
    { event: "workflow.manual.youtube-research" },
    async ({ event, step }) => {
      const { runId, inputData } = event.data;
      
      // Get logger from mastra instance
      let logger;
      try {
        const { mastra } = await import('../index');
        logger = mastra.getLogger();
      } catch {
        // Fallback to console if logger unavailable
        logger = console;
      }
      
      try {
        logger?.info('🏁 [Manual] Starting workflow run', { runId, trigger: 'manual', inputData });
        
        // Start workflow with runId in runtime context
        const run = await workflow.createRunAsync();
        const result = await run.start({ 
          inputData, 
          runtimeContext: { runId }
        });
        
        // Mark as completed if we reach here
        const { db } = await import('../storage');
        const { sql } = await import('drizzle-orm');
        
        // Defensive handling: Ensure the record exists before updating
        const updateResult = await db.execute(sql`
          UPDATE workflow_runs 
          SET status = 'completed', completed_at = NOW() 
          WHERE run_id = ${runId} RETURNING run_id
        `);
        
        // If no rows were returned, the record might be missing - insert it
        if (updateResult.length === 0) {
          logger?.warn('⚠️ [Manual] Workflow run not found in DB, creating record', { runId, source: 'defensive_insert' });
          await db.execute(sql`
            INSERT INTO workflow_runs (run_id, status, started_at, completed_at, metadata) 
            VALUES (${runId}, 'completed', NOW(), NOW(), ${JSON.stringify({ 
              trigger: 'manual', 
              source: 'defensive_insert',
              note: 'Record created during completion due to missing initial record'
            })})
          `);
        }
        
        logger?.info('✅ [Manual] Completed workflow run', { runId, trigger: 'manual', status: 'completed' });
        return result;
      } catch (error) {
        // Mark as failed on error
        try {
          const { db } = await import('../storage');
          const { sql } = await import('drizzle-orm');
          
          const errorMessage = String(error).slice(0, 1000); // Truncate to prevent bloat
          
          // Defensive handling: Try to update, if no record exists, insert it
          const updateResult = await db.execute(sql`
            UPDATE workflow_runs 
            SET status = 'failed', 
                error_message = ${errorMessage}, 
                completed_at = NOW() 
            WHERE run_id = ${runId} RETURNING run_id
          `);
          
          // If no rows were returned, the record might be missing - insert it
          if (updateResult.length === 0) {
            logger?.warn('⚠️ [Manual] Workflow run not found in DB, creating failed record', { runId, source: 'defensive_insert' });
            await db.execute(sql`
              INSERT INTO workflow_runs (run_id, status, started_at, completed_at, error_message, metadata) 
              VALUES (${runId}, 'failed', NOW(), NOW(), ${errorMessage}, ${JSON.stringify({ 
                trigger: 'manual', 
                source: 'defensive_insert',
                note: 'Record created during failure due to missing initial record'
              })})
            `);
          }
          
          logger?.error('❌ [Manual] Failed workflow run', { runId, trigger: 'manual', status: 'failed', error: errorMessage });
        } catch (dbError) {
          logger?.error('❌ [Manual] Failed to update status', { runId, dbError: String(dbError) });
        }
        
        // Re-throw to preserve Inngest retry behavior
        throw error;
      }
    },
  );
  inngestFunctions.push(f);
}

// Create a middleware for Inngest to be able to route triggers to Mastra directly.
export function registerApiRoute<P extends string>(
  ...args: Parameters<typeof originalRegisterApiRoute<P>>
): ReturnType<typeof originalRegisterApiRoute<P>> {
  const [path, options] = args;
  if (path.startsWith("/api/") || typeof options !== "object") {
    // This will throw an error.
    return originalRegisterApiRoute(...args);
  }
  inngestFunctions.push(
    inngest.createFunction(
      {
        id: `api-${path.replace(/^\/+/, "").replaceAll(/\/+/g, "-")}`,
        name: path,
      },
      {
        event: `event/api.${path.replace(/^\/+/, "").replaceAll(/\/+/g, ".")}`,
      },
      async ({ event, step }) => {
        await step.run("forward request to Mastra", async () => {
          // It is hard to obtain an internal handle on the Hono server,
          // so we just forward the request to the local Mastra server.
          const response = await fetch(`http://localhost:5000${path}`, {
            method: event.data.method,
            headers: event.data.headers,
            body: event.data.body,
          });

          if (!response.ok) {
            if (
              (response.status >= 500 && response.status < 600) ||
              response.status == 429 ||
              response.status == 408
            ) {
              // 5XX, 429 (Rate-Limit Exceeded), 408 (Request Timeout) are retriable.
              throw new Error(
                `Failed to forward request to Mastra: ${response.statusText}`,
              );
            } else {
              // All other errors are non-retriable.
              throw new NonRetriableError(
                `Failed to forward request to Mastra: ${response.statusText}`,
              );
            }
          }
        });
      },
    ),
  );

  return originalRegisterApiRoute(...args);
}

export function registerCronWorkflow(cronExpression: string, workflow: any) {
  const f = inngest.createFunction(
    { id: "cron-trigger" },
    [{ event: "replit/cron.trigger" }, { cron: cronExpression }],
    async ({ event, step }) => {
      // Generate runId and create workflow_runs entry
      const runId = `cron-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
      
      // Get logger from mastra instance
      let logger;
      try {
        const { mastra } = await import('../index');
        logger = mastra.getLogger();
      } catch {
        // Fallback to console if logger unavailable
        logger = console;
      }
      
      try {
        // Insert workflow run record
        const { db } = await import('../storage');
        const { sql } = await import('drizzle-orm');
        
        await db.execute(sql`
          INSERT INTO workflow_runs (run_id, status, started_at, metadata) 
          VALUES (${runId}, 'running', NOW(), ${JSON.stringify({ trigger: 'cron', schedule: cronExpression })})
        `);
        
        logger?.info('🏁 [Cron] Starting workflow run', { runId, trigger: 'cron', schedule: cronExpression });
        
        // Start workflow with runId in runtime context
        const run = await workflow.createRunAsync();
        const result = await run.start({ 
          inputData: {}, 
          runtimeContext: { runId }
        });
        
        // Mark as completed if we reach here
        const updateResult = await db.execute(sql`
          UPDATE workflow_runs 
          SET status = 'completed', completed_at = NOW() 
          WHERE run_id = ${runId} RETURNING run_id
        `);
        
        // Defensive handling: If no rows were returned, the record might be missing
        if (updateResult.length === 0) {
          logger?.warn('⚠️ [Cron] Workflow run not found in DB, creating record', { runId, source: 'defensive_insert', schedule: cronExpression });
          await db.execute(sql`
            INSERT INTO workflow_runs (run_id, status, started_at, completed_at, metadata) 
            VALUES (${runId}, 'completed', NOW(), NOW(), ${JSON.stringify({ 
              trigger: 'cron', 
              schedule: cronExpression,
              source: 'defensive_insert',
              note: 'Record created during completion due to missing initial record'
            })})
          `);
        }
        
        logger?.info('✅ [Cron] Completed workflow run', { runId, trigger: 'cron', status: 'completed', schedule: cronExpression });
        return result;
      } catch (error) {
        // Mark as failed on error
        try {
          const { db } = await import('../storage');
          const { sql } = await import('drizzle-orm');
          
          const errorMessage = String(error).slice(0, 1000); // Truncate to prevent bloat
          
          // Defensive handling: Try to update, if no record exists, insert it
          const updateResult = await db.execute(sql`
            UPDATE workflow_runs 
            SET status = 'failed', 
                error_message = ${errorMessage}, 
                completed_at = NOW() 
            WHERE run_id = ${runId} RETURNING run_id
          `);
          
          // If no rows were returned, the record might be missing - insert it
          if (updateResult.length === 0) {
            logger?.warn('⚠️ [Cron] Workflow run not found in DB, creating failed record', { runId, source: 'defensive_insert', schedule: cronExpression });
            await db.execute(sql`
              INSERT INTO workflow_runs (run_id, status, started_at, completed_at, error_message, metadata) 
              VALUES (${runId}, 'failed', NOW(), NOW(), ${errorMessage}, ${JSON.stringify({ 
                trigger: 'cron', 
                schedule: cronExpression,
                source: 'defensive_insert',
                note: 'Record created during failure due to missing initial record'
              })})
            `);
          }
          
          logger?.error('❌ [Cron] Failed workflow run', { runId, trigger: 'cron', status: 'failed', schedule: cronExpression, error: errorMessage });
        } catch (dbError) {
          logger?.error('❌ [Cron] Failed to update status', { runId, schedule: cronExpression, dbError: String(dbError) });
        }
        
        // Re-throw to preserve Inngest retry behavior
        throw error;
      }
    },
  );
  inngestFunctions.push(f);
}

export function inngestServe({
  mastra,
  inngest,
}: {
  mastra: Mastra;
  inngest: Inngest;
}): ReturnType<typeof originalInngestServe> {
  const wfs = mastra.getWorkflows();

  const functions = new Set<InngestFunction.Any>();
  for (const wf of Object.values(wfs)) {
    if (!(wf instanceof InngestWorkflow)) {
      continue;
    }
    wf.__registerMastra(mastra);
    for (const f of wf.getFunctions()) {
      functions.add(f);
    }
  }
  for (const fn of inngestFunctions) {
    functions.add(fn);
  }
  let serveHost: string | undefined = undefined;
  if (process.env.NODE_ENV === "production") {
    if (process.env.REPLIT_DOMAINS) {
      serveHost = `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`;
    }
  } else {
    serveHost = "http://localhost:5000";
  }
  
  return originalInngestServe({
    client: inngest,
    functions: Array.from(functions),
    serveHost,
  });
}