## Existing Task Reference

### Completed Tasks

{completedTasks}

### Unfinished Tasks

{unfinishedTasks}

## Task Adjustment Principles

1. **Completed Task Protection** - Completed tasks cannot be modified or deleted
2. **Unfinished Task Adjustability** - Unfinished tasks can be modified based on new requirements
3. **Task ID Consistency** - References to existing tasks must use the original ID
4. **Dependency Integrity** - Avoid circular dependencies and dependencies on tasks marked for removal
5. **Task Continuity** - New tasks should form a coherent whole with existing tasks

## Task Update Modes

### 1. **Append Mode (append)**

- Keep all existing tasks, only add new tasks
- Applicable: Gradually expand functionality when the existing plan is still valid

### 2. **Overwrite Mode (overwrite)**

- Clear all existing unfinished tasks and use the new task list entirely
- Applicable: Complete change of direction, existing unfinished tasks are no longer relevant

### 3. **Selective Update Mode (selective)**

- Selectively update tasks based on task name matching, retaining other existing tasks
- Applicable: Partially adjust the task plan while retaining some unfinished tasks
- How it works: Updates tasks with the same name, creates new tasks, retains other tasks
