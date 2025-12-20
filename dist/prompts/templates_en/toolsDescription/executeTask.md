Execute a specific task by its ID. This starts the implementation phase and marks the task as "in progress".

**Parameters:**
- `taskId` (required): The UUID of the task to execute (get from list_tasks)
- `focus` (optional): Execution approach - affects how the agent implements:
  - `logic`: Follow strict patterns, prioritize correctness
  - `vibe`: Creative freedom, prioritize aesthetics and feel
  - `debug`: Careful, systematic, check everything
  - `security`: Paranoid validation, check for vulnerabilities
  - `performance`: Optimize for speed/memory
  - `accessibility`: Ensure WCAG compliance

**After execution:** Use verify_task to validate, then complete_task to mark done.
