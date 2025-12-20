import path from "path";
import fs from "fs";
import fsPromises from "fs/promises";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

// Explicitly load .env from project root and override inherited variables
dotenv.config({ path: path.join(PROJECT_ROOT, ".env"), override: true });

// Debug logging
const debugLog = (msg: string) => {
  const logMsg = `[CoT Debug] ${new Date().toISOString()} - ${msg}\n`;
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
  planTask,
  planTaskSchema,
  analyzeTask,
  analyzeTaskSchema,
  reflectTask,
  reflectTaskSchema,
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
  clearAllTasks,
  clearAllTasksSchema,
  updateTaskContent,
  updateTaskContentSchema,
  queryTask,
  queryTaskSchema,
  getTaskDetail,
  getTaskDetailSchema,
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

async function main() {
  try {
    const ENABLE_GUI = process.env.ENABLE_GUI === "true";
    const ENABLE_DETAILED_MODE = process.env.ENABLE_DETAILED_MODE === "true";

    // Initialize Database
    await ensureDataDir();

    if (ENABLE_GUI) {
      // Create Express application
      const app = express();

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

      // Set up static file directory
      const publicPath = path.join(__dirname, "public");
      const DATA_DIR_FOR_GUI = process.env.DATA_DIR || path.join(__dirname, "data");

      app.use(express.static(publicPath));
      app.use(express.json()); // Enable JSON body parsing

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
          console.error("Error updating task:", error);
          res.status(500).json({ error: "Failed to update task" });
        }
      });


      // Add: SSE endpoint
      app.get("/api/tasks/stream", (req: Request, res: Response) => {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          // Optional: CORS headers
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
      const portInUse = await isPortInUse(SERVER_PORT);

      // Client registration - behavior differs based on whether this is primary server or client-only mode
      let currentClient: { id: string; name: string } | null = null;
      try {
        if (!portInUse) {
          // This is the PRIMARY server - clean up all stale clients first
          // Mark all as inactive, then delete them to clean up old duplicates
          await markAllClientsInactive();
          await deleteInactiveClients();
          console.error("[CoT] Primary server starting - cleaned up stale clients");
        }

        // Register this instance as a client (both primary and client-only modes)
        currentClient = await registerClient();
        console.error(`[CoT] Registered as client: ${currentClient.name} (${currentClient.id})`);

        // Start heartbeat interval (every 1 minute) - for all instances
        setInterval(async () => {
          try {
            if (currentClient) {
              await updateClientHeartbeat(currentClient.id);
            }
          } catch (err) {
            console.error("[CoT] Heartbeat failed:", err);
          }
        }, 60000);

        if (!portInUse) {
          // Only primary server runs periodic cleanup for stale clients (every 2 minutes)
          setInterval(async () => {
            try {
              await cleanupStaleClients();
            } catch (err) {
              console.error("[CoT] Stale client cleanup failed:", err);
            }
          }, 120000);
        }
      } catch (err) {
        console.error("[CoT] Failed to register client:", err);
      }

      if (portInUse) {
        console.error(`[CoT] Server already running on port ${SERVER_PORT}`);
        console.error(`[CoT] This instance will run in client-only mode (no GUI server)`);
        // Skip starting GUI server, just continue with MCP handler
      } else {
        // Start HTTP server on fixed port
        const httpServer = app.listen(SERVER_PORT, async () => {
          // Subscribe to task updates
          taskEvents.on(TASK_EVENTS.UPDATED, () => {
            sendSseUpdate();
          });

          console.error(`[CoT] Web GUI available at: http://localhost:${SERVER_PORT}`);

          // Write the URL to WebGUI.md
          try {
            const websiteUrl = `[Task Manager UI](http://localhost:${SERVER_PORT})`;
            const targetDir = process.env.DATA_DIR || path.join(__dirname, "data");
            const websiteFilePath = path.join(targetDir, "WebGUI.md");

            if (!fs.existsSync(targetDir)) {
              await fsPromises.mkdir(targetDir, { recursive: true });
            }

            await fsPromises.writeFile(websiteFilePath, websiteUrl, "utf-8");
            console.error(`[CoT] GUI link saved to: ${websiteFilePath}`);
          } catch (error) {
            console.error("[CoT] Failed to write WebGUI.md:", error);
          }

          // Auto-open browser if enabled
          if (process.env.ENABLE_AUTO_OPEN === "true") {
            try {
              await open(`http://localhost:${SERVER_PORT}`);
              console.error(`[CoT] Opened GUI in browser`);
            } catch (error) {
              console.error(`[CoT] Could not auto-open browser:`, error);
            }
          }
        });

        // Handle server errors
        httpServer.on("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE") {
            console.error(`[CoT] Port ${SERVER_PORT} is already in use. Running in client-only mode.`);
          } else {
            console.error(`[CoT] Server error:`, err);
          }
        });

        // Cleanup on exit
        const shutdownHandler = async () => {
          // Mark current client as inactive before shutdown
          if (currentClient) {
            try {
              await markClientInactive(currentClient.id);
              console.error(`[CoT] Client ${currentClient.id} marked as inactive`);
            } catch (err) {
              console.error("[CoT] Failed to mark client inactive:", err);
            }
          }
          sseClients.forEach((client) => client.end());
          sseClients = [];
          await new Promise<void>((resolve) => httpServer.close(() => resolve()));
          process.exit(0);
        };

        process.on("SIGINT", shutdownHandler);
        process.on("SIGTERM", shutdownHandler);
      }
    }

    // Create MCP server
    const server = new Server(
      {
        name: "MCP Chain of Thought",
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
            name: "plan_task",
            description: loadPromptFromTemplate("toolsDescription/planTask.md"),
            inputSchema: zodToJsonSchema(planTaskSchema),
          },
          {
            name: "analyze_task",
            description: loadPromptFromTemplate(
              "toolsDescription/analyzeTask.md"
            ),
            inputSchema: zodToJsonSchema(analyzeTaskSchema),
          },
          {
            name: "reflect_task",
            description: loadPromptFromTemplate(
              "toolsDescription/reflectTask.md"
            ),
            inputSchema: zodToJsonSchema(reflectTaskSchema),
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
            name: "clear_all_tasks",
            description: loadPromptFromTemplate(
              "toolsDescription/clearAllTasks.md"
            ),
            inputSchema: zodToJsonSchema(clearAllTasksSchema),
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
            case "plan_task":
              parsedArgs = await planTaskSchema.safeParseAsync(
                request.params.arguments
              );
              if (!parsedArgs.success) {
                throw new Error(
                  `Invalid arguments for tool ${request.params.name}: ${parsedArgs.error.message}`
                );
              }
              result = await planTask(parsedArgs.data);
              return result;

            case "analyze_task":
              parsedArgs = await analyzeTaskSchema.safeParseAsync(
                request.params.arguments
              );
              if (!parsedArgs.success) {
                throw new Error(
                  `Invalid arguments for tool ${request.params.name}: ${parsedArgs.error.message}`
                );
              }
              result = await analyzeTask(parsedArgs.data);
              return result;

            case "reflect_task":
              parsedArgs = await reflectTaskSchema.safeParseAsync(
                request.params.arguments
              );
              if (!parsedArgs.success) {
                throw new Error(
                  `Invalid arguments for tool ${request.params.name}: ${parsedArgs.error.message}`
                );
              }
              result = await reflectTask(parsedArgs.data);
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

            case "clear_all_tasks":
              parsedArgs = await clearAllTasksSchema.safeParseAsync(
                request.params.arguments
              );
              if (!parsedArgs.success) {
                throw new Error(
                  `Invalid arguments for tool ${request.params.name}: ${parsedArgs.error.message}`
                );
              }
              result = await clearAllTasks(parsedArgs.data);
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

    // Establish connection
    const transport = new StdioServerTransport();
    await server.connect(transport);

  } catch (error) {
    process.exit(1);
  }
}

main().catch(console.error);
