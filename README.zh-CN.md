# my-dsh-modify

[English](https://github.com/AkagiYui/my-dsh-modify/blob/main/README.md) | 简体中文

DeepSeek Harness（DSH）的 Web UI 插件集合，集中在一个仓库里维护。

这里的每个包都是一个 **Cordis bundle**：`package.json` 里声明 `dsh.bundle.patch`
（一段插入插件行的 YAML patch）；如果是界面功能，还会有 `dsh.client` 半部分，
它的 factory 以**等于包名的 id** 注册进浏览器的 `window.__ModuleLoader__`。

## 包含的包

| 包 | 作用 |
| --- | --- |
| [`@akagiyui/ui-tweaks`](packages/ui-tweaks/README.zh-CN.md) | 一个插件五个开关：对话内容宽度、侧边栏账号显示、隐藏反馈入口、隐藏侧边栏「更多」、跳过完全权限确认 |
| [`@akagiyui/balance-chip`](packages/balance-chip/README.zh-CN.md) | 在输入框旁显示余额、今日已用与峰谷时段，并给出每轮对话的花费 |
| [`@akagiyui/copy-reply-image`](packages/copy-reply-image/README.zh-CN.md) | 把 AI 回复渲染成 PNG 卡片并复制到剪贴板 |

`ui-tweaks` 吸收了原本四个独立的单功能包（内容宽度、侧边栏账号显示、隐藏反馈、
隐藏「更多」）。它们现在是这个插件里的开关，不再是单独的包，因此不存在
「装两遍会重复生效」的问题。

## 安装

DSH 按包名安装 bundle。直接让 agent 装，或者自己调用工具：

```text
plugin_manager   action: install_bundle   target: "@akagiyui/ui-tweaks"
```

每个包都声明了 `engines.dsh`，所以和它未验证过的 Harness 版本会被拒绝安装，
而不是半加载着跑。

## 兼容性

所有包都针对 **DeepSeek Harness 0.2.1-rc.5** 构建和验证，并声明
`engines.dsh: >=0.2.1-rc.5`。

这些功能大多存在的原因是：DSH 外壳自己渲染了某些元素，而它没有提供可以注销的
slot。所以它们作用于渲染后的标记：`data-*` 属性、CSS 自定义属性、slot 选择器，
以及——对于数据驱动的菜单行——用 `MutationObserver` 匹配本地化文案。这是扩展
API 未覆盖全部界面时诚实的取舍：一次改名或新增翻译就可能让某个开关失效，而且是
**静悄悄地失效**（开关还在，只是不再起作用）。每个包的 README 都写明了它依赖
哪些钩子。

三个包都刻意停在 `0.x`：它们依附的表面还在变动，所以请把任何一次版本升级都视为
可能改变行为；如果你在意稳定性，就锁精确版本。

## 目录结构

```text
packages/<name>/
  package.json        manifest：name、dsh.bundle、dsh.client、files、engines
  cordis.patch.yml    bundle patch：插入一行，名字与包名一致
  index.js            Host 半部分（纯界面 bundle 这里是空的 apply）
  client.js           Client 半部分：window.__ModuleLoader__.load({ id, factory })
  locale/{en,zh}.json plugin manager 显示的 meta.title / meta.description
  icon.svg            插件行图标（<= 256 KiB）
  README.md           文档；README.zh-CN.md 是中文版（npm 会自动一起打包，
                      但页面只渲染 README.md）
copy-reply-image 另外保留 src/ 和 build.mjs：它的 client.js 是生成出来的。
```

## 为什么放在一个仓库

三个包共用一套 patch 方言、一套 locale 约定、一份展示清单和同一个兼容目标。
放在一起意味着 DSH 接口一旦变动，改一次提交就能覆盖全部；下面的校验也能一次
跑完所有包。它们仍然是三个独立的包而不是合成一个，因为有人可能只想要余额条、
不想要界面微调。发布依然逐个包进行，每个 manifest 都带 `repository.directory`，
所以 npm 页面会直接链接到对应的子目录。

## 开发

```bash
npm run check      # 校验 manifest、patch 行、client factory id、locale、图标、exports、语法
npm run build      # 从 src/ 重新生成 packages/copy-reply-image/client.js
npm run pack:dry   # 预览每个包实际会打出的 tarball
```

最重要的是 `npm run check`。它抓的是**静默失败**：改名时漏掉 `cordis.patch.yml`，
包能装上，但插入的插件行指向一个不存在的包；漏掉 client factory 的 `id`，包也能
加载，但界面永远不会注册——因为 DSH 是按包名解析浏览器端那半部分的。

GitHub Actions 在每次 push 和 PR 时跑同样的命令（[`ci.yml`](.github/workflows/ci.yml)），
并额外检查生成的 `client.js` 是否仍与 `src/` 一致。推送形如
`<包名>@<版本>` 的 tag 会发布该包（[`publish.yml`](.github/workflows/publish.yml)）。

## 发布

见 [PUBLISHING.md](https://github.com/AkagiYui/my-dsh-modify/blob/main/PUBLISHING.md)。
简版：`npm login`，然后进入包目录执行 `npm publish`（scoped 包需要
`--access public`，`publishConfig` 已经写好了）。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
