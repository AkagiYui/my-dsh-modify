# 界面微调

[English](https://github.com/AkagiYui/my-dsh-modify/blob/main/packages/ui-tweaks/README.md) | 简体中文

DeepSeek Harness Web UI 的五个独立开关，全部位于 **设置 → 通用**。属于
[my-dsh-modify](https://github.com/AkagiYui/my-dsh-modify) 项目。

| 开关 | 作用 |
| --- | --- |
| 对话内容宽度 | 默认宽度，或铺满窗口的宽屏布局 |
| 侧边栏账号 | 保留原名、只显示头像，或显示你自己输入的标签 |
| 隐藏反馈入口 | 回复评分、账号菜单与「更多」菜单里的反馈行、输入框 `+` 菜单项，以及 `/feedback` 命令本身 |
| 隐藏侧边栏「更多」 | 去掉打开全局面板菜单的那一行 |
| 跳过完全权限确认 | 确认「完全权限」时不再经过两步弹窗 |

## 安装

DSH 按包名安装 bundle。直接让 agent 装，或者自己调用工具：

```text
plugin_manager   action: install_bundle   target: "@akagiyui/ui-tweaks"
```

安装前会校验 `engines.dsh`：超出 `>=0.2.1-rc.5` 的 Harness 会被拒绝，而不是加载
一个没验证过的插件。

## 打开之前值得知道的行为

- **完全权限弹窗是一个真实的安全提示。** 这个开关并没有授予 Harness 本来不会授予的
  权限——它只是在同一帧里，替你点击了你刚创建的工具行上已经出现的那次确认。但它的
  代价是：把文件访问策略改成不受限制时，不再有任何警告。想要那个警告，就别开它。
- **隐藏反馈同时会停用一个 Host bundle。** 评分按钮和菜单行是用作用域内的样式表藏掉
  的，但 `/feedback` 命令是通过 plugin manager 的 remote 停用
  `include:command-feedback` 这一行来移除的，所以它是真的从命令目录里消失，而不是
  只是没被画出来。关掉这个开关会恢复它停用的那一行；记录保存在 `localStorage` 的
  `dsh.ui-tweaks.feedback-command-managed` 键下。
- **只用一个存储键。** 五个开关都存放在 `dsh.ui-tweaks` 里。首次运行时，会把早期
  单功能包写下的偏好（`dsh.conversation-content-width`、`dsh.sidebar-account-display`，
  作为 `localStorage` 键保留）导入一次，所以已有的设置能延续过来。

## 兼容性

针对 **DeepSeek Harness 0.2.1-rc.5** 构建并验证。

每个开关都是对着外壳渲染出的标记实现的：CSS 自定义属性、`data-*` 属性、slot 选择器，
以及——对那两行菜单——一个匹配本地化文案的 `MutationObserver`。「隐藏『更多』那一行」
没有受支持的 slot 可用，所以才用样式表。DSH 某次发版改掉这些钩子名或更新了翻译，
就可能让某个开关失效；表现形式是那个开关什么也不做，而不是崩溃。

## 许可证

MIT
