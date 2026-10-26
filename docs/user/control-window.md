# Control window

The Control window is a separate desktop window for keeping an eye on things while you work: your priority list of Linear tickets, your Slack messages, and btop showing what this machine is doing. Open the **Control** tab in the right panel and press **Open window**. The tab also shows this PC's CPU and memory, a place to add priorities, and the state of the Slack connection.

The window is desktop-only. On the web the Control tab still shows the Priorities and Slack blocks, so you can add tickets and connect Slack from anywhere.

## Priorities

The tall left panel is a list of the Linear tickets you have been asked to work on, most urgent first. Each card's border takes its priority colour. It uses the Linear API key and team key from **Settings → Integrations → Linear**. The list is kept on this device, not in Linear.

Add tickets from the **Priorities** block in the Control tab. Search by ticket number (`ENG-482`, or just `482` for your team) or by words in the title. Or paste a whole message, such as this week's priorities from your lead, and press **Find tickets**. T3 Code picks out ticket numbers, `#482`, and Linear links, then asks you to confirm the tickets before adding them. Numbers it could not find in Linear are listed so you can check them.

Each card has buttons to comment on the ticket, open its GitHub pull request when there is one, copy the ticket link, and copy its branch name. Click a card to read the whole ticket and its comments. A red dot means someone else has commented since you last opened it. The list refreshes from Linear every minute while the window is open.

The green check takes a ticket off the list. Tickets in QA, QA Approved or Done come off straight away; for any other status T3 Code asks first.

## Slack feed

The top middle panel lists every Slack message from the last five days in the channels, DMs and group DMs you are in, newest first. Your own messages are left out. Each item shows who sent it and where, with a note when it is a direct message or a reply in a thread. New messages appear as soon as they are posted.

Click an item to read the whole message, and press **Back** to return to the list. **Reply** answers the way Slack's own Reply does: a message in a channel gets a reply in its thread, a reply in a thread stays in that thread, and a direct message is answered in the conversation. Press `Enter` to send and `Shift+Enter` for a new line. **Open in Slack** jumps to the message in Slack.

To hide a busy channel, such as one where an app like Linear or GitHub posts updates, open the **⋯** menu on one of its messages and choose **Mute**. Muted channels are listed in the Control tab and in **Settings → Integrations → Slack**; press **×** beside one to bring it back.

**Refetch** in the Control tab reconnects to Slack and loads the last five days again.

### Connecting Slack

T3 Code reads Slack through a small app that you create in your own workspace. It is free, and only you can use it.

1. In the Control tab, or in **Settings → Integrations → Slack**, copy the app manifest, then [create a Slack app](https://api.slack.com/apps?new_app=1) **From a manifest** and paste it.
2. Under **OAuth & Permissions**, press **Install to Workspace**, approve, and copy the **User OAuth Token** (it starts with `xoxp-`). T3 Code reads messages and sends replies as you with this token.
3. Under **Basic Information → App-Level Tokens**, generate a token with the `connections:write` scope (it starts with `xapp-`). This token opens the live stream of new messages, so no public URL is needed.
4. Paste both tokens and press **Save**.

The tokens are stored on the server that T3 Code is connected to, never in the browser. T3 Code only talks to Slack while the Control tab or the Control window is open. **Disconnect** in the Slack settings removes both tokens.
