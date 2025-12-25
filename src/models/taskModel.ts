import {
  Task,
  TaskStatus,
  TaskDependency,
  TaskComplexityLevel,
  TaskComplexityThresholds,
  TaskComplexityAssessment,
  RelatedFile,
} from "../types/index.js";
import { v4 as uuidv4 } from "uuid";
import { fileURLToPath } from "url";
import path from "path";

// Import DB and Persistence
import { db } from "./db.js";
import {
  getSearchIndex,
  ensureDirectories,
  archiveOldTasks,
  searchArchives,
  DATA_DIR,
} from "./persistence.js";
import { taskEvents, TASK_EVENTS } from "../utils/events.js";
import {
  getOrCreateProjectFromPath,
  getCurrentProjectId,
  setCurrentProjectId,
} from "./projectModel.js";
import { TaskGraph } from "../utils/taskGraph.js";

// Ensure project folder path is obtained
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Flag to track if initialization has run
let initialized = false;

/**
 * Initialize the task system
 */
export async function ensureDataDir(): Promise<void> {
  if (initialized) return;

  await ensureDirectories();
  await db.init();

  // Set initialized to true immediately to prevent recursion loops
  // because downstream functions (like recalculateTaskOrder) call ensureDataDir()
  initialized = true;

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
      console.error(`(AgentFlow) Archived ${archivedCount} old completed tasks from DB`);
    }

    // Build search index
    const searchIndex = getSearchIndex();
    searchIndex.rebuild(remainingTasks);

    // Initial Order Calculation for Existing Tasks
    // This ensures that tasks created before the ordering logic was added get a valid executionOrder
    try {
      const { getAllProjects } = await import("./projectModel.js");
      const projects = await getAllProjects();
      for (const project of projects) {
        await recalculateTaskOrder(project.id);
      }
      console.error(`(AgentFlow) Recalculated task orders for ${projects.length} projects`);
    } catch (err) {
      console.error("(AgentFlow) Failed to initial recalculate orders:", err);
    }

  } catch (error) {
    console.error("(AgentFlow) Initialization error:", error);
  }
}

// Notify update helper
function notifyUpdate() {
  taskEvents.emit(TASK_EVENTS.UPDATED);
}

export async function getAllTasks(projectId?: string): Promise<Task[]> {
  await ensureDataDir();
  return await db.getAllTasks(projectId);
}

// Get tasks by project ID
export async function getTasksByProject(projectId: string): Promise<Task[]> {
  await ensureDataDir();
  const allTasks = await db.getAllTasks();
  return allTasks.filter(t => t.projectId === projectId);
}

// Get task by ID
export async function getTaskById(taskId: string): Promise<Task | null> {
  await ensureDataDir();
  return await db.getTask(taskId);
}

// Create new task
export async function createTask(
  name: string,
  description: string,
  notes?: string,
  dependencies: string[] = [],
  relatedFiles?: RelatedFile[],
  projectId?: string
): Promise<Task> {
  await ensureDataDir();

  // Resolve project ID
  let resolvedProjectId = projectId;
  if (!resolvedProjectId) {
    // Try to get current project from workspace
    const currentProjectId = getCurrentProjectId();
    if (currentProjectId) {
      resolvedProjectId = currentProjectId;
    } else {
      // Auto-create project from workspace path
      const workspacePath = process.env.WORKSPACE_PATH || process.cwd();
      const project = await getOrCreateProjectFromPath(workspacePath);
      resolvedProjectId = project.id;
    }
  }

  if (!resolvedProjectId) {
    throw new Error(
      "projectId is required to create a task. Create/select a project first, or pass projectId explicitly."
    );
  }

  const dependencyObjects: TaskDependency[] = dependencies.map((taskId) => ({
    taskId,
  }));

  const newTask: Task = {
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

  // Recalculate execution order
  await recalculateTaskOrder(resolvedProjectId);

  notifyUpdate();

  return newTask;
}

// Update task
export async function updateTask(
  taskId: string,
  updates: Partial<Task>
): Promise<Task | null> {
  await ensureDataDir();
  const task = await db.getTask(taskId);

  if (!task) {
    return null;
  }

  // Check if task is completed
  // (Restriction removed to allow re-opening and editing completed tasks)
  // if (task.status === TaskStatus.COMPLETED) { ... }

  const updatedTask: Task = {
    ...task,
    ...updates,
    updatedAt: new Date(),
  };

  await db.saveTask(updatedTask);

  try {
    // Update search index
    getSearchIndex().add(updatedTask);

    // If dependencies were updated, recalculate order for the project
    if (updates.dependencies !== undefined && updatedTask.projectId) {
      console.error(`(AgentFlow) Dependencies changed for task "${updatedTask.name}", recalculating order...`);
      await recalculateTaskOrder(updatedTask.projectId);
    }
  } catch (err) {
    console.error(`(AgentFlow) Warning: Post-update operations failed for task ${taskId}:`, err);
    // Continue execution to return the saved task
  }

  notifyUpdate();

  return updatedTask;
}

// Update task status
export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus
): Promise<Task | null> {
  const updates: Partial<Task> = { status };

  if (status === TaskStatus.COMPLETED) {
    updates.completedAt = new Date();
  }

  return await updateTask(taskId, updates);
}

// Update task summary
export async function updateTaskSummary(
  taskId: string,
  summary: string
): Promise<Task | null> {
  return await updateTask(taskId, { summary });
}

/**
 * Update task conversation history
 */
export async function updateTaskConversationHistory(
  taskId: string,
  role: 'user' | 'assistant',
  content: string,
  toolName?: string
): Promise<Task | null> {
  const task = await getTaskById(taskId);
  if (!task) return null;

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
export async function updateTaskContent(
  taskId: string,
  updates: {
    name?: string;
    description?: string;
    notes?: string;
    relatedFiles?: RelatedFile[];
    dependencies?: string[];
    implementationGuide?: string;
    verificationCriteria?: string;
    problemStatement?: string;
    technicalPlan?: string;
    finalOutcome?: string;
    lessonsLearned?: string;
  }
): Promise<{ success: boolean; message: string; task?: Task }> {
  const task = await getTaskById(taskId);

  if (!task) {
    return { success: false, message: "Task not found" };
  }

  if (task.status === TaskStatus.COMPLETED) {
    return { success: false, message: "Cannot update completed tasks" };
  }

  const updateObj: Partial<Task> = {};

  if (updates.name !== undefined) updateObj.name = updates.name;
  if (updates.description !== undefined) updateObj.description = updates.description;
  if (updates.notes !== undefined) updateObj.notes = updates.notes;
  if (updates.relatedFiles !== undefined) updateObj.relatedFiles = updates.relatedFiles;
  if (updates.dependencies !== undefined) {
    updateObj.dependencies = updates.dependencies.map((dep) => ({
      taskId: dep,
    }));
  }
  if (updates.implementationGuide !== undefined) updateObj.implementationGuide = updates.implementationGuide;
  if (updates.verificationCriteria !== undefined) updateObj.verificationCriteria = updates.verificationCriteria;
  if (updates.problemStatement !== undefined) updateObj.problemStatement = updates.problemStatement;
  if (updates.technicalPlan !== undefined) updateObj.technicalPlan = updates.technicalPlan;
  if (updates.finalOutcome !== undefined) updateObj.finalOutcome = updates.finalOutcome;
  if (updates.lessonsLearned !== undefined) updateObj.lessonsLearned = updates.lessonsLearned;

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
export async function updateTaskRelatedFiles(
  taskId: string,
  relatedFiles: RelatedFile[]
): Promise<{ success: boolean; message: string; task?: Task }> {
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
export async function batchCreateOrUpdateTasks(
  taskDataList: Array<{
    name: string;
    description: string;
    notes?: string;
    dependencies?: string[];
    relatedFiles?: RelatedFile[];
    implementationGuide?: string;
    verificationCriteria?: string;
    problemStatement?: string;
    technicalPlan?: string;
  }>,
  updateMode: "append" | "overwrite" | "selective" | "clearAllTasks",
  globalAnalysisResult?: string,
  projectId?: string,
  sourceStepId?: string
): Promise<Task[]> {
  await ensureDataDir();
  const existingTasks = await db.getAllTasks();

  // Resolve project ID for new tasks
  let resolvedProjectId = projectId;
  if (!resolvedProjectId) {
    const currentProjId = getCurrentProjectId();
    if (currentProjId) {
      resolvedProjectId = currentProjId;
    } else {
      const workspacePath = process.env.WORKSPACE_PATH || process.cwd();
      const project = await getOrCreateProjectFromPath(workspacePath);
      resolvedProjectId = project.id;
    }
  }

  let tasksToKeep: Task[] = [];

  if (updateMode === "append") {
    tasksToKeep = [...existingTasks];
  } else if (updateMode === "overwrite") {
    tasksToKeep = existingTasks.filter(task => task.status === TaskStatus.COMPLETED);
    const tasksToDelete = existingTasks.filter(task => task.status !== TaskStatus.COMPLETED);
    for (const t of tasksToDelete) await db.deleteTask(t.id);
  } else if (updateMode === "selective") {
    const updateTaskNames = new Set(taskDataList.map((task) => task.name));
    tasksToKeep = existingTasks.filter((task) => !updateTaskNames.has(task.name));
  } else if (updateMode === "clearAllTasks") {
    tasksToKeep = [];
    for (const t of existingTasks) await db.deleteTask(t.id);
  }

  const taskNameToIdMap = new Map<string, string>();

  if (!resolvedProjectId) {
    throw new Error(
      "projectId is required to create/update tasks. Create/select a project first, or pass projectId explicitly."
    );
  }
  if (updateMode === "selective") {
    existingTasks.forEach(task => taskNameToIdMap.set(task.name, task.id));
  }
  tasksToKeep.forEach(task => taskNameToIdMap.set(task.name, task.id));

  const newTasks: Task[] = [];
  const tasksToSave: Task[] = [];

  for (const taskData of taskDataList) {
    if (updateMode === "selective" && taskNameToIdMap.has(taskData.name)) {
      const existingTaskId = taskNameToIdMap.get(taskData.name)!;
      const existingTask = existingTasks.find(t => t.id === existingTaskId);

      if (existingTask && existingTask.status !== TaskStatus.COMPLETED) {
        const updatedTask: Task = {
          ...existingTask,
          name: taskData.name,
          description: taskData.description,
          notes: taskData.notes,
          updatedAt: new Date(),
          implementationGuide: taskData.implementationGuide,
          verificationCriteria: taskData.verificationCriteria,
          problemStatement: taskData.problemStatement,
          technicalPlan: taskData.technicalPlan,
          analysisResult: globalAnalysisResult,
          sourceStepId: sourceStepId,
        };
        if (taskData.relatedFiles) updatedTask.relatedFiles = taskData.relatedFiles;

        newTasks.push(updatedTask);
        tasksToSave.push(updatedTask);
      }
    } else {
      const newTaskId = uuidv4();
      taskNameToIdMap.set(taskData.name, newTaskId);
      const newTask: Task = {
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
        problemStatement: taskData.problemStatement,
        technicalPlan: taskData.technicalPlan,
        analysisResult: globalAnalysisResult,
        projectId: resolvedProjectId,
        sourceStepId: sourceStepId,
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
      const resolvedDependencies: TaskDependency[] = [];
      for (const dependencyName of taskData.dependencies) {
        let dependencyTaskId = dependencyName;
        if (!dependencyName.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
          if (taskNameToIdMap.has(dependencyName)) dependencyTaskId = taskNameToIdMap.get(dependencyName)!;
          else continue;
        } else {
          const idExists = [...tasksToKeep, ...newTasks].some(t => t.id === dependencyTaskId) || existingTasks.some(t => t.id === dependencyTaskId);
          if (!idExists) continue;
        }
        resolvedDependencies.push({ taskId: dependencyTaskId });
      }
      newTask.dependencies = resolvedDependencies;
    }
  }

  if (tasksToSave.length > 0) {
    await db.saveTasks(tasksToSave);
  }

  // Recalculate execution order
  await recalculateTaskOrder(resolvedProjectId);

  const allTasks = await db.getAllTasks();
  getSearchIndex().rebuild(allTasks);

  notifyUpdate();

  return newTasks;
}

/**
 * Recalculate execution order for a project
 */
export async function recalculateTaskOrder(projectId: string): Promise<void> {
  await ensureDataDir();
  const tasks = await getTasksByProject(projectId);
  if (tasks.length === 0) return;

  const graph = new TaskGraph(tasks);
  const orderedTasks = graph.recalculateOrder();

  // Debug logging to verify dependency order
  console.error(`(AgentFlow) recalculateTaskOrder for project ${projectId}: ${orderedTasks.length} tasks`);
  orderedTasks.slice(0, 10).forEach(t => {
    const deps = t.dependencies?.map(d => (typeof d === 'object' ? d.taskId : d).slice(0, 8)).join(',') || 'none';
    console.error(`  [${t.executionOrder}] ${t.name} (deps: ${deps})`);
  });

  // Save updated orders
  await db.saveTasks(orderedTasks);
}



/**
 * Reorder tasks based on user input, while respecting dependencies.
 */
export async function reorderTasks(projectId: string, taskIds: string[]): Promise<Task[]> {
  await ensureDataDir();
  const tasks = await getTasksByProject(projectId);
  if (tasks.length === 0) return [];

  // Create a map for quick lookup
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const inputTasks = taskIds.filter(id => taskMap.has(id)).map(id => taskMap.get(id)!);

  // If input tasks are missing (e.g. user only sent a subset), we need to handle that.
  // Strategy: 
  // 1. Assign "User Preferred Order" based on the input list index.
  // 2. Tasks NOT in the input list keep their existing relative order, or mapped to end?
  //    Let's assume input list is the "focus" area. 
  //    Actually, simpler: We calculate a new "weight" for topological sort based on this list.

  // Update executionOrder on the task objects to reflect user's manual preference
  // This preference is just a "hint" for the topological sort's legalization step.
  // But wait, our TaskGraph uses existing executionOrder as a tie-breaker.
  // So we just need to update the executionOrder of these specific tasks to be sequential *before* calling recalculate.

  // However, recalculateTaskOrder normalizes everything 0..N.
  // If we just set these to 0..N, we might lose the relative position of OTHER tasks.

  // Hybrid Approach:
  // 1. Get current Max execution order.
  // 2. NO - that's messy.

  // Better Approach:
  // Just update the temporary executionOrder of the target tasks to reflect the input sequence,
  // potentially spacing them out or overriding.
  // Actually, let's trust the TaskGraph `recalculateOrder` "User Intent" sort.
  // That sort uses `executionOrder` as the primary key for sorting components and nodes.

  // So, we effectively "apply" the user's requested order to the tasks' current state,
  // then run the graph to legalize it.

  // 1. Normalize current orders to ensure gaps? No.
  // 2. Just overwrite executionOrder for the provided IDs to be 0, 1, 2... 
  //    BUT! that would put them all at the top if other tasks are 100, 101...
  //    Or at the bottom if we choose high numbers.

  //    User probably wants to reorder a specific subset relative to each other, OR the whole list.
  //    If the user sends the WHOLE list, it's easy.
  //    If partial: We assume they want to maintain relative position to unmentioned tasks? 
  //    This is tricky. Let's assume the user UI sends the WHOLE list for now, or we treat it as "Move these to top".

  //    Safest: The user (UI) should likely send the re-ordered view of the visible list.

  //    Let's just assign sequential indices to the passed IDs starting from 0 (or finding the min of the current set).
  //    Find min executionOrder of the passed set.
  const relevantOrders = inputTasks.map(t => t.executionOrder || 0);
  let minOrder = relevantOrders.length > 0 ? Math.min(...relevantOrders) : 0;

  // Heuristic: If we are reordering a LARGE chunk (likely the whole list), 
  // and the min is NOT 0, we might want to force it to 0 to "clean up" the list.
  // But safely: if inputTasks.length == tasks.length, set minOrder = 0.
  if (inputTasks.length === tasks.length) {
    minOrder = 0;
  }

  inputTasks.forEach((task, index) => {
    task.executionOrder = minOrder + index; // Attempt to slot them in sequence
    // Note: This matches the user's manual "Visual Order" (before dependency legalization)
  });

  // DO NOT save here! This would cause a race condition where UI sees invalid order.
  // Only save after recalculateOrder fixes the dependency order.

  // Now legalize everything with the graph
  // We need to make sure 'tasks' array has the UPDATED objects for the input set.
  const updatedAllTasks = tasks.map(t => {
    const updated = inputTasks.find(it => it.id === t.id);
    return updated || t;
  });

  const finalGraph = new TaskGraph(updatedAllTasks);
  const validOrderTasks = finalGraph.recalculateOrder();

  // Log for debugging
  console.error(`(AgentFlow) Reorder: ${taskIds.length} tasks reordered, ${validOrderTasks.length} total. Final orders: ${validOrderTasks.map(t => `${t.name}:${t.executionOrder}`).slice(0, 5).join(', ')}${validOrderTasks.length > 5 ? '...' : ''}`);

  // Save the legalized (dependency-respecting) order
  await db.saveTasks(validOrderTasks);

  notifyUpdate();

  return validOrderTasks;
}
// Check executability
export async function canExecuteTask(
  taskId: string
): Promise<{ canExecute: boolean; blockedBy?: string[] }> {
  await ensureDataDir();
  const task = await getTaskById(taskId);
  if (!task) return { canExecute: false };
  if (task.status === TaskStatus.COMPLETED) return { canExecute: false };
  if (task.dependencies.length === 0) return { canExecute: true };

  const allTasks = await getAllTasks();
  const blockedBy: string[] = [];

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
export async function deleteTask(
  taskId: string
): Promise<{ success: boolean; message: string }> {
  await ensureDataDir();
  const tasks = await getAllTasks();
  const task = tasks.find(t => t.id === taskId);

  if (!task) return { success: false, message: "Task not found" };
  if (task.status === TaskStatus.COMPLETED) return { success: false, message: "Cannot delete completed tasks" };

  const dependentTasks = tasks.filter(t => t.dependencies.some(d => d.taskId === taskId));
  if (dependentTasks.length > 0) {
    const names = dependentTasks.map(t => `"${t.name}"`).join(", ");
    return { success: false, message: `Cannot delete, dependent tasks: ${names}` };
  }

  await db.deleteTask(taskId);
  getSearchIndex().remove(taskId);

  // Recalculate execution order if possible (need project ID, but task is gone)
  // We can try to get siblings from the same project if we knew the project ID.
  // Ideally, deleteTask should take projectId or we look it up before deleting.
  // For safety, we can skip or look up before. 
  if (task.projectId) {
    await recalculateTaskOrder(task.projectId);
  }

  notifyUpdate();

  return { success: true, message: "Task deleted successfully" };
}

// Clear all tasks
export async function clearAllTasks(): Promise<{
  success: boolean;
  message: string;
  backupFile?: string;
}> {
  await ensureDataDir();
  const allTasks = await getAllTasks();
  if (allTasks.length === 0) return { success: true, message: "No tasks to clear" };

  for (const t of allTasks) {
    await db.deleteTask(t.id);
  }

  getSearchIndex().rebuild([]);
  notifyUpdate();

  return { success: true, message: "All tasks cleared (Database wiped)" };
}

// Assess task complexity
export async function assessTaskComplexity(
  taskId: string
): Promise<TaskComplexityAssessment | null> {
  const task = await getTaskById(taskId);
  if (!task) return null;

  const descriptionLength = task.description.length;
  const dependenciesCount = task.dependencies.length;
  const notesLength = task.notes ? task.notes.length : 0;
  const hasNotes = !!task.notes;

  let level = TaskComplexityLevel.LOW;

  if (descriptionLength >= TaskComplexityThresholds.DESCRIPTION_LENGTH.VERY_HIGH) level = TaskComplexityLevel.VERY_HIGH;
  else if (descriptionLength >= TaskComplexityThresholds.DESCRIPTION_LENGTH.HIGH) level = TaskComplexityLevel.HIGH;
  else if (descriptionLength >= TaskComplexityThresholds.DESCRIPTION_LENGTH.MEDIUM) level = TaskComplexityLevel.MEDIUM;

  if (dependenciesCount >= TaskComplexityThresholds.DEPENDENCIES_COUNT.VERY_HIGH) level = TaskComplexityLevel.VERY_HIGH;
  else if (dependenciesCount >= TaskComplexityThresholds.DEPENDENCIES_COUNT.HIGH && level !== TaskComplexityLevel.VERY_HIGH) level = TaskComplexityLevel.HIGH;
  else if (dependenciesCount >= TaskComplexityThresholds.DEPENDENCIES_COUNT.MEDIUM && level !== TaskComplexityLevel.HIGH && level !== TaskComplexityLevel.VERY_HIGH) level = TaskComplexityLevel.MEDIUM;

  if (notesLength >= TaskComplexityThresholds.NOTES_LENGTH.VERY_HIGH) level = TaskComplexityLevel.VERY_HIGH;
  else if (notesLength >= TaskComplexityThresholds.NOTES_LENGTH.HIGH && level !== TaskComplexityLevel.VERY_HIGH) level = TaskComplexityLevel.HIGH;
  else if (notesLength >= TaskComplexityThresholds.NOTES_LENGTH.MEDIUM && level !== TaskComplexityLevel.HIGH && level !== TaskComplexityLevel.VERY_HIGH) level = TaskComplexityLevel.MEDIUM;

  const recommendations: string[] = [];
  if (level === TaskComplexityLevel.LOW) {
    recommendations.push("This task is low complexity, can be executed directly");
    recommendations.push("Suggest setting clear completion standards");
  } else if (level === TaskComplexityLevel.MEDIUM) {
    recommendations.push("This task has some complexity, suggest detailed planning execution steps");
    if (dependenciesCount > 0) recommendations.push("Pay attention to dependent tasks");
  } else if (level === TaskComplexityLevel.HIGH) {
    recommendations.push("High complexity, suggest thorough analysis");
    recommendations.push("Consider breaking down");
    if (dependenciesCount > 5) recommendations.push("Many dependencies, make diagram");
  } else if (level === TaskComplexityLevel.VERY_HIGH) {
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
export async function searchTasksWithCommand(
  query: string,
  isId: boolean = false,
  page: number = 1,
  pageSize: number = 5
): Promise<{
  tasks: Task[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalResults: number;
    hasMore: boolean;
  };
}> {
  await ensureDataDir();
  const currentTasks = await getAllTasks();

  let matchingTasks: Task[] = [];

  if (isId) {
    const task = currentTasks.find(t => t.id === query);
    if (task) matchingTasks = [task];
  } else if (query.trim()) {
    const searchIndex = getSearchIndex();
    if (!searchIndex.isReady()) searchIndex.rebuild(currentTasks);
    // Note: ensure these fields are added to persistence.ts getSearchIndex configuration if needed, 
    // but typically MiniSearch indexing happens on the objects passed to .add/.rebuild.
    // We implicitly rely on the object shape. 

    // However, if getSearchIndex() defines specific fields, we must update it there. 
    // Checking persistence.ts is prudent, but for now assuming it uses auto-field or we update the object.

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
    } catch { }
  } else {
    matchingTasks = currentTasks;
  }

  matchingTasks.sort((a, b) => {
    if (a.completedAt && b.completedAt) {
      return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
    } else if (a.completedAt) return -1;
    else if (b.completedAt) return 1;
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
