# Workflows

Workflows turn the agent processes you run by hand — "find ten backlog tickets, research each one, label and comment" — into something you build once, save with a colour, and start with one click. They live in the **Workflows** tab of the right panel and belong to a project, so every thread in that project sees the same list.

## Building a workflow

Press **+** in the Workflows tab and pick a starting point: **Blank**, **Single prompt**, or one of the ready-made flows (**Backlog follow-up**, **Whole backlog sweep**, **Implement by tag**). The builder opens with the panel maximized.

The canvas is a top-down flow of bubbles joined by arrows. Press the **+** on any arrow to insert a step; click a bubble to edit it in the inspector below (or beside, when the panel is maximized). Every step has its own colour:

| Step             | What it does                                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Start**        | Whether the workflow runs once or loops. Also holds the workflow's description and **shared context** — text injected at the top of every agent prompt.                                                                                                                                                                                                         |
| **Agent**        | One agent turn with your prompt. Pick the model, permissions, checkout (local or a fresh worktree), skills to invoke, and what the agent should hand to the next step: free text, a JSON list, or a JSON object. Set **Mode** to _Plan_ for a **Plan agent**: it runs in the provider's plan mode, changes nothing, and its plan becomes the next step's input. |
| **Linear**       | An agent with Linear instructions baked in — _find tickets_, _update tickets_, or custom. It uses whatever Linear access the agent already has (MCP or CLI). Find returns a list the next step can fan out over.                                                                                                                                                |
| **For each**     | Runs the lane beneath it once per item of the previous list, N lanes at a time. Set _Checkout per lane_ to a fresh worktree when lanes open pull requests.                                                                                                                                                                                                      |
| **Check**        | Asks the agent that did the previous step a pass/fail question. On fail: stop the run, fix and re-check up to N times, or continue anyway.                                                                                                                                                                                                                      |
| **Human review** | Pauses the run under **Review** until you approve or reject.                                                                                                                                                                                                                                                                                                    |
| **Action**       | A preset follow-up on the same agent: commit & open PR, commit, comment on the ticket, or custom instructions.                                                                                                                                                                                                                                                  |
| **Context**      | Not a step of its own — text injected into the next agent's prompt, before or after it.                                                                                                                                                                                                                                                                         |
| **Report**       | What the final feedback should look like. Leave it empty to show the last step's output as the result.                                                                                                                                                                                                                                                          |

### Models

Every agent step has a **Model** switch: off, it inherits the workflow's **Default model** (set on the Start step); if that is off too, the project's default applies. Turn it on to pin a specific model for that step. This is how you hand work off to a cheaper model: a Plan agent on a strong model, then an **↳ same agent** Implement step on a smaller one — the second turn continues the same thread with the plan and its context. (Providers that cannot switch models mid-thread will say so; make that step a ✦ new agent instead.)

Agents and actions can be **✦ new agent** (a fresh thread) or **↳ same agent as previous step** (a follow-up turn on the thread that did the previous step, keeping its context and checkout). Prompts can reference `{{item}}`, `{{item.field}}`, `{{prev}}` and `{{iteration}}`; if a prompt does not mention them, the item and the previous output are appended automatically.

Save is enabled once the workflow is valid; bubbles with a problem glow red and say what is missing.

## Running

Every saved workflow is a coloured bubble with a **▶ Start** button. Starting a run opens the run view: the same canvas, with each bubble showing whether that step is queued, running, done or failed, and lanes showing progress. Click a bubble to see its output, errors, and an **Open thread** link — every agent step is a real thread in the project's sidebar, titled `⟲ workflow · step · item`, so you can watch or intervene as usual.

Runs list under **In progress**, **Review**, **Stuck** (failed or stopped, with the reason) and **Done**. Each bubble shows how far the current pass got, what the agents are doing right now, and the actions for its state: **Pause** (agents already working finish, nothing new starts) and **Resume**, **Stop** (interrupts every running agent), **Approve** / **Reject** for a review, **Restart** for a stuck run, and **View** to open the run. A run only advances while the app is open; agents keep working on the server in the meantime and the run picks up where it left off when you come back.

## Tasks: your threads, tracked here too

The same panel tracks the project's own threads as **tasks**, so what the main chats and their agents are doing sits next to the workflow runs. A task is not saved anywhere — it is a live view of a thread: **In progress** while its turn works (with the provider's current plan step and an "agents working" tag when subagents are busy), **Review** when it needs your approval, an answer, or has a plan ready to implement, **Stuck** when it was stopped or errored, and **Done** for a day after it finished. **Stop** interrupts the turn, **Resume** sends "Continue where you left off" on the same thread, and **Open** jumps to it. Threads a workflow started are not listed as tasks; their run already tracks them.

## Loops

Turn on **Loop** in the Start step to run Ralph-style: after the Report, the workflow starts over with fresh agents until the first list step returns nothing, a check passes, or the maximum number of iterations is reached — with an optional pause between iterations. _Whole backlog sweep_ is exactly this: triage ten tickets, then ten more, until the backlog is empty.

## Good to know

- Workflows are stored on this device for now; a run needs a web or desktop client open to move from one step to the next.
- Structured hand-off works by asking the agent to end its reply with a fenced ` ```json ` block. If a step is set to return a list or object and the agent does not, the run stops there and tells you why.
- Scheduling is not available yet — runs start when you press Start.
