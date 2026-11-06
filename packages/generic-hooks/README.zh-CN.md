# 通用钩子

[English](https://github.com/AkagiYui/my-dsh-modify/blob/main/packages/generic-hooks/README.md) | 简体中文

给 DeepSeek Harness 用的生命周期钩子，中间不经过任何其他 harness 的方言：
选一个 DSH 自己的事件，绑定一条命令，事件发生时命令就会运行。属于
[my-dsh-modify](https://github.com/AkagiYui/my-dsh-modify)。

和兼容桥不同，这里没有任何 Claude Code / Codex 配置的翻译。事件列表就是
DSH 的事件目录，载荷是一小段 JSON，每种事件的拦截语义分别写明。

## 安装

```text
plugin_manager   action: install_bundle   target: "dsh-generic-hooks"
```

然后打开 设置 → 插件 → **生命周期钩子**：这个 bundle 的页面里有列表、编辑器
和每个钩子的最近一次运行。

## 事件

| 事件 | 运行时机 | 拦截时的含义 |
|---|---|---|
| `PreToolUse`（`tools/pre-execute`） | 工具调用之前 | 拒绝该调用，stderr 作为模型可见原因 |
| `PostToolUse`（`tools/post-execute`） | 工具返回之后 | 用 stderr 作为反馈替换结果 |
| `UserPromptSubmit`（`agent/pre-step`） | 提示词到达 agent 时 | 在模型运行前丢弃这条提示词 |
| `SessionStart`（`agent/created`） | agent 创建时 | 只观察 |
| `Stop`（`agent/turn-stopping`） | 轮次即将结束时 | 只观察 |
| `SubagentStart`（`subagent/start`） | 子智能体开始时 | 只观察 |
| `SubagentEnd`（`subagent/end`） | 子智能体结束时 | 只观察 |
| `AgentError`（`agent/error`） | 步骤或轮次出错时 | 只观察 |
| `SessionCreated`（`session/created`） | 会话进入存储时 | 只观察 |

工具事件支持匹配器：留空或 `*` 匹配所有工具，`a|b` 列出多个候选。每一段先按
字面匹配工具名；只有含正则符号（`.` `*` `^` `$` 等）时才按正则解释——所以
`edit` 不会再误伤 `str_replace_editor`，而 `web_.*` 仍能同时命中两个 web 工具。

## 执行方式

每个钩子可以按 **Shell 命令**（默认）或 **进程** 运行。

| 执行方式 | 字段 | 运行的是 |
|---|---|---|
| Shell 命令 | `command` | 会话 shell：管道、重定向、`$VAR`、glob 都可用 |
| 进程 | `command` + `args[]` | 直接以 argv 启动可执行文件，一行一个参数 |

进程方式完全跳过 shell：参数按字面传递、不做变量展开、退出码原样保留。最后一点
在 Windows 上尤其重要——`pwsh -Command` 会把 `exit 2` 折成 `1`，否则一个本该
拦截的钩子会退化成警告。

两种方式都从 stdin 收到 JSON 载荷，也都使用下面的退出码判定。

## 载荷

每条命令都会从 stdin 收到一个 JSON 对象：

```json
{
  "hook_event": "PreToolUse",
  "session_id": "session-…",
  "cwd": "/path/to/workspace",
  "tool_name": "bash",
  "tool_input": { "command": "ls" }
}
```

`PostToolUse` 额外带 `tool_response` 与 `is_error`，`UserPromptSubmit` 带
`prompt` 与 `turn`，`SessionStart` 带 `source`，子智能体事件带 `run_id` /
`provider` / `local`。

## 判定

| 退出码 / stdout | 效果 |
|---|---|
| `2` | 拦截；stderr（为空时用 stdout）作为原因 |
| `0` + `{"decision":"deny","reason":"…"}` | 带原因拦截 |
| `0` + `{"decision":"ask","reason":"…"}` | 请求批准（工具事件） |
| `0` + 其他输出 | 不参与决策，只记录已运行 |
| 其他退出码、超时、崩溃 | 记录，但从不拦截 |

`ask` 不会预先批准任何东西，只是把调用交回正常的审批路径。钩子在会话工作目录
下通过 harness 的 shell 执行，因此和普通 shell 工作一样受超时与会话沙箱约束。

## 限制

- 列表是进程级的，不按项目或会话区分：同一份钩子作用于本进程的所有会话。
- 观察类事件脱离运行：不会拖慢轮次，慢钩子可能在下一个事件到达时仍在跑。
- 除了上面的判定，钩子输出不会进入对话；最近一次运行只在 bundle 页面上可见。
