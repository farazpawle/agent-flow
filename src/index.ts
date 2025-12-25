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
  } catch (e) { }
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
} from "@modelcontextprotocol/sdk/types.js";
import express, { Request, Response, NextFunction } from "express";
import { isPortInUse } from "./utils/portUtils.js";
import open from "open";

// Import tool functions
import {
  planIdea,
  planIdeaSchema,
  analyzeIdea,
  analyzeIdeaSchema,
  reflectIdea,
  reflectIdeaSchema,
  splitTasks,
  splitTasksSchema,
  listTasksSchema,
  listTasks,
  executeTask,
  executeTaskSchema,
  verifyTask,
  verifyTaskSchema,
  completeTask,
  completeTaskSchema,
  deleteTask,
  deleteTaskSchema,
  updateTaskContent,
  updateTaskContentSchema,
  queryTask,
  queryTaskSchema,
  getTaskDetail,
  getTaskDetailSchema,
  reorderTasksTool,
  reorderTasksSchema,
} from "./tools/taskTools.js";


// Import thought chain tools
import {
  processThought,
  processThoughtSchema,
} from "./tools/thoughtChainTools.js";

// Import project tools
import {
  createProject,
  createProjectSchema,
  listProjects,
  listProjectsSchema,
  getProjectContext,
  getProjectContextSchema,
  deleteProject,
  deleteProjectSchema,
} from "./tools/projectTools.js";


// Import task model functions
import {
  updateTaskConversationHistory,
  getTaskById,
  getAllTasks,
  ensureDataDir,
  updateTask
} from "./models/taskModel.js";
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
  deleteInactiveClients
} from "./models/clientModel.js";

// Import database
import { db } from "./models/db.js";

async function main() {
  try {
    const ENABLE_GUI = process.env.ENABLE_GUI === "true";
    const ENABLE_DETAILED_MODE = process.env.ENABLE_DETAILED_MODE === "true";
    const GUI_ONLY = process.argv.includes("--gui") || process.env.GUI_ONLY === "true";
    const IS_SPAWNED_GUI = process.argv.includes("--spawn-gui");

    // Initialize Database (SQLite/Supabase)
    try {
      await db.init();
    } catch (dbError) {
      console.error("FATAL: Failed to initialize database:", dbError);
      process.exit(1);
    }

    // Initialize Data Directories (Search indices, etc.)
    await ensureDataDir();

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
      app.use(express.json()); // Enable JSON body parsing

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
            afterCount
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
              env: process.env
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

      // ==================== TASK API ENDPOINTS ====================

      // Get all tasks (with optional project or client filter)
      app.get("/api/tasks", async (req: Request, res: Response) => {
        try {
          let tasks = await getAllTasks();

          // Filter by project_id if provided
          const projectId = req.query.project_id as string;
          if (projectId && projectId !== "all") {
            tasks = tasks.filter(t => (t as any).projectId === projectId);
          }

          // Filter by client_id if provided (backward compatibility)
          const clientId = req.query.client_id as string;
          if (clientId && clientId !== "all") {
            tasks = tasks.filter(t => (t as any).clientId === clientId);
          }

          res.json({ tasks });
        } catch (error) {
          res.status(500).json({ error: "Failed to read tasks data" });
        }
      });
      // Add: SSE endpoint - MUST be defined before /api/tasks/:id to avoid route collision
      app.get("/api/tasks/stream", (req: Request, res: Response) => {
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
      });

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

      // Update task (PATCH)
      app.patch("/api/tasks/:id", async (req: Request, res: Response) => {
        try {
          const taskId = req.params.id;
          const updates = req.body;



          // Normalize status to the canonical TaskStatus strings
          // (UI may send: pending/in_progress/completed)
          if (updates && typeof updates.status === "string") {
            const s = updates.status.trim();
            const lower = s.toLowerCase();
            if (lower === "pending") updates.status = "Pending";
            else if (lower === "in_progress" || lower === "in progress") updates.status = "In Progress";
            else if (lower === "completed") updates.status = "Completed";
            else if (lower === "blocked") updates.status = "Blocked";
          }

          // Validate task exists
          const existingTask = await getTaskById(taskId);
          if (!existingTask) {
            res.status(404).json({ error: "Task not found" });
            return;
          }

          // Apply updates
          const updatedTask = await updateTask(taskId, updates);

          if (!updatedTask) {
            res.status(400).json({ error: "Failed to update task" });
            return;
          }

          // Trigger SSE update
          sendSseUpdate();

          res.json({ success: true, task: updatedTask });
        } catch (error) {
          console.error("[AgentFlow] Error updating task:", error);
          res.status(500).json({ error: "Failed to update task" });
        }
      });

      // Reorder tasks
      app.post("/api/tasks/reorder", async (req: Request, res: Response) => {
        try {
          const { taskIds, projectId } = req.body;
          if (!Array.isArray(taskIds)) {
            res.status(400).json({ error: "Invalid input: taskIds must be an array" });
            return;
          }

          // Call the tool logic with projectId
          const result = await reorderTasksTool({ taskIds, projectId });

          // Trigger SSE update
          sendSseUpdate();

          res.json({ success: true, message: result.content[0].text });
        } catch (error) {
          console.error("Error reordering tasks:", error);
          res.status(500).json({ error: "Failed to reorder tasks" });
        }
      });



      // Conversation history API endpoint (only when detailed mode is enabled)
      if (ENABLE_DETAILED_MODE) {
        app.get("/api/tasks/:taskId/conversation", async (req: Request, res: Response) => {
          try {
            const taskId = req.params.taskId;

            // Validate taskId
            if (!taskId) {
              res.status(400).json({ error: "Task ID is required" });
              return;
            }

            // Get task by ID
            const task = await getTaskById(taskId);

            // If task doesn't exist, return 404
            if (!task) {
              res.status(404).json({ error: "Task not found" });
              return;
            }

            // Return conversation history or empty array if it doesn't exist
            res.json({ conversationHistory: task.conversationHistory || [] });
          } catch (error) {
            console.error("Error retrieving conversation history:", error);
            res.status(500).json({ error: "Failed to retrieve conversation history" });
          }
        });
      }

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
            env: { ...process.env, ENABLE_GUI: "true" }
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
          await new Promise(resolve => setTimeout(resolve, pollInterval));
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
          console.error(`(AgentFlow) Registered as client: ${currentClient.name} (${currentClient.id})`);
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
                  await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, attempt - 1)));
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
            console.error(`(AgentFlow) Process exiting, client ${currentClient.id} will be cleaned up by timeout`);
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

          // Auto-open browser if enabled
          // Note: This is disabled by default because some Antivirus (like Avast) 
          // flag the powershell command used by the 'open' package as a threat.
          if (process.env.ENABLE_AUTO_OPEN === "true") {
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
            console.error(`(AgentFlow) Port ${SERVER_PORT} is already in use. Running in client-only mode.`);
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

    // Create MCP server
    const server = new Server(
      {
        name: "AgentFlow",
        version: "1.0.1",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "plan_idea",
            description: loadPromptFromTemplate("toolsDescription/planIdea.md"),
            inputSchema: zodToJsonSchema(planIdeaSchema),
          },
          {
            name: "analyze_idea",
            description: loadPromptFromTemplate(
              "toolsDescription/analyzeIdea.md"
            ),
            inputSchema: zodToJsonSchema(analyzeIdeaSchema),
          },
          {
            name: "reflect_idea",
            description: loadPromptFromTemplate(
              "toolsDescription/reflectIdea.md"
            ),
            inputSchema: zodToJsonSchema(reflectIdeaSchema),
          },
          {
            name: "split_tasks",
            description: loadPromptFromTemplate(
              "toolsDescription/splitTasks.md"
            ),
            inputSchema: zodToJsonSchema(splitTasksSchema),
          },
          {
            name: "list_tasks",
            description: loadPromptFromTemplate(
              "toolsDescription/listTasks.md"
            ),
            inputSchema: zodToJsonSchema(listTasksSchema),
          },
          {
            name: "execute_task",
            description: loadPromptFromTemplate(
              "toolsDescription/executeTask.md"
            ),
            inputSchema: zodToJsonSchema(executeTaskSchema),
          },
          {
            name: "verify_task",
            description: loadPromptFromTemplate(
              "toolsDescription/verifyTask.md"
            ),
            inputSchema: zodToJsonSchema(verifyTaskSchema),
          },
          {
            name: "complete_task",
            description: loadPromptFromTemplate(
              "toolsDescription/completeTask.md"
            ),
            inputSchema: zodToJsonSchema(completeTaskSchema),
          },
          {
            name: "delete_task",
            description: loadPromptFromTemplate(
              "toolsDescription/deleteTask.md"
            ),
            inputSchema: zodToJsonSchema(deleteTaskSchema),
          },

          {
            name: "update_task",
            description: loadPromptFromTemplate(
              "toolsDescription/updateTask.md"
            ),
            inputSchema: zodToJsonSchema(updateTaskContentSchema),
          },
          {
            name: "query_task",
            description: loadPromptFromTemplate(
              "toolsDescription/queryTask.md"
            ),
            inputSchema: zodToJsonSchema(queryTaskSchema),
          },
          {
            name: "get_task_detail",
            description: loadPromptFromTemplate(
              "toolsDescription/getTaskDetail.md"
            ),
            inputSchema: zodToJsonSchema(getTaskDetailSchema),
          },
          {
            name: "reorder_tasks",
            description: loadPromptFromTemplate(
              "toolsDescription/reorderTasks.md"
            ),
            inputSchema: zodToJsonSchema(reorderTasksSchema),
          },
          {
            name: "process_thought",
            description: loadPromptFromTemplate(
              "toolsDescription/processThought.md"
            ),
            inputSchema: zodToJsonSchema(processThoughtSchema),
          },
          {
            name: "create_project",
            description: "Create or update a project with a description and metadata. Use this tool to create projects that agents can identify across sessions. REQUIRED: project_name and project_description.",
            inputSchema: zodToJsonSchema(createProjectSchema),
          },
          {
            name: "list_projects",
            description: "List all available projects with descriptions. Use this to identify which project to work on when resuming work across sessions. Returns project IDs, names, descriptions, tech stacks, and task counts.",
            inputSchema: zodToJsonSchema(listProjectsSchema),
          },
          {
            name: "get_project_context",
            description: "Get the current project context for this workspace. Use this at the start of a session to understand which project you're working on. Can also be used to switch to a different project by providing project_id.",
            inputSchema: zodToJsonSchema(getProjectContextSchema),
          },
          {
            name: "delete_project",
            description: "Delete a project and all its associated tasks. WARNING: This action is irreversible. Required: project_id and confirm=true.",
            inputSchema: zodToJsonSchema(deleteProjectSchema),
          },
        ],
      };
    });

    server.setRequestHandler(
      CallToolRequestSchema,
      async (request: CallToolRequest) => {
        try {
          if (!request.params.arguments) {
            throw new Error("No arguments provided");
          }

          let parsedArgs;
          let taskId: string | undefined;
          let result;

          // Save request to conversation history if detailed mode is enabled
          // and this is a task-related tool request
          const saveRequest = async () => {
            if (ENABLE_DETAILED_MODE && taskId) {
              try {
                await updateTaskConversationHistory(
                  taskId,
                  'user',
                  JSON.stringify(request.params),
                  request.params.name
                );
              } catch (error) {
                // Silently handle errors to avoid interrupting the main flow
                console.error('Failed to save request to conversation history:', error);
              }
            }
          };

          // Save response to conversation history if detailed mode is enabled
          const saveResponse = async (response: any) => {
            if (ENABLE_DETAILED_MODE && taskId) {
              try {
                await updateTaskConversationHistory(
                  taskId,
                  'assistant',
                  JSON.stringify(response),
                  request.params.name
                );
              } catch (error) {
                // Silently handle errors to avoid interrupting the main flow
                console.error('Failed to save response to conversation history:', error);
              }
            }
          };

          switch (request.params.name) {
            case "plan_idea":
              parsedArgs = await planIdeaSchema.safeParseAsync(
                request.params.arguments
              );
              if (!parsedArgs.success) {
                throw new Error(
                  `Invalid arguments for tool ${request.params.name}: ${parsedArgs.error.message}`
                );
              }
              result = await planIdea(parsedArgs.data);
              return result;

            case "analyze_idea":
              parsedArgs = await analyzeIdeaSchema.safeParseAsync(
                request.params.arguments
              );
              if (!parsedArgs.success) {
                throw new Error(
                  `Invalid arguments for tool ${request.params.name}: ${parsedArgs.error.message}`
                );
              }
              result = await analyzeIdea(parsedArgs.data);
              return result;

            case "reflect_idea":
              parsedArgs = await reflectIdeaSchema.safeParseAsync(
                request.params.arguments
              );
              if (!parsedArgs.success) {
                throw new Error(
                  `Invalid arguments for tool ${request.params.name}: ${parsedArgs.error.message}`
                );
              }
              result = await reflectIdea(parsedArgs.data);
              return result;

            case "split_tasks":
              parsedArgs = await splitTasksSchema.safeParseAsync(
                request.params.arguments
              );
              if (!parsedArgs.success) {
                throw new Error(
                  `Invalid arguments for tool ${request.params.name}: ${parsedArgs.error.message}`
                );
              }
              result = await splitTasks(parsedArgs.data);
              return result;

            case "list_tasks":
              parsedArgs = await listTasksSchema.safeParseAsync(
                request.params.arguments
              );
              if (!parsedArgs.success) {
                throw new Error(
                  `Invalid arguments for tool ${request.params.name}: ${parsedArgs.error.message}`
                );
              }
              result = await listTasks(parsedArgs.data);
              return result;

            case "reorder_tasks":
              parsedArgs = await reorderTasksSchema.safeParseAsync(
                request.params.arguments
              );
              if (!parsedArgs.success) {
                throw new Error(
                  `Invalid arguments for tool ${request.params.name}: ${parsedArgs.error.message}`
                );
              }
              result = await reorderTasksTool(parsedArgs.data);
              return result;

            case "execute_task":
              parsedArgs = await executeTaskSchema.safeParseAsync(
                request.params.arguments
              );
              if (!parsedArgs.success) {
                throw new Error(
                  `Invalid arguments for tool ${request.params.name}: ${parsedArgs.error.message}`
                );
              }
              taskId = parsedArgs.data.taskId;
              await saveRequest();
              result = await executeTask(parsedArgs.data);
              await saveResponse(result);
              return result;

            case "verify_task":
              parsedArgs = await verifyTaskSchema.safeParseAsync(
                request.params.arguments
              );
              if (!parsedArgs.success) {
                throw new Error(
                  `Invalid arguments for tool ${request.params.name}: ${parsedArgs.error.message}`
                );
              }
              taskId = parsedArgs.data.taskId;
              await saveRequest();
              result = await verifyTask(parsedArgs.data);
              await saveResponse(result);
              return result;

            case "complete_task":
              parsedArgs = await completeTaskSchema.safeParseAsync(
                request.params.arguments
              );
              if (!parsedArgs.success) {
                throw new Error(
                  `Invalid arguments for tool ${request.params.name}: ${parsedArgs.error.message}`
                );
              }
              taskId = parsedArgs.data.taskId;
              await saveRequest();
              result = await completeTask(parsedArgs.data);
              await saveResponse(result);
              return result;

            case "delete_task":
              parsedArgs = await deleteTaskSchema.safeParseAsync(
                request.params.arguments
              );
              if (!parsedArgs.success) {
                throw new Error(
                  `Invalid arguments for tool ${request.params.name}: ${parsedArgs.error.message}`
                );
              }
              result = await deleteTask(parsedArgs.data);
              return result;

            case "update_task":
              parsedArgs = await updateTaskContentSchema.safeParseAsync(
                request.params.arguments
              );
              if (!parsedArgs.success) {
                throw new Error(
                  `Invalid arguments for tool ${request.params.name}: ${parsedArgs.error.message}`
                );
              }
              taskId = parsedArgs.data.taskId;
              await saveRequest();
              result = await updateTaskContent(parsedArgs.data);
              await saveResponse(result);
              return result;

            case "query_task":
              parsedArgs = await queryTaskSchema.safeParseAsync(
                request.params.arguments
              );
              if (!parsedArgs.success) {
                throw new Error(
                  `Invalid arguments for tool ${request.params.name}: ${parsedArgs.error.message}`
                );
              }
              result = await queryTask(parsedArgs.data);
              return result;

            case "get_task_detail":
              parsedArgs = await getTaskDetailSchema.safeParseAsync(
                request.params.arguments
              );
              if (!parsedArgs.success) {
                throw new Error(
                  `Invalid arguments for tool ${request.params.name}: ${parsedArgs.error.message}`
                );
              }
              result = await getTaskDetail(parsedArgs.data);
              return result;

            case "process_thought":
              parsedArgs = await processThoughtSchema.safeParseAsync(
                request.params.arguments
              );
              if (!parsedArgs.success) {
                throw new Error(
                  `Invalid arguments for tool ${request.params.name}: ${parsedArgs.error.message}`
                );
              }
              result = await processThought(parsedArgs.data);
              return result;

            case "create_project":
              parsedArgs = await createProjectSchema.safeParseAsync(
                request.params.arguments
              );
              if (!parsedArgs.success) {
                throw new Error(
                  `Invalid arguments for tool ${request.params.name}: ${parsedArgs.error.message}`
                );
              }
              result = await createProject(parsedArgs.data);
              return result;

            case "list_projects":
              parsedArgs = await listProjectsSchema.safeParseAsync(
                request.params.arguments
              );
              if (!parsedArgs.success) {
                throw new Error(
                  `Invalid arguments for tool ${request.params.name}: ${parsedArgs.error.message}`
                );
              }
              result = await listProjects(parsedArgs.data);
              return result;

            case "get_project_context":
              parsedArgs = await getProjectContextSchema.safeParseAsync(
                request.params.arguments
              );
              if (!parsedArgs.success) {
                throw new Error(
                  `Invalid arguments for tool ${request.params.name}: ${parsedArgs.error.message}`
                );
              }
              result = await getProjectContext(parsedArgs.data);
              return result;

            case "delete_project":
              parsedArgs = await deleteProjectSchema.safeParseAsync(
                request.params.arguments
              );
              if (!parsedArgs.success) {
                throw new Error(
                  `Invalid arguments for tool ${request.params.name}: ${parsedArgs.error.message}`
                );
              }
              result = await deleteProject(parsedArgs.data);
              return result;

            default:
              throw new Error(`Tool ${request.params.name} does not exist`);
          }
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text",
                text: `Error occurred: ${errorMsg} \n Please try correcting the error and calling the tool again`,
              },
            ],
          };
        }
      }
    );

    // Establish MCP stdio connection.
    // When the server is started from a normal terminal (GUI-only usage),
    // the MCP stdio transport may not be available and connect can throw.
    // In that case, keep the GUI running instead of exiting.

    // Skip MCP transport setup for spawned GUI server (it runs headless)
    if (IS_SPAWNED_GUI) {
      console.error("[AgentFlow] Running as spawned GUI server - skipping MCP transport");
      // Keep process alive for GUI server
      setInterval(() => { }, 60000);
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
        console.error("(AgentFlow) MCP stdio connect failed; continuing without MCP transport:", err);

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
