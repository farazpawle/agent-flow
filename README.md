# AgentFlow 🚀

[![smithery badge](https://smithery.ai/badge/@farazpawle/agent-flow)](https://smithery.ai/server/@farazpawle/agent-flow)

**AgentFlow** is a next-generation, premium agentic workflow system built on the **Model Context Protocol (MCP)**. It transforms the way AI agents handle complex development tasks by bridging the gap between raw LLM reasoning and structured execution.

---

## ✨ The Vision: "Vibe Coding" Refined

AgentFlow is designed for the modern "Vibe Coder"—developers who prioritize high-level intent, rapid iteration, and stunning visual feedback.

-   **🧠 Integrated Thought Chain**: Native Support for complex multi-step reasoning (`plan` → `analyze` → `reflect`).
-   **🎨 State-of-the-Art Dashboard**: A premium **Glassmorphism** interface with **Dynamic Background Gradients**, fluid animations (15s ease infinite shift), and meticulous **Light/Dark** themes.
-   **🎮 Real-Time Pulse**: Live updates via **SSE (Server-Sent Events)**. Watch your agent create, update, and reorder tasks in real-time.
-   **⚛️ Dual Persistence**: Robust storage support via **SQLite** for local portability or **Supabase** for enterprise-scale persistence.
-   **📁 Intelligent Project Context**: Auto-detects projects based on workspace paths or Git remote URLs, mapping local work to stable project identities.

---

## 🧭 The Core Workflow

AgentFlow promotes a high-integrity "Think-Then-Do" pipeline:

1.  **💡 Plan Idea**: Draft initial concepts and design tokens.
2.  **🔍 Analyze**: Deep dive into technical requirements and blockers.
3.  **🤔 Reflect**: Self-critique the plan to catch edge cases before a single line of code is written.
4.  **🧩 Split**: Automatically decompose the refined plan into a **Topological DAG** of tasks.
5.  **▶️ Execute**: Move through tasks with built-in **Verification Loops** ensuring criteria are met.

---

## ⚙️ Technical Stack

-   **Backend**: Node.js + TypeScript (High-performance ESM).
-   **MCP Implementation**: `@modelcontextprotocol/sdk` for seamless tool-calling integration.
-   **Persistence**: SQLite (Local) / Supabase (Remote) via shared `DatabaseAdapter`.
-   **Dashboard**: Vanilla JS + CSS (Custom Tokens) + **D3.js** for real-time dependency graph visualization.
-   **Communication**: HTTP REST API + **Server-Sent Events (SSE)** for zero-latency UI updates.

---

## 🛠️ Advanced Toolset

### 🏗️ Reasoning Engine
| Tool | Description |
| :--- | :--- |
| `plan_idea` | Draft architectural concepts with optional **Focus Modes** (logic, vibe, security, etc.). |
| `analyze_idea` | Context-aware analysis of a planned idea. |
| `reflect_idea` | Critical self-reflection to harden specifications. |
| `process_thought` | High-fidelity thinking tool with support for **Design Tokens**, axioms, and focus shifts. |

### 📋 Task Orchestration
| Tool | Description |
| :--- | :--- |
| `split_tasks` | Converts specification into a task graph with **Dependencies**, **Priority**, and **Category**. |
| `reorder_tasks` | Legalizes manual reordering while strictly enforcing topological constraints. |
| `verify_task` | A mandatory validation step before task completion. |
| `get_project_context` | Workspace-aware project identification and switching. |

---

## � Quick Start

### 🔽 Via Smithery (Recommended)
```bash
npx -y @smithery/cli install agent-flow --client claude
```

### 🔽 Manual Setup
```bash
git clone https://github.com/farazpawle/agent-flow.git
cd agent-flow
npm install
npm run build
```

---

## 🔌 Configuration

Update your MCP client config (e.g., Cursor, Claude Desktop):

```json
{
  "mcpServers": {
    "agent-flow": {
      "command": "npx",
      "args": ["-y", "agent-flow"],
      "env": {
        "DATA_DIR": "C:/Path/To/Your/Data", // REQUIRED: Absolute path
        "DB_TYPE": "sqlite",              // 'sqlite' or 'supabase'
        "ENABLE_GUI": "true",             // Enable the dashboard (default: true)
        "ENABLE_DETAILED_MODE": "true"    // Record per-task conversation history
      }
    }
  }
}
```

---

## 🤖 Optimized Models

AgentFlow is fine-tuned for:
-   **Claude 3.7 / 3.5 Sonnet**: The gold standard for reasoning and complex tool interaction.
-   **Gemini 2.0 Flash**: Ultra-responsive for real-time dashboard updates and rapid tool calling.

---

## 📄 License
MIT License. Created with ❤️ for the Vibe Coding community.
