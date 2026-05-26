import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const requiredProcessThoughtTemplates = [
  "src/prompts/templates_en/processThought/index.md",
  "src/prompts/templates_en/processThought/moreThought.md",
  "src/prompts/templates_en/processThought/completedThought.md",
  "src/prompts/templates_en/processThought/previousContext.md",
  "src/prompts/templates_en/processThought/designContext.md",
  "src/prompts/templates_en/processThought/designColors.md",
  "src/prompts/templates_en/processThought/designFonts.md",
  "src/prompts/templates_en/processThought/designMood.md",
  "src/prompts/templates_en/processThought/defaultTags.md",
  "src/prompts/templates_en/processThought/defaultAxioms.md",
  "src/prompts/templates_en/processThought/defaultAssumptions.md",
  "src/prompts/templates_en/processThought/focusGuidance/logic.md",
  "src/prompts/templates_en/processThought/focusGuidance/vibe.md",
  "src/prompts/templates_en/processThought/focusGuidance/debug.md",
  "src/prompts/templates_en/processThought/focusGuidance/security.md",
  "src/prompts/templates_en/processThought/focusGuidance/performance.md",
  "src/prompts/templates_en/processThought/focusGuidance/accessibility.md",
];

const requiredTaskToolMessageTemplates = [
  "src/prompts/templates_en/taskToolMessages/common/projectMismatch.md",
  "src/prompts/templates_en/taskToolMessages/planning/analyzeInputStepNotFound.md",
  "src/prompts/templates_en/taskToolMessages/planning/analyzeInputStepWrongType.md",
  "src/prompts/templates_en/taskToolMessages/planning/analyzeStepSaved.md",
  "src/prompts/templates_en/taskToolMessages/planning/reviewInputStepNotFound.md",
  "src/prompts/templates_en/taskToolMessages/planning/reviewInputStepWrongType.md",
  "src/prompts/templates_en/taskToolMessages/planning/reviewStepSaved.md",
  "src/prompts/templates_en/taskToolMessages/planning/planStepSaved.md",
  "src/prompts/templates_en/taskToolMessages/planning/decisionOptionsBlock.md",
  "src/prompts/templates_en/taskToolMessages/planning/generateRoadmapInputStepNotFound.md",
  "src/prompts/templates_en/taskToolMessages/planning/generateRoadmapInputStepWrongType.md",
  "src/prompts/templates_en/taskToolMessages/planning/roadmapWriteFailedSuffix.md",
  "src/prompts/templates_en/taskToolMessages/planning/roadmapSavedSuffix.md",
  "src/prompts/templates_en/taskToolMessages/execution/executeTaskNotFound.md",
  "src/prompts/templates_en/taskToolMessages/execution/executeTaskBlockedByDependencies.md",
  "src/prompts/templates_en/taskToolMessages/execution/executeTaskBlockedUnknownReason.md",
  "src/prompts/templates_en/taskToolMessages/execution/executeTaskBlocked.md",
  "src/prompts/templates_en/taskToolMessages/execution/executeTaskAlreadyInProgress.md",
  "src/prompts/templates_en/taskToolMessages/execution/executeTaskAlreadyCompleted.md",
  "src/prompts/templates_en/taskToolMessages/execution/relatedFilesLoadError.md",
  "src/prompts/templates_en/taskToolMessages/execution/executeTaskFailed.md",
  "src/prompts/templates_en/taskToolMessages/execution/verifyTaskNotFound.md",
  "src/prompts/templates_en/taskToolMessages/execution/verifyTaskInvalidStatus.md",
  "src/prompts/templates_en/taskToolMessages/execution/completeTaskNotFound.md",
  "src/prompts/templates_en/taskToolMessages/execution/completeTaskInvalidStatus.md",
  "src/prompts/templates_en/taskToolMessages/execution/completeTaskVerificationRequired.md",
  "src/prompts/templates_en/taskToolMessages/management/listTasksEmpty.md",
  "src/prompts/templates_en/taskToolMessages/management/queryTaskFailed.md",
  "src/prompts/templates_en/taskToolMessages/management/getTaskDetailNotFound.md",
  "src/prompts/templates_en/taskToolMessages/management/reorderTasksSuccess.md",
  "src/prompts/templates_en/taskToolMessages/management/reorderTasksFailed.md",
  "src/prompts/templates_en/taskToolMessages/modification/deleteAllConfirmRequired.md",
  "src/prompts/templates_en/taskToolMessages/modification/deleteAllSuccess.md",
  "src/prompts/templates_en/taskToolMessages/modification/deleteTaskIdRequired.md",
  "src/prompts/templates_en/taskToolMessages/modification/syncTasksInputStepNotFound.md",
  "src/prompts/templates_en/taskToolMessages/modification/syncTasksInputStepProjectMismatch.md",
  "src/prompts/templates_en/taskToolMessages/modification/syncTasksStructuredInputStepRequired.md",
  "src/prompts/templates_en/taskToolMessages/modification/syncTasksStructuredValidInputStepRequired.md",
  "src/prompts/templates_en/taskToolMessages/modification/syncTasksStructuredGateLocked.md",
  "src/prompts/templates_en/taskToolMessages/modification/syncTasksStructuredStepTypeInvalid.md",
];

const bannedLiteralsInProcessThoughtTs = [
  "**Guidance (",
  "no tags",
  "no axioms used",
  "no assumptions challenged",
  "**Previous Context:**",
  "**Design Context:**",
  "Colors:",
  "Fonts:",
  "Mood:",
];

const hardcodedChecks = [
  {
    label: "processThought generator",
    relativePath: "src/prompts/generators/processThought.ts",
    bannedLiterals: bannedLiteralsInProcessThoughtTs,
  },
  {
    label: "planning task tool",
    relativePath: "src/tools/task/planning.ts",
    bannedLiterals: [
      "[SYSTEM] ANALYSIS Context Loaded",
      "[SYSTEM] REVIEW Saved",
      "[SYSTEM] IDEA Saved",
      "Decision required (exactly one): Proceed | Reject with feedback",
      "Error: inputStepId '",
    ],
  },
  {
    label: "execution task tool",
    relativePath: "src/tools/task/execution.ts",
    bannedLiterals: [
      "Task with ID \\`",
      "cannot be executed at this time.",
      "is already in progress.",
      "Error occurred when executing task:",
      "cannot be completed yet because verification has not passed",
      'Only tasks in "in progress" state can be verified.',
    ],
  },
  {
    label: "management task tool",
    relativePath: "src/tools/task/management.ts",
    bannedLiterals: [
      "## System Notification",
      "Error occurred when querying tasks:",
      "## Task Reorder Successful",
      "## Reorder Failed",
    ],
  },
  {
    label: "modification task tool",
    relativePath: "src/tools/task/modification.ts",
    bannedLiterals: [
      "To delete all tasks, you must set 'confirm' to true.",
      "TaskId is required unless deleteAll is set to true.",
      "Structured flow requires inputStepId from generate_roadmap before syncing tasks.",
      "Structured flow gate is locked. You must pass roadmapDecision='proceed'",
      "Structured flow requires roadmap context from SPECIFICATION/REFLECT step.",
    ],
  },
];

async function assertTemplatesExist(requiredTemplates, groupLabel) {
  const missing = [];

  for (const relativePath of requiredTemplates) {
    const absolutePath = path.join(REPO_ROOT, relativePath);
    try {
      await fs.access(absolutePath);
    } catch {
      missing.push(relativePath);
    }
  }

  if (missing.length > 0) {
    console.error(`❌ Missing required ${groupLabel} templates:`);
    for (const file of missing) {
      console.error(`- ${file}`);
    }
    return false;
  }

  return true;
}

async function assertNoHardcodedPromptLiterals(relativePath, bannedLiterals, label) {
  const absolutePath = path.join(REPO_ROOT, relativePath);
  const content = await fs.readFile(absolutePath, "utf-8");
  const violations = [];

  for (const token of bannedLiterals) {
    if (content.includes(token)) {
      violations.push(token);
    }
  }

  if (violations.length > 0) {
    console.error(`❌ Hardcoded prompt literals found in ${label} (${relativePath}):`);
    for (const token of violations) {
      console.error(`- ${token}`);
    }
    return false;
  }

  return true;
}

async function main() {
  const processThoughtTemplatesOk = await assertTemplatesExist(
    requiredProcessThoughtTemplates,
    "processThought prompt"
  );
  const taskToolTemplatesOk = await assertTemplatesExist(
    requiredTaskToolMessageTemplates,
    "task tool message"
  );

  let literalsOk = true;
  for (const check of hardcodedChecks) {
    const checkOk = await assertNoHardcodedPromptLiterals(
      check.relativePath,
      check.bannedLiterals,
      check.label
    );
    literalsOk = literalsOk && checkOk;
  }

  if (!processThoughtTemplatesOk || !taskToolTemplatesOk || !literalsOk) {
    process.exitCode = 1;
    return;
  }

  console.log(
    "✅ Hardcoded-prompt audit passed (processThought + task tool message templates present, no banned inline literals in audited files)."
  );
}

main().catch((error) => {
  console.error("❌ audit-hardcoded-prompts failed:", error);
  process.exitCode = 1;
});
