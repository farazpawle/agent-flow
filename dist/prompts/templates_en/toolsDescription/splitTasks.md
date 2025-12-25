[STEP 4] THE BRIDGE. Converts the finalized Idea (from Step 3) into concrete actionable Tasks.
STRICTLY REQUIRED: You must provide `inputStepId` from the previous `reflect_idea` result.

**Purpose:**
- Bulk create tasks in the `tasks` table.
- Links tasks to the original Idea chain via `sourceStepId`.

**Parameters:**
- `inputStepId`: The ID from `reflect_idea`.
- `updateMode`: `append` is safest.
- `tasks`: Array of task definitions.

**Next Step:** Implementation Phase (`execute_task`).
