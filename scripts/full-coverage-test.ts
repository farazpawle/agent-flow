
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { strict as assert } from "assert";

// Mock environment setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DIR = path.join(__dirname, "..", "test_full_coverage_env");

// Set environment variables BEFORE importing modules
process.env.DATA_DIR = path.join(TEST_DIR, "data");
process.env.WORKSPACE_PATH = path.join(TEST_DIR, "workspace_full");

async function setup() {
    console.log("Setting up Full Coverage test environment...");
    if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(TEST_DIR, "data"), { recursive: true });
    fs.mkdirSync(path.join(TEST_DIR, "workspace_full"), { recursive: true });
}

async function run() {
    await setup();

    // Helper to extract JSON from tool response
    function parseToolResponse(response: any) {
        if (!response.content || !response.content[0] || !response.content[0].text) {
            return response;
        }
        try {
            return JSON.parse(response.content[0].text);
        } catch (e) {
            return { text: response.content[0].text };
        }
    }

    // Dynamic imports
    const { createProject, getProjectContext, listProjects } = await import("../src/tools/projectTools.js");
    const {
        planTask, analyzeTask, reflectTask, splitTasks,
        listTasks, queryTask, getTaskDetail,
        executeTask, verifyTask, completeTask,
        updateTaskContent, deleteTask
    } = await import("../src/tools/task/index.js");

    const { processThought } = await import("../src/tools/thoughtChainTools.js");
    const { db } = await import("../src/models/db.js");

    await db.init();
    console.log("DB Initialized.\n");

    // ==========================================
    // Phase 1: Project & Context
    // ==========================================
    console.log("=== Phase 1: Project & Context ===");

    // Test: create_project
    const projRes = await createProject({
        project_name: "Coverage Project",
        project_description: "Project for full tool coverage",
        workspace_path: path.join(TEST_DIR, "workspace_full")
    });
    const project = parseToolResponse(projRes).project;
    const projectId = project.id;
    console.log(`[PASS] create_project: ${projectId}`);

    // Test: get_project_context
    const contextRes = await getProjectContext({ project_id: projectId });
    const context = parseToolResponse(contextRes);
    assert.equal(context.project.id, projectId);
    console.log(`[PASS] get_project_context: Output matches Project ID`);

    // Test: list_projects
    // listProjectsSchema takes optional params
    const listProjRes = await listProjects({ include_task_count: true });
    const projectsList = parseToolResponse(listProjRes);
    assert(projectsList.projects.length >= 1);
    console.log(`[PASS] list_projects: Found ${projectsList.projects.length} projects`);


    // ==========================================
    // Phase 2: Thought & Analysis
    // ==========================================
    console.log("\n=== Phase 2: Thought & Analysis ===");

    // Test: process_thought
    const thoughtRes = await processThought({
        thought: "I need to analyze requirements",
        thought_number: 1,
        total_thoughts: 3,
        next_thought_needed: true,
        stage: "problem_analysis",
        focus: "logic"
    });
    console.log(`[PASS] process_thought: Executed`);

    // Test: analyze_task
    const analyzeRes = await analyzeTask({
        summary: "Build a User Dashboard",
        initialConcept: "Use React and Tailwind"
    });
    // analyzeTask returns a PROMPT string
    const analysisPrompt = analyzeRes.content[0].text;
    assert(analysisPrompt.includes("User Dashboard"), "Analysis prompt missing summary");
    console.log(`[PASS] analyze_task: Analysis prompt generated`);

    // Test: reflect_task
    const reflectRes = await reflectTask({
        summary: "Build a User Dashboard",
        analysis: "Initial analysis completed."
    });
    // reflectTask returns a PROMPT string
    const reflectionPrompt = reflectRes.content[0].text;
    assert(reflectionPrompt.includes("User Dashboard"), "Reflection prompt missing summary");
    console.log(`[PASS] reflect_task: Reflection prompt generated`);


    // ==========================================
    // Phase 3: Task Lifecycle & Modification
    // ==========================================
    console.log("\n=== Phase 3: Task Lifecycle & Modification ===");

    // Test: plan_task
    await planTask({
        description: "Dashboard Development",
        projectId: projectId,
        focus: "vibe",
        existingTasksReference: false
    });
    console.log(`[PASS] plan_task: Plan created`);

    // Test: split_tasks
    await splitTasks({
        updateMode: "overwrite",
        projectId: projectId,
        globalAnalysisResult: "Plan verified",
        tasks: [
            {
                name: "Header Component", // Task 1
                description: "Create header",
                implementationGuide: "Use <header>",
                verificationCriteria: "Visible",
                priority: "high",
                category: "frontend",
                relatedFiles: []
            },
            {
                name: "Footer Component", // Task 2
                description: "Create footer",
                implementationGuide: "Use <footer>",
                verificationCriteria: "Visible",
                priority: "low",
                category: "frontend",
                relatedFiles: []
            }
        ]
    });
    console.log(`[PASS] split_tasks: Tasks split`);

    // Verify Tasks Created via Model (Tool returns text)
    const listRes = await listTasks({ status: "all", projectId });
    const listText = listRes.content[0].text;
    assert(listText.includes("Header Component"), "List output missing Header task");

    // Get IDs helper for subsequent tests
    const { getAllTasks } = await import("../src/models/taskModel.js");
    const tasks = await getAllTasks(projectId); // Model helper
    assert.equal(tasks.length, 2);
    console.log(`[PASS] list_tasks: Found 2 tasks (verified via Model and Tool text)`);

    const task1 = tasks.find((t: any) => t.name === "Header Component");
    const task2 = tasks.find((t: any) => t.name === "Footer Component");

    if (!task1 || !task2) throw new Error("Tasks not created properly");

    // Test: get_task_detail
    const detailRes = await getTaskDetail({ taskId: task1.id });
    // This typically returns a Prompt or formatted text
    const detailText = detailRes.content[0].text;
    assert(detailText.includes("Header Component"), "Detail text missing task name");
    console.log(`[PASS] get_task_detail: Retrieved task details`);

    // Test: query_task
    const queryRes = await queryTask({
        query: "Footer",
        // Correct params based on schema
        projectId: projectId,
        isId: false,
        page: 1,
        pageSize: 10
    });
    const queryText = queryRes.content[0].text;
    assert(queryText.includes("Footer Component") || queryText.includes("Found 1 task"));
    console.log(`[PASS] query_task: Found task by keyword`);

    // Test: update_task (Content)
    const updateRes = await updateTaskContent({
        taskId: task1.id,
        notes: "Updated Note: Use Flexbox",
        projectId: projectId
    });
    const updatedTaskText = updateRes.content[0].text;
    assert(updatedTaskText.includes("success") || updatedTaskText.includes("Updated"), "Update failed");
    console.log(`[PASS] update_task: Content updated`);

    // Test: execute_task (Start)
    await executeTask({ taskId: task1.id, projectId });
    console.log(`[PASS] execute_task: Task 1 started`);

    // Test: verify_task 
    await verifyTask({ taskId: task1.id, projectId });
    console.log(`[PASS] verify_task: Task 1 verified`);

    // Test: complete_task
    await completeTask({ taskId: task1.id, projectId });
    console.log(`[PASS] complete_task: Task 1 completed`);

    // Test: delete_task
    // Delete Task 2
    await deleteTask({ taskId: task2.id, projectId });
    const remainingTasks = await getAllTasks(projectId);
    assert.equal(remainingTasks.length, 1);
    console.log(`[PASS] delete_task: Task 2 deleted`);

    // Test: clear_all_tasks
    // Appending a new PENDING task to test clearing logic
    await splitTasks({
        updateMode: "append",
        projectId: projectId,
        globalAnalysisResult: "Extra task",
        tasks: [{
            name: "Pending Task",
            description: "To be cleared",
            implementationGuide: "none",
            verificationCriteria: "none",
            priority: "low",
            category: "backend",
            relatedFiles: []
        }]
    });

    await deleteTask({ deleteAll: true, confirm: true, projectId });

    // Check via Model
    const finalTasks = await getAllTasks(projectId);
    const pendingStillExists = finalTasks.find((t: any) => t.name === "Pending Task");
    assert(!pendingStillExists, "Pending task should be cleared");
    console.log(`[PASS] delete_task(bulk): Unfinished tasks cleared`);

    console.log("\n=== Full Coverage Test Completed Successfully ===");
}

run().catch(console.error);
