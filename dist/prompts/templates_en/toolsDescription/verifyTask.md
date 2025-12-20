Verify that a task was completed correctly before marking it as done.

**Parameters:**
- `taskId` (required): The UUID of the task to verify
- `focus` (optional): Verification approach:
  - `logic`: Test correctness, run unit tests, check edge cases
  - `vibe`: Check aesthetics, animations feel right, UX is smooth
  - `debug`: Verify the fix works, no regression
  - `security`: Check for vulnerabilities, auth bypasses
  - `performance`: Run benchmarks, check memory usage
  - `accessibility`: WCAG audit, screen reader test, keyboard navigation

**Next step:** If verification passes, use complete_task. If it fails, continue with execute_task.
