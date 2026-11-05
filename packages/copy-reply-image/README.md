# Copy reply as image

English | [简体中文](https://github.com/AkagiYui/my-dsh-modify/blob/main/packages/copy-reply-image/README.zh-CN.md)

Adds **Copy as image** after the branch button of every finalized AI reply: the
reply is rendered as a PNG card and written to the clipboard. Part of
[my-dsh-modify](https://github.com/AkagiYui/my-dsh-modify).

## Install

```text
plugin_manager   action: install_bundle   target: "@akagiyui/copy-reply-image"
```

## How the image is made

There is no browser API that turns a node into a PNG, so the plugin takes the
standard route: clone the reply, freeze its computed styles into inline styles,
embed the clone in an SVG `foreignObject`, draw that on a canvas, and read the
canvas back.

Because the source is the **live rendered row**, the image is the reply as the
Chat drew it — the host's typography, colors, spacing, syntax highlighting,
tables and inline math — not a second Markdown implementation that drifts from
the real thing.

When a capture is impossible (a detached row, an image the sandbox refuses, a
tainted canvas, a card above the size limit) the action throws and the caller
paints a standalone card instead, so the button still produces something.

## Limits

- A reply is captured as one card; very long replies are scaled or capped.
- Images loaded from another origin can taint the canvas; those fall back.
- Clipboard writes need a local page gesture, which a button click is.

## Development

`client.js` is **generated**. Edit the sources and rebuild:

```bash
node build.mjs     # src/capture.js + src/renderer.js + src/ui.js -> client.js
```

The build wraps the three self-contained ES modules in the
`window.__ModuleLoader__.load({ id, factory })` envelope the Web UI expects,
stripping their `export` keywords. Editor changes to `client.js` are lost on the
next build; `src/` stays out of the npm tarball on purpose, so the published
package ships only the artifact.

## Compatibility

Built and verified against **DeepSeek Harness 0.2.1-rc.5**. The action is
registered into `conversation.chat.assistant-actions`; the capture walks the
Chat's rendered markup, so a large restyle can change what the card looks like.

## License

MIT
