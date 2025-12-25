# AgentFlow

> 🚀 **AgentFlow** is an intelligent agentic workflow system based on Model Context Protocol (MCP). It bridges the gap between reasoning and execution (Task Management), providing a visual control center for AI Agents.

## 📑 Table of Contents

- [✨ Features](#features)
- [🧭 Usage Guide](#usage-guide)
- [🔧 Installation](#installation)
- [🔌 Using with MCP-Compatible Clients](#clients)
- [🛠️ Tools Overview](#tools)
- [🤖 Recommended Models](#recommended)
- [📄 License](#license)
- [📚 Documentation](#documentation)

## ✨ Features

- **🧠 Intelligent Reasoning**: Advanced reasoning processing for complex problem solving
- **📋 Visual Task Management**: Drag-and-drop hierarchy, status tracking, and dependency graph
- **🎨 Appearance**: Light and Dark theme support with modern UI
- **🌐 Real-Time Dashboard**: Monitor connected clients and agent status live
- **🧩 Task Decomposition**: Break down large tasks into manageable steps automatically
- **✅ Verification & Memory**: Built-in verification steps and history persistence
- **📋 Project Rules**: Define standards to maintain consistency
- **📝 Detailed Mode**: View conversation history (enable with `ENABLE_DETAILED_MODE=true`)

## 🧭 Usage Guide

### 🚀 Quick Start

1. **🔽 Installation**: [Install AgentFlow](#installation) via Smithery or manually
2. **🏁 Initial Setup**: Tell the Agent "init project rules" to establish project-specific guidelines
3. **📝 Plan Tasks**: Use "plan task [description]" to create a development plan
4. **👀 Review & Feedback**: Provide feedback during the planning process
5. **▶️ Execute Tasks**: Use "execute task [name/ID]" to implement a specific task
6. **🔄 Continuous Mode**: Say "continuous mode" to process all tasks sequentially

### 🔍 Memory & Thinking Features

- **💾 Task Memory**: Automatically saves execution history for reference
- **🔄 Thought Chain**: Enables systematic reasoning through `process_thought` tool
- **📋 Project Rules**: Maintains consistency across your codebase

## 🔧 Installation

### 🔽 Via Smithery
```bash
npx -y @smithery/cli install agent-flow --client claude
```

### 🔽 Manual Installation
```bash
npm install
npm run build
```

## 🔌 Using with MCP-Compatible Clients

### ⚙️ Configuration in Cursor IDE

Add to your Cursor configuration file (`~/.cursor/mcp.json` or project-specific `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "agent-flow": {
      "command": "npx",
      "args": ["-y", "agent-flow"],
      "env": {
        "DATA_DIR": "/path/to/project/data", // Must use absolute path
        "ENABLE_THOUGHT_CHAIN": "true",
        "TEMPLATES_USE": "en",
        "ENABLE_GUI": "true",
        "ENABLE_DETAILED_MODE": "true"
      }
    }
  }
}
```

> ⚠️ **Important**: `DATA_DIR` must use an absolute path.

### 🔧 Environment Variables

- **📁 DATA_DIR**: Directory for storing task data (absolute path required)
- **🧠 ENABLE_THOUGHT_CHAIN**: Controls detailed thinking process (default: true)
- **🌐 TEMPLATES_USE**: Template language (default: en)
- **🖥️ ENABLE_GUI**: Enables web interface (default: false)
- **📝 ENABLE_DETAILED_MODE**: Shows conversation history (default: false)

## 🛠️ Tools Overview

| Category          | Tool                  | Description                                |
|-------------------|------------------------|--------------------------------------------|
| 📋 Planning       | `plan_task`            | Start planning tasks                       |
|                   | `analyze_task`         | Analyze requirements                       |
|                   | `process_thought`      | Step-by-step reasoning                     |
|                   | `reflect_task`         | Improve solution concepts                  |
|                   | `init_project_rules`   | Set project standards                      |
| 🧩 Management     | `split_tasks`          | Break into subtasks                        |
|                   | `list_tasks`           | Show all tasks                             |
|                   | `query_task`           | Search tasks                               |
|                   | `get_task_detail`      | Show task details                          |
|                   | `delete_task`          | Remove tasks                               |
| ▶️ Execution      | `execute_task`         | Run specific tasks                         |
|                   | `verify_task`          | Verify completion                          |
|                   | `complete_task`        | Mark as completed                          |

## 🤖 Recommended Models

- **👑 Claude 3.7**: Offers strong understanding and generation capabilities
- **💎 Gemini 2.5**: Google's latest model, performs excellently

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 📚 Documentation

- [🏗️ System Architecture](docs/en/architecture.md)
- [🔧 Prompt Customization Guide](docs/en/prompt-customization.md)
- [📝 Changelog](CHANGELOG.md)


