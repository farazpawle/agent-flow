## Task Splitting - {updateMode} Mode

## Splitting Strategies

1. **Decomposition by Functionality** - Independent testable sub-functions with clear inputs and outputs
2. **Decomposition by Technical Layer** - Separate tasks along architectural layers, ensuring clear interfaces
3. **Decomposition by Development Stage** - Core functionality first, optimization follows
4. **Decomposition by Risk** - Isolate high-risk parts to reduce overall risk

## Category and Priority Guide

### Task Categories
| Category | Use For |
|----------|---------|
| 🎨 **frontend** | UI components, styling, animations, user interactions |
| ⚙️ **backend** | API endpoints, database, business logic, services |
| 🧪 **testing** | Unit tests, integration tests, E2E tests |
| 🎭 **design** | Visual design, mockups, design tokens, assets |
| 🔧 **devops** | CI/CD, deployment, infrastructure, monitoring |
| 📚 **docs** | Documentation, README, API docs, comments |

### Task Priorities
| Priority | Meaning |
|----------|---------|
| 🔴 **critical** | Blocks other work, must be done first |
| 🟠 **high** | Important for core functionality |
| 🟡 **medium** | Standard priority (default) |
| 🟢 **low** | Nice-to-have, can be deferred |

## Task Quality Review

1. **Task Atomicity** - Each task is small and specific enough to be completed independently
2. **Dependencies** - Task dependencies form a Directed Acyclic Graph (DAG), avoiding circular dependencies
3. **Description Completeness** - Each task description is clear and accurate, including necessary context
4. **Category Assigned** - Each task has an appropriate category for organization
5. **Priority Set** - Critical and high-priority tasks are clearly marked

## Task List

{tasksContent}

## Dependency Management

- Use task names or task IDs to set dependencies
- Minimize the number of dependencies, setting only direct predecessors
- Avoid circular dependencies, ensuring the task graph is a DAG
- Balance the critical path, optimizing potential for parallel execution

## Decision Points

- Found unreasonable task split: Re-call "split_tasks" to adjust
- Confirmed task split is sound: Generate execution plan, determine priorities

**Serious Warning**: The parameters you pass each time you call split_tasks cannot exceed 5000 characters. If it exceeds 5000 characters, please call the tool multiple times to complete.

**If there are remaining tasks, please continue calling "split_tasks"**
