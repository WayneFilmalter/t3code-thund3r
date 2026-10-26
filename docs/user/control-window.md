# Control window

The Control window is a separate desktop window for keeping an eye on things while you work: your priority list of Linear tickets and tasks, your Slack messages, workflows you can start with one press, and btop showing what this machine is doing. Open the **Control** tab in the right panel and press **Open window**. The tab also shows this PC's CPU and memory, places to add priorities and tasks, and the state of the Slack connection.

The window is desktop-only. On the web the Control tab still shows the Priorities, Tasks and Slack blocks, so you can add tickets and tasks and connect Slack from anywhere.

## Priorities

The tall left panel is a list of the Linear tickets you have been asked to work on, most urgent first. Each card's border takes its priority colour. It uses the Linear API key and team key from **Settings → Integrations → Linear**. The list is kept on the server T3 Code is connected to, not in Linear, so every window and device sees the same list.

Add tickets from the **Priorities** block in the Control tab. Search by ticket number (`ENG-482`, or just `482` for your team) or by words in the title. Or paste a whole message, such as this week's priorities from your lead, and press **Find tickets**. T3 Code picks out ticket numbers, `#482`, and Linear links, then asks you to confirm the tickets before adding them. Numbers it could not find in Linear are listed so you can check them.

Each card has buttons to comment on the ticket, open its GitHub pull request when there is one, copy the ticket link, and copy its branch name. Click a card to read the whole ticket and its comments. A red dot means someone else has commented since you last opened it. The list refreshes from Linear every minute while the window is open.

The green check takes a ticket off the list. Tickets in QA, QA Approved or Done come off straight away; for any other status T3 Code asks first.

### Tasks

Not everything has a Linear ticket. Add a task from the **Tasks** block in the Control tab: a title, an optional description and a priority. Tasks don't need a Linear key. They sit among the tickets by priority, with a purple border, a number such as `T-12`, and how long ago they were added. The green check takes a task off straight away, and **Undo** in the message that follows brings it back.

### Priorities from Slack

Once Slack is connected, anyone in your workspace can look at and change the list with slash commands:

- `/priorities` lists the tickets, most urgent first.
- `/add-priority ENG-482 #490` adds tickets. It reads ticket numbers, `#482`, bare numbers and Linear links, just like pasting into the Control tab.
- `/remove-priority ENG-482` takes tickets off.
- `/get-tasks` lists the tasks, most urgent first, with how long ago each was added.
- `/add-task high: Fix login | Users can't sign in on Safari` adds a task. The priority (`urgent:`, `high:`, `medium:` or `low:`) is optional and defaults to medium. The text after `|`, or on the lines after the first, is the description.
- `/remove-task T-12` takes a task off. Just `12` works too.

Only the person who ran the command sees the answer. Changes show up in the Priorities panel straight away. Slash commands only work while T3 Code's server is running; one sent while it is off fails and is not kept.

Requests posted as messages in a `#priorities` channel are never lost. Start a message with `add`, `remove` or `list`, such as `add ENG-482 #490`, or with `add-task`, `remove-task` or `get-tasks` for tasks. Other messages in the channel are ignored. Thund3rBot answers in the message's thread. If T3 Code was off, it handles everything posted since it last ran as soon as it starts again, and answers each one then.

For `#priorities` to work:

- Create a channel named `priorities` and join it yourself; T3 Code reads it through your account.
- Paste the **Bot User OAuth Token** (it starts with `xoxb-`) into the Slack settings so the answers come from Thund3rBot. Without it they are posted as you. In a private channel, also invite Thund3rBot.

If you connected Slack before these features existed, copy the app manifest again, paste it over the old one under **App Manifest** on your Slack app's page, then reinstall the app to your workspace so it gets the new permissions.

## Workflows

The bottom middle panel holds prompts you run over and over, such as "triage ten backlog tickets". Press **New**, give the workflow a title and a prompt, and save. The project, model, checkout and permissions are filled in for you; change them in the same dialog if you need to.

Press the big **▶** on a workflow to run it. Each run starts a new thread in the workflow's project, so you can watch it or step in as usual; click the workflow to open its latest thread in the main window. The dropdown beside **▶** picks when: **Now**, or a timer of 5 minutes up to 8 hours that counts from the moment you press **▶**.

While it works, the workflow shows how long it has been running and a line of what the agent is doing or saying, and **▶** becomes **■**, which stops the agent. A set timer shows when the workflow will run, and **✕** cancels it. Each workflow also shows when it last ran and how that run ended.

Workflows are scheduled tasks that only run when you start them, so they also appear under **Settings → Scheduled tasks** as **On demand**. Give one a schedule there to run it at a set time or interval as well; scheduled tasks also appear in this panel. **⋯** on a workflow edits, pauses or deletes it. A paused workflow can still run now, but not on a timer.

## Slack feed

The top middle panel lists every Slack message from the last five days in the channels, DMs and group DMs you are in, newest first. Your own messages are left out. Each item shows who sent it and where, with a note when it is a direct message or a reply in a thread. New messages appear as soon as they are posted.

Click an item to read the whole message, and press **Back** to return to the list. **Reply** answers the way Slack's own Reply does: a message in a channel gets a reply in its thread, a reply in a thread stays in that thread, and a direct message is answered in the conversation. Press `Enter` to send and `Shift+Enter` for a new line. **Open in Slack** jumps to the message in Slack.

To hide a busy channel, such as one where an app like Linear or GitHub posts updates, press **Channels** at the top of the feed (or look under **Slack** in the Control tab) and switch it off. The list shows the busiest channels first. Switch a channel back on to see its messages again. You can also mute a channel from the **⋯** menu on any of its messages, and unmute from **Settings → Integrations → Slack**.

**Refetch** in the Control tab reconnects to Slack and loads the last five days again.

### Connecting Slack

T3 Code reads Slack through a small app that you create in your own workspace. It is free, and only you can use it.

1. In the Control tab, or in **Settings → Integrations → Slack**, copy the app manifest, then [create a Slack app](https://api.slack.com/apps?new_app=1) **From a manifest** and paste it.
2. Under **OAuth & Permissions**, press **Install to Workspace**, approve, and copy the **User OAuth Token** (it starts with `xoxp-`). T3 Code reads messages and sends replies as you with this token.
3. Under **Basic Information → App-Level Tokens**, generate a token with the `connections:write` scope (it starts with `xapp-`). This token opens the live stream of new messages, so no public URL is needed.
4. Paste both tokens and press **Save**.

The tokens are stored on the server that T3 Code is connected to, never in the browser. While Slack is connected, the server stays connected to Slack so the slash commands keep working. **Disconnect** in the Slack settings removes both tokens.
