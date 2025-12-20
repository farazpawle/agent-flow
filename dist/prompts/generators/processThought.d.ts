type FocusMode = "logic" | "vibe" | "debug" | "security" | "performance" | "accessibility";
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
export declare function getProcessThoughtPrompt(param: ProcessThoughtPromptParams): string;
export {};
