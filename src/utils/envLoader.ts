import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { applyEnvironmentAliases } from "./envConfig.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, ".."); // Assuming this file is in src/utils, so .. goes to src. Wait, PROJECT_ROOT usually means repo root.
// If file is in src/utils/envLoader.ts, __dirname is src/utils.
// Repo root (where .env is) is src/utils/../../.
// Let's verify standard structure. src/index.ts used path.resolve(__dirname, "..") where __dirname was src.
// So src/index.ts -> src. Root is one up.
// Here src/utils/envLoader.ts -> src/utils. Root is two up.

const REPO_ROOT = path.resolve(__dirname, "../..");

// Explicitly load .env from project root and override inherited variables
dotenv.config({ path: path.join(REPO_ROOT, ".env"), override: true });
applyEnvironmentAliases(process.env);

// --- Patch console.error/log to prevent stdout pollution ---
const LOG_FILE = path.join(REPO_ROOT, "server_stdio.log");

function logToFile(type: string, args: any[]) {
  const msg = args
    .map((a) => (typeof a === "object" && a !== null ? JSON.stringify(a) : String(a)))
    .join(" ");
  const line = `[${new Date().toISOString()}] [${type}] ${msg}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch (e) {}
}

// Redirect console.error to file (and suppress stderr to avoid client confusion)
console.error = (...args: any[]) => logToFile("ERROR", args);

// Optionally redirect console.log too, just in case someone uses it
const originalConsoleLog = console.log;
// We KEEP console.log because it might be used for stdout JSON output if not using process.stdout.write directly.
// BUT MCP SDK uses process.stdout. So console.log is dangerous too.
// Most MCP servers strictly forbid console.log.
console.log = (...args: any[]) => logToFile("LOG", args);
// -----------------------------------------------------------
