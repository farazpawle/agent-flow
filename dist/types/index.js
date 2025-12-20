// Task status enumeration: defines the current stage of a task in the workflow
export var TaskStatus;
(function (TaskStatus) {
    TaskStatus["PENDING"] = "Pending";
    TaskStatus["IN_PROGRESS"] = "In Progress";
    TaskStatus["COMPLETED"] = "Completed";
    TaskStatus["BLOCKED"] = "Blocked";
})(TaskStatus || (TaskStatus = {}));
// Related file type: defines the relationship type between files and tasks
export var RelatedFileType;
(function (RelatedFileType) {
    RelatedFileType["TO_MODIFY"] = "TO_MODIFY";
    RelatedFileType["REFERENCE"] = "REFERENCE";
    RelatedFileType["CREATE"] = "CREATE";
    RelatedFileType["DEPENDENCY"] = "DEPENDENCY";
    RelatedFileType["TEST"] = "TEST";
    RelatedFileType["DOCUMENT"] = "DOCUMENT";
    RelatedFileType["OTHER"] = "OTHER";
})(RelatedFileType || (RelatedFileType = {}));
// Task complexity level: defines the classification of task complexity
export var TaskComplexityLevel;
(function (TaskComplexityLevel) {
    TaskComplexityLevel["LOW"] = "Low Complexity";
    TaskComplexityLevel["MEDIUM"] = "Medium Complexity";
    TaskComplexityLevel["HIGH"] = "High Complexity";
    TaskComplexityLevel["VERY_HIGH"] = "Very High Complexity";
})(TaskComplexityLevel || (TaskComplexityLevel = {}));
// Task complexity thresholds: defines reference standards for task complexity assessment
export const TaskComplexityThresholds = {
    DESCRIPTION_LENGTH: {
        MEDIUM: 500, // Exceeding this word count is determined as medium complexity
        HIGH: 1000, // Exceeding this word count is determined as high complexity
        VERY_HIGH: 2000, // Exceeding this word count is determined as very high complexity
    },
    DEPENDENCIES_COUNT: {
        MEDIUM: 2, // Exceeding this number of dependencies is determined as medium complexity
        HIGH: 5, // Exceeding this number of dependencies is determined as high complexity
        VERY_HIGH: 10, // Exceeding this number of dependencies is determined as very high complexity
    },
    NOTES_LENGTH: {
        MEDIUM: 200, // Exceeding this word count is determined as medium complexity
        HIGH: 500, // Exceeding this word count is determined as high complexity
        VERY_HIGH: 1000, // Exceeding this word count is determined as very high complexity
    },
};
// Thought chain data structure
export * from "./thoughtChain.js";
//# sourceMappingURL=index.js.map