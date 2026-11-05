/**
 * Markdown → PNG renderer for one Assistant reply.
 *
 * The whole card is drawn with the Canvas 2D API. A DOM/foreignObject
 * rasterizer would preserve the chat's exact styling, but Chromium taints a
 * canvas once an SVG image contains <foreignObject>, so the PNG cannot be
 * exported. Drawing directly keeps the output shareable and dependency-free;
 * the layout below covers the Markdown a chat reply actually uses: headings,
 * paragraphs, lists, quotes, fenced code, tables, rules and inline emphasis.
 */

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif';
const MONO_STACK =
  'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

const COLORS = {
  text: '#1f2328',
  muted: '#8b949e',
  border: '#e6e8eb',
  hairline: '#eaecef',
  codeBg: '#f6f8fa',
  codeText: '#24292f',
  inlineBg: '#f0f1f3',
  quote: '#57606a',
  quoteBar: '#d0d7de',
  link: '#3b5bdb',
  linkUnderline: 'rgba(59, 91, 219, 0.35)',
  accent: '#4d6bfe',
  accentAlt: '#8b5cf6',
  headerBg: '#f6f8fa',
  white: '#ffffff',
};

const CLOSING_PUNCTUATION = new Set([
  '，', '。', '、', '；', '：', '！', '？', '）', '】', '》', '」', '』', '”', '’', '…',
  ',', '.', ';', ':', '!', '?', ')', ']', '}', '>', '"', "'", '…',
]);

const DEFAULT_OPTIONS = {
  width: 880,
  padding: 48,
  scale: 2,
  maxHeight: 14000,
  brand: 'DeepSeek Harness',
  footer: '由 DeepSeek Harness 生成',
  notice: 'AI 生成内容，仅供参考',
  truncatedLabel: '内容过长，已截断',
  date: '',
};

/**
 * Render one Markdown reply to a PNG blob.
 *
 * @param {string} markdown - Assistant reply text.
 * @param {Partial<typeof DEFAULT_OPTIONS>} [options] - Card copy and sizing.
 * @returns {Promise<{blob: Blob, width: number, height: number, cssWidth: number, cssHeight: number, truncated: boolean}>}
 */
export async function renderReplyImage(markdown, options = {}) {
  const config = normalizeOptions(options);
  const blocks = parseMarkdown(markdown);
  if (blocks.length === 0) {
    const error = new Error('EMPTY_REPLY');
    error.code = 'EMPTY';
    throw error;
  }
  const measurer = createMeasurer();
  const layout = layoutDocument(blocks, config, measurer);
  const canvas = paintDocument(layout, config);
  const blob = await canvasToBlob(canvas);
  return {
    blob,
    width: canvas.width,
    height: canvas.height,
    cssWidth: layout.width,
    cssHeight: layout.height,
    truncated: layout.truncated,
  };
}

function normalizeOptions(options) {
  const width = clampNumber(options.width, 560, 1600, DEFAULT_OPTIONS.width);
  const padding = clampNumber(options.padding, 28, 80, DEFAULT_OPTIONS.padding);
  const scale = clampNumber(options.scale, 1, 3, DEFAULT_OPTIONS.scale);
  const maxHeight = clampNumber(options.maxHeight, 1200, 15000, DEFAULT_OPTIONS.maxHeight);
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    width,
    padding,
    scale,
    maxHeight,
    date: options.date || formatDate(new Date()),
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function formatDate(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

//#region Markdown parser

/**
 * Split Markdown into the block shapes the card draws. This is intentionally
 * smaller than CommonMark: chat replies use a predictable subset, and an
 * unrecognized construct still arrives as a paragraph instead of disappearing.
 */
function parseMarkdown(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (/^\s*$/.test(line)) {
      index += 1;
      continue;
    }

    const fence = /^\s*(`{3,}|~{3,})\s*([A-Za-z0-9_+.#-]*)\s*$/.exec(line);
    if (fence !== null) {
      const marker = fence[1][0];
      const minimum = fence[1].length;
      const closing = new RegExp(`^\\s*${marker}{${minimum},}\\s*$`);
      const body = [];
      index += 1;
      while (index < lines.length && !closing.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', lang: fence[2] || '', text: body.join('\n') });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading !== null) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }

    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: 'hr' });
      index += 1;
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const header = parseTableRow(line);
      const align = parseTableAlign(lines[index + 1], header.length);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes('|') && !/^\s*$/.test(lines[index])) {
        rows.push(parseTableRow(lines[index]));
        index += 1;
      }
      blocks.push({ type: 'table', header, align, rows });
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', text: quote.join('\n') });
      continue;
    }

    const listItem = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (listItem !== null) {
      const items = [];
      while (index < lines.length) {
        const match = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[index]);
        if (match === null) break;
        const indent = match[1].replace(/\t/g, '    ').length;
        items.push({
          level: Math.min(2, Math.floor(indent / 2)),
          ordered: /^\d/.test(match[2]),
          marker: match[2],
          text: match[3],
        });
        index += 1;
        while (
          index < lines.length &&
          /^\s{2,}\S/.test(lines[index]) &&
          !/^\s*([-*+]|\d+[.)])\s+/.test(lines[index])
        ) {
          items[items.length - 1].text += `\n${lines[index].trim()}`;
          index += 1;
        }
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    const paragraph = [];
    while (index < lines.length && !/^\s*$/.test(lines[index]) && !startsBlock(lines, index)) {
      paragraph.push(lines[index].replace(/\s+$/, ''));
      index += 1;
    }
    if (paragraph.length === 0) {
      // A construct that starts a block but was not claimed above; keep it visible.
      paragraph.push(line);
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks;
}

function startsBlock(lines, index) {
  const line = lines[index];
  if (/^\s*(`{3,}|~{3,})/.test(line)) return true;
  if (/^(#{1,6})\s+/.test(line)) return true;
  if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) return true;
  if (/^\s*>/.test(line)) return true;
  if (/^(\s*)([-*+]|\d+[.)])\s+/.test(line)) return true;
  if (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) return true;
  return false;
}

function isTableSeparator(line) {
  const cells = parseTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseTableRow(line) {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  return text.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
}

function parseTableAlign(line, count) {
  const cells = parseTableRow(line);
  return Array.from({ length: count }, (_, index) => {
    const cell = cells[index] ?? '';
    if (/^:-+:$/.test(cell)) return 'center';
    if (/^-+:$/.test(cell)) return 'right';
    return 'left';
  });
}

/**
 * Turn one inline Markdown string into styled spans. Raw HTML is left as text:
 * an unrecognized tag is more useful to the reader than silently dropping it.
 */
function parseInline(text) {
  const spans = [];
  parseInlineInto(String(text ?? ''), {}, spans);
  return spans;
}

function parseInlineInto(text, inherited, out) {
  let index = 0;
  while (index < text.length) {
    const rest = text.slice(index);

    const code = /^`([^`\n]+)`/.exec(rest);
    if (code !== null) {
      out.push({ text: code[1], ...inherited, code: true });
      index += code[0].length;
      continue;
    }

    const image = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
    if (image !== null) {
      out.push({ text: `图片：${image[1] || '未命名'}`, ...inherited, image: true });
      index += image[0].length;
      continue;
    }

    const link = /^\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
    if (link !== null) {
      parseInlineInto(link[1], { ...inherited, link: true }, out);
      index += link[0].length;
      continue;
    }

    const bold = /^\*\*([^*\n]+)\*\*/.exec(rest) || /^__([^_\n]+)__/.exec(rest);
    if (bold !== null) {
      parseInlineInto(bold[1], { ...inherited, bold: true }, out);
      index += bold[0].length;
      continue;
    }

    const strike = /^~~([^~\n]+)~~/.exec(rest);
    if (strike !== null) {
      parseInlineInto(strike[1], { ...inherited, strike: true }, out);
      index += strike[0].length;
      continue;
    }

    const italic = /^\*([^*\n]+)\*/.exec(rest) || /^_([^_\n]+)_/.exec(rest);
    if (italic !== null) {
      parseInlineInto(italic[1], { ...inherited, italic: true }, out);
      index += italic[0].length;
      continue;
    }

    const autolink = /^<((?:https?|mailto):[^>\s]+)>/.exec(rest);
    if (autolink !== null) {
      out.push({ text: autolink[1], ...inherited, link: true });
      index += autolink[0].length;
      continue;
    }

    const plain = /^[^`*_~\[<!]+/.exec(rest);
    if (plain !== null) {
      pushPlain(plain[0], inherited, out);
      index += plain[0].length;
      continue;
    }

    out.push({ text: rest[0], ...inherited });
    index += 1;
  }
}

function pushPlain(text, style, out) {
  const urlPattern = /(?<![\w/])https?:\/\/[^\s<>()]+/g;
  let last = 0;
  let match;
  while ((match = urlPattern.exec(text)) !== null) {
    if (match.index > last) out.push({ text: decodeEntities(text.slice(last, match.index)), ...style });
    out.push({ text: match[0], ...style, link: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ text: decodeEntities(text.slice(last)), ...style });
}

function decodeEntities(value) {
  if (!value.includes('&')) return value;
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

//#endregion

//#region Measurement and inline layout

function createMeasurer() {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const context = canvas.getContext('2d');
  const cache = new Map();
  return {
    measure(text, font) {
      const key = `${font}\u0000${text}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      context.font = font;
      const width = context.measureText(text).width;
      if (cache.size > 20000) cache.clear();
      cache.set(key, width);
      return width;
    },
  };
}

function fontOf(style) {
  const weight = style.weight ?? 400;
  const italic = style.italic === true ? 'italic ' : '';
  return `${italic}${weight} ${style.size}px ${style.mono === true ? MONO_STACK : FONT_STACK}`;
}

function resolveStyle(span, base) {
  const style = {
    size: base.size,
    weight: base.weight ?? 400,
    italic: base.italic === true,
    color: base.color ?? COLORS.text,
    lineHeight: base.lineHeight,
    mono: false,
    bg: false,
    pad: 0,
    dy: 0,
    link: span.link === true || base.link === true,
    strike: span.strike === true || base.strike === true,
    code: span.code === true || base.code === true,
  };
  if (style.code) {
    style.mono = true;
    style.size = Math.max(10.5, base.size - 2.5);
    style.color = COLORS.codeText;
    style.bg = true;
    style.pad = 8;
  }
  if (span.image === true) {
    style.italic = true;
    style.color = COLORS.muted;
  }
  if (span.bold === true || base.bold === true) style.weight = 600;
  if (span.italic === true || base.italic === true) style.italic = true;
  if (span.link === true || base.link === true) style.color = COLORS.link;
  return style;
}

function segmentText(text) {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segments = [];
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    for (const part of segmenter.segment(text)) segments.push(part.segment);
    return segments;
  }
  return text.match(/[A-Za-z0-9_@#$%^&*+./:;=!?()[\]{}'"|<>~-]+|\s+|[\s\S]/gu) ?? [text];
}

function layoutSpans(spans, maxWidth, base, measurer) {
  const tokens = [];
  for (const span of spans) {
    const style = resolveStyle(span, base);
    const font = fontOf(style);
    const parts = span.text.split('\n');
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      if (partIndex > 0) tokens.push({ break: true });
      const part = parts[partIndex];
      if (part === '') continue;
      const segments = style.mono ? [part] : segmentText(part);
      for (const segment of segments) {
        if (segment === '') continue;
        const width = measurer.measure(segment, font) + style.pad;
        if (width > maxWidth && segment.length > 1) {
          for (const character of Array.from(segment)) {
            const charWidth = measurer.measure(character, font) + style.pad;
            tokens.push({ text: character, style, font, width: charWidth });
          }
        } else {
          tokens.push({ text: segment, style, font, width });
        }
      }
    }
  }

  const lines = [];
  let current = [];
  let cursor = 0;
  const flush = () => {
    lines.push({ items: current, width: cursor });
    current = [];
    cursor = 0;
  };

  for (const token of tokens) {
    if (token.break === true) {
      flush();
      continue;
    }
    if (token.text === '') continue;
    const whitespace = /^\s+$/.test(token.text);
    if (cursor + token.width > maxWidth && current.length > 0) {
      if (whitespace) continue;
      const closing = CLOSING_PUNCTUATION.has(token.text);
      if (!(closing && cursor < maxWidth)) {
        flush();
      }
    }
    if (whitespace && current.length === 0) continue;
    current.push({ ...token, x: cursor, dy: token.style.dy });
    cursor += token.width;
  }
  flush();

  const lineHeight = base.lineHeight;
  const ascent = Math.round(lineHeight * 0.76);
  return {
    lines: lines.map((line, index) => ({
      ...line,
      baseline: index * lineHeight + ascent,
      height: lineHeight,
    })),
    height: Math.max(1, lines.length) * lineHeight,
    lineHeight,
  };
}

//#endregion

//#region Block layout

function layoutDocument(blocks, config, measurer) {
  const width = config.width;
  const padding = config.padding;
  const contentWidth = width - padding * 2;
  const top = 98;
  const footerReserve = 74;
  const limit = config.maxHeight - footerReserve;
  const out = [];
  let cursor = top;
  let truncated = false;

  for (const block of blocks) {
    const laid = layoutBlock(block, {
      x: padding,
      width: contentWidth,
      top: cursor,
      measurer,
      config,
      first: out.length === 0,
    });
    if (laid === null) continue;
    if (laid.y + laid.height > limit) {
      truncated = true;
      break;
    }
    out.push(laid);
    cursor = laid.y + laid.height;
  }

  const contentEnd = cursor;
  const footerLineY = contentEnd + 18;
  const footerBaseline = footerLineY + 18;
  const height = Math.max(top + 120, footerBaseline + 12 + 34);
  return {
    width,
    height,
    blocks: out,
    truncated,
    top,
    contentEnd,
    footerLineY,
    footerBaseline,
    padding,
    contentWidth,
    config,
  };
}

function layoutBlock(block, context) {
  switch (block.type) {
    case 'heading': {
      const sizes = [
        { size: 26, lineHeight: 36, top: 12, bottom: 12 },
        { size: 22, lineHeight: 31, top: 24, bottom: 10 },
        { size: 18, lineHeight: 27, top: 20, bottom: 8 },
        { size: 16, lineHeight: 25, top: 18, bottom: 6 },
      ];
      const spec = sizes[Math.min(block.level, 4) - 1];
      return layoutTextBlock(block, context, {
        base: { size: spec.size, lineHeight: spec.lineHeight, weight: 600 },
        marginTop: context.first ? 2 : spec.top,
        marginBottom: spec.bottom,
      });
    }
    case 'paragraph':
      return layoutTextBlock(block, context, {
        base: { size: 15, lineHeight: 25 },
        marginTop: 0,
        marginBottom: 14,
      });
    case 'quote':
      return layoutQuote(block, context);
    case 'list':
      return layoutList(block, context);
    case 'code':
      return layoutCode(block, context);
    case 'table':
      return layoutTable(block, context);
    case 'hr':
      return {
        type: 'hr',
        x: context.x,
        y: context.top + 20,
        width: context.width,
        height: 1 + 40,
      };
    default:
      return null;
  }
}

function layoutTextBlock(block, context, options) {
  const base = options.base;
  const spans = parseInline(block.text);
  const laid = layoutSpans(spans, context.width, base, context.measurer);
  const y = context.top + options.marginTop;
  return {
    type: 'text',
    x: context.x,
    y,
    lines: laid.lines,
    lineHeight: laid.lineHeight,
    height: options.marginTop + laid.height + options.marginBottom,
    color: base.color,
  };
}

function layoutQuote(block, context) {
  const base = { size: 15, lineHeight: 25, color: COLORS.quote };
  const spans = parseInline(block.text);
  const laid = layoutSpans(spans, context.width - 18, base, context.measurer);
  const y = context.top + 4;
  return {
    type: 'quote',
    x: context.x,
    y,
    lines: laid.lines,
    lineHeight: laid.lineHeight,
    textX: context.x + 18,
    height: 4 + laid.height + 14,
    barTop: y + 2,
    barHeight: Math.max(18, laid.height - 4),
  };
}

function layoutList(block, context) {
  const base = { size: 15, lineHeight: 25 };
  const items = [];
  let cursor = context.top + 2;
  for (const item of block.items) {
    const indent = 22 + item.level * 22;
    const available = context.width - indent - 6;
    const spans = parseInline(item.text);
    const laid = layoutSpans(spans, available, base, context.measurer);
    items.push({
      marker: item.marker,
      ordered: item.ordered,
      level: item.level,
      markerX: context.x + indent - 12,
      textX: context.x + indent,
      y: cursor,
      lines: laid.lines,
      lineHeight: laid.lineHeight,
      height: laid.height,
    });
    cursor += laid.height + 5;
  }
  const height = Math.max(0, cursor - 5 - context.top) + 14;
  return {
    type: 'list',
    x: context.x,
    y: context.top,
    items,
    height,
  };
}

function layoutCode(block, context) {
  const fontSize = 12.5;
  const lineHeight = 19;
  const padX = 16;
  const padY = 14;
  const langHeight = block.lang === '' ? 0 : 16;
  const maxWidth = context.width - padX * 2;
  const measurer = context.measurer;
  const font = fontOf({ size: fontSize, weight: 400, mono: true });
  const lines = [];
  for (const rawLine of block.text.split('\n')) {
    const expanded = rawLine.replace(/\t/g, '    ');
    if (expanded === '') {
      lines.push('');
      continue;
    }
    let rest = expanded;
    while (rest.length > 0) {
      if (measurer.measure(rest, font) <= maxWidth) {
        lines.push(rest);
        break;
      }
      let cut = rest.length - 1;
      while (cut > 0 && measurer.measure(rest.slice(0, cut), font) > maxWidth) cut -= 1;
      const window = rest.slice(0, cut);
      const space = window.lastIndexOf(' ');
      if (space > 20) cut = space;
      lines.push(rest.slice(0, cut).replace(/\s+$/, ''));
      rest = rest.slice(cut).replace(/^\s+/, '');
    }
  }
  const height = padY * 2 + langHeight + Math.max(1, lines.length) * lineHeight;
  const y = context.top + 2;
  return {
    type: 'code',
    x: context.x,
    y,
    width: context.width,
    height: height + 18,
    padX,
    padY,
    lang: block.lang,
    langHeight,
    lines,
    lineHeight,
    fontSize,
    font,
  };
}

function layoutTable(block, context) {
  const cellPadX = 10;
  const cellPadY = 8;
  const fontSize = 13.5;
  const lineHeight = 20;
  const base = { size: fontSize, lineHeight };
  const columns = block.header.length;
  const measurer = context.measurer;

  const natural = new Array(columns).fill(72);
  const allRows = [block.header, ...block.rows];
  for (const row of allRows) {
    for (let index = 0; index < columns; index += 1) {
      const spans = parseInline(row[index] ?? '');
      let widest = 0;
      for (const span of spans) {
        const style = resolveStyle(span, base);
        widest += measurer.measure(span.text, fontOf(style));
      }
      natural[index] = Math.max(natural[index], widest + cellPadX * 2 + 2);
    }
  }
  const minimum = Math.max(58, Math.floor(context.width / columns / 2.4));
  for (let index = 0; index < columns; index += 1) natural[index] = Math.max(minimum, natural[index]);

  const naturalTotal = natural.reduce((sum, value) => sum + value, 0);
  let widths;
  if (naturalTotal <= context.width) {
    const extra = (context.width - naturalTotal) / columns;
    widths = natural.map((value) => value + extra);
  } else {
    const scale = context.width / naturalTotal;
    widths = natural.map((value) => Math.max(minimum, value * scale));
    const total = widths.reduce((sum, value) => sum + value, 0);
    if (total > context.width) {
      const shrink = context.width / total;
      widths = widths.map((value) => value * shrink);
    } else if (total < context.width) {
      const extra = (context.width - total) / columns;
      widths = widths.map((value) => value + extra);
    }
  }

  const rows = [];
  let cursor = context.top + 2;
  for (let rowIndex = 0; rowIndex < allRows.length; rowIndex += 1) {
    const row = allRows[rowIndex];
    const header = rowIndex === 0;
    const cells = [];
    let rowHeight = 0;
    let cellX = context.x;
    for (let column = 0; column < columns; column += 1) {
      const width = widths[column];
      const spans = parseInline(row[column] ?? '');
      const laid = layoutSpans(spans, width - cellPadX * 2, base, measurer);
      cells.push({
        x: cellX,
        width,
        lines: laid.lines,
        lineHeight: laid.lineHeight,
        height: laid.height,
        align: block.align[column] ?? 'left',
      });
      rowHeight = Math.max(rowHeight, laid.height + cellPadY * 2);
      cellX += width;
    }
    rows.push({ y: cursor, height: rowHeight, header, cells });
    cursor += rowHeight;
  }
  return {
    type: 'table',
    x: context.x,
    y: context.top + 2,
    width: context.width,
    height: cursor - (context.top + 2) + 16,
    rows,
    cellPadX,
    cellPadY,
  };
}

//#endregion

//#region Painting

function paintDocument(layout, config) {
  const scale = config.scale;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(layout.width * scale));
  canvas.height = Math.max(1, Math.round(layout.height * scale));
  const context = canvas.getContext('2d');
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.textBaseline = 'alphabetic';

  context.fillStyle = COLORS.white;
  context.fillRect(0, 0, layout.width, layout.height);

  const gradient = context.createLinearGradient(0, 0, layout.width, 0);
  gradient.addColorStop(0, COLORS.accent);
  gradient.addColorStop(1, COLORS.accentAlt);
  context.fillStyle = gradient;
  context.fillRect(0, 0, layout.width, 3);

  drawHeader(context, layout, config);
  for (const block of layout.blocks) drawBlock(context, block);
  drawFooter(context, layout, config);
  return canvas;
}

function drawHeader(context, layout, config) {
  const pad = layout.padding;
  const baseline = 62;
  const dot = context.createLinearGradient(pad - 5, baseline - 9, pad + 5, baseline + 1);
  dot.addColorStop(0, COLORS.accent);
  dot.addColorStop(1, COLORS.accentAlt);
  context.beginPath();
  context.arc(pad + 4, baseline - 4, 4.5, 0, Math.PI * 2);
  context.fillStyle = dot;
  context.fill();

  context.font = fontOf({ size: 12, weight: 500 });
  context.fillStyle = COLORS.muted;
  context.textAlign = 'left';
  context.fillText(config.brand, pad + 16, baseline);

  context.textAlign = 'right';
  context.font = fontOf({ size: 11.5, weight: 400 });
  context.fillStyle = COLORS.muted;
  context.fillText(config.date, layout.width - pad, baseline);
  context.textAlign = 'left';

  context.strokeStyle = COLORS.hairline;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(pad, 80.5);
  context.lineTo(layout.width - pad, 80.5);
  context.stroke();
}

function drawFooter(context, layout, config) {
  const pad = layout.padding;
  context.strokeStyle = COLORS.hairline;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(pad, layout.footerLineY + 0.5);
  context.lineTo(layout.width - pad, layout.footerLineY + 0.5);
  context.stroke();

  const baseline = layout.footerBaseline;
  const left = layout.truncated ? `${config.truncatedLabel} · ${config.footer}` : config.footer;
  context.font = fontOf({ size: 11.5, weight: 400 });
  context.fillStyle = COLORS.muted;
  context.textAlign = 'left';
  context.fillText(left, pad, baseline);
  context.textAlign = 'right';
  context.fillText(config.notice, layout.width - pad, baseline);
  context.textAlign = 'left';
}

function drawBlock(context, block) {
  switch (block.type) {
    case 'text':
      drawTextLines(context, block.x, block.y, block.lines);
      break;
    case 'quote':
      drawQuote(context, block);
      break;
    case 'list':
      drawList(context, block);
      break;
    case 'code':
      drawCode(context, block);
      break;
    case 'table':
      drawTable(context, block);
      break;
    case 'hr':
      context.strokeStyle = COLORS.hairline;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(block.x, block.y + 0.5);
      context.lineTo(block.x + block.width, block.y + 0.5);
      context.stroke();
      break;
    default:
      break;
  }
}

function drawTextLines(context, x, y, lines) {
  for (const line of lines) {
    for (const item of line.items) {
      const left = x + item.x;
      const baseline = y + line.baseline + (item.dy ?? 0);
      if (item.style.bg === true) {
        roundedRect(
          context,
          left,
          baseline - item.style.size + 1,
          item.width,
          item.style.size + 6,
          4
        );
        context.fillStyle = COLORS.inlineBg;
        context.fill();
      }
      context.font = item.font;
      context.fillStyle = item.style.color;
      context.fillText(item.text, left + (item.style.bg === true ? 4 : 0), baseline);
      if (item.style.strike === true) {
        context.strokeStyle = item.style.color;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(left, baseline - item.style.size * 0.3);
        context.lineTo(left + item.width, baseline - item.style.size * 0.3);
        context.stroke();
      }
      if (item.style.link === true) {
        context.strokeStyle = COLORS.linkUnderline;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(left, baseline + 2.5);
        context.lineTo(left + item.width, baseline + 2.5);
        context.stroke();
      }
    }
  }
}

function drawQuote(context, block) {
  context.fillStyle = COLORS.quoteBar;
  roundedRect(context, block.x + 1, block.barTop, 3, block.barHeight, 1.5);
  context.fill();
  drawTextLines(context, block.textX, block.y, block.lines);
}

function drawList(context, block) {
  for (const item of block.items) {
    if (item.ordered) {
      context.font = fontOf({ size: 13, weight: 400 });
      context.fillStyle = COLORS.muted;
      context.textAlign = 'right';
      context.fillText(`${item.marker.replace(/[.)]$/, '')}.`, item.markerX + 2, item.y + item.lineHeight * 0.76);
      context.textAlign = 'left';
    } else {
      context.beginPath();
      context.arc(item.markerX - 2, item.y + item.lineHeight * 0.38, 2.3, 0, Math.PI * 2);
      context.fillStyle = COLORS.muted;
      context.fill();
    }
    drawTextLines(context, item.textX, item.y, item.lines);
  }
}

function drawCode(context, block) {
  roundedRect(context, block.x, block.y, block.width, block.height - 18, 10);
  context.fillStyle = COLORS.codeBg;
  context.fill();
  context.strokeStyle = COLORS.border;
  context.lineWidth = 1;
  context.stroke();

  if (block.lang !== '') {
    context.font = fontOf({ size: 10, weight: 500, mono: true });
    context.fillStyle = COLORS.muted;
    context.fillText(block.lang.toUpperCase(), block.x + block.padX, block.y + block.padY + 7);
  }

  context.font = block.font;
  context.fillStyle = COLORS.codeText;
  const startY = block.y + block.padY + block.langHeight;
  block.lines.forEach((line, index) => {
    context.fillText(line, block.x + block.padX, startY + index * block.lineHeight + block.lineHeight * 0.72);
  });
}

function drawTable(context, block) {
  for (const row of block.rows) {
    for (const cell of row.cells) {
      if (row.header) {
        context.fillStyle = COLORS.headerBg;
        context.fillRect(cell.x, row.y, cell.width, row.height);
      }
      context.strokeStyle = COLORS.border;
      context.lineWidth = 1;
      context.strokeRect(cell.x + 0.5, row.y + 0.5, cell.width - 1, row.height - 1);
      drawCellLines(context, cell, row.y + block.cellPadY, block.cellPadX);
    }
  }
}

function drawCellLines(context, cell, top, cellPadX) {
  for (const line of cell.lines) {
    const lineWidth = line.items.reduce((sum, item) => Math.max(sum, item.x + item.width), 0);
    let offset = 0;
    if (cell.align === 'center') offset = Math.max(0, (cell.width - cellPadX * 2 - lineWidth) / 2);
    if (cell.align === 'right') offset = Math.max(0, cell.width - cellPadX * 2 - lineWidth);
    for (const item of line.items) {
      const left = cell.x + cellPadX + offset + item.x;
      const baseline = top + line.baseline;
      if (item.style.bg === true) {
        roundedRect(context, left, baseline - item.style.size + 1, item.width, item.style.size + 6, 4);
        context.fillStyle = COLORS.inlineBg;
        context.fill();
      }
      context.font = item.font;
      context.fillStyle = item.style.color;
      context.fillText(item.text, left + (item.style.bg === true ? 4 : 0), baseline);
      if (item.style.link === true) {
        context.strokeStyle = COLORS.linkUnderline;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(left, baseline + 2.5);
        context.lineTo(left + item.width, baseline + 2.5);
        context.stroke();
      }
    }
  }
}

function roundedRect(context, x, y, width, height, radius) {
  if (width <= 0 || height <= 0) return;
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('PNG_ENCODE_FAILED'));
      else resolve(blob);
    }, 'image/png');
  });
}
