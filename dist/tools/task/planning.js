import path from "path";
import { fileURLToPath } from "url";
import { getAllTasks } from "../../models/taskModel.js";
import { TaskStatus } from "../../types/index.js";
import { getPlanTaskPrompt, getAnalyzeTaskPrompt, getReflectTaskPrompt, } from "../../prompts/index.js";
// Task planning tool
export async function planTask({ description, requirements, existingTasksReference = false, }) {
    // Get base directory path
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const PROJECT_ROOT = path.resolve(__dirname, "../../..");
    const DATA_DIR = process.env.DATA_DIR || path.join(PROJECT_ROOT, "data");
    const MEMORY_DIR = path.join(DATA_DIR, "memory");
    // Prepare required parameters
    let completedTasks = [];
    let pendingTasks = [];
    // When existingTasksReference is true, load all tasks from the database as reference
    if (existingTasksReference) {
        try {
            const allTasks = await getAllTasks();
            // Split tasks into completed and pending categories
            completedTasks = allTasks.filter((task) => task.status === TaskStatus.COMPLETED);
            pendingTasks = allTasks.filter((task) => task.status !== TaskStatus.COMPLETED);
        }
        catch (error) { }
    }
    // Use prompt generator to get the final prompt
    const prompt = getPlanTaskPrompt({
        description,
        requirements,
        existingTasksReference,
        completedTasks,
        pendingTasks,
        memoryDir: MEMORY_DIR,
    });
    return {
        content: [
            {
                type: "text",
                text: prompt,
            },
        ],
    };
}
export async function analyzeTask({ summary, initialConcept, previousAnalysis, }) {
    // Use prompt generator to get the final prompt
    const prompt = getAnalyzeTaskPrompt({
        summary,
        initialConcept,
        previousAnalysis,
    });
    return {
        content: [
            {
                type: "text",
                text: prompt,
            },
        ],
    };
}
export async function reflectTask({ summary, analysis, }) {
    // Use prompt generator to get the final prompt
    const prompt = getReflectTaskPrompt({
        summary,
        analysis,
    });
    return {
        content: [
            {
                type: "text",
                text: prompt,
            },
        ],
    };
}
//# sourceMappingURL=planning.js.map