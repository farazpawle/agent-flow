/**
 * Client Model
 * Handles CRUD operations for IDE clients
 */
import { db } from "./db.js";
import { createHash } from "crypto";
/**
 * Generate a unique client ID based on type, workspace, and process PID
 * This ensures each MCP server instance gets a unique ID even if running from the same workspace
 */
function generateStableClientId(type, workspace) {
    const normalizedWorkspace = workspace.toLowerCase().replace(/\\/g, '/').replace(/\/$/, '');
    // Include process.pid to ensure each instance is unique
    const uniqueData = `${type}:${normalizedWorkspace}:${process.pid}`;
    const hash = createHash('md5').update(uniqueData).digest('hex').substring(0, 12);
    return `client-${type}-${hash}`;
}
// Current client ID for this session
let currentClientId = null;
/**
 * Initialize clients table - DEPRECATED
 */
export async function initClientsTable() {
    // No-op, handled by db.init()
    return Promise.resolve();
}
/**
 * Detect client type from environment
 */
export function detectClientType() {
    // Check Cursor
    if (process.env.CURSOR_VERSION || process.env.CURSOR_TRACE_ID) {
        return { type: "cursor", name: "Cursor" };
    }
    // Check VS Code
    if (process.env.VSCODE_PID || process.env.TERM_PROGRAM === "vscode") {
        return { type: "vscode", name: "VS Code" };
    }
    // Check Claude Desktop
    if (process.env.CLAUDE_DESKTOP) {
        return { type: "claude", name: "Claude Desktop" };
    }
    // Check for custom client name from env
    if (process.env.CLIENT_NAME) {
        const type = process.env.CLIENT_TYPE || "unknown";
        return { type, name: process.env.CLIENT_NAME };
    }
    return { type: "unknown", name: "Unknown Client" };
}
/**
 * Register a new client or update existing
 * Uses stable IDs based on type + workspace to prevent duplicates
 */
export async function registerClient(clientInfo) {
    const detected = detectClientType();
    const workspace = clientInfo?.workspace || process.env.WORKSPACE_PATH || process.cwd();
    // Generate stable ID - same type + workspace always gets same ID
    const stableId = clientInfo?.id || generateStableClientId(detected.type, workspace);
    const client = {
        id: stableId,
        name: clientInfo?.name || detected.name,
        type: clientInfo?.type || detected.type,
        workspace: workspace,
        connectedAt: clientInfo?.connectedAt || new Date(),
        lastActivityAt: new Date(),
        isActive: true
    };
    await db.registerClient(client);
    currentClientId = client.id;
    console.error(`(AgentFlow) Client registered: ${client.name} (${client.id})`);
    return client;
}
/**
 * Get current client ID
 */
export function getCurrentClientId() {
    return currentClientId;
}
/**
 * Set current client ID (used when client_id is passed in env)
 */
export function setCurrentClientId(id) {
    currentClientId = id;
}
/**
 * Get all clients
 * @param activeOnly - If true (default), only return active clients. If false, return all.
 */
export async function getAllClients(activeOnly = true) {
    return await db.getAllClients(activeOnly);
}
/**
 * Get client by ID
 */
export async function getClientById(id) {
    return await db.getClient(id);
}
/**
 * Update client heartbeat (last activity)
 */
export async function updateClientHeartbeat(id) {
    return await db.updateClientHeartbeat(id);
}
/**
 * Mark client as inactive
 */
export async function markClientInactive(id) {
    // This method is not explicitly in interface, but registerClient or update logic can handle it
    // Wait, I should use registerClient with isActive=false? 
    // Or I can add `markClientInactive` to interface. 
    // Check interfaces.ts... it has `cleanupStaleClients` and `markAllClientsInactive` but not single `markClientInactive`.
    // BUT `registerClient` is an UPSERT. So I can just get the client, set inactive, and save.
    const client = await getClientById(id);
    if (client) {
        client.isActive = false;
        await db.registerClient(client);
    }
}
/**
 * Delete client
 */
export async function deleteClient(id) {
    return await db.deleteClient(id);
}
/**
 * Cleanup stale clients - mark clients as inactive if they haven't had activity
 * in the specified timeout period (default: 2 minutes)
 */
export async function cleanupStaleClients(timeoutMs = 120000) {
    return await db.cleanupStaleClients(timeoutMs);
}
/**
 * Mark all clients as inactive - used on server startup to reset state
 */
export async function markAllClientsInactive() {
    return await db.markAllClientsInactive();
}
/**
 * Delete all inactive clients from the database
 * Use this for periodic cleanup to remove stale entries
 */
export async function deleteInactiveClients() {
    return await db.deleteInactiveClients();
}
//# sourceMappingURL=clientModel.js.map