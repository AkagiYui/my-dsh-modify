//#region Locale

/** Dictionary namespace owned by this plugin. */
const NS = 'copy-reply-image';

const zh = {
  title: '复制为图片',
  busy: '正在生成图片…',
  copied: '图片已复制',
  saved: '剪贴板不可用，图片已下载',
  failed: '复制失败，请重试',
  'card.footer': '由 DeepSeek Harness 生成',
  'card.notice': 'AI 生成内容，仅供参考',
  'card.truncated': '内容过长，已截断',
};

const en = {
  title: 'Copy as image',
  busy: 'Rendering image…',
  copied: 'Image copied',
  saved: 'Clipboard unavailable — image downloaded',
  failed: 'Could not copy the image',
  'card.footer': 'Generated with DeepSeek Harness',
  'card.notice': 'AI-generated content for reference only',
  'card.truncated': 'Reply truncated for length',
};

//#endregion

//#region Styles

const STYLE_ID = 'dsh-copy-reply-image/actions.css';

/**
 * The button copies the host's 28px action metrics and the tooltip copies the
 * host Tooltip primitive's bubble (same padding, radius, colors, type scale,
 * gap and fade). `conversation.chat.assistant-actions` renders its entries
 * between the shipped Copy and Branch buttons, so `order` moves this entry past
 * Branch, and the trailing usage/time cell is pushed one step further so the
 * button sits directly after Branch and before the usage readout.
 */
const CSS = [
  '.dsh-cri{position:relative;display:inline-flex;order:1}',
  '[data-clock="end"] > span:last-child{order:2}',
  '.dsh-cri_button{box-sizing:border-box;width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));padding:6px;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background-color 80ms,color 80ms}',
  '.dsh-cri_button svg{width:calc(17px + var(--dsh-content-font-delta,0px));height:calc(17px + var(--dsh-content-font-delta,0px));display:block}',
  '.dsh-cri_button:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-secondary)}',
  '.dsh-cri_button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
  '.dsh-cri_button:disabled{cursor:default;background:transparent}',
  '.dsh-cri[data-state="busy"] .dsh-cri_button{opacity:.55}',
  '.dsh-cri[data-state="copied"] .dsh-cri_button,.dsh-cri[data-state="saved"] .dsh-cri_button{color:var(--dsw-alias-state-success-primary)}',
  '.dsh-cri[data-state="failed"] .dsh-cri_button{color:var(--dsw-alias-state-error-primary)}',
  '@keyframes dsh-cri-spin{to{transform:rotate(360deg)}}',
  '.dsh-cri_spinner{transform-origin:50% 50%;animation:dsh-cri-spin .9s linear infinite}',
  '.dsh-cri_tip{display:inline-flex;align-items:safe center;gap:8px;position:fixed;z-index:100;width:max-content;box-sizing:border-box;max-width:min(50vw,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;padding:3px 7px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-tooltip-bg,#3b3b46);color:var(--dsw-static-neutral-bluish-00,#ffffff);font-family:inherit;font-size:13px;line-height:20px;white-space:pre-line;overflow-wrap:break-word;pointer-events:none;transform:translate(-50%);animation:dsh-cri-tip-in .15s var(--ds-ease-in-out,ease-out)}',
  '.dsh-cri_tip[data-side="top"]{transform:translate(-50%,-100%)}',
  '@keyframes dsh-cri-tip-in{0%{opacity:0}}',
].join('');

//#endregion

//#region Reply source

/** Concatenate the visible prose of one Assistant message; the card fallback needs it. */
function replyMarkdown(blocks) {
  const parts = [];
  for (const block of blocks ?? []) {
    if (block?.kind !== 'text' || typeof block.text !== 'string') continue;
    if (block.text.trim() === '') continue;
    parts.push(block.text);
  }
  return parts.join('\n\n').trim();
}

/**
 * The slot owner passes only the durable message id, so the Chat snapshot that
 * rendered the row locates the message: its text feeds the card fallback, and
 * its node key addresses the node's rendered DOM.
 */
function findReplyNode(snapshot, messageId) {
  for (const key of snapshot.order) {
    const node = snapshot.nodes.get(key);
    if (node === undefined || node.kind !== 'assistant-step') continue;
    if (node.data?.finalNode?.messageId !== messageId) continue;
    return node;
  }
  return undefined;
}

/**
 * The rendered reply lives in the node's Chat flow item, which is the element
 * the browser laid out for this message. A grouped Assistant can expose one
 * item per group part; the response part is the one to capture.
 */
function findReplyElement(nodeKey) {
  if (typeof nodeKey !== 'string' || nodeKey === '') return null;
  const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(nodeKey)
    : nodeKey.replace(/["\\]/g, '\\$&');
  const candidates = document.querySelectorAll(
    '[data-chat-node-key="' + escaped + '"][data-chat-flow-kind="assistant-step"]',
  );
  let match = null;
  for (const candidate of candidates) {
    if (!(candidate instanceof HTMLElement)) continue;
    if (candidate.getAttribute('data-chat-group-part') === 'reasoning') continue;
    if (candidate.hidden) continue;
    match = candidate;
  }
  return match;
}

//#endregion

//#region Delivery

/** Write a PNG to the target `blob` promise resolves to, keeping the click's user activation. */
function writeImageClipboard(blob) {
  const clipboard = navigator.clipboard;
  if (typeof ClipboardItem === 'undefined' || clipboard === undefined || typeof clipboard.write !== 'function') {
    return Promise.reject(new Error('CLIPBOARD_UNAVAILABLE'));
  }
  return clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/** Fallback when the clipboard refuses the write; the browser owns the file after this call. */
function downloadPng(blob) {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const name = `deepseek-reply-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

//#endregion

//#region Icons

function icon(children) {
  return h('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  }, children);
}

function imageIcon() {
  return icon([
    h('rect', { key: 'frame', x: 3, y: 4, width: 18, height: 16, rx: 4 }),
    h('circle', { key: 'sun', cx: 8.6, cy: 9.6, r: 1.5 }),
    h('path', { key: 'hill', d: 'M3.4 17.4l4.5-4.5a2 2 0 0 1 2.8 0l2 2' }),
    h('path', { key: 'ridge', d: 'M13.1 15.3l2.4-2.4a2 2 0 0 1 2.8 0l2.3 2.3' }),
  ]);
}

function checkIcon() {
  return icon(h('path', { d: 'M5 12.6l4.6 4.6L19 7.6' }));
}

function alertIcon() {
  return icon([
    h('circle', { key: 'ring', cx: 12, cy: 12, r: 8.6 }),
    h('path', { key: 'mark', d: 'M12 8v5' }),
    h('path', { key: 'dot', d: 'M12 16.4v.1' }),
  ]);
}

function spinnerIcon() {
  return h('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  }, [
    h('circle', { key: 'track', cx: 12, cy: 12, r: 8.4, strokeOpacity: 0.25 }),
    h('path', { key: 'arc', className: 'dsh-cri_spinner', d: 'M20.4 12A8.4 8.4 0 0 0 12 3.6', strokeLinecap: 'round' }),
  ]);
}

//#endregion

//#region Component

/**
 * One "copy as image" action in a finalized Assistant message's action row.
 * The click captures that message's rendered DOM (so the image is exactly what
 * the Chat laid out) and falls back to the standalone card only when the live
 * node cannot be captured.
 */
function CopyImageAction({ messageId, t, useChat }) {
  const node = useChat((snapshot) => findReplyNode(snapshot, messageId));
  const text = React.useMemo(
    () => (node === undefined ? '' : replyMarkdown(node.data?.blocks)),
    [node],
  );
  const [state, setState] = React.useState('idle');
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const [forced, setForced] = React.useState(false);
  const buttonRef = React.useRef(null);
  const tipRef = React.useRef(null);
  const stateTimer = React.useRef(null);
  const tipId = React.useId();

  React.useEffect(() => () => {
    if (stateTimer.current !== null) window.clearTimeout(stateTimer.current);
  }, []);

  const open = text !== '' && (hovered || focused || forced);

  // Position the fixed bubble against the button, mirroring the host Tooltip's
  // own placement: below with an 8px gap, flipped above when the viewport ends.
  React.useLayoutEffect(() => {
    if (!open || tipRef.current === null || buttonRef.current === null) return;
    const bubble = tipRef.current;
    const anchor = buttonRef.current.getBoundingClientRect();
    bubble.style.visibility = 'hidden';
    const width = bubble.offsetWidth;
    const height = bubble.offsetHeight;
    const half = width / 2;
    const center = anchor.left + anchor.width / 2;
    const left = Math.max(half + 12, Math.min(center, window.innerWidth - half - 12));
    let top = anchor.bottom + 8;
    let side = 'bottom';
    if (top + height > window.innerHeight - 12) {
      top = anchor.top - 8 - height;
      side = 'top';
    }
    bubble.dataset.side = side;
    bubble.style.left = `${Math.round(left)}px`;
    bubble.style.top = `${Math.round(Math.max(12, top))}px`;
    bubble.style.visibility = 'visible';
  }, [open, state]);

  // Dismissal mirrors the host Tooltip: Escape, Tab, an outside press, or a
  // scroll/resize that would leave the bubble stranded.
  React.useEffect(() => {
    if (!open) return undefined;
    const dismiss = () => {
      setHovered(false);
      setFocused(false);
      setForced(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape' || event.key === 'Tab') dismiss();
    };
    const onPointerDown = (event) => {
      if (tipRef.current !== null && event.target instanceof Node && tipRef.current.contains(event.target)) return;
      if (buttonRef.current !== null && event.target instanceof Node && buttonRef.current.contains(event.target)) return;
      dismiss();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [open]);

  const start = React.useCallback(() => {
    if (state === 'busy' || text === '') return;
    setState('busy');
    setForced(false);
    const settle = (next) => {
      setState(next);
      if (stateTimer.current !== null) window.clearTimeout(stateTimer.current);
      setForced(next === 'failed');
      stateTimer.current = window.setTimeout(() => {
        stateTimer.current = null;
        setForced(false);
        setState('idle');
      }, next === 'failed' ? 2600 : 1800);
    };
    // The ClipboardItem is created synchronously from a pending blob so the
    // write keeps the click's user activation while the image is produced.
    const blob = (async () => {
      const element = node === undefined ? null : findReplyElement(node.key);
      if (element !== null) {
        try {
          return (await captureRenderedReply(element, { padding: 28 })).blob;
        } catch (captureError) {
          console.warn('[copy-reply-image] rendered capture failed; using the card fallback:', captureError);
        }
      }
      const card = await renderReplyImage(text, {
        footer: t('card.footer'),
        notice: t('card.notice'),
        truncatedLabel: t('card.truncated'),
      });
      return card.blob;
    })();
    writeImageClipboard(blob).then(
      () => settle('copied'),
      (clipboardError) => {
        console.warn('[copy-reply-image] clipboard write failed:', clipboardError);
        blob.then(
          (value) => {
            try {
              downloadPng(value);
              settle('saved');
            } catch (downloadError) {
              console.error('[copy-reply-image] download failed:', downloadError);
              settle('failed');
            }
          },
          (renderError) => {
            console.error('[copy-reply-image] render failed:', renderError);
            settle('failed');
          },
        );
      },
    );
  }, [node, state, text, t]);

  if (text === '') return null;

  const key = state === 'busy' ? 'busy'
    : state === 'copied' ? 'copied'
      : state === 'saved' ? 'saved'
        : state === 'failed' ? 'failed'
          : 'title';
  const label = t(key);
  const glyph = state === 'busy' ? spinnerIcon()
    : state === 'copied' || state === 'saved' ? checkIcon()
      : state === 'failed' ? alertIcon()
        : imageIcon();

  return h('span', {
    className: 'dsh-cri',
    'data-dsh-copy-image': '',
    'data-state': state,
    onPointerEnter: (event) => {
      if (event.pointerType === 'mouse') setHovered(true);
    },
    onPointerLeave: () => setHovered(false),
  },
  h('button', {
    ref: buttonRef,
    type: 'button',
    className: 'dsh-cri_button',
    'aria-label': label,
    'aria-describedby': open ? tipId : undefined,
    'aria-busy': state === 'busy' ? 'true' : undefined,
    disabled: state === 'busy',
    onClick: start,
    onFocus: (event) => {
      if (event.currentTarget.matches(':focus-visible')) setFocused(true);
    },
    onBlur: () => setFocused(false),
    onPointerDown: () => {
      setHovered(false);
      setFocused(false);
    },
    children: glyph,
  }),
  open ? h('span', {
    ref: tipRef,
    id: tipId,
    className: 'dsh-cri_tip',
    role: 'tooltip',
    'data-side': 'bottom',
    style: { visibility: 'hidden' },
  }, label) : null);
}

//#endregion

//#region Plugin

/**
 * Browser half: the per-reply "copy as image" action. The capture module turns
 * the rendered reply node into a PNG, and the Canvas card painter in
 * `renderer.js` is the fallback; `build.mjs` inlines both into this module.
 */
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'copy-reply-image: dictionaries');
  ctx.effect(() => {
    const tag = document.createElement('style');
    tag.dataset.plugin = 'dsh-copy-reply-image';
    tag.dataset.pluginCss = STYLE_ID;
    tag.textContent = CSS;
    document.head.appendChild(tag);
    return () => {
      tag.remove();
    };
  }, 'copy-reply-image: stylesheet');
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'copy-image',
    order: 40,
    locale: NS,
  }, CopyImageAction));
}

return { inject: ['slots', 'locale'], apply };

//#endregion
