# AgentFlow 🚀

[![smithery badge](https://smithery.ai/badge/@farazpawle/agent-flow)](https://smithery.ai/server/@farazpawle/agent-flow)

**AgentFlow** is a premium, high-performance agentic workflow system built on the **Model Context Protocol (MCP)**. It transforms raw AI reasoning into structured, manageable, and executable tracks, providing a stunning visual control center for autonomous agents.

---

## ✨ The Experience

AgentFlow isn't just a task list; it's a **Vibe-first** orchestration layer.

-   **🧠 Deep Reasoning**: Integrated reasoning loops (`plan` → `analyze` → `reflect`) to ensure high-quality architectural decisions.
-   **🎨 Premium UI**: A state-of-the-art dashboard featuring **Glassmorphism**, **Dynamic Gradient Flow** animations, and full **Light/Dark theme** support.
-   **⚡ Real-Time Pulse**: Live task status updates via Server-Sent Events (SSE). Watch your agent work in real-time.
-   **📂 Project Centric**: Native support for multiple projects, persistent across sessions.
-   **🧪 Hardened Workflow**: Built-in verification loops to ensure code quality and project alignment.

---

## 🧭 The Workflow

AgentFlow promotes a structured "Thinking to Doing" pipeline:

1.  **Ideate**: Start with `plan_idea` to outline a feature.
2.  **Refine**: Use `analyze_idea` and `reflect_idea` to harden the specification.
3.  **Decompose**: Run `split_tasks` to convert your plan into an executable DAG (Directed Acyclic Graph).
4.  **Execute**: Move through tasks with `execute_task`, `update_task`, and `verify_task`.
5.  **Visualize**: Monitor progress on the local dashboard at `http://localhost:54544`.

---

## 🔧 Installation

### 🔽 Quick Start (via Smithery)
```bash
npx -y @smithery/cli install agent-flow --client claude
```

### 🔽 Developer Setup
```bash
git clone https://github.com/farazpawle/agent-flow.git
cd agent-flow
npm install
npm run build
```

---

## 🔌 Configuration

Add AgentFlow to your MCP client (e.g., Cursor, Claude Desktop):

```json
{
  "mcpServers": {
    "agent-flow": {
      "command": "npx",
      "args": ["-y", "agent-flow"],
      "env": {
        "DATA_DIR": "C:/Path/To/Your/Data", // REQUIRED: Use absolute path
        "DB_TYPE": "sqlite",              // 'sqlite' or 'supabase'
        "ENABLE_GUI": "true",             // Enable the web dashboard
        "ENABLE_DETAILED_MODE": "true"    // Record conversation history
      }
    }
  }
}
```

---

## 🛠️ Toolset

### 🏗️ Planning & Reasoning
| Tool | Purpose |
| :--- | :--- |
| `plan_idea` | Draft the initial architectural concept. |
| `analyze_idea` | Deep dive into technical requirements and blockers. |
| `reflect_idea` | Self-critique the plan to identify edge cases. |
| `process_thought` | General reasoning tool for logic checkpoints. |

### 📋 Task Management
| Tool | Purpose |
| :--- | :--- |
| `split_tasks` | Break a plan into a structured task list. |
| `list_tasks` | Fetch tasks with filtering (status, project). |
| `query_task` | Full-text search across all tasks. |
| `reorder_tasks` | Fine-tune the execution sequence. |

### ▶️ Action & Verification
| Tool | Purpose |
| :--- | :--- |
| `execute_task` | Signal the start of implementation. |
| `update_task` | Push updates to task content/metadata. |
| `verify_task` | Submit work for validation & status check. |
| `complete_task` | Finalize a verified task. |

---

## 🤖 Optimized Models

For the best experience, we recommend:
-   **Claude 3.7 / 3.5 Sonnet**: Exceptional tool calling and reasoning.
-   **Gemini 2.0 Flash**: Ultra-fast execution and real-time responsiveness.

---

## 📄 License
MIT License. Created with ❤️ by the AgentFlow team.
