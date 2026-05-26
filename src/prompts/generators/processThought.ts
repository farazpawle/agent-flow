import { loadPrompt, generatePrompt, loadPromptFromTemplate } from "../loader.js";

// Focus type definition
type FocusMode = "logic" | "vibe" | "debug" | "security" | "performance" | "accessibility";

// Design tokens interface
interface DesignTokens {
  colors?: string[];
  fonts?: string[];
  mood?: "bold" | "minimal" | "playful" | "elegant" | "dark" | "vibrant";
}

const PROCESS_THOUGHT_TEMPLATE = {
  MORE_THOUGHT: "processThought/moreThought.md",
  COMPLETED_THOUGHT: "processThought/completedThought.md",
  INDEX: "processThought/index.md",
  PREVIOUS_CONTEXT: "processThought/previousContext.md",
  DESIGN_CONTEXT: "processThought/designContext.md",
  DESIGN_COLORS: "processThought/designColors.md",
  DESIGN_FONTS: "processThought/designFonts.md",
  DESIGN_MOOD: "processThought/designMood.md",
  DEFAULT_TAGS: "processThought/defaultTags.md",
  DEFAULT_AXIOMS: "processThought/defaultAxioms.md",
  DEFAULT_ASSUMPTIONS: "processThought/defaultAssumptions.md",
} as const;

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
    accessibility: "♿",
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
    debugging: "🐛",
  };
  return emojis[stage] || "💭";
}

/**
 * Get focus-specific guidance based on the focus mode
 */
function getFocusGuidance(focus: FocusMode): string {
  const focusTemplatePath = `processThought/focusGuidance/${focus}.md`;
  return loadPromptFromTemplate(focusTemplatePath);
}

/**
 * Format design tokens for display
 */
function formatDesignTokens(tokens?: DesignTokens): string {
  if (!tokens) return "";

  const parts: string[] = [];
  if (tokens.colors && tokens.colors.length > 0) {
    parts.push(
      generatePrompt(loadPromptFromTemplate(PROCESS_THOUGHT_TEMPLATE.DESIGN_COLORS), {
        colors: tokens.colors.join(", "),
      })
    );
  }
  if (tokens.fonts && tokens.fonts.length > 0) {
    parts.push(
      generatePrompt(loadPromptFromTemplate(PROCESS_THOUGHT_TEMPLATE.DESIGN_FONTS), {
        fonts: tokens.fonts.join(", "),
      })
    );
  }
  if (tokens.mood) {
    parts.push(
      generatePrompt(loadPromptFromTemplate(PROCESS_THOUGHT_TEMPLATE.DESIGN_MOOD), {
        mood: tokens.mood,
      })
    );
  }

  return parts.length > 0
    ? generatePrompt(loadPromptFromTemplate(PROCESS_THOUGHT_TEMPLATE.DESIGN_CONTEXT), {
        parts: parts.join(" | "),
      })
    : "";
}

export function getProcessThoughtPrompt(param: ProcessThoughtPromptParams): string {
  let nextThoughtNeeded = "";
  if (param.nextThoughtNeeded) {
    nextThoughtNeeded = loadPromptFromTemplate(PROCESS_THOUGHT_TEMPLATE.MORE_THOUGHT);
  } else {
    nextThoughtNeeded = loadPromptFromTemplate(PROCESS_THOUGHT_TEMPLATE.COMPLETED_THOUGHT);
  }

  const focusGuidance = getFocusGuidance(param.focus);
  const focusEmoji = getFocusEmoji(param.focus);
  const stageEmoji = getStageEmoji(param.stage);
  const designTokensDisplay = formatDesignTokens(param.design_tokens);
  const previousSummaryDisplay = param.previous_summary
    ? generatePrompt(loadPromptFromTemplate(PROCESS_THOUGHT_TEMPLATE.PREVIOUS_CONTEXT), {
        previous_summary: param.previous_summary,
      })
    : "";

  const indexTemplate = loadPromptFromTemplate(PROCESS_THOUGHT_TEMPLATE.INDEX);

  const defaultTags = loadPromptFromTemplate(PROCESS_THOUGHT_TEMPLATE.DEFAULT_TAGS);
  const defaultAxioms = loadPromptFromTemplate(PROCESS_THOUGHT_TEMPLATE.DEFAULT_AXIOMS);
  const defaultAssumptions = loadPromptFromTemplate(PROCESS_THOUGHT_TEMPLATE.DEFAULT_ASSUMPTIONS);

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
    tags: param.tags.join(", ") || defaultTags,
    axioms_used: param.axioms_used.join(", ") || defaultAxioms,
    assumptions_challenged: param.assumptions_challenged.join(", ") || defaultAssumptions,
    nextThoughtNeeded,
  });

  return loadPrompt(prompt, "PROCESS_THOUGHT");
}
