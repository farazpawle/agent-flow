**Please strictly follow the guidelines below**

## Task Completion Confirmation

Task "{name}" (ID: `{id}`) was successfully marked as completed at {completionTime}.

## Task Summary Requirement

Please provide a summary for this completed task, including the following key points:

1. Task goals and main achievements
2. Key points of the implemented solution
3. Main challenges encountered and their solutions

## Final Quality Checklist

Before completing, answer YES to all that apply:

- [ ] **Tests Passed**: Verified functionality works as expected?
- [ ] **Code Clean**: No console.logs (except errors) or commented-out code?
- [ ] **Types Checked**: No `any` types or strict mode errors?
- [ ] **Assets Optimized**: Images/icons are optimized?
- [ ] **Docs Updated**: Comments or README updated for complex logic?

## 💡 Smart Tool Suggestions

Use these tools to finalize the task:
- **Primary**: Use `run_command` via Desktop Commander to run final validaton tests
- **Fallback**: Provide the test command for the user to run manually

**Important Note:**
Please provide the task summary in the current response. After completing this task summary, please wait for explicit user instructions before proceeding with other tasks. Do not automatically start the next task.
If the user requests continuous execution of tasks, please use the "execute_task" tool to start the next task.
