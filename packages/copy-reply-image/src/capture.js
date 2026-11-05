/**
 * Rasterize the reply exactly as the Chat rendered it.
 *
 * The browser has no supported "node → PNG" API, so the standard route is the
 * SVG <foreignObject> snapshot: clone the live node, freeze its computed styles
 * into inline styles (an SVG image document cannot read the page's
 * stylesheets), embed the clone in an SVG image, draw that image on a canvas,
 * and encode the canvas. The clone keeps the host's own typography, colors,
 * spacing, syntax highlighting, tables and inline math markup, so the image is
 * the rendered result rather than a second Markdown implementation.
 *
 * The caller owns the failure fallback: anything this function cannot capture
 * (a detached row, a URL the sandbox refuses, a tainted canvas, an oversized
 * card) throws, and the caller paints the standalone card instead.
 */

/** Computed properties that survive into the isolated SVG document. */
const STYLE_PROPS = [
  'color',
  'background-color',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'box-shadow',
  'opacity',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'font-stretch',
  'letter-spacing',
  'line-height',
  'font-feature-settings',
  'font-variation-settings',
  'font-kerning',
  'font-optical-sizing',
  'text-rendering',
  'text-autospace',
  'box-decoration-break',
  'text-align',
  'text-decoration-line',
  'text-decoration-color',
  'text-decoration-style',
  'text-transform',
  'text-indent',
  'white-space',
  'overflow-wrap',
  'word-break',
  'word-spacing',
  'vertical-align',
  'text-overflow',
  'display',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'align-items',
  'align-content',
  'align-self',
  'justify-content',
  'gap',
  'row-gap',
  'column-gap',
  'order',
  'grid-template-columns',
  'grid-template-rows',
  'grid-auto-flow',
  'grid-column',
  'grid-row',
  'width',
  'height',
  'box-sizing',
  'list-style-type',
  'list-style-position',
  'table-layout',
  'border-collapse',
  'border-spacing',
  'float',
  'clear',
  'visibility',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
];

/**
 * Sizes are deliberately not frozen. A reply's inline-flex code chips, badges and
 * pills are content-sized, and a pixel width measured in the live layout is a
 * hair wider than the SVG snapshot's own text metrics; pinning it wraps the
 * chip's text out of its one-line background. Replaced elements keep their
 * measured box because their intrinsic size may differ from the displayed one.
 */
const SIZED_TAGS = new Set(['IMG', 'SVG', 'VIDEO', 'IFRAME']);

/**
 * Actions that only make sense in the live page: a code block's wrap/copy
 * controls and disclosure toggles. A reply's own links are buttons too (file
 * mentions render as `<button>`), so buttons are not dropped wholesale — that
 * removed the link text and any image wrapped in an image button.
 */
const CHROME_SELECTOR = '[data-code-block-banner] button, button[aria-expanded]';

/** Embeds that cannot appear in a still image as text. */
const DROP_SELECTOR = 'input,textarea,select,video,audio,canvas';

/** Extracted boxes; measured rather than re-derived. */
const SIZE_PROPERTIES = new Set(['width', 'height']);

/** Device-pixel budget; long replies render below 2x so the canvas stays encodable. */
const MAX_CAPTURE_PIXELS = 26e6;

function px(value) {
  return `${Math.max(0, Math.round(value * 100) / 100)}px`;
}

/** Paint the first opaque ancestor background so the image is not transparent. */
function resolveBackground(element) {
  let node = element;
  while (node !== null) {
    const color = getComputedStyle(node).backgroundColor;
    if (color !== '' && color !== 'transparent') {
      if (!/^rgba\([^)]*,\s*0(\.\d+)?\)$/.test(color)) return color;
    }
    node = node.parentElement;
  }
  return getComputedStyle(document.body).backgroundColor || '#ffffff';
}

/** Copy measured styles onto a clone, which the SVG document will not compute itself. */
function inlineStyles(source, target) {
  const computed = getComputedStyle(source);
  const keepSize = source instanceof Element && SIZED_TAGS.has(source.tagName);
  const declarations = [];
  for (const property of STYLE_PROPS) {
    if (!keepSize && SIZE_PROPERTIES.has(property)) continue;
    let value = computed.getPropertyValue(property);
    if (value === '') continue;
    if (property === 'background-color' || property === 'border-top-color'
      || property === 'border-right-color' || property === 'border-bottom-color'
      || property === 'border-left-color') {
      if (value === 'rgba(0, 0, 0, 0)') value = 'transparent';
    }
    declarations.push(`${property}:${value}`);
  }
  if (source instanceof HTMLElement && source.tagName === 'IMG') {
    declarations.push('object-fit:contain');
  }
  target.setAttribute('style', declarations.join(';'));
  const sourceChildren = source.children;
  const targetChildren = target.children;
  const count = Math.min(sourceChildren.length, targetChildren.length);
  for (let index = 0; index < count; index += 1) {
    inlineStyles(sourceChildren[index], targetChildren[index]);
  }
}

/** Remove controls and embeds that only make sense in the live page. */
function stripChrome(root) {
  for (const node of root.querySelectorAll(CHROME_SELECTOR)) node.remove();
  for (const node of root.querySelectorAll(DROP_SELECTOR)) node.remove();
}

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('READ_FAILED'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Turn reply images into data URLs; an SVG image document may not reference
 * page URLs, and a cross-origin reference would taint the export canvas.
 * Unresolvable images are dropped instead of breaking the whole capture.
 */
async function inlineImages(root) {
  const images = [...root.querySelectorAll('img')];
  await Promise.all(images.map(async (image) => {
    const source = image.getAttribute('src') ?? '';
    if (source.startsWith('data:')) return;
    try {
      const response = await fetch(source, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      image.setAttribute('src', await readAsDataUrl(await response.blob()));
    } catch (error) {
      console.warn('[copy-reply-image] dropped an image that could not be embedded:', error);
      image.remove();
    }
  }));
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'sync';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('SNAPSHOT_LOAD_FAILED'));
    image.src = url;
  });
}

function canvasScale(width, height) {
  if (width <= 0 || height <= 0) return 1;
  const byArea = Math.sqrt(MAX_CAPTURE_PIXELS / (width * height));
  return Math.max(1, Math.min(2, byArea));
}

/**
 * Capture one rendered reply node as a PNG.
 *
 * @param {HTMLElement} element - The live reply node, already in the document.
 * @param {{padding?: number, background?: string}} [options]
 * @returns {Promise<{blob: Blob, width: number, height: number}>}
 */
export async function captureRenderedReply(element, options = {}) {
  if (!(element instanceof HTMLElement) || !element.isConnected) {
    throw new Error('REPLY_NOT_MOUNTED');
  }
  const rect = element.getBoundingClientRect();
  if (rect.width < 80 || rect.height < 8) throw new Error('REPLY_EMPTY');

  const padding = options.padding ?? 28;
  const contentWidth = Math.round(rect.width);
  const width = contentWidth + padding * 2;
  const height = Math.round(rect.height) + padding * 2;

  const clone = element.cloneNode(true);
  stripChrome(clone);
  inlineStyles(element, clone);
  clone.style.margin = '0';
  clone.style.width = px(contentWidth);
  await inlineImages(clone);

  const holder = document.createElement('div');
  holder.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  holder.setAttribute(
    'style',
    `width:${width}px;height:${height}px;box-sizing:border-box;`
    + `padding:${padding}px;background:${options.background ?? resolveBackground(element)};`
    + 'font-synthesis:none;-webkit-font-smoothing:antialiased;',
  );
  holder.appendChild(clone);

  const serialized = new XMLSerializer().serializeToString(holder);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">'
    + '<foreignObject x="0" y="0" width="' + width + '" height="' + height + '">'
    + serialized
    + '</foreignObject></svg>';
  const snapshot = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));

  const scale = canvasScale(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('CANVAS_UNAVAILABLE');
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.drawImage(snapshot, 0, 0, width, height);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value === null) reject(new Error('PNG_ENCODE_FAILED'));
      else resolve(value);
    }, 'image/png');
  });
  return { blob, width: canvas.width, height: canvas.height };
}
