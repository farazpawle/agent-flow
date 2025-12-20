Break down a complex task into smaller, atomic subtasks. Each task should have clear completion criteria.

**Parameters:**
- `updateMode`: How to handle existing tasks:
  - `append`: Add to existing tasks
  - `overwrite`: Replace unfinished tasks
  - `selective`: Smart merge by name
  - `clearAllTasks`: Start fresh (creates backup)
- `tasks`: Array of task objects with:
  - `name`, `description`, `implementationGuide` (required)
  - `dependencies`: Task names this depends on
  - `category`: frontend, backend, testing, design, devops, docs
  - `priority`: critical, high, medium, low
  - `relatedFiles`: Files to modify/create
  - `verificationCriteria`: How to verify completion

**Tip:** For UI work, use category: "frontend" or "design". For vibe coders, keep tasks focused on visual outcomes.
