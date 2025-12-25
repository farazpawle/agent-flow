import path from "path";
import { getPlanTaskPrompt, getAnalyzeTaskPrompt, getReflectTaskPrompt, } from "../../prompts/index.js";
import { validateProjectContext } from "../../utils/projectValidation.js";
import { createStep, getStepById } from "../../models/workflowModel.js";
// ============================================================================
// IDEA PHASE TOOLS (Brainstorming & Planning)
// ============================================================================
export async function planIdea({ description, requirements, projectId, focus, }) {
    // 1. Validate Context
    const projectValidation = await validateProjectContext(projectId);
    if (!projectValidation.isValid) {
        return {
            content: [{ type: "text", text: projectValidation.error }],
            isError: true,
        };
    }
    const MEMORY_DIR = path.join(process.env.DATA_DIR || "data", "memory");
    // 2. Generate Prompt
    // Note: We are using the "getPlanTaskPrompt" generator for now, 
    // we will rename it in the next step but the logic is compatible.
    const prompt = getPlanTaskPrompt({
        description,
        requirements,
        existingTasksReference: false, // Idea phase doesn't care about tasks yet
        completedTasks: [],
        pendingTasks: [],
        memoryDir: MEMORY_DIR,
        projectId: projectValidation.projectId,
        checkDependencies: false,
    });
    // 3. Save Step (PLAN)
    const pId = projectValidation.projectId;
    let stepId = "N/A";
    if (pId) {
        const step = await createStep(pId, "PLAN", JSON.stringify({ description, requirements, focus }), undefined, undefined);
        stepId = step.id;
        return {
            content: [
                {
                    type: "text",
                    text: `${prompt}\n\n[SYSTEM] IDEA Saved (ID: ${stepId}).\nNEXT STEP: Call 'analyze_idea' with inputStepId='${stepId}'.`,
                },
            ],
        };
    }
    return {
        content: [{ type: "text", text: prompt }],
    };
}
export async function analyzeIdea({ inputStepId, projectId: explicitProjectId, }) {
    // 1. Strict Chain Validation
    const step = await getStepById(inputStepId);
    if (!step) {
        return {
            content: [{ type: "text", text: `Error: inputStepId '${inputStepId}' not found. You must start with 'plan_idea'.` }],
            isError: true
        };
    }
    if (step.stepType !== "PLAN") {
        return {
            content: [{ type: "text", text: `Error: inputStepId '${inputStepId}' is a ${step.stepType} step. 'analyze_idea' must follow a PLAN step.` }],
            isError: true
        };
    }
    // 2. Context Resolution
    const projectId = step.projectId; // Always inherit from chain
    const content = JSON.parse(step.content);
    const contextSummary = content.description;
    const contextRequirements = content.requirements;
    // 3. Generate Prompt
    const prompt = getAnalyzeTaskPrompt({
        summary: contextSummary,
        initialConcept: contextRequirements || "",
    });
    // 4. Save Step (ANALYZE)
    const newStep = await createStep(projectId, "ANALYZE", JSON.stringify({ summary: contextSummary }), undefined, inputStepId);
    return {
        content: [
            {
                type: "text",
                text: `${prompt}\n\n[SYSTEM] ANALYSIS Context Loaded (ID: ${newStep.id}).\nNEXT STEP: Call 'reflect_idea' with inputStepId='${newStep.id}'.`,
            },
        ],
    };
}
export async function reflectIdea({ inputStepId, analysis, projectId: explicitProjectId, }) {
    // 1. Strict Chain Validation
    const step = await getStepById(inputStepId);
    if (!step) {
        return {
            content: [{ type: "text", text: `Error: inputStepId '${inputStepId}' not found. You must start with 'analyze_idea'.` }],
            isError: true
        };
    }
    if (step.stepType !== "ANALYZE") {
        return {
            content: [{ type: "text", text: `Error: inputStepId '${inputStepId}' is a ${step.stepType} step. 'reflect_idea' must follow an ANALYZE step.` }],
            isError: true
        };
    }
    const projectId = step.projectId; // Inherit
    const prevContent = JSON.parse(step.content);
    // For reflection, we want the summary of what we are building
    // The previous step was ANALYZE, its content was { summary: ... }
    const contextSummary = prevContent.summary || "Analysis Step";
    // 2. Generate Prompt
    const prompt = getReflectTaskPrompt({
        summary: contextSummary,
        analysis: analysis || "(Self-Reflection Mode)",
    });
    // 3. Save Step (REFLECT)
    // We save the 'analysis' content if provided, as that represents the critique.
    const newStep = await createStep(projectId, "REFLECT", JSON.stringify({ analysis: analysis }), undefined, inputStepId);
    return {
        content: [
            {
                type: "text",
                text: `${prompt}\n\n[SYSTEM] REFLECTION Saved (ID: ${newStep.id}).\nNEXT STEP: Call 'split_tasks' with inputStepId='${newStep.id}'.`,
            },
        ],
    };
}
//# sourceMappingURL=planning.js.map