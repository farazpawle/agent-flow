import { TaskStatus, TaskComplexityLevel, TaskComplexityThresholds, } from "../types/index.js";
import { v4 as uuidv4 } from "uuid";
import { fileURLToPath } from "url";
import path from "path";
// Import DB and Persistence
import { db } from "./db.js";
import { getSearchIndex, ensureDirectories, archiveOldTasks, searchArchives, } from "./persistence.js";
import { taskEvents, TASK_EVENTS } from "../utils/events.js";
import { getOrCreateProjectFromPath, getCurrentProjectId, } from "./projectModel.js";
// Ensure project folder path is obtained
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Flag to track if initialization has run
let initialized = false;
/**
 * Initialize the task system
 */
export async function ensureDataDir() {
    if (initialized)
        return;
    await ensureDirectories();
    await db.init();
    // Read current tasks and archive old ones
    try {
        const tasks = await db.getAllTasks();
        // Archive old completed tasks
        const { archivedCount, remainingTasks } = await archiveOldTasks(tasks);
        if (archivedCount > 0) {
            // Logic to sync DB with remaining tasks (delete archived ones)
            const remainingIds = new Set(remainingTasks.map(t => t.id));
            const archivedTasks = tasks.filter(t => !remainingIds.has(t.id));
            for (const t of archivedTasks) {
                await db.deleteTask(t.id);
            }
            console.error(`[CoT] Archived ${archivedCount} old completed tasks from DB`);
        }
        // Build search index
        const searchIndex = getSearchIndex();
        searchIndex.rebuild(remainingTasks);
    }
    catch (error) {
        console.error("Initialization error:", error);
    }
    initialized = true;
}
// Notify update helper
function notifyUpdate() {
    taskEvents.emit(TASK_EVENTS.UPDATED);
}
// Get all tasks (optionally filtered by project)
export async function getAllTasks(projectId) {
    await ensureDataDir();
    const allTasks = await db.getAllTasks();
    if (projectId) {
        return allTasks.filter(t => t.projectId === projectId);
    }
    return allTasks;
}
// Get tasks by project ID
export async function getTasksByProject(projectId) {
    await ensureDataDir();
    const allTasks = await db.getAllTasks();
    return allTasks.filter(t => t.projectId === projectId);
}
// Get task by ID
export async function getTaskById(taskId) {
    await ensureDataDir();
    return await db.getTask(taskId);
}
// Create new task
export async function createTask(name, description, notes, dependencies = [], relatedFiles, projectId) {
    await ensureDataDir();
    // Resolve project ID
    let resolvedProjectId = projectId;
    if (!resolvedProjectId) {
        // Try to get current project from workspace
        const currentProjectId = getCurrentProjectId();
        if (currentProjectId) {
            resolvedProjectId = currentProjectId;
        }
        else {
            // Auto-create project from workspace path
            const workspacePath = process.env.WORKSPACE_PATH || process.cwd();
            const project = await getOrCreateProjectFromPath(workspacePath);
            resolvedProjectId = project.id;
        }
    }
    const dependencyObjects = dependencies.map((taskId) => ({
        taskId,
    }));
    const newTask = {
        id: uuidv4(),
        name,
        description,
        notes,
        status: TaskStatus.PENDING,
        dependencies: dependencyObjects,
        createdAt: new Date(),
        updatedAt: new Date(),
        relatedFiles,
        projectId: resolvedProjectId,
    };
    await db.saveTask(newTask);
    // Update search index
    getSearchIndex().add(newTask);
    notifyUpdate();
    return newTask;
}
// Update task
export async function updateTask(taskId, updates) {
    await ensureDataDir();
    const task = await db.getTask(taskId);
    if (!task) {
        return null;
    }
    // Check if task is completed
    if (task.status === TaskStatus.COMPLETED) {
        // Only allow updating the summary field and relatedFiles field
        const allowedFields = ["summary", "relatedFiles"];
        const attemptedFields = Object.keys(updates);
        const disallowedFields = attemptedFields.filter((field) => !allowedFields.includes(field));
        if (disallowedFields.length > 0) {
            return null;
        }
    }
    const updatedTask = {
        ...task,
        ...updates,
        updatedAt: new Date(),
    };
    await db.saveTask(updatedTask);
    // Update search index
    getSearchIndex().add(updatedTask);
    notifyUpdate();
    return updatedTask;
}
// Update task status
export async function updateTaskStatus(taskId, status) {
    const updates = { status };
    if (status === TaskStatus.COMPLETED) {
        updates.completedAt = new Date();
    }
    return await updateTask(taskId, updates);
}
// Update task summary
export async function updateTaskSummary(taskId, summary) {
    return await updateTask(taskId, { summary });
}
/**
 * Update task conversation history
 */
export async function updateTaskConversationHistory(taskId, role, content, toolName) {
    const task = await getTaskById(taskId);
    if (!task)
        return null;
    const message = {
        timestamp: new Date(),
        role,
        content,
        toolName
    };
    const conversationHistory = task.conversationHistory || [];
    const updatedConversationHistory = [...conversationHistory, message];
    // We use updateTask which handles db save and notification
    return await updateTask(taskId, { conversationHistory: updatedConversationHistory });
}
// Update task content
export async function updateTaskContent(taskId, updates) {
    const task = await getTaskById(taskId);
    if (!task) {
        return { success: false, message: "Task not found" };
    }
    if (task.status === TaskStatus.COMPLETED) {
        return { success: false, message: "Cannot update completed tasks" };
    }
    const updateObj = {};
    if (updates.name !== undefined)
        updateObj.name = updates.name;
    if (updates.description !== undefined)
        updateObj.description = updates.description;
    if (updates.notes !== undefined)
        updateObj.notes = updates.notes;
    if (updates.relatedFiles !== undefined)
        updateObj.relatedFiles = updates.relatedFiles;
    if (updates.dependencies !== undefined) {
        updateObj.dependencies = updates.dependencies.map((dep) => ({
            taskId: dep,
        }));
    }
    if (updates.implementationGuide !== undefined)
        updateObj.implementationGuide = updates.implementationGuide;
    if (updates.verificationCriteria !== undefined)
        updateObj.verificationCriteria = updates.verificationCriteria;
    if (Object.keys(updateObj).length === 0) {
        return { success: true, message: "No content provided to update", task };
    }
    const updatedTask = await updateTask(taskId, updateObj);
    if (!updatedTask) {
        return { success: false, message: "Error updating task" };
    }
    return {
        success: true,
        message: "Task content updated successfully",
        task: updatedTask,
    };
}
// Update task related files
export async function updateTaskRelatedFiles(taskId, relatedFiles) {
    const task = await getTaskById(taskId);
    if (!task) {
        return { success: false, message: "Task not found" };
    }
    if (task.status === TaskStatus.COMPLETED) {
        return { success: false, message: "Cannot update completed tasks" };
    }
    const updatedTask = await updateTask(taskId, { relatedFiles });
    if (!updatedTask) {
        return { success: false, message: "Error updating task related files" };
    }
    return {
        success: true,
        message: `Task related files updated successfully, ${relatedFiles.length} files updated`,
        task: updatedTask,
    };
}
// Batch create or update tasks
export async function batchCreateOrUpdateTasks(taskDataList, updateMode, globalAnalysisResult, projectId) {
    await ensureDataDir();
    const existingTasks = await db.getAllTasks();
    // Resolve project ID for new tasks
    let resolvedProjectId = projectId;
    if (!resolvedProjectId) {
        const currentProjId = getCurrentProjectId();
        if (currentProjId) {
            resolvedProjectId = currentProjId;
        }
        else {
            const workspacePath = process.env.WORKSPACE_PATH || process.cwd();
            const project = await getOrCreateProjectFromPath(workspacePath);
            resolvedProjectId = project.id;
        }
    }
    let tasksToKeep = [];
    if (updateMode === "append") {
        tasksToKeep = [...existingTasks];
    }
    else if (updateMode === "overwrite") {
        tasksToKeep = existingTasks.filter(task => task.status === TaskStatus.COMPLETED);
        const tasksToDelete = existingTasks.filter(task => task.status !== TaskStatus.COMPLETED);
        for (const t of tasksToDelete)
            await db.deleteTask(t.id);
    }
    else if (updateMode === "selective") {
        const updateTaskNames = new Set(taskDataList.map((task) => task.name));
        tasksToKeep = existingTasks.filter((task) => !updateTaskNames.has(task.name));
    }
    else if (updateMode === "clearAllTasks") {
        tasksToKeep = [];
        for (const t of existingTasks)
            await db.deleteTask(t.id);
    }
    const taskNameToIdMap = new Map();
    if (updateMode === "selective") {
        existingTasks.forEach(task => taskNameToIdMap.set(task.name, task.id));
    }
    tasksToKeep.forEach(task => taskNameToIdMap.set(task.name, task.id));
    const newTasks = [];
    const tasksToSave = [];
    for (const taskData of taskDataList) {
        if (updateMode === "selective" && taskNameToIdMap.has(taskData.name)) {
            const existingTaskId = taskNameToIdMap.get(taskData.name);
            const existingTask = existingTasks.find(t => t.id === existingTaskId);
            if (existingTask && existingTask.status !== TaskStatus.COMPLETED) {
                const updatedTask = {
                    ...existingTask,
                    name: taskData.name,
                    description: taskData.description,
                    notes: taskData.notes,
                    updatedAt: new Date(),
                    implementationGuide: taskData.implementationGuide,
                    verificationCriteria: taskData.verificationCriteria,
                    analysisResult: globalAnalysisResult,
                };
                if (taskData.relatedFiles)
                    updatedTask.relatedFiles = taskData.relatedFiles;
                newTasks.push(updatedTask);
                tasksToSave.push(updatedTask);
            }
        }
        else {
            const newTaskId = uuidv4();
            taskNameToIdMap.set(taskData.name, newTaskId);
            const newTask = {
                id: newTaskId,
                name: taskData.name,
                description: taskData.description,
                notes: taskData.notes,
                status: TaskStatus.PENDING,
                dependencies: [],
                createdAt: new Date(),
                updatedAt: new Date(),
                relatedFiles: taskData.relatedFiles,
                implementationGuide: taskData.implementationGuide,
                verificationCriteria: taskData.verificationCriteria,
                analysisResult: globalAnalysisResult,
                projectId: resolvedProjectId,
            };
            newTasks.push(newTask);
            tasksToSave.push(newTask);
        }
    }
    // Handle dependencies
    for (let i = 0; i < taskDataList.length; i++) {
        const taskData = taskDataList[i];
        const newTask = newTasks[i];
        if (taskData.dependencies && taskData.dependencies.length > 0) {
            const resolvedDependencies = [];
            for (const dependencyName of taskData.dependencies) {
                let dependencyTaskId = dependencyName;
                if (!dependencyName.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
                    if (taskNameToIdMap.has(dependencyName))
                        dependencyTaskId = taskNameToIdMap.get(dependencyName);
                    else
                        continue;
                }
                else {
                    const idExists = [...tasksToKeep, ...newTasks].some(t => t.id === dependencyTaskId) || existingTasks.some(t => t.id === dependencyTaskId);
                    if (!idExists)
                        continue;
                }
                resolvedDependencies.push({ taskId: dependencyTaskId });
            }
            newTask.dependencies = resolvedDependencies;
        }
    }
    if (tasksToSave.length > 0) {
        await db.saveTasks(tasksToSave);
    }
    const allTasks = await db.getAllTasks();
    getSearchIndex().rebuild(allTasks);
    notifyUpdate();
    return newTasks;
}
// Check executability
export async function canExecuteTask(taskId) {
    await ensureDataDir();
    const task = await getTaskById(taskId);
    if (!task)
        return { canExecute: false };
    if (task.status === TaskStatus.COMPLETED)
        return { canExecute: false };
    if (task.dependencies.length === 0)
        return { canExecute: true };
    const allTasks = await getAllTasks();
    const blockedBy = [];
    for (const dependency of task.dependencies) {
        const dependencyTask = allTasks.find((t) => t.id === dependency.taskId);
        if (!dependencyTask || dependencyTask.status !== TaskStatus.COMPLETED) {
            blockedBy.push(dependency.taskId);
        }
    }
    return {
        canExecute: blockedBy.length === 0,
        blockedBy: blockedBy.length > 0 ? blockedBy : undefined,
    };
}
// Delete task
export async function deleteTask(taskId) {
    await ensureDataDir();
    const tasks = await getAllTasks();
    const task = tasks.find(t => t.id === taskId);
    if (!task)
        return { success: false, message: "Task not found" };
    if (task.status === TaskStatus.COMPLETED)
        return { success: false, message: "Cannot delete completed tasks" };
    const dependentTasks = tasks.filter(t => t.dependencies.some(d => d.taskId === taskId));
    if (dependentTasks.length > 0) {
        const names = dependentTasks.map(t => `"${t.name}"`).join(", ");
        return { success: false, message: `Cannot delete, dependent tasks: ${names}` };
    }
    await db.deleteTask(taskId);
    getSearchIndex().remove(taskId);
    notifyUpdate();
    return { success: true, message: "Task deleted successfully" };
}
// Clear all tasks
export async function clearAllTasks() {
    await ensureDataDir();
    const allTasks = await getAllTasks();
    if (allTasks.length === 0)
        return { success: true, message: "No tasks to clear" };
    for (const t of allTasks) {
        await db.deleteTask(t.id);
    }
    getSearchIndex().rebuild([]);
    notifyUpdate();
    return { success: true, message: "All tasks cleared (Database wiped)" };
}
// Assess task complexity
export async function assessTaskComplexity(taskId) {
    const task = await getTaskById(taskId);
    if (!task)
        return null;
    const descriptionLength = task.description.length;
    const dependenciesCount = task.dependencies.length;
    const notesLength = task.notes ? task.notes.length : 0;
    const hasNotes = !!task.notes;
    let level = TaskComplexityLevel.LOW;
    if (descriptionLength >= TaskComplexityThresholds.DESCRIPTION_LENGTH.VERY_HIGH)
        level = TaskComplexityLevel.VERY_HIGH;
    else if (descriptionLength >= TaskComplexityThresholds.DESCRIPTION_LENGTH.HIGH)
        level = TaskComplexityLevel.HIGH;
    else if (descriptionLength >= TaskComplexityThresholds.DESCRIPTION_LENGTH.MEDIUM)
        level = TaskComplexityLevel.MEDIUM;
    if (dependenciesCount >= TaskComplexityThresholds.DEPENDENCIES_COUNT.VERY_HIGH)
        level = TaskComplexityLevel.VERY_HIGH;
    else if (dependenciesCount >= TaskComplexityThresholds.DEPENDENCIES_COUNT.HIGH && level !== TaskComplexityLevel.VERY_HIGH)
        level = TaskComplexityLevel.HIGH;
    else if (dependenciesCount >= TaskComplexityThresholds.DEPENDENCIES_COUNT.MEDIUM && level !== TaskComplexityLevel.HIGH && level !== TaskComplexityLevel.VERY_HIGH)
        level = TaskComplexityLevel.MEDIUM;
    if (notesLength >= TaskComplexityThresholds.NOTES_LENGTH.VERY_HIGH)
        level = TaskComplexityLevel.VERY_HIGH;
    else if (notesLength >= TaskComplexityThresholds.NOTES_LENGTH.HIGH && level !== TaskComplexityLevel.VERY_HIGH)
        level = TaskComplexityLevel.HIGH;
    else if (notesLength >= TaskComplexityThresholds.NOTES_LENGTH.MEDIUM && level !== TaskComplexityLevel.HIGH && level !== TaskComplexityLevel.VERY_HIGH)
        level = TaskComplexityLevel.MEDIUM;
    const recommendations = [];
    if (level === TaskComplexityLevel.LOW) {
        recommendations.push("This task is low complexity, can be executed directly");
        recommendations.push("Suggest setting clear completion standards");
    }
    else if (level === TaskComplexityLevel.MEDIUM) {
        recommendations.push("This task has some complexity, suggest detailed planning execution steps");
        if (dependenciesCount > 0)
            recommendations.push("Pay attention to dependent tasks");
    }
    else if (level === TaskComplexityLevel.HIGH) {
        recommendations.push("High complexity, suggest thorough analysis");
        recommendations.push("Consider breaking down");
        if (dependenciesCount > 5)
            recommendations.push("Many dependencies, make diagram");
    }
    else if (level === TaskComplexityLevel.VERY_HIGH) {
        recommendations.push("⚠️ Very high complexity, break down!");
        recommendations.push("Thorough risk assessment needed");
    }
    return {
        level,
        metrics: { descriptionLength, dependenciesCount, notesLength, hasNotes },
        recommendations,
    };
}
// Search tasks
export async function searchTasksWithCommand(query, isId = false, page = 1, pageSize = 5) {
    await ensureDataDir();
    const currentTasks = await getAllTasks();
    let matchingTasks = [];
    if (isId) {
        const task = currentTasks.find(t => t.id === query);
        if (task)
            matchingTasks = [task];
    }
    else if (query.trim()) {
        const searchIndex = getSearchIndex();
        if (!searchIndex.isReady())
            searchIndex.rebuild(currentTasks);
        const matchedIds = searchIndex.search(query);
        const idSet = new Set(matchedIds);
        matchingTasks = currentTasks.filter(t => idSet.has(t.id));
        try {
            const archivedMatches = await searchArchives(query);
            for (const archivedTask of archivedMatches) {
                if (!idSet.has(archivedTask.id)) {
                    matchingTasks.push(archivedTask);
                }
            }
        }
        catch { }
    }
    else {
        matchingTasks = currentTasks;
    }
    matchingTasks.sort((a, b) => {
        if (a.completedAt && b.completedAt) {
            return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
        }
        else if (a.completedAt)
            return -1;
        else if (b.completedAt)
            return 1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    const totalResults = matchingTasks.length;
    const totalPages = Math.ceil(totalResults / pageSize);
    const safePage = Math.max(1, Math.min(page, totalPages || 1));
    const startIndex = (safePage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, totalResults);
    const paginatedTasks = matchingTasks.slice(startIndex, endIndex);
    return {
        tasks: paginatedTasks,
        pagination: {
            currentPage: safePage,
            totalPages: totalPages || 1,
            totalResults,
            hasMore: safePage < totalPages,
        },
    };
}
//# sourceMappingURL=taskModel.js.map