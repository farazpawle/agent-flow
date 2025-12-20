# MCP Chain of Thought Server Instructions

This server provides a robust suite of tools for **Agentic Chain of Thought (CoT)**, enabling systematic planning, execution, and verification of complex coding tasks. It uses a **local SQLite database** to persist tasks, ensuring data integrity and long-running context.

## 🚀 Core Philosophy

The server operates on a cyclic workflow: **Plan -> Execute -> Verify -> Complete**.
It encourages "slow thinking" via the `process_thought` tool and structured task management.

---

## � Standard Workflow Lifecycle

The following sequence describes the ideal logical flow of operations.

### Phase 1: Context & Initiation
1.  **Thinking**: `process_thought(stage="problem_analysis")`
    *   *Why*: Ground yourself in the problem before acting.
2.  **Rules**: `init_project_rules(...)` (Optional but recommended for new projects)
    *   *Why*: Establish tech stack and coding standards early.

### Phase 2: Planning & Architecture
3.  **High-Level Plan**: `plan_task(description="...")`
    *   *Why*: Draft the roadmap.
4.  **Deep Analysis**: `analyze_task(...)` (For complex features)
    *   *Why*: Solve hard technical problems *before* writing code.
5.  **Refinement**: `reflect_task(...)`
    *   *Why*: Critique your own plan. Catch bugs in the design phase.
6.  **Commit Tasks**: `split_tasks(...)`
    *   *Why*: **Crucial Step**. This converts your plan into actionable database records.

### Phase 3: The Execution Loop (Repeat for each task)
7.  **Selection**: `list_tasks(status="pending")` -> Pick a `taskId`.
8.  **Activation**: `execute_task(taskId="...", focus="...")`
    *   *Why*: Marks task as IN_PROGRESS and retrieves dependencies/context.
9.  **Implementation**: *Agent acts (writes code, runs commands)*.
10. **Discovery (Dynamic)**: `update_task_content(taskId="...", relatedFiles=[...])`
    *   *Why*: You found new files that define this task? Record them so the system remembers.
11. **Verification**: `verify_task(taskId="...")`
    *   *Why*: Run tests/builds. Ensure "Definition of Done".
12. **Completion**: `complete_task(taskId="...", summary="...")`
    *   *Why*: Close the meaningful unit of work.

---

## 🤖 Automation & Orchestration

> **IMPORTANT**: The tools provided by this server are **passive**.

*   **No Auto-Chaining**: Calling `plan_task` does **NOT** automatically call `split_tasks`. Calling `execute_task` does **NOT** automatically write code.
*   **Agent Responsibility**: **YOU (The Agent)** are the orchestrator. You must examine the output of one tool and decide to call the next appropriate tool.
*   **Why?**: This design keeps *you* in control. You can iterate on a plan 5 times before committing it. You can fail a verification step and go back to execution without the system forcing you forward.

---

## 🛠️ Tool Usage Guide

### 1. Thinking & Context
Before taking action, use these tools to establish context and reason through problems.

*   **`process_thought`**
    *   **Purpose**: Records a step in your reasoning chain. MANDATORY before complex actions.
    *   **Params**: `thought`, `thought_number`, `total_thoughts`, `next_thought_needed`, `stage`, `focus`.
    *   **Workflow**: Call this cyclically until `next_thought_needed` is false.

*   **`init_project_rules`**
    *   **Purpose**: Initializes project-specific guidelines (tech stack, coding style).
    *   **Params**: `project_type`, `tech_stack` (array), `coding_style`, `focus`.

---

### 2. Planning Phase
Break down the user's request into managing tasks.

*   **`plan_task`**
    *   **Purpose**: Generate a high-level plan based on requirements.
*   **`analyze_task`**
    *   **Purpose**: Deep dive into specific technical challenges.
*   **`reflect_task`**
    *   **Purpose**: Critique and refine the analysis/plan.
*   **`split_tasks`**
    *   **Purpose**: **CRITICAL**. Converts the plan into actual database entries.
    *   **Params**:
        *   `updateMode`: `append` (add to list) or `overwrite` (replace pending) or `clearAllTasks`.
        *   `tasks`: Array of task objects (`name`, `description`, `dependencies`, `relatedFiles`, `implementationGuide`).
        *   `globalAnalysisResult`: Context shared across tasks.

---

### 3. Execution Phase
Work through the task list systematically.

*   **`list_tasks`**
    *   **Purpose**: See what needs to be done.
    *   **Params**: `status` ("pending", "in_progress", "completed", "all").
*   **`execute_task`**
    *   **Purpose**: Mark a task as **IN_PROGRESS** and get its details to start work.
    *   **Params**: `taskId`, `focus`.
*   **`update_task_content`**
    *   **Purpose**: Update task details as you discover new info (e.g., adding new related files).
    *   **Params**: `taskId`, `relatedFiles`, `implementationGuide`, etc.

---

### 4. Verification & Completion Phase
Ensure quality before moving on.

*   **`verify_task`**
    *   **Purpose**: Run checks (builds, tests) for the current task.
    *   **Params**: `taskId`, `focus`.
*   **`complete_task`**
    *   **Purpose**: Mark the task as **COMPLETED**.
    *   **Params**: `taskId`, `summary` (what was done).
*   **`delete_task`** / **`clear_all_tasks`**
    *   **Purpose**: extensive cleanup.

---

### 5. Management & Querying
Find information efficiently.

*   **`query_task`**
    *   **Purpose**: Semantic/Fuzzy search for tasks.
    *   **Params**: `query` (string), `isId` (boolean).
*   **`get_task_detail`**
    *   **Purpose**: detailed view of a single task.
    *   **Params**: `taskId`.

---

## 💡 Best Practices

1.  **Always `process_thought` First**: Never rush into code. Use the thinking tool to align your internal context.
2.  **Granular Tasks**: Use `split_tasks` to create small, verifiable units of work (e.g., "Create X Component" instead of "Build App").
3.  **Update "Related Files"**: When `execute_task` reveals new files needed, use `update_task_content` to add them. This builds a knowledge graph.
4.  **Vibe Coding**: Use the `focus: "vibe"` parameter in `process_thought` and `execute_task` when working on UI/UX to shift the persona towards creativity.
5.  **Persistence**: Data is saved to `data/tasks.db`. It persists across server restarts.
