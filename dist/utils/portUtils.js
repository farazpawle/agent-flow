/**
 * Port Detection Utility
 * Checks if a port is already in use and helps with shared server mode
 */
import net from "net";
/**
 * Check if a port is already in use
 */
export async function isPortInUse(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once("error", (err) => {
            if (err.code === "EADDRINUSE") {
                resolve(true);
            }
            else {
                resolve(false);
            }
        });
        server.once("listening", () => {
            server.close();
            resolve(false);
        });
        server.listen(port);
    });
}
/**
 * Wait for a server to become available on a port
 */
export async function waitForServer(port, timeoutMs = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        try {
            const isUp = await checkServerResponding(port);
            if (isUp)
                return true;
            await sleep(100);
        }
        catch {
            await sleep(100);
        }
    }
    return false;
}
/**
 * Check if a server is responding on a port
 */
export async function checkServerResponding(port) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(1000);
        socket.once("connect", () => {
            socket.destroy();
            resolve(true);
        });
        socket.once("error", () => {
            socket.destroy();
            resolve(false);
        });
        socket.once("timeout", () => {
            socket.destroy();
            resolve(false);
        });
        socket.connect(port, "127.0.0.1");
    });
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=portUtils.js.map