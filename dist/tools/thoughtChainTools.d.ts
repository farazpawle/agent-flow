import { z } from "zod";
/**
 * Parameter structure for processThought tool
 */
export declare const processThoughtSchema: z.ZodObject<{
    thought: z.ZodString;
    thought_number: z.ZodNumber;
    total_thoughts: z.ZodNumber;
    next_thought_needed: z.ZodBoolean;
    stage: z.ZodEnum<["problem_analysis", "solution_design", "implementation", "verification", "exploration", "debugging"]>;
    focus: z.ZodDefault<z.ZodOptional<z.ZodEnum<["logic", "vibe", "debug", "security", "performance", "accessibility"]>>>;
    previous_summary: z.ZodOptional<z.ZodString>;
    design_tokens: z.ZodOptional<z.ZodObject<{
        colors: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        fonts: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        mood: z.ZodOptional<z.ZodEnum<["bold", "minimal", "playful", "elegant", "dark", "vibrant"]>>;
    }, "strip", z.ZodTypeAny, {
        colors?: string[] | undefined;
        fonts?: string[] | undefined;
        mood?: "bold" | "minimal" | "playful" | "elegant" | "dark" | "vibrant" | undefined;
    }, {
        colors?: string[] | undefined;
        fonts?: string[] | undefined;
        mood?: "bold" | "minimal" | "playful" | "elegant" | "dark" | "vibrant" | undefined;
    }>>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    axioms_used: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    assumptions_challenged: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    focus: "logic" | "vibe" | "debug" | "security" | "performance" | "accessibility";
    thought: string;
    stage: "problem_analysis" | "solution_design" | "implementation" | "verification" | "exploration" | "debugging";
    thought_number: number;
    total_thoughts: number;
    next_thought_needed: boolean;
    tags?: string[] | undefined;
    axioms_used?: string[] | undefined;
    assumptions_challenged?: string[] | undefined;
    previous_summary?: string | undefined;
    design_tokens?: {
        colors?: string[] | undefined;
        fonts?: string[] | undefined;
        mood?: "bold" | "minimal" | "playful" | "elegant" | "dark" | "vibrant" | undefined;
    } | undefined;
}, {
    thought: string;
    stage: "problem_analysis" | "solution_design" | "implementation" | "verification" | "exploration" | "debugging";
    thought_number: number;
    total_thoughts: number;
    next_thought_needed: boolean;
    focus?: "logic" | "vibe" | "debug" | "security" | "performance" | "accessibility" | undefined;
    tags?: string[] | undefined;
    axioms_used?: string[] | undefined;
    assumptions_challenged?: string[] | undefined;
    previous_summary?: string | undefined;
    design_tokens?: {
        colors?: string[] | undefined;
        fonts?: string[] | undefined;
        mood?: "bold" | "minimal" | "playful" | "elegant" | "dark" | "vibrant" | undefined;
    } | undefined;
}>;
/**
 * Process a single thought and return formatted output
 */
export declare function processThought(params: z.infer<typeof processThoughtSchema>): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
