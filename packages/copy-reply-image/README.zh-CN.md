# 回复复制为图片

[English](https://github.com/AkagiYui/my-dsh-modify/blob/main/packages/copy-reply-image/README.md) | 简体中文

在每条已完成的 AI 回复的分支按钮之后增加一个**复制为图片**按钮：把该回复渲染成
一张 PNG 卡片并写入剪贴板。属于 [my-dsh-modify](https://github.com/AkagiYui/my-dsh-modify)
项目。

## 安装

```text
plugin_manager   action: install_bundle   target: "dsh-copy-reply-image"
```

## 图片是怎么生成的

浏览器没有「把节点变成 PNG」的 API，所以走的是标准路径：克隆回复节点，把计算样式
冻结成内联样式，把克隆体嵌进一个 SVG `foreignObject`，再画到 canvas 上读回结果。

因为源数据是**已经渲染出来的那一行**，图片就是 Chat 画出来的样子——宿主的字体、
配色、间距、语法高亮、表格、行内公式——而不是另写一套 Markdown 渲染、慢慢和真实
效果跑偏。

当捕获不可能完成时（节点已被卸载、图片被沙箱拒绝、canvas 被污染、卡片超出尺寸
上限），这个动作会抛错，由调用方画一张独立卡片兜底，所以按钮依然会产出东西。

## 限制

- 一条回复捕获成一张卡片；非常长的回复会被缩放或截断。
- 跨域加载的图片会污染 canvas，这些情况走兜底。
- 写剪贴板需要本地的用户手势，按钮点击满足这一点。

## 开发

`client.js` 是**生成产物**。改源码，然后重新构建：

```bash
node build.mjs     # src/capture.js + src/renderer.js + src/ui.js -> client.js
```

构建脚本把三个自包含的 ES 模块包进 Web UI 期望的
`window.__ModuleLoader__.load({ id, factory })` 外壳，并剥掉它们的 `export`
关键字。直接编辑 `client.js` 会在下次构建时丢失；`src/` 有意不放进 npm 包，
所以发布出去的只有产物。

## 兼容性

针对 **DeepSeek Harness 0.2.1-rc.5** 构建并验证。按钮注册在
`conversation.chat.assistant-actions`；捕获过程会遍历 Chat 渲染出的标记，所以
外壳大改样式会改变卡片的样子。

## 许可证

MIT
