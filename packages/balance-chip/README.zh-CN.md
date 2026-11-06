# 余额条

[English](https://github.com/AkagiYui/my-dsh-modify/blob/main/packages/balance-chip/README.md) | 简体中文

在输入框工具行、侧边栏底部和每条回复旁显示 DeepSeek 余额、今日已用、峰谷时段
与单轮花费；三个位置可以分别关闭。属于
[my-dsh-modify](https://github.com/AkagiYui/my-dsh-modify) 项目。

四个入口：

1. **输入框停靠区** —— 紧跟在内置的上下文条目之后的一小条：余额、今日已用、峰/谷。
   默认开启，可单独关闭；点击打开详情面板。
2. **侧边栏底部** —— 位于设置行上方的第二个入口。侧栏展开时是一整行：余额、今日已用和
   峰谷倒计时；收成 56px 轨道时只剩一个紧凑金额和峰/谷圆点。它和输入框条共用同一次
   轮询与同一个详情面板；默认开启，三个位置各自有开关，互不影响。
3. **回复操作行** —— 这一轮对话的花费，就在回复的操作按钮旁。默认开启，可单独关闭；
   点击打开同一个面板，并显示该轮的 token 明细。
4. **浮层面板** —— 余额、今日已用、计价时段，以及每一轮的输入 / 缓存 / 输出 token。

## 显示开关

**设置 → 插件 → 余额条**，三个开关就在这个插件页面的配置区，不需要再点进
`balance-chip` 那一行：

- **输入框底部的余额条** —— 输入框卡片下方的那一条。
- **侧边栏底部的余额条** —— 侧边栏脚部的第二条。
- **每轮对话结束后的花费** —— 每条回复操作行旁的本轮花费。

三个都默认开启，互不影响。它们只是显示偏好，所以存在浏览器本地
（`localStorage["dsh-balance-chip.preferences"]`），不写账号配置。侧边栏本身
被隐藏时（macOS 桌面端折叠、窄屏抽屉）第二条自然不可见，收成轨道时只显示紧凑金额。

## 安装

```text
plugin_manager   action: install_bundle   target: "dsh-balance-chip"
```

## 数字从哪里来

| 数字 | 来源 |
| --- | --- |
| 余额 | Harness 凭据里的 `DEEPSEEK_API_KEY`，或者已登录的 DSH 账号 |
| 今日已用 | 一张观测账本：每次余额下降记为花费，每次上升记为充值并单独记录，因此充值永远不会抵消已经观测到的花费 |
| 单轮花费 | 该轮里的每条 assistant 消息，按各自的发生时刻、各自的模型单价计价 |
| 峰时判定 | 北京时间，工作日 09:00–12:00 与 14:00–18:00 |

账本位于 `$DSH_HOME/balance-chip/ledger.json`，采用原子写入；家目录不可写时只会
丢失「今日已用」这个数字，不会影响余额显示。

## 网络与隐私

Host 半部分会在本地 web server 上注册两个只读路由：

| 路由 | 返回 |
| --- | --- |
| `GET /balance-chip/state[?refresh=1]` | 余额、今日用量、时段 |
| `GET /balance-chip/models?session=<id>` | 该会话中每条回复背后的模型 |

两者都在 Harness 的连接防护之后，带 `Cache-Control: no-store`，并且在防护本身
不可用时返回 JSON 错误而不是 500。唯一的对外请求是用你的 key 访问
`https://api.deepseek.com/user/balance`，key 不会离开 Host 进程——它不会被发送到
浏览器。

## 精度

花费是**估算**：按 2026-09-10 的标价（人民币／百万 token），8 位定点数计算，
包含周末与节假日的谷时价格。折扣、赠送额度、按账号定价都没有建模，所以单轮数字
可能和你的账单有出入。余额和今日已用直接读账号，在轮询间隔（30 秒缓存）内是准确的。

## 兼容性

针对 **DeepSeek Harness 0.2.1-rc.5** 构建并验证。它依赖 `credentials`、
`deepseekAccount`、`webServer` 和 `connection` 这几个服务，以及 `session/event`
里携带模型名；如果 Harness 改了其中任何一个，界面还在渲染，但数据链路会断。
侧边栏条还依赖 `sidebar.footer.action` 与 `settings.general.item` 两个插槽；
如果某个 Harness 版本没有声明它们，这两处注册不会生效，输入框条仍然正常。

## 许可证

MIT
