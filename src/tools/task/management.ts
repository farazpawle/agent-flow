import { z } from "zod";
import {
  getAllTasks,
  batchCreateOrUpdateTasks,
  // Group 6.7 audit — `clearAllTasks` model fn has no callers since
  // the legacy split_tasks(clearAllTasks) path was removed. The only
  // sanctioned mass-delete path is task_delete(clear_all_for_project,
  // execute). Do NOT re-introduce a direct call here.
  searchTasksWithCommand,
  reorderTasks as modelReorderTasks,
} from "../../models/taskModel.js";
import { TaskStatus, Task, RelatedFileType } from "../../types/index.js";
import { getListTasksPrompt, getFindTaskPrompt } from "../../prompts/index.js";
import { listTasksSchema, findTaskSchema, reorderTasksSchema } from "./schemas.js";
import { validateProjectContext } from "../../utils/projectValidation.js";
import { renderTaskToolMessage } from "./messageTemplates.js";
import { renderError } from "../../utils/errorResponse.js";

// List tasks tool
// List tasks tool
export async function listTasks({ status, projectId }: z.infer<typeof listTasksSchema>) {
  // Validate Project Context (Strict Mode)
  const projectValidation = await validateProjectContext(projectId);
  if (!projectValidation.isValid) {
    return {
      content: [{ type: "text" as const, text: projectValidation.error! }],
      isError: true,
    };
  }

  // Filter by Project ID
  const tasks = await getAllTasks(projectValidation.projectId);
  let filteredTasks = tasks;
  switch (status) {
    case "all":
      break;
    case "pending":
      filteredTasks = tasks.filter((task) => task.status === TaskStatus.PENDING);
      break;
    case "in_progress":
      filteredTasks = tasks.filter((task) => task.status === TaskStatus.IN_PROGRESS);
      break;
    case "completed":
      filteredTasks = tasks.filter((task) => task.status === TaskStatus.COMPLETED);
      break;
  }

  if (filteredTasks.length === 0) {
    const statusText = status === "all" ? "any" : `any ${status}`;
    return {
      content: [
        {
          type: "text" as const,
          text: renderTaskToolMessage("taskToolMessages/management/listTasksEmpty.md", {
            statusText,
          }),
        },
      ],
    };
  }

  const tasksByStatus = tasks.reduce(
    (acc, task) => {
      if (!acc[task.status]) {
        acc[task.status] = [];
      }
      acc[task.status].push(task);
      return acc;
    },
    {} as Record<string, typeof tasks>
  );

  // Use prompt generator to get the final prompt
  const prompt = getListTasksPrompt({
    status,
    tasks: tasksByStatus,
    allTasks: filteredTasks,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: prompt,
      },
    ],
  };
}

// Find task tool (unified keyword search + exact ID detail lookup)
export async function findTask({
  query,
  isId = false,
  page = 1,
  pageSize = 5,
  projectId,
}: z.infer<typeof findTaskSchema>) {
  try {
    if (isId) {
      // Exact UUID detail lookup
      const result = await searchTasksWithCommand(query, true, 1, 1);

      if (result.tasks.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: renderTaskToolMessage("taskToolMessages/management/getTaskDetailNotFound.md", {
                taskId: query,
              }),
            },
          ],
          isError: true,
        };
      }

      const task = result.tasks[0];
      const allTasks = await getAllTasks();

      const prompt = getFindTaskPrompt({
        query,
        isId: true,
        tasks: [task],
        allTasks,
        totalTasks: 1,
        page: 1,
        pageSize: 1,
        totalPages: 1,
      });

      return {
        content: [{ type: "text" as const, text: prompt }],
      };
    }

    // Keyword search
    const results = await searchTasksWithCommand(query, false, page, pageSize, projectId);

    let tasks = results.tasks;
    let totalTasks = results.pagination.totalResults;
    let totalPages = results.pagination.totalPages;

    if (tasks.length === 0) {
      const lowerQuery = query.toLowerCase().replace(/[- ]/g, "_");
      const statusMap: Record<string, TaskStatus> = {
        pending: TaskStatus.PENDING,
        in_progress: TaskStatus.IN_PROGRESS,
        "in-progress": TaskStatus.IN_PROGRESS,
        completed: TaskStatus.COMPLETED,
        blocked: TaskStatus.BLOCKED,
      };
      const matchedStatus = statusMap[lowerQuery];
      if (matchedStatus) {
        const allTasksList = await getAllTasks(projectId);
        const filtered = allTasksList.filter((t) => t.status === matchedStatus);
        const start = (page - 1) * pageSize;
        tasks = filtered.slice(start, start + pageSize);
        totalTasks = filtered.length;
        totalPages = Math.ceil(filtered.length / pageSize) || 1;
      }
    }

    const allTasks = await getAllTasks();

    const prompt = getFindTaskPrompt({
      query,
      isId: false,
      tasks,
      allTasks,
      totalTasks,
      page: results.pagination.currentPage,
      pageSize,
      totalPages,
    });

    return {
      content: [{ type: "text" as const, text: prompt }],
    };
  } catch (error) {
    return renderError(
      "find_task",
      error instanceof Error ? error.message : String(error),
      "Check that the query string is valid and the project exists."
    );
  }
}

// Reorder tasks tool
export async function reorderTasksTool({ projectId, taskIds }: z.infer<typeof reorderTasksSchema>) {
  // Validate project context
  const projectValidation = await validateProjectContext(projectId);
  if (!projectValidation.isValid) {
    return {
      content: [{ type: "text" as const, text: projectValidation.error! }],
      isError: true,
    };
  }

  try {
    const updatedTasks = await modelReorderTasks(projectValidation.projectId!, taskIds);

    return {
      content: [
        {
          type: "text" as const,
          text: renderTaskToolMessage("taskToolMessages/management/reorderTasksSuccess.md", {
            updatedTaskCount: updatedTasks.length,
          }),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: renderTaskToolMessage("taskToolMessages/management/reorderTasksFailed.md", {
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
      isError: true,
    };
  }
}
