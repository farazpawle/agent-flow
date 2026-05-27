/**
 * executeTask prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */

import { loadPrompt, generatePrompt, loadPromptFromTemplate } from "../loader.js";
import { Task, TaskStatus } from "../../types/index.js";

/**
 * Task complexity assessment interface
 */
interface ComplexityAssessment {
  level: string;
  metrics: {
    descriptionLength: number;
    dependenciesCount: number;
  };
  recommendations?: string[];
}

/**
 * executeTask prompt parameter interface
 */
export interface ExecuteTaskPromptParams {
  task: Task;
  complexityAssessment?: ComplexityAssessment;
  relatedFilesSummary?: string;
  dependencyTasks?: Task[];
}

/**
 * Get styled text for complexity level
 * @param level complexity level
 * @returns styled text
 */
function getComplexityStyle(level: string): string {
  switch (level) {
    case "VERY_HIGH":
      return "⚠️ **Warning: This task has extremely high complexity** ⚠️";
    case "HIGH":
      return "⚠️ **Note: This task has high complexity**";
    case "MEDIUM":
      return "**Tip: This task has moderate complexity**";
    default:
      return "";
  }
}

/**
 * Get complexity-based guidance for subtask evaluation
 * @param level complexity level
 * @returns guidance text
 */
function getComplexityBasedGuidance(level: string): string {
  switch (level) {
    case "VERY_HIGH":
      return "⚠️ This task has very high complexity. It is strongly recommended to split it into multiple subtasks. You should have compelling reasons if you choose not to split this task.";
    case "HIGH":
      return "This task has high complexity. Strongly consider splitting it into smaller subtasks for better manageability and reduced risk. If you decide not to split, you must justify your decision.";
    case "MEDIUM":
      return "This task has moderate complexity. Consider if there are natural boundaries for splitting, but proceeding with a single task may be appropriate.";
    default: // LOW
      return "This task appears to be low complexity. Splitting is typically not necessary unless you identify specific reasons.";
  }
}

/**
 * Detect focus mode from task content and return the relevant guidance section
 */
function getFocusGuidance(task: Task): string {
  const text = `${task.name} ${task.description} ${task.notes || ""}`.toLowerCase();
  if (/debug|error|fix|bug|crash|exception|fail/.test(text)) {
    return `### 🐛 Debug Mode (Error Investigation)\n- Start with the most recent changes\n- Use binary search to narrow down the issue\n- Check logs and error messages carefully\n- Verify assumptions with console.log/breakpoints\n- Don't assume - verify everything`;
  }
  if (/security|\bauth\b|encrypt|permission|vulnerab|\binject\b|xss|\bsql injection\b/.test(text)) {
    return `### 🔒 Security Mode (Auth/Encryption)\n- Validate ALL user input\n- Check authentication and authorization at every step\n- Look for injection vulnerabilities\n- Use parameterized queries\n- Never expose sensitive data in logs`;
  }
  if (/performance|optim|speed|slow|cache|bottleneck|profil/.test(text)) {
    return `### ⚡ Performance Mode (Optimization)\n- Measure before optimizing\n- Identify the bottleneck first\n- Check for N+1 queries\n- Minimize unnecessary re-renders\n- Profile in production-like conditions`;
  }
  if (/accessib|wcag|aria|screen reader|keyboard nav|contrast/.test(text)) {
    return `### ♿ Accessibility Mode (WCAG)\n- Test keyboard navigation\n- Verify color contrast (4.5:1 minimum)\n- Add ARIA labels where needed\n- Test with screen reader\n- Ensure focus states are visible`;
  }
  if (
    /\bui\b|\bstyle\b|design|animation|layout|\bcss\b|\bcolor\b|\bfont\b|\bvibe\b|aesthetic/.test(
      text
    )
  ) {
    return `### 🎨 Vibe Mode (Creative/UI)\n- Trust your aesthetic intuition\n- Focus on how it FEELS, not just how it works\n- Iterate on animations and transitions\n- Test on different screen sizes\n- Get the spacing and typography right`;
  }
  return `### 🔬 Logic Mode (Technical/Backend)\n- Follow established patterns and best practices\n- Prioritize correctness over speed\n- Write comprehensive error handling\n- Add logging for debugging\n- Write unit tests for edge cases`;
}

/**
 * Get the complete executeTask prompt
 * @param params prompt parameters
 * @returns generated prompt
 */
export function getExecuteTaskPrompt(params: ExecuteTaskPromptParams): string {
  const { task, complexityAssessment, relatedFilesSummary, dependencyTasks } = params;

  const notesTemplate = loadPromptFromTemplate("executeTask/notes.md");
  let notesPrompt = "";
  if (task.notes) {
    notesPrompt = generatePrompt(notesTemplate, {
      notes: task.notes,
    });
  }

  const implementationGuideTemplate = loadPromptFromTemplate("executeTask/implementationGuide.md");
  let implementationGuidePrompt = "";
  if (task.implementationGuide) {
    implementationGuidePrompt = generatePrompt(implementationGuideTemplate, {
      implementationGuide: task.implementationGuide,
    });
  }

  const verificationCriteriaTemplate = loadPromptFromTemplate(
    "executeTask/verificationCriteria.md"
  );
  let verificationCriteriaPrompt = "";
  if (task.verificationCriteria) {
    verificationCriteriaPrompt = generatePrompt(verificationCriteriaTemplate, {
      verificationCriteria: task.verificationCriteria,
    });
  }

  const dependencyTasksTemplate = loadPromptFromTemplate("executeTask/dependencyTasks.md");
  let dependencyTasksPrompt = "";
  if (dependencyTasks && dependencyTasks.length > 0) {
    const completedDependencyTasks = dependencyTasks.filter(
      (t) => t.status === TaskStatus.COMPLETED && t.summary
    );

    if (completedDependencyTasks.length > 0) {
      let dependencyTasksContent = "";
      for (const depTask of completedDependencyTasks) {
        dependencyTasksContent += `### ${depTask.name}\n${
          depTask.summary || "*No completion summary*"
        }\n\n`;
      }
      dependencyTasksPrompt = generatePrompt(dependencyTasksTemplate, {
        dependencyTasks: dependencyTasksContent,
      });
    }
  }

  const relatedFilesSummaryTemplate = loadPromptFromTemplate("executeTask/relatedFilesSummary.md");
  let relatedFilesSummaryPrompt = "";
  relatedFilesSummaryPrompt = generatePrompt(relatedFilesSummaryTemplate, {
    relatedFilesSummary: relatedFilesSummary || "The current task has no related files.",
  });

  const complexityTemplate = loadPromptFromTemplate("executeTask/complexity.md");
  let complexityPrompt = "";
  if (complexityAssessment) {
    const complexityStyle = getComplexityStyle(complexityAssessment.level);
    let recommendationContent = "";
    if (complexityAssessment.recommendations && complexityAssessment.recommendations.length > 0) {
      for (const recommendation of complexityAssessment.recommendations) {
        recommendationContent += `- ${recommendation}\n`;
      }
    }
    complexityPrompt = generatePrompt(complexityTemplate, {
      level: complexityAssessment.level,
      complexityStyle: complexityStyle,
      descriptionLength: complexityAssessment.metrics.descriptionLength,
      dependenciesCount: complexityAssessment.metrics.dependenciesCount,
      recommendation: recommendationContent,
    });
  }

  const subtaskEvaluationTemplate = loadPromptFromTemplate("executeTask/subtaskEvaluation.md");
  let subtaskEvaluationPrompt = "";
  if (complexityAssessment) {
    const complexityBasedGuidance = getComplexityBasedGuidance(complexityAssessment.level);
    subtaskEvaluationPrompt = generatePrompt(subtaskEvaluationTemplate, {
      complexityBasedGuidance,
    });
  } else {
    // Default guidance if complexity assessment is missing
    subtaskEvaluationPrompt = generatePrompt(subtaskEvaluationTemplate, {
      complexityBasedGuidance:
        "Unable to determine task complexity. Evaluate the task based on your understanding and the assessment criteria.",
    });
  }

  const indexTemplate = loadPromptFromTemplate("executeTask/index.md");
  const prompt = generatePrompt(indexTemplate, {
    name: task.name,
    id: task.id,
    description: task.description,
    notesTemplate: notesPrompt,
    implementationGuideTemplate: implementationGuidePrompt,
    verificationCriteriaTemplate: verificationCriteriaPrompt,
    dependencyTasksTemplate: dependencyTasksPrompt,
    relatedFilesSummaryTemplate: relatedFilesSummaryPrompt,
    complexityTemplate: complexityPrompt,
    subtaskEvaluationTemplate: subtaskEvaluationPrompt,
    focusGuidance: getFocusGuidance(task),
  });

  // Load possible custom prompt
  return loadPrompt(prompt, "EXECUTE_TASK");
}
