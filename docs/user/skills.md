# Agent Skills

Skills give Mixer specialized knowledge and behavioral instructions for specific tasks. Think of them as reusable expertise that the AI can activate on demand — like giving it a detailed playbook for particular types of work.

---

## Why Skills?

Your system prompt tells Mixer how to behave in general. Skills go deeper:

- **Focused expertise** — A "code-review" skill can contain your team's specific coding standards, patterns to watch for, and how to structure feedback
- **Reusable across sessions** — Write instructions once, use them every time that task comes up
- **Progressive disclosure** — Only loaded when relevant, keeping your context window efficient
- **Portable** — Compatible with the [agentskills.io](https://agentskills.io) specification, importable from GitHub

---

## Quick Start

### 1. Open the Skills Panel

Click the **🧩** button in the toolbar to open the Skills panel.

### 2. Create Your First Skill

Expand "✨ Create New Skill" and fill in:
- **Name**: `code-review` (lowercase, hyphens only)
- **Description**: "Review code for error handling, type safety, and test coverage."
- **Instructions**: The detailed instructions the AI should follow

Click "✨ Create Skill" — it's saved as a Logseq page under `Mixer/Skills/code-review`.

### 3. Use the Skill

Type in chat:
```
/skill code-review Review this function for issues: [paste code]
```

Or just describe the task naturally — Mixer will activate the skill automatically when it matches.

---

## Activating Skills

Skills can be activated three ways:

### Slash Command (explicit)

```
/skill <name> [your message]
```

Examples:
```
/skill code-review Check this TypeScript function for issues
/skill meeting-notes Structure today's standup notes
/skill research-paper Summarize the key findings from my ML notes
```

If you type just `/skill <name>` without a follow-up message, the skill activates and Mixer confirms it's ready.

### Natural Language (automatic)

When you describe a task that matches a skill's description, Mixer activates it automatically. The skill catalog (names + descriptions) is always available to the AI.

### Model-Driven (tool call)

The AI can call `activate_skill` when it decides a skill is relevant during a multi-step task.

---

## Creating Skills

### In the Skills Panel

1. Click 🧩 to open Skills
2. Expand "✨ Create New Skill"
3. Fill in name, description, and instructions body
4. Click Create

### Via Chat (AI-generated)

Ask the AI to create a skill for you:

```
Create a skill called "logseq-conventions" that instructs you to:
- Always use [[double brackets]] for page links
- Use TODO/DOING/DONE markers for tasks
- Structure pages with ## headings
- Tag pages with #project or #reference
```

The AI will write comprehensive instructions and save the skill.

### From a Logseq Block

If you have instructions already written in a block:

```
Create a skill from block ((block-uuid)) named "my-workflow"
```

The block content becomes the skill's instruction body.

---

## Importing Skills from GitHub

Skills follow the [agentskills.io specification](https://agentskills.io/specification), making them portable across tools.

### In the Skills Panel

1. Click 🧩 to open Skills
2. Paste a GitHub URL in the "Import from GitHub" field
3. Click Import

Supported URL formats:
- `https://github.com/user/repo/blob/main/skills/my-skill/SKILL.md`
- `https://github.com/user/repo/tree/main/skills/my-skill`
- `https://github.com/user/repo` (looks for SKILL.md at root)

### Via Chat

```
Import skill from https://github.com/user/repo/blob/main/skills/pdf-processing/SKILL.md
```

---

## Skill Page Format

Each skill is stored as a Logseq page under `Mixer/Skills/`. Here's what a skill page looks like:

```
Page: Mixer/Skills/code-review

name:: code-review
description:: Review code for error handling, type safety, and test coverage.
enabled:: true
source:: github:user/repo/skills/code-review
license:: MIT

# Code Review Instructions

## What to Check
1. Error handling — are all error paths covered?
2. Type safety — are types used correctly?
3. Test coverage — are edge cases tested?

## Output Format
Provide feedback as:
- 🔴 Critical: must fix before merge
- 🟡 Warning: should address
- 🟢 Suggestion: nice to have
```

### Properties

| Property | Required | Description |
|----------|----------|-------------|
| `name` | Yes | Lowercase, hyphens, 1-64 chars |
| `description` | Yes | What the skill does (max 1024 chars) |
| `enabled` | Yes | `true` or `false` — controls visibility |
| `source` | No | Where it came from (e.g., `github:user/repo`) |
| `license` | No | License info |
| `version` | No | Version string |

---

## Managing Skills

In the 🧩 Skills panel:

- **Toggle** — Enable/disable each skill individually. Disabled skills are not included in the AI's catalog.
- **Delete** — Remove a skill permanently (with confirmation).
- **Source badge** — Shows whether a skill came from GitHub or was created locally.

---

## Subagent Delegation

Skills can instruct the AI to delegate complex sub-tasks to focused subagents. This is useful for:

- Research tasks that need to search many pages
- Complex analysis that benefits from isolated context
- Multi-phase workflows where each phase is independent

Example skill body using delegation:

```markdown
## Execution Strategy
For comprehensive research:
1. Use mixer_run_subtask to gather all relevant pages
2. Use mixer_run_subtask to analyze and categorize findings
3. Synthesize results into the final output

Each subtask runs in a fresh context, preventing information overload.
```

The `mixer_run_subtask` tool:
- Runs a separate AI session with its own history
- Has access to all Logseq tools and MCP tools
- Can optionally activate a skill in the sub-session
- Returns results to the parent conversation

---

## Writing Effective Skills

### Good Practices

1. **Be specific** in descriptions — include keywords that help matching:
   > ✅ "Review Python and TypeScript code for error handling, type safety, security issues, and test coverage."
   > ❌ "Help with code."

2. **Structure instructions** with clear sections:
   - When to use this skill
   - Step-by-step process
   - Output format expected
   - Common edge cases

3. **Keep instructions focused** — one skill per task type. Split "research-and-write" into "research" and "writing" skills.

4. **Include examples** in the body — show the AI what good output looks like.

### Skill Body Tips

- Use markdown headings for structure
- Include example inputs and outputs
- Specify the output format explicitly
- Mention tools the AI should use (`logseq_search_pages`, `logseq_get_blocks`, etc.)
- Reference when to use `mixer_run_subtask` for complex sub-tasks

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Enable Agent Skills | `true` | Master toggle for the skills system |

When disabled, the skills catalog is not injected into the system prompt and the 🧩 panel is hidden.

---

## Compatibility

Mixer Skills follow the [agentskills.io specification](https://agentskills.io/specification):

- **SKILL.md format** — Import any standard SKILL.md file from GitHub
- **Progressive disclosure** — Name + description as catalog (tier 1), full body on activation (tier 2)
- **Structured activation** — Wrapped in `<skill_content>` tags for context management

Skills created in Mixer can be exported back to SKILL.md format for use in other tools.
