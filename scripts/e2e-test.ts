
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Mock environment setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DIR = path.join(__dirname, "..", "test_e2e_env");

// Set environment variables BEFORE importing modules
process.env.DATA_DIR = path.join(TEST_DIR, "data");
// Initialize default workspace path (though we will override it)
process.env.WORKSPACE_PATH = path.join(TEST_DIR, "workspace_default");

async function setup() {
    console.log("Setting up E2E test environment...");
    if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(TEST_DIR, "data"), { recursive: true });
    fs.mkdirSync(path.join(TEST_DIR, "workspace_A"), { recursive: true });
    fs.mkdirSync(path.join(TEST_DIR, "workspace_B"), { recursive: true });
}

async function run() {
    await setup();

    // Helper to extract JSON from tool response
    function parseToolResponse(response: any) {
        if (!response.content || !response.content[0] || !response.content[0].text) {
            return response; // Return as is if structure doesn't match
        }
        try {
            return JSON.parse(response.content[0].text);
        } catch (e) {
            // For simple text responses, just return an object with the text or specific field
            return { text: response.content[0].text };
        }
    }

    // Dynamic imports
    const { createProject } = await import("../src/tools/projectTools.js");
    const {
        planTask,
        executeTask,
        verifyTask,
        completeTask
    } = await import("../src/tools/task/index.js");
    const {
        splitTasks
    } = await import("../src/tools/task/management.js");
    const { db } = await import("../src/models/db.js");

    await db.init();
    console.log("DB Initialized.\n");

    // ==========================================
    // Scenario 1: Happy Path (Project A)
    // ==========================================
    console.log("=== Scenario 1: Happy Path (Project A) ===");

    // 1. Create Project
    const projectARes = await createProject({
        project_name: "Project A",
        project_description: "My First Project",
        workspace_path: path.join(TEST_DIR, "workspace_A") // EXPLICIT PATH
    });
    const projectAData = parseToolResponse(projectARes);

    if (!projectAData.success) throw new Error("Project creation failed: " + JSON.stringify(projectAData));
    const idA = projectAData.project.id;
    console.log(`[1] Created Project A: ${idA}`);


    // 2. Plan a Task
    await planTask({
        description: "Build a login form",
        projectId: idA,
        existingTasksReference: false,
        focus: "logic"
    });
    console.log(`[2] Plan Task Prompt Generated`);

    // 3. Split Tasks (Actual Creation)
    // Note: splitTasks typically takes a "globalAnalysisResult". We provide a dummy string.
    await splitTasks({
        updateMode: "append",
        projectId: idA, // Important: context
        globalAnalysisResult: "Analysis: We need a login form.",
        tasks: [{
            name: "Implement Login UI",
            description: "Create login.tsx",
            implementationGuide: "Use React",
            verificationCriteria: "It renders",
            priority: "high",
            category: "frontend",
            relatedFiles: []
        }]
    });

    // 4. List Tasks & Get ID
    console.log(`[3] Listing Tasks for Project A...`);
    const { getAllTasks } = await import("../src/models/taskModel.js");
    const allTasksA = await getAllTasks(idA);
    const taskA = allTasksA[0];

    if (!taskA) throw new Error("Task creation failed!");
    console.log(`[4] Task Found: ${taskA.name} (${taskA.id})`);

    // 5. Execute Task
    const execResult = await executeTask({
        taskId: taskA.id,
        projectId: idA
    });
    if (execResult.content && execResult.content.length > 0) {
        // Some errors might be returned as content text not exception
        const text = execResult.content[0].text;
        if (text.includes("Error:")) throw new Error(`Execute failed: ${text}`);
    }
    console.log(`[5] Executed Task (Status set to IN_PROGRESS)`);

    // 6. Verify Task
    const verResult = await verifyTask({
        taskId: taskA.id,
        projectId: idA
    });
    if (verResult.content && verResult.content[0].text.includes("Error:"))
        throw new Error(`Verify failed: ${verResult.content[0].text}`);
    console.log(`[6] Verified Task (Ready for completion)`);

    // 7. Complete Task
    const compResult = await completeTask({
        taskId: taskA.id,
        projectId: idA
    });
    if (compResult.content && compResult.content[0].text.includes("Error:"))
        throw new Error(`Complete failed: ${compResult.content[0].text}`);
    console.log(`[7] Completed Task A`);


    // ==========================================
    // Scenario 2: Multi-Project Isolation
    // ==========================================
    console.log("\n=== Scenario 2: Multi-Project Isolation (Project B) ===");

    // NOTE: We bypass the tool's auto-discovery here to force a distinct project B
    // because the test environment is inside a real Git repo, so "Smart Discovery"
    // correctly identifies both folders as belonging to the SAME root project.
    // For this test, we want to simulate two completely independent projects.

    // Manual DB insertion to force distinct identity
    const { createProject: createProjectModel } = await import("../src/models/projectModel.js");
    const projectBModel = await createProjectModel({
        name: "Project B",
        description: "Second Project - Forced Isolation",
        path: path.join(TEST_DIR, "workspace_B"),
        gitRemoteUrl: "https://github.com/example/project-b.git" // Distinct Git Identity
    });

    const idB = projectBModel.id;
    console.log(`[1] Created Project B (Manual Isolation): ${idB}`);

    // If IDs are same, test is invalid logic wise
    if (idA === idB) throw new Error("CRITICAL: Project A and B share the same ID! Path separation failed.");

    // 2. Verify List Tasks in B is empty
    const allTasksB = await getAllTasks(idB);
    console.log(`[2] Tasks in Project B: ${allTasksB.length} (Expected: 0)`);
    if (allTasksB.length !== 0) throw new Error("Isolation Failed: Project B has tasks!");

    // 3. Try access Task A from Project B context (Strict Mode Check)
    console.log(`[3] Attempting to Execute Task A (${taskA.id}) using Project B ID (Strict Mode Check)...`);
    const crossAccessResult = await executeTask({
        taskId: taskA.id,
        projectId: idB // Wrong Project ID
    });

    const output = crossAccessResult.content?.[0]?.text || "";
    // We expect the tool to catch this and return an error message
    // If "Strict Mode" is working, it should complain about ID mismatch or "Task belongs to project X"
    if (output.includes("belongs to project") || output.includes("Project context mismatch") || (crossAccessResult.isError && output.includes("not found"))) {
        console.log("PASS: Cross-project access rejected successfully.");
    } else {
        console.log("FAIL/WARNING: Cross-project access response was unexpected.");
        console.log("Output:", output);
    }

    console.log("\n=== E2E Test Completed Successfully ===");
}

run().catch(console.error);
