/**
 * Client Model
 * Handles CRUD operations for IDE clients
 */

import { db as database } from "./db.js";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";

/**
 * Generate a stable client ID based on type and workspace
 * This ensures the same logical client always gets the same ID
 */
function generateStableClientId(type: string, workspace: string): string {
    const normalizedWorkspace = workspace.toLowerCase().replace(/\\/g, '/').replace(/\/$/, '');
    const hash = createHash('md5').update(`${type}:${normalizedWorkspace}`).digest('hex').substring(0, 12);
    return `client-${type}-${hash}`;
}

export interface Client {
    id: string;
    name: string;
    type: "cursor" | "vscode" | "claude" | "unknown";
    workspace?: string;
    connectedAt: Date;
    lastActivityAt: Date;
    isActive: boolean;
    taskCount?: number;
}

// Current client ID for this session
let currentClientId: string | null = null;

/**
 * Initialize clients table
 */
export async function initClientsTable(): Promise<void> {
    return new Promise((resolve, reject) => {
        database.getDb().run(`
      CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        workspace TEXT,
        connected_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL,
        is_active INTEGER DEFAULT 1
      )
    `, (err) => {
            if (err) {
                console.error("[CoT] Failed to create clients table:", err);
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

/**
 * Detect client type from environment
 */
export function detectClientType(): { type: Client["type"]; name: string } {
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
        const type = (process.env.CLIENT_TYPE as Client["type"]) || "unknown";
        return { type, name: process.env.CLIENT_NAME };
    }

    return { type: "unknown", name: "Unknown Client" };
}

/**
 * Register a new client or update existing
 * Uses stable IDs based on type + workspace to prevent duplicates
 */
export async function registerClient(clientInfo?: Partial<Client>): Promise<Client> {
    const detected = detectClientType();
    const workspace = clientInfo?.workspace || process.env.WORKSPACE_PATH || process.cwd();

    // Generate stable ID - same type + workspace always gets same ID
    const stableId = clientInfo?.id || generateStableClientId(detected.type, workspace);

    const client: Client = {
        id: stableId,
        name: clientInfo?.name || detected.name,
        type: clientInfo?.type || detected.type,
        workspace: workspace,
        connectedAt: clientInfo?.connectedAt || new Date(),
        lastActivityAt: new Date(),
        isActive: true
    };

    return new Promise((resolve, reject) => {
        database.getDb().run(`
      INSERT OR REPLACE INTO clients (
        id, name, type, workspace, connected_at, last_activity_at, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
            client.id,
            client.name,
            client.type,
            client.workspace,
            client.connectedAt.getTime(),
            client.lastActivityAt.getTime(),
            client.isActive ? 1 : 0
        ], function (err) {
            if (err) {
                console.error("[CoT] Failed to register client:", err);
                reject(err);
            } else {
                currentClientId = client.id;
                console.error(`[CoT] Client registered: ${client.name} (${client.id})`);
                resolve(client);
            }
        });
    });
}

/**
 * Get current client ID
 */
export function getCurrentClientId(): string | null {
    return currentClientId;
}

/**
 * Set current client ID (used when client_id is passed in env)
 */
export function setCurrentClientId(id: string): void {
    currentClientId = id;
}

/**
 * Get all clients
 * @param activeOnly - If true (default), only return active clients. If false, return all.
 */
export async function getAllClients(activeOnly: boolean = true): Promise<Client[]> {
    return new Promise((resolve, reject) => {
        const whereClause = activeOnly ? 'WHERE is_active = 1' : '';
        database.getDb().all(`
      SELECT * FROM clients
      ${whereClause}
      ORDER BY last_activity_at DESC
    `, (err, rows: any[]) => {
            if (err) {
                // If clients table doesn't exist, return empty array
                if (err.message?.includes('no such table')) {
                    resolve([]);
                    return;
                }
                reject(err);
            } else {
                const clients = rows?.map(row => ({
                    id: row.id,
                    name: row.name,
                    type: row.type as Client["type"],
                    workspace: row.workspace,
                    connectedAt: new Date(row.connected_at),
                    lastActivityAt: new Date(row.last_activity_at),
                    isActive: row.is_active === 1,
                    taskCount: 0 // Will be computed later if needed
                })) || [];
                resolve(clients);
            }
        });
    });
}

/**
 * Get client by ID
 */
export async function getClientById(id: string): Promise<Client | null> {
    return new Promise((resolve, reject) => {
        database.getDb().get(`
      SELECT * FROM clients WHERE id = ?
    `, [id], (err, row: any) => {
            if (err) {
                if (err.message?.includes('no such table')) {
                    resolve(null);
                    return;
                }
                reject(err);
            } else if (!row) {
                resolve(null);
            } else {
                resolve({
                    id: row.id,
                    name: row.name,
                    type: row.type as Client["type"],
                    workspace: row.workspace,
                    connectedAt: new Date(row.connected_at),
                    lastActivityAt: new Date(row.last_activity_at),
                    isActive: row.is_active === 1,
                    taskCount: 0
                });
            }
        });
    });
}

/**
 * Update client heartbeat (last activity)
 */
export async function updateClientHeartbeat(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
        database.getDb().run(`
      UPDATE clients SET last_activity_at = ?, is_active = 1 WHERE id = ?
    `, [Date.now(), id], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

/**
 * Mark client as inactive
 */
export async function markClientInactive(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
        database.getDb().run(`
      UPDATE clients SET is_active = 0 WHERE id = ?
    `, [id], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

/**
 * Delete client
 */
export async function deleteClient(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
        database.getDb().run(`DELETE FROM clients WHERE id = ?`, [id], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

/**
 * Cleanup stale clients - mark clients as inactive if they haven't had activity
 * in the specified timeout period (default: 2 minutes)
 */
export async function cleanupStaleClients(timeoutMs: number = 120000): Promise<number> {
    const cutoffTime = Date.now() - timeoutMs;
    return new Promise((resolve, reject) => {
        database.getDb().run(`
            UPDATE clients SET is_active = 0 
            WHERE is_active = 1 AND last_activity_at < ?
        `, [cutoffTime], function (err) {
            if (err) {
                console.error("[CoT] Failed to cleanup stale clients:", err);
                reject(err);
            } else {
                const markedInactive = this.changes || 0;
                if (markedInactive > 0) {
                    console.error(`[CoT] Marked ${markedInactive} stale client(s) as inactive`);
                }
                resolve(markedInactive);
            }
        });
    });
}

/**
 * Mark all clients as inactive - used on server startup to reset state
 */
export async function markAllClientsInactive(): Promise<void> {
    return new Promise((resolve, reject) => {
        database.getDb().run(`UPDATE clients SET is_active = 0`, (err) => {
            if (err) {
                console.error("[CoT] Failed to mark all clients inactive:", err);
                reject(err);
            } else {
                console.error("[CoT] All existing clients marked as inactive");
                resolve();
            }
        });
    });
}

/**
 * Delete all inactive clients from the database
 * Use this for periodic cleanup to remove stale entries
 */
export async function deleteInactiveClients(): Promise<number> {
    return new Promise((resolve, reject) => {
        database.getDb().run(`DELETE FROM clients WHERE is_active = 0`, function (err) {
            if (err) {
                console.error("[CoT] Failed to delete inactive clients:", err);
                reject(err);
            } else {
                const deleted = this.changes || 0;
                if (deleted > 0) {
                    console.error(`[CoT] Deleted ${deleted} inactive client(s)`);
                }
                resolve(deleted);
            }
        });
    });
}
