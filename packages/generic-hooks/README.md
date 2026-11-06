# Generic hooks

English | [简体中文](https://github.com/AkagiYui/my-dsh-modify/blob/main/packages/generic-hooks/README.zh-CN.md)

Lifecycle hooks for the DeepSeek Harness with no other harness dialect in the
middle: pick one of DSH's own events, point it at a command, and the command
runs when that event happens. Part of
[my-dsh-modify](https://github.com/AkagiYui/my-dsh-modify).

Unlike a compatibility bridge, nothing here is translated from Claude Code or
Codex configuration. The event list is DSH's event catalog, the payload is a
small JSON object, and the decision mapping is stated per event.

## Install

```text
plugin_manager   action: install_bundle   target: "dsh-generic-hooks"
```

Then open Settings → Plugins → **Lifecycle hooks**: the bundle's page holds the
list, the editor, and the last run of every hook.

## Events

| Event | Runs | A blocking exit means |
|---|---|---|
| `PreToolUse` (`tools/pre-execute`) | before a tool call | deny the call; stderr is the model-visible reason |
| `PostToolUse` (`tools/post-execute`) | after a tool returns | replace the result with stderr as feedback |
| `UserPromptSubmit` (`agent/pre-step`) | a prompt reaches the agent | drop the prompt before the model runs |
| `SessionStart` (`agent/created`) | an agent is created | observation only |
| `Stop` (`agent/turn-stopping`) | a turn is about to close | observation only |
| `SubagentStart` (`subagent/start`) | a child agent starts | observation only |
| `SubagentEnd` (`subagent/end`) | a child agent settles | observation only |
| `AgentError` (`agent/error`) | a step or turn errored | observation only |
| `SessionCreated` (`session/created`) | a session enters the store | observation only |

Tool events take a matcher: blank or `*` matches every tool and `a|b` lists
alternatives. Each part matches the tool name literally unless it contains regex
syntax (`.` `*` `^` `$` …), in which case it is used as a regular expression — so
`edit` no longer quietly hits `str_replace_editor`, while `web_.*` still matches
both web tools.

## Runner

A hook runs as a **shell command** (the default) or as a **process**.

| Runner | Fields | Runs |
|---|---|---|
| Shell command | `command` | the session shell: pipes, redirects, `$VAR`, globs |
| Process | `command` + `args[]` | the executable directly with argv, one argument per line |

Process hooks skip the shell entirely: arguments are literal, environment
expansion does not happen, and the exit code survives intact. That last part
matters on Windows, where `pwsh -Command` collapses `exit 2` into `1` and would
otherwise turn a blocking hook into a warning.

Both runners get the JSON payload on stdin and both use the same exit-code
decisions below.

## Payload

Every command receives one JSON object on stdin:

```json
{
  "hook_event": "PreToolUse",
  "session_id": "session-…",
  "cwd": "/path/to/workspace",
  "tool_name": "bash",
  "tool_input": { "command": "ls" }
}
```

`tool_response` and `is_error` are added for `PostToolUse`, `prompt` and `turn`
for `UserPromptSubmit`, `source` for `SessionStart`, `run_id` / `provider` /
`local` for subagents.

## Decisions

| Exit / stdout | Effect |
|---|---|
| `2` | block; stderr (or stdout when stderr is empty) is the reason |
| `0` + `{"decision":"deny","reason":"…"}` | block with that reason |
| `0` + `{"decision":"ask","reason":"…"}` | ask for approval (tool events) |
| `0` + anything else | no decision; the hook only ran |
| other exit codes, timeouts, crashes | recorded, never blocking |

An `ask` does not pre-approve anything: it hands the call to the normal approval
path. Hooks run in the session working directory through the harness shell, so
they obey the same timeout and session sandbox as any other shell work.

## Limits

- The list is process-wide, not per project or per session. One hook set applies
  to every session this process serves.
- Observation events run detached: they never delay the turn, and a slow hook
  may still be running when the next event arrives.
- Hook output is not shown in the conversation except through the decisions
  above; the last run is visible on the bundle page.
