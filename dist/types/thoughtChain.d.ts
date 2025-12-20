/**
 * Thought Chain Data Structure Definition
 *
 * This file defines the core data structures needed for the thought chain tool, only including interfaces
 * for processing a single thought, not including functionality for storing historical records.
 * The design complies with the existing project architecture style.
 */
/**
 * Thought Stage Enum: Defines different stages in the thinking process
 */
export declare enum ThoughtStage {
    PROBLEM_DEFINITION = "Problem Definition",// Stage for defining problems and goals
    COLLECT_INFORMATION = "Collect Information",// Stage for collecting and analyzing information
    RESEARCH = "Research",// Stage for researching information
    ANALYSIS = "Analysis",// Stage for in-depth analysis of problems and possible solutions
    SYNTHESIS = "Synthesis",// Stage for integrating analysis results to form solutions
    CONCLUSION = "Conclusion",// Stage for summarizing the thinking process and proposing final solutions
    QUESTIONING = "Questioning",// Stage for questioning and critique
    PLANNING = "Planning"
}
/**
 * Thought Data Interface: Defines the complete data structure of a thought
 */
export interface ThoughtData {
    thought: string;
    thoughtNumber: number;
    totalThoughts: number;
    nextThoughtNeeded: boolean;
    stage: string;
    tags?: string[];
    axioms_used?: string[];
    assumptions_challenged?: string[];
}
