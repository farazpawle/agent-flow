
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { strict as assert } from "assert";

// Mock environment setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DIR = path.join(__dirname, "..", "test_delete_project_env");

process.env.DATA_DIR = path.join(TEST_DIR, "data");
process.env.WORKSPACE_PATH = path.join(TEST_DIR, "workspace_delete");

async function setup() {
    console.log("Setting up Delete Project test environment...");
    if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(TEST_DIR, "data"), { recursive: true });
    fs.mkdirSync(path.join(TEST_DIR, "workspace_delete"), { recursive: true });
}

async function run() {
    await setup();

    // Helpers
    function parseToolResponse(response: any) {
        if (!response.content || !response.content[0] || !response.content[0].text) return response;
        try { return JSON.parse(response.content[0].text); } catch { return { text: response.content[0].text }; }
    }

    // Imports
    const { createProject, deleteProject } = await import("../src/tools/projectTools.js");
    const { splitTasks } = await import("../src/tools/task/index.js");
    const { db } = await import("../src/models/db.js");
    const { getAllTasks } = await import("../src/models/taskModel.js");
    const { getProjectById } = await import("../src/models/projectModel.js");

    await db.init();
    console.log("DB Initialized.\n");

    // 1. Create Project
    const projRes = await createProject({
        project_name: "Project To Delete",
        project_description: "Temp project",
        workspace_path: path.join(TEST_DIR, "workspace_delete")
    });
    const project = parseToolResponse(projRes).project;
    const projectId = project.id;
    console.log(`[PASS] Project created: ${projectId}`);

    // 2. Add Tasks
    await splitTasks({
        updateMode: "overwrite",
        projectId: projectId,
        globalAnalysisResult: "Plan",
        tasks: [
            { name: "Task 1", description: "T1", priority: "medium", category: "backend" },
            { name: "Task 2", description: "T2", priority: "medium", category: "backend" }
        ]
    });

    // Verify tasks exist
    const tasksBefore = await getAllTasks(projectId);
    assert.equal(tasksBefore.length, 2, "Tasks should exist before deletion");
    console.log(`[PASS] Tasks created: ${tasksBefore.length}`);

    // 3. Delete Project (Fail without confirm)
    const failRes = await deleteProject({ projectId, confirm: false });
    assert(failRes.isError, "Should fail without confirm");
    console.log(`[PASS] Safety check passed (confirm=false rejected)`);

    // 4. Delete Project (Success)
    const successRes = await deleteProject({ projectId, confirm: true });
    const successResult = parseToolResponse(successRes);
    assert(successResult.success, "Deletion failed");
    console.log(`[PASS] Delete tool executed successfully`);

    // 5. Verify Cleanup
    const projAfter = await getProjectById(projectId);
    assert.equal(projAfter, null, "Project should be gone");

    const tasksAfter = await getAllTasks(projectId);
    assert.equal(tasksAfter.length, 0, "Tasks should be gone (orphans cleaned up)");
    console.log(`[PASS] Cleanup verified (Project and Tasks deleted)`);

    console.log("\n=== Delete Project Test Completed Successfully ===");
}

run().catch(console.error);
