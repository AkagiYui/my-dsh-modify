# Interface tweaks

Five independent interface switches for the DeepSeek Harness Web UI, all in
**Settings → General**. Part of [my-dsh-modify](../../README.md).

| Switch | What it changes |
| --- | --- |
| Conversation content width | Default width, or a widescreen layout that fills the window |
| Sidebar account | The shipped name, the avatar alone, or a label you type |
| Hide feedback entries | Reply ratings, the account and More menu rows, the composer `+` entry, and the `/feedback` command itself |
| Hide the sidebar "More" row | Removes the row that opens the global-panel menu |
| Skip the Full access risk dialog | Confirming "Full access" takes effect without the two-step modal |

## Install

DSH installs a bundle by package spec. Ask the agent, or call the tool directly:

```text
plugin_manager   action: install_bundle   target: "@akagiyui/ui-tweaks"
```

`engines.dsh` is checked before installation: a Harness outside `>=0.2.1-rc.5`
is refused rather than loading an untested plugin.

## Behaviour worth knowing before you turn it on

- **The Full access dialog is a real safety prompt.** The switch does not grant
  anything the Harness would not grant anyway — it clicks the confirmation that
  is already on screen, in the same frame, for a tool row you just created. But
  it does mean a policy change to unrestricted file access happens with no
  warning. Leave it off if you want that warning.
- **Hiding feedback also disables a Host bundle.** Ratings and menu rows are
  hidden with a scoped stylesheet, but the `/feedback` command is removed by
  disabling the shipped `include:command-feedback` row through the plugin
  manager remote, so it leaves the command catalog instead of merely not being
  drawn. Turning the switch off restores the row it disabled; the record is kept
  under the `dsh.ui-tweaks.feedback-command-managed` key in `localStorage`.
- **One storage key.** All five switches live in `dsh.ui-tweaks`. On first run
  the preferences written by the earlier single-purpose bundles
  (`dsh.conversation-content-width`, `dsh.sidebar-account-display`, kept as
  `localStorage` keys) are imported once, so an existing setup carries over.

## Compatibility

Built and verified against **DeepSeek Harness 0.2.1-rc.5**.

Every switch is implemented against the shell's rendered markup: CSS custom
properties, `data-*` attributes, slot selectors and, for the two menu rows, a
`MutationObserver` that matches localized labels. There is no supported slot for
"hide the More row", which is why a stylesheet is used. A Harness release that
renames those hooks or ships new translations can stop a switch from working;
that shows up as the switch doing nothing, not as a crash.

## License

MIT
