import {
  loadPrompt,
  generatePrompt,
  loadPromptFromTemplate,
} from "../loader.js";

// Focus type definition
type FocusMode = "logic" | "vibe" | "debug" | "security" | "performance" | "accessibility";

// Design tokens interface
interface DesignTokens {
  colors?: string[];
  fonts?: string[];
  mood?: "bold" | "minimal" | "playful" | "elegant" | "dark" | "vibrant";
}

export interface ProcessThoughtPromptParams {
  thought: string;
  thoughtNumber: number;
  totalThoughts: number;
  nextThoughtNeeded: boolean;
  stage: string;
  focus: FocusMode;
  previous_summary?: string;
  design_tokens?: DesignTokens;
  tags: string[];
  axioms_used: string[];
  assumptions_challenged: string[];
}

/**
 * Get emoji for focus mode
 */
function getFocusEmoji(focus: FocusMode): string {
  const emojis: Record<FocusMode, string> = {
    logic: "🔬",
    vibe: "🎨",
    debug: "🐛",
    security: "🔒",
    performance: "⚡",
    accessibility: "♿"
  };
  return emojis[focus] || "🧠";
}

/**
 * Get emoji for stage
 */
function getStageEmoji(stage: string): string {
  const emojis: Record<string, string> = {
    problem_analysis: "🔍",
    solution_design: "📐",
    implementation: "⚙️",
    verification: "✅",
    exploration: "🌟",
    debugging: "🐛"
  };
  return emojis[stage] || "💭";
}

/**
 * Get focus-specific guidance based on the focus mode
 */
function getFocusGuidance(focus: FocusMode): string {
  switch (focus) {
    case "logic":
      return `**Guidance (🔬 Logic Mode):**
- Prohibit all speculation. Verify every fact before using it.
- For any doubts, review relevant code or use web search tools.
- Prioritize correctness, security, and performance.
- Use established patterns and best practices.`;

    case "vibe":
      return `**Guidance (🎨 Vibe Mode):**
- Explore freely and trust your aesthetic intuition.
- Break conventional rules when it makes the design better.
- Ask yourself: Does this FEEL right? Does it create the desired mood?
- Prioritize user experience, visual harmony, and creative impact.
- Iterate on ideas - the first solution may not be the best.`;

    case "debug":
      return `**Guidance (🐛 Debug Mode):**
- Use systematic investigation: binary search, divide and conquer.
- Check the most recent changes first.
- Verify assumptions about what the code is doing vs what you expect.
- Look for common error patterns: off-by-one, null references, race conditions.
- Use logging and breakpoints to narrow down the issue.`;

    case "security":
      return `**Guidance (🔒 Security Mode):**
- Assume all input is malicious until validated.
- Check authentication, authorization, and data encryption.
- Look for injection vulnerabilities (SQL, XSS, command injection).
- Verify secure defaults and fail-safe behaviors.
- Review attack surface and potential exploit paths.`;

    case "performance":
      return `**Guidance (⚡ Performance Mode):**
- Identify bottlenecks before optimizing.
- Measure before and after - don't assume.
- Consider algorithmic complexity (Big O).
- Check for N+1 queries, unnecessary re-renders, memory leaks.
- Profile in production-like conditions.`;

    case "accessibility":
      return `**Guidance (♿ Accessibility Mode):**
- Ensure keyboard navigation works for all interactions.
- Check color contrast meets WCAG AA (4.5:1 for text).
- Verify screen reader compatibility with semantic HTML.
- Add ARIA labels where native semantics are insufficient.
- Test with actual assistive technologies when possible.`;

    default:
      return "";
  }
}

/**
 * Format design tokens for display
 */
function formatDesignTokens(tokens?: DesignTokens): string {
  if (!tokens) return "";

  const parts: string[] = [];
  if (tokens.colors && tokens.colors.length > 0) {
    parts.push(`Colors: ${tokens.colors.join(", ")}`);
  }
  if (tokens.fonts && tokens.fonts.length > 0) {
    parts.push(`Fonts: ${tokens.fonts.join(", ")}`);
  }
  if (tokens.mood) {
    parts.push(`Mood: ${tokens.mood}`);
  }

  return parts.length > 0 ? `\n**Design Context:** ${parts.join(" | ")}` : "";
}

export function getProcessThoughtPrompt(
  param: ProcessThoughtPromptParams
): string {
  let nextThoughtNeeded = "";
  if (param.nextThoughtNeeded) {
    nextThoughtNeeded = loadPromptFromTemplate("processThought/moreThought.md");
  } else {
    nextThoughtNeeded = loadPromptFromTemplate(
      "processThought/completedThought.md"
    );
  }

  const focusGuidance = getFocusGuidance(param.focus);
  const focusEmoji = getFocusEmoji(param.focus);
  const stageEmoji = getStageEmoji(param.stage);
  const designTokensDisplay = formatDesignTokens(param.design_tokens);
  const previousSummaryDisplay = param.previous_summary
    ? `\n**Previous Context:** ${param.previous_summary}`
    : "";

  const indexTemplate = loadPromptFromTemplate("processThought/index.md");

  const prompt = generatePrompt(indexTemplate, {
    thought: param.thought,
    thoughtNumber: param.thoughtNumber,
    totalThoughts: param.totalThoughts,
    stage: param.stage,
    stageEmoji: stageEmoji,
    focus: param.focus,
    focusEmoji: focusEmoji,
    focusGuidance: focusGuidance,
    previousSummary: previousSummaryDisplay,
    designTokens: designTokensDisplay,
    tags: param.tags.join(", ") || "no tags",
    axioms_used: param.axioms_used.join(", ") || "no axioms used",
    assumptions_challenged:
      param.assumptions_challenged.join(", ") || "no assumptions challenged",
    nextThoughtNeeded,
  });

  return loadPrompt(prompt, "PROCESS_THOUGHT");
}
