Start planning tasks by defining clear objectives and requirements. Use this as the first step in the planning workflow.

**Parameters:**
- `description` (required): What you want to build. Example: "Create a user dashboard with real-time notifications"
- `requirements` (optional): Technical constraints. Example: "Must use WebSocket for real-time updates"
- `existingTasksReference`: Set to true to continue from previous tasks
- `focus`: Set the planning approach (logic, vibe, debug, security, performance, accessibility)

**Workflow:** plan_task → analyze_task → reflect_task → split_tasks → execute_task → verify_task → complete_task
