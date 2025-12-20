**Please strictly follow the guidelines below**

## Task Analysis

{description}

## Requirements and Constraints

{requirements}

{tasksTemplate}

## Focus Mode Guidance

Select your planning approach based on the project focus:

### 🔬 Logic Mode Planning
- Define clear technical requirements and constraints
- Identify data models and API contracts
- Plan for error handling and edge cases
- Consider testing strategy upfront
- Document integration points

### 🎨 Vibe Mode Planning
- Start with the desired user experience
- Define the visual mood and aesthetic goals
- Plan for animations and micro-interactions
- Consider responsive design from the start
- Prioritize feel over feature completeness

### 🔒 Security Mode Planning
- Identify all trust boundaries
- Plan authentication and authorization flows
- Define input validation requirements
- Consider audit logging needs
- Plan for secure storage of sensitive data

### ⚡ Performance Mode Planning
- Define performance targets (load time, throughput)
- Identify potential bottlenecks early
- Plan for profiling and measurement
- Consider caching strategies
- Plan for horizontal scaling if needed

### ♿ Accessibility Mode Planning
- Define WCAG compliance level (A, AA, AAA)
- Plan keyboard navigation flows
- Identify areas needing ARIA support
- Plan for screen reader testing
- Consider color contrast requirements

## Analysis Guidelines

1. Determine the task's goals and expected outcomes
2. Identify technical challenges and key decision points
3. Consider potential solutions and alternatives
4. Evaluate the pros and cons of each solution
5. Determine if the task needs to be broken down into subtasks
6. Consider integration requirements with existing systems

## Task Memory Retrieval

Past task records are stored in **{memoryDir}**.

When using the query tool, judge based on the following scenarios:

- **Must Query (High Priority)**:
  - Involves modifying or extending existing functionality
  - Task description mentions referencing past work
  - Involves internal system technical implementation

- **Can Query (Medium Priority)**:
  - New functionality has integration needs with existing system
  - Functionality needs to conform to system conventions

- **Can Skip (Low Priority)**:
  - Completely new, independent functionality
  - Basic setup or simple standard tasks

## Information Gathering Guide

1. **Ask the User** - When you have questions about task requirements
2. **Query Memory** - Use "query_task" to check past memory
3. **Web Search** - For terms or concepts you don't understand

## 💡 Smart Tool Suggestions

Use these tools if available to enhance your planning:

### For Research & Best Practices
- **Primary**: Use `perplexity_search` or `perplexity_ask` to research best practices, find similar implementations, or understand unfamiliar concepts
- **Fallback**: If Perplexity is unavailable, use `search_web` or ask the user for guidance on best practices

### For Decision Making
- **Primary**: Use `decisionframework` (Clear Thoughts MCP) when choosing between multiple approaches or technologies
- **Fallback**: If unavailable, list pros/cons of each option in your analysis and make a reasoned recommendation

### For Documentation Lookup
- **Primary**: Use `context7` to fetch framework/library documentation when working with specific technologies
- **Fallback**: If unavailable, check README files, package.json, or ask the user for documentation links

> ⚠️ **Note**: These tools are optional enhancements. If any tool is not available in your environment, proceed with the fallback approach.

## Next Steps

⚠️ Important: Please read the rules in {rulesPath} before conducting any analysis or design ⚠️

**Step 1: Decide whether to query memory based on the task description**

{thoughtTemplate}

