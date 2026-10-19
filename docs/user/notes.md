# Notes

Notes are a place for meeting notes, priorities and to-do lists that live alongside your threads. They belong to the server you are connected to, not to a project or a thread, so the same list shows wherever you open it, and it is still there after a restart.

## Opening the tab

Open any thread, press **+** in the right panel and choose **Notes** (or press `N` when the panel is empty). **Show notes** in the command palette does the same. The right panel's tabs, their order and the selected tab are the same in every thread, so Notes stays where you left it as you move between threads.

## Writing a note

Press **+** in the Notes header to start a note. Give it a title and write the body in the editor: the toolbar adds bullets, numbered lists, checklists, headings, bold, code and quotes, and typing `- `, `1. ` or `- [ ] ` at the start of a line does the same. Press **Save** (or `mod+enter`) to add it to the list. A note you are still typing keeps its draft if you switch tabs and come back.

Notes are stored as markdown. Open one to read it rendered; ticking a checkbox saves the change straight away, and tapping anywhere else in the body opens the editor. The **⋯** menu offers **Edit**, **Category**, **Copy contents** (as markdown), **Continue with agent** and **Delete**.

## Sorting notes into categories

Right-click a note in the list (or open its **⋯** menu) and choose **Category** to file it. The submenu lists your categories with a search box; pick one, choose **No category** to unfile the note, or use **Create category…** at the bottom to make a new one with a name and a colour. Once a category exists, the list groups notes under collapsible headings and tints each note with its category's colour. Collapse a heading to tuck that group away; it stays collapsed after a reload. Right-click a heading to rename it, change its colour, or delete the category. Deleting a category keeps its notes, which move back to **Uncategorised**.

## Letting an agent write a note

Press the sparkle button in the Notes header, say what you want researched or written up, and press **Draft note**. An agent runs on its own thread in the current project (or in **No project** when the thread has none) and saves the result as a note; it appears in the list as soon as it is written, marked **Agent**. **Open thread** shows the agent at work, and **Continue with agent** on an existing note asks an agent to extend it.

Agents in any thread can also read and write notes themselves through the `t3_note_list`, `t3_note_read`, `t3_note_create` and `t3_note_update` tools, so you can ask one to "save that as a note" mid-conversation. The list tool returns your categories too, so an agent can file a note under one you already have.
