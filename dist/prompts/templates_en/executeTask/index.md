**Please strictly follow the guidelines below**

## Task Execution

**Name:** {name}

**ID:** `{id}`

**Description:** {description}

{notesTemplate}

{implementationGuideTemplate}

{verificationCriteriaTemplate}

{analysisResultTemplate}

{dependencyTasksTemplate}

{relatedFilesSummaryTemplate}

{complexityTemplate}

{subtaskEvaluationTemplate}

## Focus-Specific Execution Guidance

Choose your approach based on the task type:

### 🔬 Logic Mode (Technical/Backend)
- Follow established patterns and best practices
- Prioritize correctness over speed
- Write comprehensive error handling
- Add logging for debugging
- Write unit tests for edge cases

### 🎨 Vibe Mode (Creative/UI)
- Trust your aesthetic intuition
- Focus on how it FEELS, not just how it works
- Iterate on animations and transitions
- Test on different screen sizes
- Get the spacing and typography right

### 🐛 Debug Mode (Error Investigation)
- Start with the most recent changes
- Use binary search to narrow down the issue
- Check logs and error messages carefully
- Verify assumptions with console.log/breakpoints
- Don't assume - verify everything

### 🔒 Security Mode (Auth/Encryption)
- Validate ALL user input
- Check authentication and authorization at every step
- Look for injection vulnerabilities
- Use parameterized queries
- Never expose sensitive data in logs

### ⚡ Performance Mode (Optimization)
- Measure before optimizing
- Identify the bottleneck first
- Check for N+1 queries
- Minimize unnecessary re-renders
- Profile in production-like conditions

### ♿ Accessibility Mode (WCAG)
- Test keyboard navigation
- Verify color contrast (4.5:1 minimum)
- Add ARIA labels where needed
- Test with screen reader
- Ensure focus states are visible

## Execution Steps

1. **Evaluate Task Complexity** - Assess if this task should be split into subtasks
2. **Select Approach** - Choose execution style based on task focus
3. **Implement Solution** - Execute according to plan, handle edge cases
4. **Self-Review** - Check your work against the focus-specific criteria
5. **Test and Verify** - Ensure functional correctness and robustness

## Quality Requirements

- **Scope Management** - Only modify relevant code, avoid feature creep
- **Code Quality** - Comply with coding standards, handle exceptions
- **Focus Alignment** - Ensure implementation matches the task's focus mode

## 💡 Smart Tool Suggestions

Use these tools if available during implementation:

### For Documentation & API Reference
- **Primary**: Use `context7` to fetch documentation for frameworks/libraries you're working with (React, Next.js, etc.)
- **Fallback**: Check project README, package.json dependencies, or search the codebase for usage examples

### For Code Examples
- **Primary**: Use `perplexity_ask` to get code examples for specific implementation patterns
- **Fallback**: Search for similar patterns in the existing codebase using file search

### For Debugging Approach
- **Primary**: Use `debuggingapproach` (Clear Thoughts MCP) for systematic error investigation
- **Fallback**: Apply binary search debugging manually - check most recent changes first, add logging, verify assumptions

> ⚠️ **Note**: These tools are optional enhancements. If unavailable, proceed with the fallback approach.

Start executing the task according to instructions. After execution, please directly use the "verify_task" tool for verification.
