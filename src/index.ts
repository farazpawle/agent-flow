import "./utils/envLoader.js"; // Must be the very first import to load .env before other modules
import path from "path";
import fs from "fs";
import fsPromises from "fs/promises";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
// import dotenv from "dotenv"; // Handled by envLoader

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

// Explicitly load .env from project root and override inherited variables
// dotenv.config({ path: path.join(PROJECT_ROOT, ".env"), override: true }); // Handled by envLoader

// Debug logging
const debugLog = (msg: string) => {
  const logMsg = `[AgentFlow Debug] ${new Date().toISOString()} - ${msg}\n`;
  try {
    fs.appendFileSync(path.join(PROJECT_ROOT, "debug_server.log"), logMsg);
  } catch (e) {}
};

debugLog(`Server starting. CWD: ${process.cwd()}`);
debugLog(`ENABLE_GUI: ${process.env.ENABLE_GUI}`);
debugLog(`DATA_DIR: ${process.env.DATA_DIR}`);

import { loadPromptFromTemplate } from "./prompts/loader.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  CallToolRequest,
  CallToolRequestSchema,
  ListToolsRequestSchema,
  // Phase 3 Group 19 — Resources + Prompts capabilities.
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express, { Request, Response, NextFunction } from "express";
import { isPortInUse } from "./utils/portUtils.js";
import open from "open";

// Import tool functions. Phase 1 cumulative removals from the MCP
// surface: Group 6.6 (split_tasks + delete_task); Group 7.8
// (execute_task / verify_task / complete_task — task_lifecycle covers
// that flow, with verify/complete returning as Group 8 shims);
// Group 10.8 (plan_idea + process_thought — workflow_run subsumes
// them). The legacy reorder handler stays available only for the
// /api/tasks/reorder Express route until the GUI migrates.
import {
  // Legacy reorder kept available for the GUI `/api/tasks/reorder`
  // route until the front-end migrates to
  // `task_edit(action='reorder')` which requires `expectedVersions`.
  // Not exposed on the MCP surface.
  reorderTasksTool,
} from "./tools/taskTools.js";

// Project tools (Group 4.6 removed list_projects/get_project_context;
// Group 5.6 removed create_project; Group 6.6 removed delete_project in
// favour of the project_delete dry_run/execute split). Nothing left to
// import here at the MCP surface — Express routes use the model layer
// directly.

// Phase 1 Group 4 — read-only view tools.
import {
  projectView,
  projectViewSchema,
  taskView,
  taskViewSchema,
  contextGet,
  contextGetSchema,
} from "./tools/views/index.js";

// Phase 1 Group 5 — non-destructive edit tools.
import { projectEdit, projectEditSchema, taskEdit, taskEditSchema } from "./tools/edits/index.js";

// Phase 1 Group 6 — destructive tools (dry_run/execute split).
import {
  projectDelete,
  projectDeleteSchema,
  taskDelete,
  taskDeleteSchema,
  withDeriveOp,
} from "./tools/deletes/index.js";

// Phase 1 Group 7 — unified task lifecycle tool (replaces execute_task,
// verify_task, complete_task on the MCP surface).
import { taskLifecycle, taskLifecycleSchema } from "./tools/lifecycle/index.js";

// Phase 4 Group 20 — verify_task / complete_task deprecation shims
// removed in v1.2.0. Callers must use task_lifecycle directly. See
// CHANGELOG.md "[1.2.0]" for the migration pointer.

// Phase 1 Group 9 — append-only artifact ingestion.
import { artifactRecord, artifactRecordSchema } from "./tools/artifacts/index.js";

// Phase 1 Group 10 — workflow_run manual-mode scaffold.
import { workflowRun, workflowRunSchema } from "./tools/workflows/index.js";

// Phase 2 Group 16 — LLM HTTP layer (provider status, models cache,
// effective settings + persistence).
import {
  assertConfigUnlocked,
  getProvidersStatus,
  getLlmSettings as getLlmSettingsApi,
  setLlmSettings as setLlmSettingsApi,
  getProviderModelsForApi,
  refreshProviderModelsForApi,
  llmSettingsBodySchema,
  llmModelRefreshBodySchema,
} from "./llm/http/index.js";
import {
  isSupportedProvider,
  SUPPORTED_PROVIDERS,
  type SupportedProvider,
} from "./llm/provider.js";

// Phase 3 Group 19 — MCP Resources + Prompts surface.
import {
  listResources,
  listResourceTemplates,
  readResource,
  VIEW_TOOL_NAMES,
} from "./mcp/resources.js";

// Runtime configuration snapshot for the GUI Settings page.
import { buildRuntimeConfig } from "./http/runtimeConfig.js";
import { updateEnvVar, EDITABLE_FIELD_NAMES } from "./http/envWriter.js";
import { listPrompts, getPrompt, PROMPT_NAMES as MCP_PROMPT_NAMES } from "./mcp/prompts.js";

import type { ZodTypeAny } from "zod";
import { safeParseTool } from "./utils/schemaParse.js";
import { toToolErrorResponse } from "./utils/errors.js";

// HTTP hardening: validation, rate limiting, structured logging
import rateLimit from "express-rate-limit";
import { logger, childLogger, newCorrelationId } from "./utils/logger.js";
import {
  patchTaskBodySchema,
  reorderTasksBodySchema,
  sseQuerySchema,
  validateBody,
  validateQuery,
  normalizeStatus,
} from "./utils/httpValidation.js";
import { toHttpErrorBody } from "./utils/errors.js";

// Import task model functions
import { getTaskById, getAllTasks, ensureDataDir, updateTask } from "./models/taskModel.js";
import { taskEvents, TASK_EVENTS } from "./utils/events.js";

// Import client model
import {
  getAllClients,
  getClientById,
  registerClient,
  updateClientHeartbeat,
  getCurrentClientId,
  markClientInactive,
  markAllClientsInactive,
  cleanupStaleClients,
  deleteInactiveClients,
} from "./models/clientModel.js";

// Import database
import { db } from "./models/db.js";
import { startFindingsCleanup } from "./utils/findingsCleanup.js";

// Wave 3 §10.A — plan upload (preview + commit) routes.
import {
  handlePlanUploadPreview,
  handlePlanUploadCommit,
  startPreviewSweeper,
} from "./http/planUpload.js";
// Wave 3 §10.E — Project Skill compile.
import { compileSkill } from "./llm/skillCompiler.js";

async function main() {
  try {
    const GUI_ONLY = process.argv.includes("--gui") || process.env.GUI_ONLY === "true";
    const IS_SPAWNED_GUI = process.argv.includes("--spawn-gui");
    // GUI server should start when explicitly invoked in GUI mode,
    // even if ENABLE_GUI is not set in environment.
    const ENABLE_GUI = process.env.ENABLE_GUI === "true" || GUI_ONLY || IS_SPAWNED_GUI;

    // Initialize Database (SQLite/Supabase)
    try {
      await db.init();
    } catch (dbError) {
      console.error("FATAL: Failed to initialize database:", dbError);
      process.exit(1);
    }

    // Initialize Data Directories (Search indices, etc.)
    await ensureDataDir();

    // Phase 1 Group 1.9 — nightly cleanup of stale findings rows.
    // No-op unless FINDINGS_RETENTION_DAYS is a positive integer.
    startFindingsCleanup(db);

    if (ENABLE_GUI) {
      // Create Express application
      const app = express();

      // Avoid any conditional caching behavior for dynamic JSON responses
      app.set("etag", false);

      // List to store SSE clients
      let sseClients: Response[] = [];

      // Helper function to send SSE events
      function sendSseUpdate() {
        sseClients.forEach((client) => {
          // Check if client is still connected
          if (!client.writableEnded) {
            client.write(
              `event: update\ndata: ${JSON.stringify({
                timestamp: Date.now(),
              })}\n\n`
            );
          }
        });
        // Clean up disconnected clients (optional, but recommended)
        sseClients = sseClients.filter((client) => !client.writableEnded);
      }

      // Phase 4 Group 20 — `sendDeprecationEvent` removed alongside
      // the verify_task / complete_task shims. The SSE channel that
      // fed the GUI activity log's "DEPRECATED" rows no longer has any
      // emitter; the channel itself stays declared in
      // `src/utils/events.ts` in case future tools want to re-use it,
      // but nothing pipes to it from the runtime today.

      // Helper function to send client count updates via SSE
      async function sendClientUpdate() {
        try {
          const clients = await getAllClients();
          const count = clients.filter((c: any) => c.isActive).length;
          sseClients.forEach((client) => {
            if (!client.writableEnded) {
              client.write(
                `event: client-update\ndata: ${JSON.stringify({
                  count,
                  timestamp: Date.now(),
                })}\n\n`
              );
            }
          });
          sseClients = sseClients.filter((client) => !client.writableEnded);
        } catch (err) {
          console.error("(AgentFlow) Failed to send client update:", err);
        }
      }

      // Set up static file directory
      const publicPath = path.join(__dirname, "public");
      const DATA_DIR_FOR_GUI = process.env.DATA_DIR || path.join(__dirname, "data");

      // File Watcher for Cross-Process Live Updates
      // Watch the DATA_DIR for changes to 'tasks.db' or 'tasks.json' (if used)
      let debounceTimer: NodeJS.Timeout | null = null;
      try {
        if (fs.existsSync(DATA_DIR_FOR_GUI)) {
          console.error(`(AgentFlow) Starting file watcher on: ${DATA_DIR_FOR_GUI}`);
          fs.watch(DATA_DIR_FOR_GUI, (eventType, filename) => {
            if (filename && (filename.includes("tasks.db") || filename.includes("tasks.json"))) {
              // Debounce the update to avoid spamming events during transactions
              if (debounceTimer) clearTimeout(debounceTimer);
              debounceTimer = setTimeout(() => {
                debugLog(`File change detected: ${filename}. Sending SSE update.`);
                sendSseUpdate();
                debounceTimer = null;
              }, 100); // 100ms debounce
            }
          });
        }
      } catch (err) {
        console.error("[AgentFlow] Failed to setup file watcher:", err);
      }

      app.use(express.static(publicPath));
      app.use(express.json({ limit: "1mb" }));

      // Per-request logger + correlation ID. Attached as req.log so
      // handlers can emit context-bound entries without re-binding.
      app.use("/api", (req: Request, res: Response, next: NextFunction) => {
        const correlationId = (req.header("x-correlation-id") || newCorrelationId()).slice(0, 64);
        const reqLog = childLogger({
          correlationId,
          method: req.method,
          path: req.path,
        });
        (req as Request & { log?: typeof reqLog; correlationId?: string }).log = reqLog;
        (req as Request & { correlationId?: string }).correlationId = correlationId;
        res.setHeader("X-Correlation-Id", correlationId);

        const startedAt = Date.now();
        res.on("finish", () => {
          reqLog.info(
            { status: res.statusCode, durationMs: Date.now() - startedAt },
            "request completed"
          );
        });
        next();
      });

      // Rate limit mutating routes. The GUI is single-user so limits are
      // generous; they exist to catch runaway loops and accidental DoS.
      const mutationLimiter = rateLimit({
        windowMs: 60_000,
        limit: 300,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        skip: (req) => ["GET", "HEAD", "OPTIONS"].includes(req.method),
        message: { error: "Too many requests, slow down.", code: "RATE_LIMITED" },
      });
      app.use("/api", mutationLimiter);

      // Disable caching for API responses to ensure UI always reflects latest DB state
      app.use("/api", (req: Request, res: Response, next: NextFunction) => {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        res.setHeader("Surrogate-Control", "no-store");

        // Debug headers: helps detect if refresh is hitting a different process/DB
        res.setHeader("X-AgentFlow-PID", String(process.pid));
        res.setHeader("X-AgentFlow-DATA-DIR", DATA_DIR_FOR_GUI);
        next();
      });

      // ==================== CLIENT API ENDPOINTS ====================

      // Get all clients
      app.get("/api/clients", async (req: Request, res: Response) => {
        try {
          const clients = await getAllClients();
          res.json({ clients });
        } catch (error) {
          res.status(500).json({ error: "Failed to fetch clients" });
        }
      });

      // Get client count only
      app.get("/api/clients/count", async (req: Request, res: Response) => {
        try {
          const clients = await getAllClients();
          const count = clients.filter((c: any) => c.isActive).length;
          res.json({ count });
        } catch (error) {
          res.status(500).json({ error: "Failed to fetch client count" });
        }
      });

      // Force cleanup of all clients except the current one - useful for debugging
      app.delete("/api/clients/cleanup", async (req: Request, res: Response) => {
        try {
          // Get all clients before cleanup
          const beforeClients = await getAllClients();
          const beforeCount = beforeClients.length;

          // Mark all inactive and delete them
          await markAllClientsInactive();
          await deleteInactiveClients();

          // Get count after cleanup
          const afterClients = await getAllClients();
          const afterCount = afterClients.length;

          // Broadcast the update
          sendClientUpdate();

          res.json({
            success: true,
            message: `Cleaned up ${beforeCount - afterCount} stale clients`,
            beforeCount,
            afterCount,
          });
        } catch (error) {
          console.error("Error cleaning up clients:", error);
          res.status(500).json({ error: "Failed to cleanup clients" });
        }
      });

      // Get single client
      app.get("/api/clients/:id", async (req: Request, res: Response) => {
        try {
          const client = await getClientById(req.params.id);
          if (!client) {
            res.status(404).json({ error: "Client not found" });
            return;
          }
          res.json({ client });
        } catch (error) {
          res.status(500).json({ error: "Failed to fetch client" });
        }
      });

      // Update client heartbeat
      app.patch("/api/clients/:id/heartbeat", async (req: Request, res: Response) => {
        try {
          await updateClientHeartbeat(req.params.id);
          res.json({ success: true });
        } catch (error) {
          res.status(500).json({ error: "Failed to update heartbeat" });
        }
      });

      // Notify primary server of client changes (called by secondary clients after registration)
      app.post("/api/clients/notify", async (req: Request, res: Response) => {
        try {
          // Broadcast updated client count to all SSE connections
          sendClientUpdate();
          res.json({ success: true, message: "Client update broadcasted" });
        } catch (error) {
          res.status(500).json({ error: "Failed to broadcast client update" });
        }
      });

      // Client disconnect - mark client as inactive and broadcast update
      app.delete("/api/clients/:id/disconnect", async (req: Request, res: Response) => {
        try {
          const clientId = req.params.id;
          await markClientInactive(clientId);
          console.error(`(AgentFlow) Client disconnected: ${clientId}`);
          // Broadcast updated client count to all SSE connections
          sendClientUpdate();
          res.json({ success: true, message: "Client disconnected" });
        } catch (error) {
          console.error("Error disconnecting client:", error);
          res.status(500).json({ error: "Failed to disconnect client" });
        }
      });

      // ==================== SERVER CONTROL ENDPOINTS ====================

      // Restart Server
      app.post("/api/server/restart", (req: Request, res: Response) => {
        try {
          console.error("(AgentFlow) Restarting server...");
          res.json({ success: true, message: "Server restarting..." });

          // Allow response to be sent before exiting
          setTimeout(async () => {
            // Spawn a new detached instance of the same process
            const { spawn } = await import("child_process");
            const newProcess = spawn(process.execPath, process.argv.slice(1), {
              detached: true,
              stdio: "ignore",
              cwd: process.cwd(),
              env: process.env,
            });
            newProcess.unref(); // Allow parent to exit independent of child
            process.exit(0);
          }, 500);
        } catch (error) {
          console.error("Failed to restart server:", error);
          res.status(500).json({ error: "Failed to restart server" });
        }
      });

      // Stop Server
      app.post("/api/server/stop", (req: Request, res: Response) => {
        try {
          console.error("(AgentFlow) Stopping server...");
          res.json({ success: true, message: "Server stopping..." });

          // Allow response to be sent before exiting
          setTimeout(() => {
            process.exit(0);
          }, 500);
        } catch (error) {
          console.error("Failed to stop server:", error);
          res.status(500).json({ error: "Failed to stop server" });
        }
      });

      // ==================== PROJECT API ENDPOINTS ====================

      // Get all projects
      app.get("/api/projects", async (req: Request, res: Response) => {
        try {
          const { getAllProjects } = await import("./models/projectModel.js");
          const projects = await getAllProjects(true);
          res.json({ projects });
        } catch (error) {
          res.status(500).json({ error: "Failed to fetch projects" });
        }
      });

      // Get single project
      app.get("/api/projects/:id", async (req: Request, res: Response) => {
        try {
          const { getProjectById } = await import("./models/projectModel.js");
          const project = await getProjectById(req.params.id);
          if (!project) {
            res.status(404).json({ error: "Project not found" });
            return;
          }
          res.json({ project });
        } catch (error) {
          res.status(500).json({ error: "Failed to fetch project" });
        }
      });

      // Delete project (and all tasks in that project)
      app.delete("/api/projects/:id", async (req: Request, res: Response) => {
        try {
          const projectId = req.params.id;
          if (!projectId) {
            res.status(400).json({ success: false, error: "Project ID is required" });
            return;
          }

          const { deleteProjectWithTasks } = await import("./models/projectModel.js");

          const deletionResult = await deleteProjectWithTasks(projectId);

          // Notify all connected UIs
          sendSseUpdate();

          res.json({
            success: true,
            projectId: deletionResult.projectId,
            projectName: deletionResult.projectName,
            deletedTaskCount: deletionResult.deletedTaskCount,
          });
        } catch (error) {
          console.error("(AgentFlow) Failed to delete project:", error);
          const message = error instanceof Error ? error.message : "Failed to delete project";
          const status = message === "Project not found" ? 404 : 500;
          res.status(status).json({ success: false, error: message });
        }
      });

      // ==================== VIEW TOOLS (Phase 1 Group 4.5) ====================
      // POST mirrors of the MCP view tools so the GUI can hit them with the
      // same discriminated-union body the agent uses. Validation flows
      // through safeParseTool → toHttpErrorBody so the wire shape is
      // identical to the MCP error envelope.

      const viewBodyRoute = async <T>(
        toolName: string,
        schema: ZodTypeAny,
        handler: (input: T) => Promise<{ content: Array<{ type: "text"; text: string }> }>,
        res: Response,
        body: unknown
      ) => {
        const parsed = safeParseTool(toolName, schema, body);
        if (!parsed.ok) {
          const { status, body: errBody } = toHttpErrorBody(parsed.error);
          res.status(status).json(errBody);
          return;
        }
        try {
          const result = await handler(parsed.data as T);
          // The handler returns the MCP { content: [...] } envelope. The
          // GUI consumes the inner JSON, so we unwrap and forward it.
          const text = result.content?.[0]?.text ?? "{}";
          try {
            res.json(JSON.parse(text));
          } catch {
            res.type("text/plain").send(text);
          }
        } catch (err) {
          const { status, body: errBody } = toHttpErrorBody(err);
          res.status(status).json(errBody);
        }
      };

      app.post("/api/projects/view", async (req: Request, res: Response) => {
        await viewBodyRoute("project_view", projectViewSchema, projectView, res, req.body);
      });
      app.post("/api/tasks/view", async (req: Request, res: Response) => {
        await viewBodyRoute("task_view", taskViewSchema, taskView, res, req.body);
      });
      app.post("/api/context", async (req: Request, res: Response) => {
        await viewBodyRoute("context_get", contextGetSchema, contextGet, res, req.body);
      });

      // Phase 1 Group 5.5 — edit tool HTTP mirrors. Same dispatch shape;
      // CONFLICT bodies arrive as the standard {status:409, body:{code, details}}.
      app.post("/api/projects/edit", async (req: Request, res: Response) => {
        await viewBodyRoute("project_edit", projectEditSchema, projectEdit, res, req.body);
      });
      app.post("/api/tasks/edit", async (req: Request, res: Response) => {
        await viewBodyRoute("task_edit", taskEditSchema, taskEdit, res, req.body);
      });

      // Phase 1 Group 6.5 — destructive tool HTTP mirrors. Same `mode`
      // discriminator on the body; FORBIDDEN (workflow_run-initiated)
      // surfaces as HTTP 403 via toHttpErrorBody.
      app.post("/api/projects/delete", async (req: Request, res: Response) => {
        await viewBodyRoute("project_delete", projectDeleteSchema, projectDelete, res, req.body);
      });
      app.post("/api/tasks/delete", async (req: Request, res: Response) => {
        const normalised = withDeriveOp(req.body);
        await viewBodyRoute("task_delete", taskDeleteSchema, taskDelete, res, normalised);
      });

      // Phase 1 Group 7.7 — task_lifecycle HTTP mirror. Same discriminator
      // contract; CONFLICT bodies (illegal transitions, stale finalize
      // version) surface as HTTP 409 via toHttpErrorBody.
      app.post("/api/tasks/lifecycle", async (req: Request, res: Response) => {
        await viewBodyRoute("task_lifecycle", taskLifecycleSchema, taskLifecycle, res, req.body);
      });

      // Phase 4 Group 20 — /api/tasks/verify + /api/tasks/complete
      // routes removed alongside the underlying shim handlers. Use
      // POST /api/tasks/lifecycle with action='request_review' or
      // action='finalize' instead.

      // Phase 1 Group 9.6 — artifact_record HTTP mirror. Append-only —
      // there is intentionally no PUT/DELETE companion route. The
      // returned body carries the `findingId` that downstream calls
      // reference.
      app.post("/api/artifacts", async (req: Request, res: Response) => {
        await viewBodyRoute("artifact_record", artifactRecordSchema, artifactRecord, res, req.body);
      });

      // Phase 1 Group 10.7 — workflow_run HTTP mirror. Manual mode by
      // default; per-call `mode` overrides `WORKFLOW_MODE` env.
      app.post("/api/workflow/run", async (req: Request, res: Response) => {
        await viewBodyRoute("workflow_run", workflowRunSchema, workflowRun, res, req.body);
      });

      // Wave 3 §10.A — plan upload (preview + commit). LLM-driven.
      // preview = parse, no DB writes; commit = transactional insert.
      app.post("/api/plan/upload/preview", async (req: Request, res: Response) => {
        await handlePlanUploadPreview(req, res);
      });
      app.post("/api/plan/upload/commit", async (req: Request, res: Response) => {
        await handlePlanUploadCommit(req, res);
      });
      startPreviewSweeper();

      // Wave 3 §10.E — Project Skill compile. Triggered manually by the
      // GUI "Recompile" button. Returns 503 LLM_NOT_CONFIGURED when no
      // provider is configured.
      app.post("/api/skill/compile", async (req: Request, res: Response) => {
        const correlationId = (req as Request & { correlationId?: string }).correlationId;
        try {
          const projectId = (req.body as { projectId?: unknown } | undefined)?.projectId;
          if (typeof projectId !== "string" || projectId.length === 0) {
            res.status(400).json({
              code: "VALIDATION",
              error: "POST /api/skill/compile requires a `projectId` string in the body.",
            });
            return;
          }
          const result = await compileSkill({ projectId, correlationId });
          res.json({
            skillId: result.skill.id,
            compiledAt: result.skill.compiledAt.toISOString(),
            tokenCount: result.skill.tokenCount,
            topicsWritten: result.topicsWritten,
            referencesWritten: result.referencesWritten,
            inputItems: result.inputItems,
            clustersIn: result.clustersIn,
            clustersUsed: result.clustersUsed,
            droppedClusters: result.droppedClusters,
          });
        } catch (err) {
          const appErr = err as { details?: { code?: string } };
          if (appErr?.details?.code === "LLM_NOT_CONFIGURED") {
            const { body } = toHttpErrorBody(err);
            res.status(503).json(body);
            return;
          }
          const { status, body } = toHttpErrorBody(err);
          res.status(status).json(body);
        }
      });

      // ==================== LLM HTTP ROUTES (Phase 2 Group 16) ====================
      // GET = read-only (bypass mutationLimiter via the skip rule above);
      // POST = mutating, rate-limited + Zod-validated through safeParseTool.
      // Every route inherits the /api correlationId middleware so
      // workflow_steps audit rows tie back to the originating request.

      // 16.1 — GET /api/llm/providers: which providers have an API key
      // configured. Returns booleans only; NEVER the keys themselves.
      app.get("/api/llm/providers", async (_req: Request, res: Response) => {
        try {
          res.json(getProvidersStatus(process.env));
        } catch (err) {
          const { status, body } = toHttpErrorBody(err);
          res.status(status).json(body);
        }
      });

      // 16.1 — GET /api/llm/models?provider=<id>: cached model list +
      // capabilities. Bypasses TTL only on POST /api/llm/model/refresh.
      app.get("/api/llm/models", async (req: Request, res: Response) => {
        const raw = String(req.query.provider ?? "").trim();
        if (!raw) {
          res.status(400).json({
            error: "Missing required `provider` query parameter.",
            code: "VALIDATION",
            hint: `Allowed: ${SUPPORTED_PROVIDERS.filter((p) => p !== "none").join(", ")}`,
          });
          return;
        }
        if (!isSupportedProvider(raw)) {
          res.status(400).json({
            error: `Unknown provider '${raw}'.`,
            code: "VALIDATION",
            hint: `Allowed: ${SUPPORTED_PROVIDERS.join(", ")}`,
          });
          return;
        }
        try {
          const out = await getProviderModelsForApi({
            provider: raw as SupportedProvider,
            env: process.env,
          });
          res.json(out);
        } catch (err) {
          const { status, body } = toHttpErrorBody(err);
          res.status(status).json(body);
        }
      });

      // 16.1 — POST /api/llm/model/refresh: force a refetch of the
      // model list (bypasses cache TTL). Rate-limited by /api
      // mutationLimiter; body validated via safeParseTool.
      app.post("/api/llm/model/refresh", async (req: Request, res: Response) => {
        const parsed = safeParseTool("llm_model_refresh", llmModelRefreshBodySchema, req.body);
        if (!parsed.ok) {
          const { status, body } = toHttpErrorBody(parsed.error);
          res.status(status).json(body);
          return;
        }
        try {
          const out = await refreshProviderModelsForApi({
            provider: parsed.data.provider as SupportedProvider,
            env: process.env,
          });
          res.json(out);
        } catch (err) {
          const { status, body } = toHttpErrorBody(err);
          res.status(status).json(body);
        }
      });

      // 16.1 — GET /api/llm/settings: effective settings + source
      // labels (env vs db vs default). NEVER contains API keys.
      app.get("/api/llm/settings", async (_req: Request, res: Response) => {
        try {
          const out = await getLlmSettingsApi({ db, env: process.env });
          res.json(out);
        } catch (err) {
          const { status, body } = toHttpErrorBody(err);
          res.status(status).json(body);
        }
      });

      // 16.1 + 16.5 — POST /api/llm/settings: persist provider / model
      // / selectionStrategy / workflowMode. `LLM_CONFIG_LOCK=true`
      // short-circuits to 403 before the DB write via
      // `assertConfigUnlocked`. Body schema is `.strict()` so any
      // API-key-shaped field is rejected at parse time.
      app.post("/api/llm/settings", async (req: Request, res: Response) => {
        try {
          // 16.5 guard runs BEFORE schema parse so a locked instance
          // can't be probed for valid body shapes via 400s.
          assertConfigUnlocked(process.env);
        } catch (err) {
          const { status, body } = toHttpErrorBody(err);
          res.status(status).json(body);
          return;
        }
        const parsed = safeParseTool("llm_settings", llmSettingsBodySchema, req.body);
        if (!parsed.ok) {
          const { status, body } = toHttpErrorBody(parsed.error);
          res.status(status).json(body);
          return;
        }
        try {
          const out = await setLlmSettingsApi({ db, body: parsed.data, env: process.env });
          res.json(out);
        } catch (err) {
          const { status, body } = toHttpErrorBody(err);
          res.status(status).json(body);
        }
      });

      // Runtime configuration snapshot — backs the GUI Settings page's
      // "Runtime Configuration" card. Returns every relevant env var
      // grouped by section, with secret values redacted to a boolean
      // `set` flag.
      app.get("/api/settings/runtime", async (_req: Request, res: Response) => {
        try {
          res.json(buildRuntimeConfig(process.env));
        } catch (err) {
          const { status, body } = toHttpErrorBody(err);
          res.status(status).json(body);
        }
      });

      // Inline-edit endpoint for the Runtime Configuration card. Writes
      // the single named field to `.env` atomically; some fields are
      // also applied to the live `process.env` so the next call picks
      // them up without restart (see EDITABLE_ENV_FIELDS allow-list in
      // src/http/envWriter.ts). Secrets and DB-defining vars are
      // explicitly NOT on the allow-list — the route returns 400
      // ENV_NOT_EDITABLE if a caller tries to write one. LLM_CONFIG_LOCK
      // also blocks all writes (returns 403 RUNTIME_CONFIG_LOCKED).
      app.patch("/api/settings/runtime", async (req: Request, res: Response) => {
        const body = req.body as { name?: unknown; value?: unknown };
        if (typeof body?.name !== "string" || body.name.length === 0) {
          res.status(400).json({
            error: "PATCH /api/settings/runtime requires a `name` string in the body.",
            code: "VALIDATION",
            hint: `Editable fields: ${EDITABLE_FIELD_NAMES.join(", ")}.`,
          });
          return;
        }
        if (body.value !== null && typeof body.value !== "string") {
          res.status(400).json({
            error:
              "PATCH /api/settings/runtime body `value` must be a string or null (null clears).",
            code: "VALIDATION",
          });
          return;
        }
        try {
          const out = await updateEnvVar({
            name: body.name,
            value: body.value as string | null,
            env: process.env,
          });
          res.json(out);
        } catch (err) {
          const { status, body: errBody } = toHttpErrorBody(err);
          res.status(status).json(errBody);
        }
      });

      // ==================== TASK API ENDPOINTS ====================

      // Get all tasks (with optional project or client filter)
      app.get("/api/tasks", async (req: Request, res: Response) => {
        try {
          let tasks = await getAllTasks();

          // Filter by project_id if provided
          const projectId = req.query.project_id as string;
          if (projectId && projectId !== "all") {
            tasks = tasks.filter((t) => (t as any).projectId === projectId);
          }

          // Filter by client_id if provided (backward compatibility)
          const clientId = req.query.client_id as string;
          if (clientId && clientId !== "all") {
            tasks = tasks.filter((t) => (t as any).clientId === clientId);
          }

          res.json({ tasks });
        } catch (error) {
          res.status(500).json({ error: "Failed to read tasks data" });
        }
      });
      // Add: SSE endpoint - MUST be defined before /api/tasks/:id to avoid route collision.
      // If a clientId query param is supplied, validate it against the
      // clients table. Anonymous subscriptions remain allowed (the SPA
      // currently does not pass one) — this is progressive hardening.
      app.get(
        "/api/tasks/stream",
        validateQuery(sseQuerySchema),
        async (req: Request, res: Response) => {
          const { clientId } =
            (
              req as Request & {
                validatedQuery?: { clientId?: string };
              }
            ).validatedQuery ?? {};

          if (clientId) {
            const client = await getClientById(clientId);
            if (!client) {
              res.status(401).json({ error: "Unknown clientId", code: "AUTH" });
              return;
            }
          }

          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });

          // Send an initial event or keep the connection
          res.write("data: connected\n\n");

          // Add client to the list
          sseClients.push(res);

          // When client disconnects, remove it from the list
          req.on("close", () => {
            sseClients = sseClients.filter((client) => client !== res);
          });
        }
      );

      // Get single task
      app.get("/api/tasks/:id", async (req: Request, res: Response) => {
        try {
          const task = await getTaskById(req.params.id);
          if (!task) {
            res.status(404).json({ error: "Task not found" });
            return;
          }
          res.json({ task });
        } catch (error) {
          res.status(500).json({ error: "Failed to fetch task" });
        }
      });

      // Update task (PATCH) — Zod-validated body, whitelist-only fields.
      app.patch(
        "/api/tasks/:id",
        validateBody(patchTaskBodySchema),
        async (req: Request, res: Response) => {
          const reqLog = (req as Request & { log?: ReturnType<typeof childLogger> }).log ?? logger;
          try {
            const taskId = req.params.id;
            const updates = { ...req.body };

            // Canonicalize status (the body schema accepts UI-style values).
            if (typeof updates.status === "string") {
              updates.status = normalizeStatus(updates.status);
            }

            const existingTask = await getTaskById(taskId);
            if (!existingTask) {
              res.status(404).json({ error: "Task not found", code: "NOT_FOUND" });
              return;
            }

            const updatedTask = await updateTask(taskId, updates);

            if (!updatedTask) {
              res.status(400).json({ error: "Failed to update task", code: "VALIDATION" });
              return;
            }

            sendSseUpdate();
            res.json({ success: true, task: updatedTask });
          } catch (error) {
            reqLog.error({ err: error }, "patch task failed");
            const { status, body } = toHttpErrorBody(error);
            res.status(status).json(body);
          }
        }
      );

      // Reorder tasks — body validated up front.
      app.post(
        "/api/tasks/reorder",
        validateBody(reorderTasksBodySchema),
        async (req: Request, res: Response) => {
          const reqLog = (req as Request & { log?: ReturnType<typeof childLogger> }).log ?? logger;
          try {
            const { taskIds, projectId } = req.body as {
              taskIds: string[];
              projectId?: string;
            };
            const result = await reorderTasksTool({ taskIds, projectId });
            sendSseUpdate();
            res.json({ success: true, message: result.content[0].text });
          } catch (error) {
            reqLog.error({ err: error }, "reorder tasks failed");
            const { status, body } = toHttpErrorBody(error);
            res.status(status).json(body);
          }
        }
      );

      // Fixed port configuration
      const SERVER_PORT = parseInt(process.env.SERVER_PORT || "54544", 10);

      // Check if another instance is already running FIRST
      let portInUse = await isPortInUse(SERVER_PORT);

      // Special flag: if this process was spawned as the GUI server, skip spawn logic
      const IS_SPAWNED_GUI = process.argv.includes("--spawn-gui");

      // If no server is running and this is an MCP client (not the explicitly spawned GUI),
      // spawn a detached server process first
      if (!portInUse && !IS_SPAWNED_GUI && !GUI_ONLY) {
        console.error("(AgentFlow) No server running - spawning detached GUI server...");

        // Use the actual script path for spawning
        const scriptPath = path.join(__dirname, "index.js");
        console.error(`(AgentFlow) Script path: ${scriptPath}`);

        // Create log file for spawned process output
        // Create log file for spawned process output
        const logsDir = path.join(PROJECT_ROOT, "logs");
        if (!fs.existsSync(logsDir)) {
          fs.mkdirSync(logsDir, { recursive: true });
        }
        const logPath = path.join(logsDir, "spawn-server.log");
        const logStream = fs.openSync(logPath, "a");

        // Spawn the server as a detached background process
        const serverProcess = spawn(
          process.execPath, // node executable
          [scriptPath, "--spawn-gui"],
          {
            cwd: PROJECT_ROOT,
            detached: true,
            stdio: ["ignore", logStream, logStream], // Log stdout/stderr to file
            env: { ...process.env, ENABLE_GUI: "true" },
          }
        );

        // Unref so parent can exit independently
        serverProcess.unref();

        console.error(`(AgentFlow) Spawned server process (PID: ${serverProcess.pid})`);

        // Wait for server to start (poll for port availability)
        const maxWait = 10000; // 10 seconds
        const pollInterval = 200; // 200ms
        let waited = 0;

        while (!(await isPortInUse(SERVER_PORT)) && waited < maxWait) {
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
          waited += pollInterval;
        }

        portInUse = await isPortInUse(SERVER_PORT);

        if (portInUse) {
          console.error("(AgentFlow) Server started successfully, connecting as client...");
        } else {
          console.error("(AgentFlow) Warning: Server did not start in time, continuing anyway...");
        }
      }

      // Client registration - behavior differs based on whether this is primary server or client-only mode
      let currentClient: { id: string; name: string } | null = null;
      // Determine if this instance is the primary server (hosts GUI/SSE)
      const isPrimaryServer = !portInUse || IS_SPAWNED_GUI;
      try {
        if (!portInUse || IS_SPAWNED_GUI) {
          // This is the PRIMARY server - clean up all stale clients first
          // Mark all as inactive, then delete them to clean up old duplicates
          await markAllClientsInactive();
          await deleteInactiveClients();
          console.error("(AgentFlow) Primary server starting - cleaned up stale clients");
        }

        // Register this instance as a client (only if not the spawned GUI server)
        // We don't want the persistent server to count as a client in the dashboard
        if (!IS_SPAWNED_GUI) {
          currentClient = await registerClient();
          console.error(
            `(AgentFlow) Registered as client: ${currentClient.name} (${currentClient.id})`
          );
        } else {
          console.error("(AgentFlow) Running as Spawned GUI Server (not registering as client)");
        }

        // Notify about client registration
        if (isPrimaryServer) {
          // Primary server - broadcast directly to SSE connections
          sendClientUpdate();
        } else {
          // Secondary client - notify primary server via HTTP API (fire-and-forget, non-blocking)
          // Use IIFE to run async retry in background without blocking MCP initialize
          (async () => {
            // Only notify if we successfully registered a client
            if (!currentClient) return;

            const notifyUrl = `http://localhost:${SERVER_PORT}/api/clients/notify`;
            for (let attempt = 0; attempt < 5; attempt++) {
              try {
                if (attempt > 0) {
                  await new Promise((resolve) =>
                    setTimeout(resolve, 500 * Math.pow(2, attempt - 1))
                  );
                }
                const response = await fetch(notifyUrl, { method: "POST" });
                if (response.ok) {
                  console.error("(AgentFlow) Notified primary server of client registration");
                  return; // Success, exit
                }
              } catch (err) {
                if (attempt === 4) {
                  console.error("(AgentFlow) Failed to notify primary server after retries");
                }
              }
            }
          })(); // Fire and forget - don't await!
        }

        // Start heartbeat interval (every 1 minute) - for all instances
        setInterval(async () => {
          try {
            if (currentClient) {
              await updateClientHeartbeat(currentClient.id);
            }
          } catch (err) {
            console.error("(AgentFlow) Heartbeat failed:", err);
          }
        }, 60000);

        if (isPrimaryServer) {
          // Only primary server runs periodic cleanup for stale clients (every 30 seconds)
          // Uses 90 second timeout (clients heartbeat every 60s, so 90s gives buffer)
          setInterval(async () => {
            try {
              const cleaned = await cleanupStaleClients(90000); // 90 second timeout
              if (cleaned > 0) {
                // Broadcast updated client count after cleanup
                sendClientUpdate();
                console.error(`(AgentFlow) Cleaned up ${cleaned} stale clients`);
              }
            } catch (err) {
              console.error("(AgentFlow) Stale client cleanup failed:", err);
            }
          }, 30000); // Run every 30 seconds
        }

        // Graceful shutdown - notify primary server when this client disconnects
        const gracefulShutdown = async () => {
          if (currentClient) {
            try {
              if (!isPrimaryServer) {
                // Secondary client - notify primary via HTTP
                const disconnectUrl = `http://localhost:${SERVER_PORT}/api/clients/${currentClient.id}/disconnect`;
                await fetch(disconnectUrl, { method: "DELETE" });
                console.error(`(AgentFlow) Disconnected from primary server`);
              } else {
                // Primary server - just mark inactive locally
                await markClientInactive(currentClient.id);
                sendClientUpdate();
              }
            } catch (err) {
              console.error("(AgentFlow) Failed to disconnect gracefully:", err);
            }
          }
        };

        // Register shutdown handlers (Windows-compatible)
        let isShuttingDown = false;
        const handleShutdown = async (signal: string) => {
          if (isShuttingDown) return;
          isShuttingDown = true;
          console.error(`(AgentFlow) Received ${signal}, shutting down...`);
          await gracefulShutdown();
          process.exit(0);
        };

        process.on("beforeExit", gracefulShutdown);
        process.on("SIGTERM", () => handleShutdown("SIGTERM"));
        process.on("SIGINT", () => handleShutdown("SIGINT"));
        process.on("exit", () => {
          // Synchronous cleanup on exit (as last resort)
          if (currentClient && !isShuttingDown) {
            console.error(
              `(AgentFlow) Process exiting, client ${currentClient.id} will be cleaned up by timeout`
            );
          }
        });
      } catch (err) {
        console.error("(AgentFlow) Failed to register client:", err);
      }

      if (!isPrimaryServer) {
        console.error(`(AgentFlow) Server already running on port ${SERVER_PORT}`);
        console.error(`(AgentFlow) This instance will run in client-only mode (no GUI server)`);
        // If the user explicitly started GUI-only mode, treat this as success and exit cleanly.
        if (GUI_ONLY) {
          console.error("(AgentFlow) GUI already running; exiting with code 0");
          process.exit(0);
        }

        // Otherwise, skip starting GUI server and continue with MCP handler.
      } else {
        // Start HTTP server on fixed port
        const httpServer = app.listen(SERVER_PORT, async () => {
          // Subscribe to task updates
          taskEvents.on(TASK_EVENTS.UPDATED, () => {
            sendSseUpdate();
          });

          // Phase 4 Group 20 — DEPRECATION listener removed alongside
          // the shims. The `TASK_EVENTS.DEPRECATION` enum value stays
          // in `src/utils/events.ts` for future tools but nothing
          // currently emits to it.

          console.error(`(AgentFlow) Web GUI available at: http://localhost:${SERVER_PORT}`);

          // Write the URL to WebGUI.md
          try {
            const websiteUrl = `[Task Manager UI](http://localhost:${SERVER_PORT})`;
            const targetDir = process.env.DATA_DIR || path.join(__dirname, "data");
            const websiteFilePath = path.join(targetDir, "WebGUI.md");

            if (!fs.existsSync(targetDir)) {
              await fsPromises.mkdir(targetDir, { recursive: true });
            }

            await fsPromises.writeFile(websiteFilePath, websiteUrl, "utf-8");
            console.error(`(AgentFlow) GUI link saved to: ${websiteFilePath}`);
          } catch (error) {
            console.error("(AgentFlow) Failed to write WebGUI.md:", error);
          }

          // Auto-open browser by default on primary server startup.
          // Opt-out with DISABLE_AUTO_OPEN=true.
          // Backward compatibility: ENABLE_AUTO_OPEN=false also disables auto-open.
          const shouldAutoOpen =
            process.env.DISABLE_AUTO_OPEN !== "true" && process.env.ENABLE_AUTO_OPEN !== "false";

          if (shouldAutoOpen) {
            try {
              await open(`http://localhost:${SERVER_PORT}`);
              console.error(`(AgentFlow) Opened GUI in browser`);
            } catch (error) {
              console.error(`(AgentFlow) Could not auto-open browser:`, error);
            }
          }
        });

        // Handle server errors
        httpServer.on("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE") {
            console.error(
              `(AgentFlow) Port ${SERVER_PORT} is already in use. Running in client-only mode.`
            );
          } else {
            console.error(`(AgentFlow) Server error:`, err);
          }
        });

        // Cleanup on exit
        const shutdownHandler = async (signal?: string) => {
          try {
            const isGuiOnly = process.argv.includes("--gui") || process.env.GUI_ONLY === "true";

            // In GUI-only usage (or when started from some task runners),
            // SIGINT/SIGTERM can be emitted unexpectedly. Prefer to keep the GUI alive.
            // (You can still stop it by killing the process.)
            if (isGuiOnly && (signal === "SIGTERM" || signal === "SIGINT")) {
              console.error(`(AgentFlow) Ignoring ${signal} in GUI-only mode`);
              return;
            }

            console.error(`(AgentFlow) Shutting down${signal ? ` (${signal})` : ""}...`);

            // Mark current client as inactive before shutdown
            if (currentClient) {
              try {
                await markClientInactive(currentClient.id);
                console.error(`(AgentFlow) Client ${currentClient.id} marked as inactive`);
              } catch (err) {
                console.error("(AgentFlow) Failed to mark client inactive:", err);
              }
            }

            sseClients.forEach((client) => client.end());
            sseClients = [];

            await new Promise<void>((resolve) => httpServer.close(() => resolve()));
          } catch (err) {
            console.error("[AgentFlow] Shutdown handler failed:", err);
          } finally {
            process.exit(0);
          }
        };

        process.on("SIGINT", () => shutdownHandler("SIGINT"));
        process.on("SIGTERM", () => shutdownHandler("SIGTERM"));
      }
    }

    // If started in GUI-only mode, do not start MCP stdio transport.
    // The Express server above keeps the process alive.
    if (GUI_ONLY) {
      console.error("[AgentFlow] Running in GUI-only mode (no MCP stdio transport)");
      return;
    }

    // Phase 3 Group 19 — `MCP_REDUCED_TOOL_SURFACE=true` (default true)
    // moves project_view / task_view / context_get behind Resources and
    // workflow_run(plan|analyze|review) behind Prompts. The tools list
    // drops those entries to honour plan §10 ("startup tool list reduced
    // to verb-only tools"). Set the env var to `false` to keep the
    // legacy tools surface for clients that haven't migrated yet.
    const REDUCED_TOOL_SURFACE =
      process.env.MCP_REDUCED_TOOL_SURFACE === undefined
        ? true
        : process.env.MCP_REDUCED_TOOL_SURFACE === "true";

    // Create MCP server
    const server = new Server(
      {
        name: "AgentFlow",
        version: "1.2.0",
      },
      {
        capabilities: {
          tools: {},
          // Phase 3 Group 19.1 — declare prompts + resources so clients
          // know to call resources/list + prompts/list at handshake.
          resources: {},
          prompts: {},
        },
      }
    );

    // Phase 3 Group 19.2 — Resources surface. Re-exposes
    // project_view / task_view / context_get as readable resources.
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: listResources(),
    }));
    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
      resourceTemplates: listResourceTemplates(),
    }));
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      // readResource throws AppError on validation/handler failure; the
      // SDK turns the rejection into a JSON-RPC error response.
      return readResource(request.params.uri);
    });

    // Phase 3 Group 19.3 — Prompts surface. Re-exposes plan / analyze
    // / review as MCP prompts; other workflows stay on the tools list.
    server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: listPrompts(),
    }));
    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      // Cast to the SDK's result-union type; the response shape
      // (description + messages) matches GetPromptResultSchema but TS
      // can't narrow the broader server-result union for us.
      return (await getPrompt(request.params.name, request.params.arguments)) as never;
    });

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      // Phase 3 Group 19.4 — when REDUCED_TOOL_SURFACE is true, the
      // four moved entries (workflow_run + the three view tools) come
      // off the tools list. workflow_run is still accessible for
      // non-plan/analyze/review workflows via the tools surface, so
      // keep it registered; only the three view tools come off.
      const viewTools = REDUCED_TOOL_SURFACE
        ? []
        : [
            // Phase 1 Group 4 — read-only view tools (replace list_tasks,
            // find_task, list_projects, get_project_context).
            {
              name: "task_view",
              description:
                "Read-only task view. Discriminated on `action`: list (filter by projectId/status), get (taskId), search (query + projectId), next_ready (next PENDING task with all deps COMPLETED), by_status. Every returned task includes `version` for use as `expectedVersion` on subsequent edits.",
              inputSchema: zodToJsonSchema(taskViewSchema),
            },
            {
              name: "project_view",
              description:
                "Read-only project view. Discriminated on `action`: list, get (projectId), summary (projectId — adds task-count breakdown), active (resolves the per-client active project from client_active_project).",
              inputSchema: zodToJsonSchema(projectViewSchema),
            },
            {
              name: "context_get",
              description:
                "Token-budgeted, LLM-free context bundle assembler. Discriminated on `type`: project_summary, implementation_context, verification_context, lessons (deterministic fallback chain: lesson_summaries → recent lessonsLearned + findings → empty), similar_tasks, decisions, findings, skill_index (Wave 3 §10.E — compiled Project Skill body + reference pointers), skill_section (lazy-fetch a single oversized topic referenced by skill_index).",
              inputSchema: zodToJsonSchema(contextGetSchema),
            },
          ];
      return {
        tools: [
          // Phase 1 Group 10 — workflow_run manual-mode scaffold.
          // Replaces plan_idea + process_thought. The 11 workflows
          // each return the §4.4 contract (purpose, inputRequired,
          // steps, outputSchema, qualityChecklist,
          // nextRecommendedCalls); agent mode (Group 15) will reuse
          // the same outputSchema.
          //
          // Stays on the tools list even with REDUCED_TOOL_SURFACE
          // because only `plan`/`analyze`/`review` move to Prompts —
          // the other 8 workflows are still callable here.
          {
            name: "workflow_run",
            description:
              "Run a structured workflow. Discriminated on `workflow`: plan, analyze, review, split_plan, process_thought, record_decision, review_task_quality, build_context_pack, summarize_lessons, detect_duplicates, generate_release_summary, ingest_plan, narrate_abandonment, compile_skill. In `WORKFLOW_MODE=manual` (default), returns the structured contract (purpose, inputRequired, steps, outputSchema, qualityChecklist, nextRecommendedCalls) for the agent to execute. `WORKFLOW_MODE=disabled` returns a typed WORKFLOW_DISABLED payload. Per-call `mode` overrides env. (Phase 3: plan/analyze/review are ALSO available via MCP Prompts — `prompts/list` + `prompts/get`.)",
            inputSchema: zodToJsonSchema(workflowRunSchema),
          },
          // Phase 3 Group 19.2: view tools moved behind Resources by
          // default. Set MCP_REDUCED_TOOL_SURFACE=false to restore them
          // on the tools list (the handlers themselves are unchanged).
          ...viewTools,
          // Phase 1 Group 7 — unified lifecycle tool. Replaces
          // execute_task / verify_task / complete_task on the MCP
          // surface; Group 8 reintroduces the old names as deprecation
          // shims that route through this handler.
          {
            name: "task_lifecycle",
            description:
              "Drive a task through its lifecycle. Discriminated on `action`: claim, start, block, unblock, request_review, finalize, reopen, archive. Only `finalize` requires `expectedVersion` (from task_view); every other action transitions atomically server-side. `finalize.result` is itself a discriminated union on `verdict` (pass / fail / partial / needs_review), each branch with its own required fields. Illegal transitions return a typed CONFLICT.",
            inputSchema: zodToJsonSchema(taskLifecycleSchema),
          },
          // Phase 4 Group 20 — verify_task / complete_task deprecation
          // shims removed in v1.2.0 as advertised by
          // DEPRECATION_REMOVAL_VERSION. Use task_lifecycle directly
          // (action='request_review' or action='finalize').

          // Phase 1 Group 9 — append-only artifact ingestion. The
          // returned `findingId` is the handle agents use as
          // `evidenceRefs[]` on `task_lifecycle(finalize)` and to look
          // the row back up via `context_get(type='findings')`.
          {
            name: "artifact_record",
            description:
              "Append-only artifact ingestion for a task. Discriminated on `kind`: finding (type+content), test_log (outcome+content), build_log (outcome+content), reference (url), commit (sha+message), pull_request (url+status), evidence (content). The server resolves `project_id` from `taskId`. Returns `findingId` for downstream reference. No UPDATE/DELETE — append-only by API contract.",
            inputSchema: zodToJsonSchema(artifactRecordSchema),
          },
          // Phase 1 Group 5 — non-destructive edit tools (replace
          // create_project, update_task, reorder_tasks).
          {
            name: "task_edit",
            description:
              "Non-destructive task edits. Discriminated on `action`: create, update, reorder, set_priority, set_dependency, clear_dependency, split, merge. Single-task actions require `expectedVersion` (from task_view); reorder + merge require `expectedVersions` covering every affected task — any stale version aborts the whole batch with a CONFLICT carrying the current bodies.",
            inputSchema: zodToJsonSchema(taskEditSchema),
          },
          {
            name: "project_edit",
            description:
              "Non-destructive project edits. Discriminated on `action`: create, update, set_active. `set_active` is client-scoped — requires `clientId` and writes only the (client_id, project_id) row; never mutates global state.",
            inputSchema: zodToJsonSchema(projectEditSchema),
          },
          // Phase 1 Group 6 — destructive tools (replace delete_project,
          // delete_task, split_tasks(clearAllTasks)). Two-mode contract:
          // dry_run reports affected scope, execute requires reason +
          // confirm:true + audit-log entry.
          {
            name: "project_delete",
            description:
              "Project deletion with safety chain. Discriminated on `mode`: dry_run (projectId only) returns affected counts + sample; execute requires `projectId`, `reason ≥ 10`, `confirm: true`. Writes an audit row before deleting. Refused when invoked from inside workflow_run.",
            inputSchema: zodToJsonSchema(projectDeleteSchema),
          },
          {
            name: "task_delete",
            description:
              "Task deletion with safety chain. Compound discriminator `op = <action>.<mode>` (action ∈ delete_one | delete_many | clear_all_for_project; mode ∈ dry_run | execute). Execute branches require `reason` (≥10 chars, or ≥20 for clear_all_for_project) and `confirm: true`. Writes an audit row before deleting. Refused when invoked from inside workflow_run.",
            inputSchema: zodToJsonSchema(taskDeleteSchema),
          },
        ],
      };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
      try {
        if (!request.params.arguments) {
          throw new Error("No arguments provided");
        }

        let parsedArgs;
        let taskId: string | undefined;
        let result;

        switch (request.params.name) {
          // Phase 1 Group 10 — workflow_run replaces plan_idea +
          // process_thought. Manual mode by default; per-call
          // `mode` overrides env `WORKFLOW_MODE`.
          case "workflow_run": {
            const parsed = safeParseTool(
              "workflow_run",
              workflowRunSchema,
              request.params.arguments
            );
            if (!parsed.ok) return toToolErrorResponse("workflow_run", parsed.error);
            try {
              return await workflowRun(parsed.data);
            } catch (err) {
              return toToolErrorResponse("workflow_run", err);
            }
          }

          // Phase 1 Group 4 — view tools route through safeParseTool so
          // discriminator errors carry hints, and through toToolError-
          // Response so NotFound/Validation/Conflict get the uniform
          // MCP envelope (including the §6.4 details block).
          case "task_view": {
            const parsed = safeParseTool("task_view", taskViewSchema, request.params.arguments);
            if (!parsed.ok) return toToolErrorResponse("task_view", parsed.error);
            try {
              return await taskView(parsed.data);
            } catch (err) {
              return toToolErrorResponse("task_view", err);
            }
          }

          case "project_view": {
            const parsed = safeParseTool(
              "project_view",
              projectViewSchema,
              request.params.arguments
            );
            if (!parsed.ok) return toToolErrorResponse("project_view", parsed.error);
            try {
              return await projectView(parsed.data);
            } catch (err) {
              return toToolErrorResponse("project_view", err);
            }
          }

          case "context_get": {
            const parsed = safeParseTool("context_get", contextGetSchema, request.params.arguments);
            if (!parsed.ok) return toToolErrorResponse("context_get", parsed.error);
            try {
              return await contextGet(parsed.data);
            } catch (err) {
              return toToolErrorResponse("context_get", err);
            }
          }

          // Phase 1 Group 7 — task_lifecycle replaces the legacy trio.
          case "task_lifecycle": {
            const parsed = safeParseTool(
              "task_lifecycle",
              taskLifecycleSchema,
              request.params.arguments
            );
            if (!parsed.ok) return toToolErrorResponse("task_lifecycle", parsed.error);
            taskId = parsed.data.taskId;
            try {
              result = await taskLifecycle(parsed.data);
              return result;
            } catch (err) {
              return toToolErrorResponse("task_lifecycle", err);
            }
          }

          // Phase 4 Group 20 — verify_task / complete_task switch
          // cases removed in v1.2.0. Calls now fall through to the
          // default branch which returns the "Unknown tool" error;
          // MCP clients should map this to MethodNotFound.

          // Phase 1 Group 9 — append-only artifact ingestion.
          case "artifact_record": {
            const parsed = safeParseTool(
              "artifact_record",
              artifactRecordSchema,
              request.params.arguments
            );
            if (!parsed.ok) return toToolErrorResponse("artifact_record", parsed.error);
            taskId = parsed.data.taskId;
            try {
              result = await artifactRecord(parsed.data);
              return result;
            } catch (err) {
              return toToolErrorResponse("artifact_record", err);
            }
          }

          // Phase 1 Group 6 — destructive tools. task_delete derives
          // its `op` discriminator from `{action, mode}` so callers
          // don't have to assemble it themselves.
          case "task_delete": {
            const normalised = withDeriveOp(request.params.arguments);
            const parsed = safeParseTool("task_delete", taskDeleteSchema, normalised);
            if (!parsed.ok) return toToolErrorResponse("task_delete", parsed.error);
            try {
              return await taskDelete(parsed.data);
            } catch (err) {
              return toToolErrorResponse("task_delete", err);
            }
          }

          case "project_delete": {
            const parsed = safeParseTool(
              "project_delete",
              projectDeleteSchema,
              request.params.arguments
            );
            if (!parsed.ok) return toToolErrorResponse("project_delete", parsed.error);
            try {
              return await projectDelete(parsed.data);
            } catch (err) {
              return toToolErrorResponse("project_delete", err);
            }
          }

          // Phase 1 Group 5 — edit tools route through safeParseTool +
          // toToolErrorResponse so CONFLICT bodies surface inline.
          case "task_edit": {
            const parsed = safeParseTool("task_edit", taskEditSchema, request.params.arguments);
            if (!parsed.ok) return toToolErrorResponse("task_edit", parsed.error);
            try {
              return await taskEdit(parsed.data);
            } catch (err) {
              return toToolErrorResponse("task_edit", err);
            }
          }

          case "project_edit": {
            const parsed = safeParseTool(
              "project_edit",
              projectEditSchema,
              request.params.arguments
            );
            if (!parsed.ok) return toToolErrorResponse("project_edit", parsed.error);
            try {
              return await projectEdit(parsed.data);
            } catch (err) {
              return toToolErrorResponse("project_edit", err);
            }
          }

          default:
            throw new Error(`Tool ${request.params.name} does not exist`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `Error occurred: ${errorMsg} \n Please try correcting the error and calling the tool again`,
            },
          ],
        };
      }
    });

    // Establish MCP stdio connection.
    // When the server is started from a normal terminal (GUI-only usage),
    // the MCP stdio transport may not be available and connect can throw.
    // In that case, keep the GUI running instead of exiting.

    // Skip MCP transport setup for spawned GUI server (it runs headless)
    if (IS_SPAWNED_GUI) {
      console.error("[AgentFlow] Running as spawned GUI server - skipping MCP transport");
      // Keep process alive for GUI server
      setInterval(() => {}, 60000);
    } else {
      try {
        const transport = new StdioServerTransport();

        // Listen for transport/stdin close to detect MCP disconnection
        // Only for MCP clients, NOT for spawned GUI server
        process.stdin.on("end", async () => {
          console.error("(AgentFlow) stdin closed - MCP client disconnected");
          // Trigger graceful shutdown when stdin closes (IDE disconnected)
          process.emit("SIGINT", "SIGINT" as any);
        });

        process.stdin.on("close", async () => {
          console.error("(AgentFlow) stdin closed event - MCP client disconnected");
          process.emit("SIGINT", "SIGINT" as any);
        });

        await server.connect(transport);
      } catch (err) {
        console.error(
          "(AgentFlow) MCP stdio connect failed; continuing without MCP transport:",
          err
        );

        if (!ENABLE_GUI) {
          throw err;
        }
      }
    }
  } catch (error) {
    // If GUI is enabled, prefer to keep the process alive for the web dashboard.
    if (process.env.ENABLE_GUI === "true") {
      console.error("(AgentFlow) Startup error (GUI mode):", error);
      return;
    }
    process.exit(1);
  }
}

main().catch(console.error);
