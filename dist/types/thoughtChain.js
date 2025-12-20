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
export var ThoughtStage;
(function (ThoughtStage) {
    ThoughtStage["PROBLEM_DEFINITION"] = "Problem Definition";
    ThoughtStage["COLLECT_INFORMATION"] = "Collect Information";
    ThoughtStage["RESEARCH"] = "Research";
    ThoughtStage["ANALYSIS"] = "Analysis";
    ThoughtStage["SYNTHESIS"] = "Synthesis";
    ThoughtStage["CONCLUSION"] = "Conclusion";
    ThoughtStage["QUESTIONING"] = "Questioning";
    ThoughtStage["PLANNING"] = "Planning";
})(ThoughtStage || (ThoughtStage = {}));
//# sourceMappingURL=thoughtChain.js.map