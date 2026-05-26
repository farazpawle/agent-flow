/**
 * verifyTask prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */

import { loadPrompt, generatePrompt, loadPromptFromTemplate } from "../loader.js";
import { Task } from "../../types/index.js";

/**
 * verifyTask prompt parameter interface
 */
export interface VerifyTaskPromptParams {
  task: Task;
}

/**
 * Extract summary content
 * @param content Original content
 * @param maxLength Maximum length
 * @returns Extracted summary
 */
function extractSummary(content: string | undefined, maxLength: number): string {
  if (!content) return "";

  if (content.length <= maxLength) {
    return content;
  }

  // Simple summary extraction: Take the first maxLength characters and add ellipsis
  return content.substring(0, maxLength) + "...";
}

/**
 * Detect focus mode from task content and return the relevant verification criteria table
 */
function getFocusVerification(task: Task): string {
  const text = `${task.name} ${task.description} ${task.notes || ""}`.toLowerCase();
  if (/debug|error|fix|bug|crash|exception|fail/.test(text)) {
    return `### 🐛 Debug Mode Verification (Fix)\n| Criteria | Weight | Check |\n|----------|--------|-------|\n| Bug Fixed | 40% | Original issue resolved |\n| No Regression | 30% | Nothing else broke |\n| Root Cause | 20% | Underlying issue addressed, not just symptom |\n| Test Added | 10% | Prevent recurrence |`;
  }
  if (/security|\bauth\b|encrypt|permission|vulnerab|\binject\b|xss|\bsql injection\b/.test(text)) {
    return `### 🔒 Security Mode Verification\n| Criteria | Weight | Check |\n|----------|--------|-------|\n| Input Validation | 30% | All inputs sanitized |\n| Auth/AuthZ | 30% | Proper access control |\n| No Vulnerabilities | 25% | Injection, XSS, CSRF checked |\n| Secure Defaults | 15% | Fail-safe behavior |`;
  }
  if (/performance|optim|speed|slow|cache|bottleneck|profil/.test(text)) {
    return `### ⚡ Performance Mode Verification\n| Criteria | Weight | Check |\n|----------|--------|-------|\n| Measurable Improvement | 40% | Benchmarks show improvement |\n| No Regression | 25% | Other areas not degraded |\n| Resource Usage | 20% | Memory/CPU within bounds |\n| Scalability | 15% | Handles increased load |`;
  }
  if (/accessib|wcag|aria|screen reader|keyboard nav|contrast/.test(text)) {
    return `### ♿ Accessibility Mode Verification\n| Criteria | Weight | Check |\n|----------|--------|-------|\n| Keyboard Navigation | 30% | All interactive elements reachable |\n| Screen Reader | 25% | Proper announcements |\n| Color Contrast | 25% | WCAG AA compliance (4.5:1) |\n| Focus Management | 20% | Visible focus, logical order |`;
  }
  if (
    /\bui\b|\bstyle\b|design|animation|layout|\bcss\b|\bcolor\b|\bfont\b|\bvibe\b|aesthetic/.test(
      text
    )
  ) {
    return `### 🎨 Vibe Mode Verification (Creative/UI)\n| Criteria | Weight | Check |\n|----------|--------|-------|\n| Visual Polish | 35% | Looks professional, consistent styling |\n| User Experience | 30% | Feels smooth, intuitive interactions |\n| Responsiveness | 20% | Works on all screen sizes |\n| Animation Quality | 15% | Smooth transitions, right timing |`;
  }
  return `### 🔬 Logic Mode Verification (Technical)\n| Criteria | Weight | Check |\n|----------|--------|-------|\n| Functional Correctness | 35% | All requirements met, edge cases handled |\n| Code Quality | 30% | Clean, maintainable, follows patterns |\n| Error Handling | 20% | Graceful failures, meaningful messages |\n| Performance | 15% | No obvious bottlenecks |`;
}

/**
 * Get the complete prompt for verifyTask
 * @param params prompt parameters
 * @returns the generated prompt
 */
export function getVerifyTaskPrompt(params: VerifyTaskPromptParams): string {
  const { task } = params;
  const indexTemplate = loadPromptFromTemplate("verifyTask/index.md");
  const prompt = generatePrompt(indexTemplate, {
    name: task.name,
    id: task.id,
    description: task.description,
    notes: task.notes || "no notes",
    verificationCriteria: task.verificationCriteria || "no verification criteria",
    implementationGuideSummary:
      extractSummary(task.implementationGuide, 200) || "no implementation guide",
    analysisResult: extractSummary(task.analysisResult, 300) || "no analysis result",
    focusVerification: getFocusVerification(task),
  });

  // Load possible custom prompt
  return loadPrompt(prompt, "VERIFY_TASK");
}
