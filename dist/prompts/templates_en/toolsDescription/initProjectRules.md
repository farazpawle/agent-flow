Initialize project-specific rules and coding standards. Call this when starting a new project.

**Parameters:**
- `project_type`: What you're building (web_app, api, mobile, cli, library, fullstack)
- `tech_stack`: Technologies used (e.g., ["React", "TypeScript", "Node.js"])
- `coding_style`: How strict the rules should be:
  - `strict`: Enforce all rules, no exceptions
  - `balanced`: Practical rules, common sense
  - `flexible`: Minimal rules, maximum creative freedom
- `focus`: Primary focus for this project (logic, vibe, security, etc.)

**Example:** For a creative portfolio site, use project_type: "web_app", coding_style: "flexible", focus: "vibe"
