/**
 * Port Detection Utility
 * Checks if a port is already in use and helps with shared server mode
 */
/**
 * Check if a port is already in use
 */
export declare function isPortInUse(port: number): Promise<boolean>;
/**
 * Wait for a server to become available on a port
 */
export declare function waitForServer(port: number, timeoutMs?: number): Promise<boolean>;
/**
 * Check if a server is responding on a port
 */
export declare function checkServerResponding(port: number): Promise<boolean>;
