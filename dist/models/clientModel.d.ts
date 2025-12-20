/**
 * Client Model
 * Handles CRUD operations for IDE clients
 */
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
/**
 * Initialize clients table
 */
export declare function initClientsTable(): Promise<void>;
/**
 * Detect client type from environment
 */
export declare function detectClientType(): {
    type: Client["type"];
    name: string;
};
/**
 * Register a new client or update existing
 * Uses stable IDs based on type + workspace to prevent duplicates
 */
export declare function registerClient(clientInfo?: Partial<Client>): Promise<Client>;
/**
 * Get current client ID
 */
export declare function getCurrentClientId(): string | null;
/**
 * Set current client ID (used when client_id is passed in env)
 */
export declare function setCurrentClientId(id: string): void;
/**
 * Get all clients
 * @param activeOnly - If true (default), only return active clients. If false, return all.
 */
export declare function getAllClients(activeOnly?: boolean): Promise<Client[]>;
/**
 * Get client by ID
 */
export declare function getClientById(id: string): Promise<Client | null>;
/**
 * Update client heartbeat (last activity)
 */
export declare function updateClientHeartbeat(id: string): Promise<void>;
/**
 * Mark client as inactive
 */
export declare function markClientInactive(id: string): Promise<void>;
/**
 * Delete client
 */
export declare function deleteClient(id: string): Promise<void>;
/**
 * Cleanup stale clients - mark clients as inactive if they haven't had activity
 * in the specified timeout period (default: 2 minutes)
 */
export declare function cleanupStaleClients(timeoutMs?: number): Promise<number>;
/**
 * Mark all clients as inactive - used on server startup to reset state
 */
export declare function markAllClientsInactive(): Promise<void>;
/**
 * Delete all inactive clients from the database
 * Use this for periodic cleanup to remove stale entries
 */
export declare function deleteInactiveClients(): Promise<number>;
