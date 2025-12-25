/**
 * planIdea prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */

import {
  loadPrompt,
  generatePrompt,
  loadPromptFromTemplate,
} from "../loader.js";
import { getRulesFilePath } from "../../utils/pathUtils.js";
import { Task, TaskDependency } from "../../types/index.js";

/**
 * planIdea prompt parameter interface
 */
export interface PlanIdeaPromptParams {
  description: string;
  requirements?: string;
  existingTasksReference?: boolean;
  completedTasks?: Task[];
  pendingTasks?: Task[];
  memoryDir: string;
  projectId?: string;
  checkDependencies?: boolean;
}

/**
 * Get the complete planIdea prompt
 * @param params prompt parameters
 * @returns generated prompt
 */
export function getPlanTaskPrompt(params: PlanIdeaPromptParams): string {
  // NOTE: Export name kept as getPlanTaskPrompt temporarily for compatibility during refactor, 
  // but content points to 'planIdea' templates.
  let tasksContent = "";
  // (Tasks logic omitted for Idea phase or kept if we reuse it later? 
  // The 'planIdea' tool implementation passed existingTasksReference: false. 
  // So we can keep the logic but it won't run.)

  let thoughtTemplate = "";
  if (process.env.ENABLE_THOUGHT_CHAIN !== "false") {
    thoughtTemplate = loadPromptFromTemplate("planIdea/hasThought.md");
  } else {
    thoughtTemplate = loadPromptFromTemplate("planIdea/noThought.md");
  }
  const rulesPath = getRulesFilePath();
  const indexTemplate = loadPromptFromTemplate("planIdea/index.md");
  let prompt = generatePrompt(indexTemplate, {
    description: params.description,
    requirements: params.requirements || "No requirements",
    tasksTemplate: tasksContent,
    rulesPath: rulesPath,
    memoryDir: params.memoryDir,
    thoughtTemplate: thoughtTemplate,
    projectId: params.projectId || "Current Project",
  });

  return loadPrompt(prompt, "PLAN_IDEA");
}
