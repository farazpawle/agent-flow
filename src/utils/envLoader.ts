import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

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

console.error('(AgentFlow) Environment loaded from: ${REPO_ROOT}');
