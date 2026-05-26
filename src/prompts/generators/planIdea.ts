/**
 * planIdea prompt generator
 * Responsible for combining stage-specific templates and parameters
 */

import { loadPrompt, generatePrompt, loadPromptFromTemplate } from "../loader.js";
import { applyEnvironmentAliases } from "../../utils/envConfig.js";

/**
 * planIdea prompt parameter interface
 */
export type PlanIdeaStage = "plan" | "analyze" | "review";

export interface PlanIdeaPromptParams {
  stage: PlanIdeaStage;
  description?: string;
  requirements?: string;
  existingTasksReference?: boolean;
  completedTasks?: unknown[];
  pendingTasks?: unknown[];
  memoryDir?: string;
  projectId?: string;
  checkDependencies?: boolean;
  summary?: string;
  initialConcept?: string;
  previousAnalysis?: string;
  analysis?: string;
  currentStepId?: string;
}

/**
 * Detect focus mode from description/requirements and return the relevant planning guidance section
 */
function getFocusPlanGuidance(description: string, requirements?: string): string {
  const text = `${description} ${requirements || ""}`.toLowerCase();
  if (/debug|error|fix|bug|crash|exception|fail/.test(text)) {
    return `### 🐛 Debug Mode Planning\n- Reproduce the issue reliably first\n- Identify minimal reproduction steps\n- Plan systematic root-cause investigation\n- Define regression test to prevent recurrence\n- Scope fix carefully to avoid unintended side effects`;
  }
  if (/security|\bauth\b|encrypt|permission|vulnerab|\binject\b|xss|\bsql injection\b/.test(text)) {
    return `### 🔒 Security Mode Planning\n- Identify all trust boundaries\n- Plan authentication and authorization flows\n- Define input validation requirements\n- Consider audit logging needs\n- Plan for secure storage of sensitive data`;
  }
  if (/performance|optim|speed|slow|cache|bottleneck|profil/.test(text)) {
    return `### ⚡ Performance Mode Planning\n- Define performance targets (load time, throughput)\n- Identify potential bottlenecks early\n- Plan for profiling and measurement\n- Consider caching strategies`;
  }
  if (/accessib|wcag|aria|screen reader|keyboard nav|contrast/.test(text)) {
    return `### ♿ Accessibility Mode Planning\n- Define WCAG compliance level (A, AA, AAA)\n- Plan keyboard navigation flows\n- Identify areas needing ARIA support`;
  }
  if (
    /\bui\b|\bstyle\b|design|animation|layout|\bcss\b|\bcolor\b|\bfont\b|\bvibe\b|aesthetic/.test(
      text
    )
  ) {
    return `### 🎨 Vibe Mode Planning\n- Start with the desired user experience\n- Define the visual mood and aesthetic goals\n- Plan for animations and micro-interactions\n- Consider responsive design from the start\n- Prioritize feel over feature completeness`;
  }
  return `### 🔬 Logic Mode Planning\n- Define clear technical requirements and constraints\n- Identify data models and API contracts\n- Plan for error handling and edge cases\n- Consider testing strategy upfront\n- Document integration points`;
}

/**
 * Get stage-specific prompt for plan_idea
 * @param params prompt parameters
 * @returns generated prompt
 */
export function getPlanTaskPrompt(params: PlanIdeaPromptParams): string {
  applyEnvironmentAliases(process.env);

  if (params.stage === "analyze") {
    const indexTemplate = loadPromptFromTemplate("planIdea/analyze.md");
    const iterationTemplate = loadPromptFromTemplate("planIdea/analyzeIteration.md");

    let iterationPrompt = "";
    if (params.previousAnalysis) {
      iterationPrompt = generatePrompt(iterationTemplate, {
        previousAnalysis: params.previousAnalysis,
      });
    }

    const prompt = generatePrompt(indexTemplate, {
      summary: params.summary || "",
      initialConcept: params.initialConcept || "",
      previousAnalysis: iterationPrompt,
    });

    return loadPrompt(prompt, "PLAN_IDEA_ANALYZE_STAGE");
  }

  if (params.stage === "review") {
    const indexTemplate = loadPromptFromTemplate("planIdea/review.md");
    const prompt = generatePrompt(indexTemplate, {
      analysis: params.analysis || "(Self-Review Mode)",
    });

    return loadPrompt(prompt, "PLAN_IDEA_REVIEW_STAGE");
  }

  // Stage: plan (default)
  const thoughtTemplate =
    process.env.ENABLE_THOUGHT_CHAIN !== "false"
      ? loadPromptFromTemplate("planIdea/hasThought.md")
      : loadPromptFromTemplate("planIdea/noThought.md");

  const indexTemplate = loadPromptFromTemplate("planIdea/index.md");
  const prompt = generatePrompt(indexTemplate, {
    description: params.description || "",
    requirements: params.requirements || "No requirements",
    tasksTemplate: "",
    memoryDir: params.memoryDir || "data/memory",
    thoughtTemplate,
    projectId: params.projectId || "Current Project",
    currentStepId: params.currentStepId || "(step id will be shown after save)",
    focusPlanGuidance: getFocusPlanGuidance(params.description || "", params.requirements),
  });

  return loadPrompt(prompt, "PLAN_IDEA_PLAN_STAGE");
}
