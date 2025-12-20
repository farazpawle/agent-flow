import { z } from "zod";
import { getProcessThoughtPrompt, } from "../prompts/generators/processThought.js";
/**
 * Parameter structure for processThought tool
 */
export const processThoughtSchema = z.object({
    thought: z
        .string()
        .min(1, {
        message: "Thought content cannot be empty, please provide valid thinking content",
    })
        .describe("Thought content - your analysis, reasoning, or decision. Example: 'The API should use REST because it provides better caching and statelessness.'"),
    thought_number: z
        .number()
        .int()
        .positive({
        message: "Thought number must be a positive integer",
    })
        .describe("Current thought number (e.g., 1, 2, 3)"),
    total_thoughts: z
        .number()
        .int()
        .positive({
        message: "Total thoughts must be a positive integer",
    })
        .describe("Estimated total thoughts needed. Adjust dynamically - increase if problem is complex, decrease if solution becomes clear."),
    next_thought_needed: z.boolean().describe("Whether next thought step is needed. Set to false when you've reached a clear conclusion."),
    stage: z
        .enum([
        "problem_analysis",
        "solution_design",
        "implementation",
        "verification",
        "exploration",
        "debugging"
    ])
        .describe("Current thinking stage: problem_analysis (understand the problem), solution_design (plan approach), implementation (execute), verification (test/validate), exploration (creative discovery for UI/design), debugging (investigate errors)"),
    focus: z
        .enum(["logic", "vibe", "debug", "security", "performance", "accessibility"])
        .optional()
        .default("logic")
        .describe("Focus mode: logic (strict/technical), vibe (creative/exploratory), debug (error investigation), security (auth/encryption/attack vectors), performance (optimization/profiling), accessibility (WCAG/screen readers)"),
    previous_summary: z
        .string()
        .optional()
        .describe("Summary of previous thoughts for context continuity. Use this to maintain coherent reasoning across multiple thought steps."),
    design_tokens: z
        .object({
        colors: z.array(z.string()).optional().describe("Color palette being used (e.g., ['#FF5733', '#3498DB'])"),
        fonts: z.array(z.string()).optional().describe("Font families (e.g., ['Inter', 'Roboto'])"),
        mood: z.enum(["bold", "minimal", "playful", "elegant", "dark", "vibrant"]).optional().describe("Design mood/vibe")
    })
        .optional()
        .describe("Design context for vibe mode - colors, fonts, and mood to maintain visual consistency"),
    tags: z.array(z.string()).optional().describe("Thought tags for context (e.g., ['backend', 'security', 'api'])"),
    axioms_used: z
        .array(z.string())
        .optional()
        .describe("Facts or principles used (e.g., ['REST best practices', 'DRY principle', 'WCAG accessibility'])"),
    assumptions_challenged: z
        .array(z.string())
        .optional()
        .describe("Assumptions or trade-offs being considered (e.g., ['assuming user is authenticated', 'trade-off: speed vs accuracy'])"),
});
/**
 * Process a single thought and return formatted output
 */
export async function processThought(params) {
    try {
        // Convert parameters to standardized ThoughtData format
        const thoughtData = {
            thought: params.thought,
            thoughtNumber: params.thought_number,
            totalThoughts: params.total_thoughts,
            nextThoughtNeeded: params.next_thought_needed,
            stage: params.stage,
            focus: params.focus || "logic",
            previous_summary: params.previous_summary,
            design_tokens: params.design_tokens,
            tags: params.tags || [],
            axioms_used: params.axioms_used || [],
            assumptions_challenged: params.assumptions_challenged || [],
        };
        // Ensure thought number doesn't exceed total thoughts
        if (thoughtData.thoughtNumber > thoughtData.totalThoughts) {
            // Automatically adjust total thought count
            thoughtData.totalThoughts = thoughtData.thoughtNumber;
        }
        // Format thought output
        const formattedThought = getProcessThoughtPrompt(thoughtData);
        // Return successful response
        return {
            content: [
                {
                    type: "text",
                    text: formattedThought,
                },
            ],
        };
    }
    catch (error) {
        // Catch and handle all unexpected errors
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
            content: [
                {
                    type: "text",
                    text: `Error occurred while processing thought: ${errorMessage}`,
                },
            ],
        };
    }
}
//# sourceMappingURL=thoughtChainTools.js.map