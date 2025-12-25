
import { db } from "../src/models/db.js";
import { createTask, getAllTasks, ensureDataDir } from "../src/models/taskModel.js";
import { planTaskSchema } from "../src/tools/task/schemas.js";
import { v4 as uuidv4 } from "uuid";

async function verify() {
    console.log("🚀 Starting Manual Verification...");
    await ensureDataDir();

    // --- 1. Verify UX (Zod Error Messages) ---
    console.log("\n🧪 1. Testing UX (Error Messages)...");
    const shortDesc = "Short";
    const result = planTaskSchema.safeParse({ description: shortDesc });
    if (!result.success) {
        console.log("✅ Caught expected error:");
        console.log(`   "${result.error.errors[0].message}"`);
    } else {
        console.error("❌ Failed to catch short description error");
    }

    // --- 2. Verify Performance (DB Filtering) ---
    console.log("\n🧪 2. Testing Performance (DB Filtering)...");

    // Create dummy projects
    const projA = `proj-A-${uuidv4().slice(0, 8)}`;
    const projB = `proj-B-${uuidv4().slice(0, 8)}`;

    console.log(`   Creating 20 tasks for ${projA}...`);
    for (let i = 0; i < 20; i++) await createTask(`Task A ${i}`, "Description", undefined, [], [], projA);

    console.log(`   Creating 20 tasks for ${projB}...`);
    for (let i = 0; i < 20; i++) await createTask(`Task B ${i}`, "Description", undefined, [], [], projB);

    console.log("   Fetching tasks for Project A only...");
    const start = process.hrtime();
    const tasksA = await getAllTasks(projA);
    const end = process.hrtime(start);
    const timeMs = (end[0] * 1000 + end[1] / 1e6).toFixed(2);

    console.log(`   Fetched ${tasksA.length} tasks in ${timeMs}ms`);

    if (tasksA.length !== 20) throw new Error(`Expected 20 tasks, got ${tasksA.length}`);
    if (tasksA.some(t => t.projectId !== projA)) throw new Error("Found tasks from other projects!");

    console.log("✅ DB Filtering verified!");
    process.exit(0);
}

verify().catch(console.error);
