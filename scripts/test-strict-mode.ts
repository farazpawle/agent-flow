
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Mock environment setup - MUST be done before imports
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DIR = path.join(__dirname, "..", "test_strict_mode_env");
const DB_PATH = path.join(TEST_DIR, "data", "test.db");

// Set environment variables BEFORE importing modules
process.env.DATA_DIR = path.join(TEST_DIR, "data");

async function setup() {
    console.log("Setting up test environment...");
    console.log("DATA_DIR:", process.env.DATA_DIR);

    if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(TEST_DIR, "data"), { recursive: true });
}

async function run() {
    await setup();

    // specific imports AFTER setup and env vars are set
    // This ensures db.ts initializes with the correct DATA_DIR
    const { validateProjectContext } = await import("../src/utils/projectValidation.js");
    const { getGitRemoteUrl } = await import("../src/utils/gitUtils.js");
    const { createProject } = await import("../src/models/projectModel.js");
    const { db } = await import("../src/models/db.js");

    // Initialize DB
    await db.init();

    console.log("Testing Smart Rejection...");

    // 1. No project, no ID -> Should fail with generic error ("No project found" or similar)
    // Note: Since we are in a fresh DB, getGitRemoteUrl might find a URL, but getProjectByGitUrl will return null.
    // So it should fail to find a matching project.
    const res1 = await validateProjectContext(undefined);
    const isPass1 = res1.isValid === false && (
        res1.error?.includes("No project found") ||
        // If git url is found but project not registered, it might say something else?
        // Logic: if gitUrl found, getProjectByGitUrl returns null. if path found, getProjectByPath returns null.
        // It returns "No project found for current path".
        res1.error?.includes("No project found")
    );
    console.log("Test 1 (No context):", isPass1 ? "PASS" : "FAIL", res1.error);

    // 2. Create a project in this path
    const cwd = process.cwd();
    const gitUrl = await getGitRemoteUrl(cwd);

    // Correctly calling createProject with object
    const project = await createProject({
        name: path.basename(cwd),
        path: cwd,
        gitRemoteUrl: gitUrl || undefined
    });
    console.log(`Created project: ${project.name} (ID: ${project.id})`);

    // 3. No ID, but context exists -> Should fail with matching project hint
    const res2 = await validateProjectContext(undefined);
    // Logic: It should find the project via Git URL or Path and suggest it.
    console.log("Test 2 (Context found):", res2.isValid === false && res2.error?.includes(project.id) ? "PASS" : "FAIL", res2.error);

    // 4. Correct ID -> Should pass
    const res3 = await validateProjectContext(project.id);
    console.log("Test 3 (Correct ID):", res3.isValid === true && res3.projectId === project.id ? "PASS" : "FAIL");

    // 5. Wrong ID -> Should fail
    const res4 = await validateProjectContext("wrong-id");
    console.log("Test 4 (Wrong ID):", res4.isValid === false && res4.error?.includes("not found") ? "PASS" : "FAIL", res4.error);
}

run().catch(console.error);
