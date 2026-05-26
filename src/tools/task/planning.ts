import { z } from "zod";
import path from "path";
import { getPlanTaskPrompt } from "../../prompts/index.js";
import { planIdeaSchema } from "./schemas.js";
import { validateProjectContext } from "../../utils/projectValidation.js";
import { createStep, getStepById } from "../../models/workflowModel.js";
import { renderTaskToolMessage } from "./messageTemplates.js";

// ============================================================================
// IDEA PHASE TOOLS (Brainstorming & Planning)
// ============================================================================

export async function planIdea({
  stage = "plan",
  description,
  requirements,
  projectId,
  focus,
  inputStepId,
  analysis,
}: z.input<typeof planIdeaSchema>) {
  if (stage === "analyze") {
    const step = await getStepById(inputStepId!);
    if (!step) {
      return {
        content: [
          {
            type: "text" as const,
            text: renderTaskToolMessage("taskToolMessages/planning/analyzeInputStepNotFound.md", {
              inputStepId,
            }),
          },
        ],
        isError: true,
      };
    }

    if (step.stepType !== "PLAN") {
      return {
        content: [
          {
            type: "text" as const,
            text: renderTaskToolMessage("taskToolMessages/planning/analyzeInputStepWrongType.md", {
              inputStepId,
              stepType: step.stepType,
            }),
          },
        ],
        isError: true,
      };
    }

    const content = JSON.parse(step.content);
    const contextSummary = content.description;
    const contextRequirements = content.requirements;

    const prompt = getPlanTaskPrompt({
      stage: "analyze",
      summary: contextSummary,
      initialConcept: contextRequirements || "",
    });

    const newStep = await createStep(
      step.projectId,
      "ANALYZE",
      JSON.stringify({ summary: contextSummary }),
      undefined,
      inputStepId
    );

    return {
      content: [
        {
          type: "text" as const,
          text: `${prompt}\n\n${renderTaskToolMessage(
            "taskToolMessages/planning/analyzeStepSaved.md",
            {
              stepId: newStep.id,
            }
          )}`,
        },
      ],
    };
  }

  if (stage === "review") {
    const step = await getStepById(inputStepId!);
    if (!step) {
      return {
        content: [
          {
            type: "text" as const,
            text: renderTaskToolMessage("taskToolMessages/planning/reviewInputStepNotFound.md", {
              inputStepId,
            }),
          },
        ],
        isError: true,
      };
    }

    if (step.stepType !== "ANALYZE") {
      return {
        content: [
          {
            type: "text" as const,
            text: renderTaskToolMessage("taskToolMessages/planning/reviewInputStepWrongType.md", {
              inputStepId,
              stepType: step.stepType,
            }),
          },
        ],
        isError: true,
      };
    }

    const prompt = getPlanTaskPrompt({
      stage: "review",
      analysis: analysis || "(Self-Review Mode)",
    });

    // Persist using REFLECT step type for compatibility with existing DB model
    const newStep = await createStep(
      step.projectId,
      "REFLECT",
      JSON.stringify({ analysis }),
      undefined,
      inputStepId
    );

    return {
      content: [
        {
          type: "text" as const,
          text: `${prompt}\n\n${renderTaskToolMessage(
            "taskToolMessages/planning/reviewStepSaved.md",
            {
              stepId: newStep.id,
            }
          )}`,
        },
      ],
    };
  }

  // 1. Validate Context
  const projectValidation = await validateProjectContext(projectId);
  if (!projectValidation.isValid) {
    return {
      content: [{ type: "text" as const, text: projectValidation.error! }],
      isError: true,
    };
  }

  const MEMORY_DIR = path.join(process.env.DATA_DIR || "data", "memory");

  // 3. Save Step (PLAN) first to get the step ID for the prompt
  const pId = projectValidation.projectId;
  let stepId = "N/A";

  if (pId) {
    const step = await createStep(
      pId,
      "PLAN",
      JSON.stringify({ description: description || "", requirements, focus }),
      undefined,
      undefined
    );
    stepId = step.id;
  }

  const prompt = getPlanTaskPrompt({
    stage: "plan",
    description: description || "",
    requirements,
    existingTasksReference: false,
    completedTasks: [],
    pendingTasks: [],
    memoryDir: MEMORY_DIR,
    projectId: projectValidation.projectId,
    checkDependencies: false,
    currentStepId: stepId,
  });

  if (pId) {
    return {
      content: [
        {
          type: "text" as const,
          text: `${prompt}\n\n${renderTaskToolMessage(
            "taskToolMessages/planning/planStepSaved.md",
            {
              stepId,
            }
          )}`,
        },
      ],
    };
  }

  return {
    content: [{ type: "text" as const, text: prompt }],
  };
}
