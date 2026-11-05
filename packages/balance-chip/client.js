/**
 * Client half, three surfaces:
 *
 *  1. `conversation.composer.dock` — the balance strip after the shipped
 *     context entry. A host-style control: hover tint, held state while its
 *     details are open, click toggles the panel.
 *  2. `conversation.chat.assistant-actions` — the turn's cost, also a real
 *     button (not a hover tooltip). Clicking opens the same panel with the
 *     turn's token breakdown.
 *  3. `shell.overlay` — that panel, shared by both entries. It lives in the
 *     frame-wide floating layer because the docked composer is the containing
 *     block for fixed children, which would clip and misplace a panel opened
 *     from the composer.
 *
 * Cost accounting mirrors dsh-whale-widget: a turn sums every assistant message
 * of the turn, each priced at its own instant with its own model's rates, in
 * 8-decimal fixed point, weekend and holiday valley pricing included. The model
 * name comes from the Host, which reads it off the durable event.
 */
window.__ModuleLoader__.load({
  id: '@akagiyui/balance-chip',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'balance-chip';
    const ENDPOINT = '/balance-chip/state';
    const MODELS_ENDPOINT = '/balance-chip/models';
    const POLL_MS = 60000;
    const TICK_MS = 20000;
    const MODELS_TTL_MS = 15000;
    const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const PANEL_WIDTH = 268;

    const zh = {
      balance: '余额',
      today: '今日',
      peak: '峰',
      offpeak: '谷',
      unavailable: '读取不到余额',
      loading: '正在读取余额',
      details: '余额与峰谷详情',
      sourceKey: '来源：API Key',
      sourceAccount: '来源：账号登录',
      sourceNone: '未取到余额',
      updated: '更新于 {time}',
      stale: '读数可能已过期',
      refresh: '刷新',
      todayNote: '按余额下降累计；充值不计入',
      peakNote: '工作日 9:00–12:00、14:00–18:00 为高峰，周末与法定节假日全天谷时',
      turnTitle: '本轮用量',
      turnTotal: '本轮共 {n} 步',
      turnModel: '模型 {model}',
      turnTokens: '输入 {input} · 缓存 {cache} · 输出 {output}',
      turnRate: '按{phase}价：输入 ¥{miss}/M · 缓存 ¥{hit}/M · 输出 ¥{out}/M',
    };
    const en = {
      balance: 'Balance',
      today: 'Today',
      peak: 'Peak',
      offpeak: 'Off-peak',
      unavailable: 'Balance unavailable',
      loading: 'Loading balance',
      details: 'Balance and peak details',
      sourceKey: 'Source: API key',
      sourceAccount: 'Source: account sign-in',
      sourceNone: 'No balance source',
      updated: 'Updated {time}',
      stale: 'Reading may be stale',
      refresh: 'Refresh',
      todayNote: 'Accumulated from balance drops; top-ups never reduce it',
      peakNote: 'Peak is 09:00–12:00 and 14:00–18:00 on weekdays; weekends and holidays are off-peak all day',
      turnTitle: 'This turn',
      turnTotal: '{n} steps in this turn',
      turnModel: 'Model {model}',
      turnTokens: 'in {input} · cache {cache} · out {output}',
      turnRate: 'At {phase} rates: in ¥{miss}/M · cache ¥{hit}/M · out ¥{out}/M',
    };

    // CNY per million tokens, [off-peak, peak] — the whale's table, 2026-09-10 rates.
    const BASE_PRICE = { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] };
    const PRO_PRICE = { hit: [0.15, 0.30], miss: [4.5, 9], out: [13.5, 27] };
    const PRICING = {
      'deepseek-flash': BASE_PRICE,
      'deepseek-v4-flash-vision-exp': BASE_PRICE,
      'deepseek-v4-flash': BASE_PRICE,
      'deepseek-v4-pro': PRO_PRICE,
    };
    const DEFAULT_MODEL = 'deepseek-flash';

    const WEEKEND_VALLEY_FROM = Date.UTC(2026, 7, 22, 16, 0, 0); // 2026-08-23 00:00 Beijing
    const HOLIDAY_VALLEY_FROM = Date.UTC(2026, 8, 18, 16, 0, 0); // 2026-09-19 00:00 Beijing
    // 2026 mainland public holidays (whole days at valley price). Refresh yearly.
    const HOLIDAY_VALLEY = new Set([
      '2026-01-01', '2026-01-02', '2026-01-03',
      '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
      '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
      '2026-04-04', '2026-04-05', '2026-04-06',
      '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
      '2026-06-19', '2026-06-20', '2026-06-21',
      '2026-09-25', '2026-09-26', '2026-09-27',
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
      '2026-10-05', '2026-10-06', '2026-10-07',
    ]);

    const CSS = [
      // Composer strip: a compact host control.
      '.dsh-bc_chip {',
      '  display: inline-flex; align-items: center; gap: 6px;',
      '  margin: 0; padding: 2px 6px; border: 0; border-radius: 6px; background: transparent;',
      '  font: inherit; font-size: 12px; line-height: 18px;',
      '  color: var(--dsw-alias-label-secondary);',
      '  cursor: pointer; -webkit-user-select: none; user-select: none; white-space: nowrap;',
      '  transition: background-color 80ms, color 80ms;',
      '}',
      '.dsh-bc_chip:hover, .dsh-bc_chip[aria-expanded="true"] {',
      '  background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));',
      '  color: var(--dsw-alias-label-primary);',
      '}',
      '.dsh-bc_chip:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }',
      '.dsh-bc_item { display: inline-flex; align-items: center; gap: 3px; }',
      '.dsh-bc_val { color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }',
      '.dsh-bc_sep { opacity: .45; }',
      '.dsh-bc_phase { font-variant-numeric: tabular-nums; }',
      '.dsh-bc_peak { color: var(--dsw-alias-state-error-primary); }',
      '.dsh-bc_peak .dsh-bc_val { color: var(--dsw-alias-state-error-primary); }',
      '.dsh-bc_valley { color: var(--dsw-alias-state-success-primary); }',
      '.dsh-bc_valley .dsh-bc_val { color: var(--dsw-alias-state-success-primary); }',

      // Turn cost: a real button in the action row, same metrics as its neighbours.
      '.dsh-bc_turn {',
      '  order: 1;',
      '  display: inline-flex; align-items: center;',
      '  margin: 0; padding: 2px 6px; border: 0; border-radius: 6px; background: transparent;',
      '  font: inherit; font-size: 12px; line-height: 18px;',
      '  color: var(--dsw-alias-label-secondary);',
      '  font-variant-numeric: tabular-nums; white-space: nowrap;',
      '  cursor: pointer; -webkit-user-select: none; user-select: none;',
      '  transition: background-color 80ms, color 80ms;',
      '}',
      '.dsh-bc_turn:hover, .dsh-bc_turn[aria-expanded="true"] {',
      '  background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));',
      '  color: var(--dsw-alias-label-primary);',
      '}',
      '.dsh-bc_turn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }',

      // Frame-layer panel shared by both entries.
      '.dsh-bc_pop {',
      '  position: fixed; z-index: 60;',
      '  width: ' + PANEL_WIDTH + 'px; box-sizing: border-box;',
      '  max-height: calc(100vh - 24px); overflow: auto;',
      '  padding: 12px 14px; border-radius: 10px;',
      '  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1));',
      '  border: .5px solid var(--dsw-alias-border-l2);',
      '  box-shadow: 0 8px 24px rgba(0, 0, 0, .16);',
      '  color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 18px;',
      '  pointer-events: auto;',
      '}',
      '.dsh-bc_row { display: flex; flex-direction: column; gap: 2px; }',
      '.dsh-bc_row + .dsh-bc_row { margin-top: 10px; padding-top: 10px; border-top: .5px solid var(--dsw-alias-border-l1); }',
      '.dsh-bc_label { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; }',
      '.dsh-bc_strong { font-size: 16px; line-height: 22px; font-variant-numeric: tabular-nums; }',
      '.dsh-bc_note { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; }',
      '.dsh-bc_head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }',
      '.dsh-bc_refresh {',
      '  border: 0; padding: 2px 8px; border-radius: 6px; background: transparent;',
      '  color: var(--dsw-alias-brand-primary); font: inherit; font-size: 11px; cursor: pointer;',
      '}',
      '.dsh-bc_refresh:hover { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }',
      '.dsh-bc_refresh:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }',

      '[data-clock="end"] > span:last-child { order: 2; }',
    ].join('\n');

    const SYMBOLS = { CNY: '¥', USD: '$' };

    function money(value, currency) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
      return (SYMBOLS[currency] || '') + value.toFixed(2);
    }

    function yuan(value) {
      if (!Number.isFinite(value)) return '';
      if (value === 0) return '¥0';
      const digits = value < 0.01 ? 4 : value < 1 ? 3 : 2;
      return '¥' + value.toFixed(digits);
    }

    /** Fixed-point addition, the whale's 8-decimal ledger unit. */
    function addMoney(a, b) {
      return Math.round((a + b) * 1e8) / 1e8;
    }

    function isPeak(ms) {
      const shifted = new Date(ms + BEIJING_OFFSET_MS);
      const weekday = shifted.getUTCDay();
      if (ms >= WEEKEND_VALLEY_FROM && (weekday === 0 || weekday === 6)) return false;
      if (ms >= HOLIDAY_VALLEY_FROM && HOLIDAY_VALLEY.has(shifted.toISOString().slice(0, 10))) return false;
      const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
      return (minutes >= 540 && minutes < 720) || (minutes >= 840 && minutes < 1080);
    }

    /** Next instant whose peak state differs from `nowMs`; same scan as the whale's. */
    function nextSwitch(nowMs) {
      const current = isPeak(nowMs);
      const dayStart = Math.floor((nowMs + BEIJING_OFFSET_MS) / DAY_MS) * DAY_MS;
      for (let offset = 0; offset <= 12; offset += 1) {
        for (const hour of [0, 9, 12, 14, 18]) {
          const candidate = dayStart + offset * DAY_MS + hour * 3600000 - BEIJING_OFFSET_MS;
          if (candidate <= nowMs + 1000) continue;
          if (isPeak(candidate) !== current) return candidate;
        }
      }
      return null;
    }

    function remaining(ms) {
      if (ms === null) return '';
      if (ms <= 0) return '0m';
      const minutes = Math.floor(ms / 60000);
      if (minutes < 1) return '<1m';
      if (minutes < 60) return minutes + 'm';
      const hours = Math.floor(minutes / 60);
      return hours + 'h' + String(minutes % 60).padStart(2, '0') + 'm';
    }

    function tokenText(value) {
      const number = Number(value) || 0;
      if (number >= 1e6) return (number / 1e6).toFixed(1) + 'M';
      if (number >= 1000) return (number / 1000).toFixed(1) + 'k';
      return String(number);
    }

    function format(template, values) {
      return template.replace(/\{(\w+)\}/g, (_match, key) => (key in values ? String(values[key]) : ''));
    }

    function clockText(iso) {
      if (typeof iso !== 'string') return '';
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '';
      return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    }

    /** Same lookup as the whale: first declared name that occurs wins, unknown prices at base rates. */
    function priceForModel(model) {
      const name = String(model || '').toLowerCase();
      for (const key of Object.keys(PRICING)) {
        if (name.indexOf(key) !== -1) return PRICING[key];
      }
      return BASE_PRICE;
    }

    function messageCost(usage, atMs, model) {
      if (usage === null || typeof usage !== 'object') return 0;
      const price = priceForModel(model);
      const index = isPeak(atMs) ? 1 : 0;
      const input = Number(usage.inputTokens) || 0;
      const cache = Number(usage.cacheReadTokens) || 0;
      const output = Number(usage.outputTokens) || 0; // already includes reasoning
      return (cache / 1e6) * price.hit[index]
        + (input / 1e6) * price.miss[index]
        + (output / 1e6) * price.out[index];
    }

    //#region Shared details panel state

    // One panel at a time, in one of two modes: the composer strip's balance
    // reading, or one turn's cost breakdown.
    const panel = {
      snapshot: { open: false, mode: 'balance', anchor: null, reading: null, refresh: null, turn: null },
      listeners: new Set(),
    };

    function setPanel(patch) {
      panel.snapshot = { ...panel.snapshot, ...patch };
      for (const listener of panel.listeners) listener();
    }

    function closePanel() {
      setPanel({ open: false, anchor: null });
    }

    function isThisPanelOpen(mode, anchor) {
      return panel.snapshot.open === true && panel.snapshot.mode === mode && panel.snapshot.anchor === anchor;
    }

    function usePanelState() {
      const [, force] = React.useState(0);
      React.useEffect(() => {
        const listener = () => force((value) => value + 1);
        panel.listeners.add(listener);
        return () => {
          panel.listeners.delete(listener);
        };
      }, []);
      return panel.snapshot;
    }

    //#endregion

    //#region Composer strip

    function BalanceChip(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key;
      const [reading, setReading] = React.useState(null);
      const [clock, setClock] = React.useState(() => Date.now());
      const panelState = usePanelState();
      const buttonRef = React.useRef(null);
      const mounted = React.useRef(true);

      const load = React.useCallback(async (force) => {
        try {
          const response = await fetch(ENDPOINT + (force ? '?refresh=1' : ''), {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
          });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const data = await response.json();
          if (mounted.current) setReading(data);
        } catch (_offline) {
          if (!mounted.current) return;
          setReading((previous) => (previous && previous.ok === true
            ? { ...previous, stale: true }
            : { ok: false }));
        }
      }, []);

      React.useEffect(() => {
        mounted.current = true;
        load(false);
        const poll = setInterval(() => load(false), POLL_MS);
        const tick = setInterval(() => setClock(Date.now()), TICK_MS);
        return () => {
          mounted.current = false;
          clearInterval(poll);
          clearInterval(tick);
          closePanel();
        };
      }, [load]);

      // Keep the open panel in step with the live reading.
      React.useEffect(() => {
        if (panel.snapshot.mode !== 'balance') return;
        setPanel({ reading, refresh: () => load(true) });
      }, [reading, load]);

      const ready = Boolean(reading && reading.ok === true);
      const currency = ready ? reading.currency : undefined;
      const balanceText = ready ? money(reading.balance, currency) : '—';
      const todayText = ready ? money(reading.todayUsage, currency) : '—';

      const peak = isPeak(clock);
      const next = nextSwitch(clock);
      const countdown = remaining(next === null ? null : next - clock);
      const phaseClass = 'dsh-bc_item dsh-bc_phase ' + (peak ? 'dsh-bc_peak' : 'dsh-bc_valley');
      const expanded = panelState.open === true && panelState.mode === 'balance' && panelState.anchor === buttonRef.current;

      const item = (key, value) => h('span', { className: 'dsh-bc_item' },
        h('span', null, t(key)),
        h('span', { className: 'dsh-bc_val' }, value));

      const toggle = () => {
        const anchor = buttonRef.current;
        if (isThisPanelOpen('balance', anchor)) {
          closePanel();
          return;
        }
        setPanel({
          open: true,
          mode: 'balance',
          anchor,
          reading,
          refresh: () => load(true),
        });
      };

      return h('button', {
        type: 'button',
        ref: buttonRef,
        className: 'dsh-bc_chip',
        'aria-haspopup': 'dialog',
        'aria-expanded': expanded ? 'true' : 'false',
        'aria-label': t('details'),
        onClick: toggle,
      },
        item('balance', balanceText),
        h('span', { className: 'dsh-bc_sep', 'aria-hidden': true }, '·'),
        item('today', todayText),
        h('span', { className: 'dsh-bc_sep', 'aria-hidden': true }, '·'),
        h('span', { className: phaseClass },
          h('span', null, t(peak ? 'peak' : 'offpeak')),
          countdown === '' ? null : h('span', { className: 'dsh-bc_val' }, countdown)));
    }

    //#endregion

    //#region Model lookup

    const modelCache = new Map();

    function loadModels(sessionId) {
      const cached = modelCache.get(sessionId);
      if (cached && Date.now() - cached.at < MODELS_TTL_MS) return Promise.resolve(cached.map);
      if (cached && cached.pending) return cached.pending;
      const pending = fetch(MODELS_ENDPOINT + '?session=' + encodeURIComponent(sessionId), {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          const map = (data && data.ok === true && data.models) || {};
          modelCache.set(sessionId, { at: Date.now(), map, pending: null });
          return map;
        })
        .catch(() => {
          const fallback = cached ? cached.map : {};
          modelCache.set(sessionId, { at: cached ? cached.at : 0, map: fallback, pending: null });
          return fallback;
        });
      modelCache.set(sessionId, { at: cached ? cached.at : 0, map: cached ? cached.map : {}, pending });
      return pending;
    }

    function useModels(sessionId, messageId) {
      const [models, setModels] = React.useState(() => {
        const cached = modelCache.get(sessionId);
        return cached ? cached.map : {};
      });

      React.useEffect(() => {
        if (typeof sessionId !== 'string' || sessionId === '') return undefined;
        let alive = true;
        const cached = modelCache.get(sessionId);
        const needsFetch = !cached
          || Date.now() - cached.at > MODELS_TTL_MS
          || !Object.prototype.hasOwnProperty.call(cached.map, messageId);
        if (!needsFetch) {
          setModels(cached.map);
          return undefined;
        }
        loadModels(sessionId).then((map) => {
          if (alive) setModels(map);
        });
        return () => {
          alive = false;
        };
      }, [sessionId, messageId]);

      return models;
    }

    //#endregion

    //#region Turn usage

    function assistantNodes(snapshot) {
      const nodes = [];
      if (!snapshot || !Array.isArray(snapshot.order) || !snapshot.nodes) return nodes;
      for (const key of snapshot.order) {
        const node = snapshot.nodes.get(key);
        if (node === undefined || node.kind !== 'assistant-step') continue;
        nodes.push(node);
      }
      return nodes;
    }

    function dataOf(node) {
      return node !== undefined && node.data !== null && typeof node.data === 'object' ? node.data : {};
    }

    function usageOf(data) {
      return data.finalNode?.usage || data.usage;
    }

    function atOf(data) {
      return data.finalNode?.time ?? data.time ?? 0;
    }

    const rowsCache = new WeakMap();

    function rowsFor(snapshot, messageId) {
      if (!snapshot || !snapshot.nodes) return '';
      let perMessage = rowsCache.get(snapshot);
      if (perMessage === undefined) {
        perMessage = new Map();
        rowsCache.set(snapshot, perMessage);
      }
      const cached = perMessage.get(messageId);
      if (cached !== undefined) return cached;
      const key = computeRows(snapshot, messageId);
      perMessage.set(messageId, key);
      return key;
    }

    function computeRows(snapshot, messageId) {
      const nodes = assistantNodes(snapshot);
      let mine;
      for (const node of nodes) {
        if (dataOf(node).finalNode?.messageId === messageId) {
          mine = node;
          break;
        }
      }
      if (mine === undefined) return '';
      const turn = dataOf(mine).turn;
      if (turn === undefined) return '';
      let last;
      for (const node of nodes) {
        if (dataOf(node).turn === turn) last = node;
      }
      if (last !== mine) return '';

      const rows = [];
      for (const node of nodes) {
        const data = dataOf(node);
        if (data.turn !== turn) continue;
        const usage = usageOf(data);
        if (usage === null || typeof usage !== 'object') continue;
        rows.push([
          data.finalNode?.messageId || '',
          Number(usage.inputTokens) || 0,
          Number(usage.cacheReadTokens) || 0,
          Number(usage.outputTokens) || 0,
          atOf(data),
        ]);
      }
      if (rows.length === 0) return '';
      return JSON.stringify(rows);
    }

    //#endregion

    //#region Turn cost button

    function TurnCost({ messageId, sessionId, t, useChat }) {
      const key = useChat((snapshot) => rowsFor(snapshot, messageId));
      const models = useModels(sessionId, messageId);
      const panelState = usePanelState();
      const buttonRef = React.useRef(null);

      if (typeof key !== 'string' || key === '') return null;

      let rows;
      try {
        rows = JSON.parse(key);
      } catch (_corrupt) {
        return null;
      }
      if (!Array.isArray(rows) || rows.length === 0) return null;

      let cost = 0;
      let input = 0;
      let cache = 0;
      let output = 0;
      let lastAt = 0;
      const used = new Set();
      for (const row of rows) {
        const [id, rowInput, rowCache, rowOutput, at] = row;
        const model = models[id] || DEFAULT_MODEL;
        used.add(model);
        input += rowInput;
        cache += rowCache;
        output += rowOutput;
        lastAt = at || lastAt;
        cost = addMoney(cost, messageCost({
          inputTokens: rowInput,
          cacheReadTokens: rowCache,
          outputTokens: rowOutput,
        }, at, model));
      }

      const modelLabel = [...used].filter(Boolean).join(' / ') || DEFAULT_MODEL;
      const expanded = panelState.open === true && panelState.mode === 'turn' && panelState.anchor === buttonRef.current;

      const toggle = () => {
        const anchor = buttonRef.current;
        if (isThisPanelOpen('turn', anchor)) {
          closePanel();
          return;
        }
        setPanel({
          open: true,
          mode: 'turn',
          anchor,
          turn: {
            cost,
            steps: rows.length,
            input,
            cache,
            output,
            model: modelLabel,
            peak: isPeak(lastAt || Date.now()),
          },
        });
      };

      return h('button', {
        type: 'button',
        ref: buttonRef,
        className: 'dsh-bc_turn',
        'aria-haspopup': 'dialog',
        'aria-expanded': expanded ? 'true' : 'false',
        'aria-label': t('turnTitle') + ' ' + yuan(cost),
        onClick: toggle,
      }, yuan(cost));
    }

    //#endregion

    //#region Details panel

    function balanceRows(t, state) {
      const reading = state.reading;
      const ready = Boolean(reading && reading.ok === true);
      const currency = ready ? reading.currency : undefined;
      const peak = isPeak(Date.now());
      const next = nextSwitch(Date.now());
      const countdown = remaining(next === null ? null : next - Date.now());
      const source = ready
        ? (reading.source === 'account' ? t('sourceAccount') : t('sourceKey'))
        : t('sourceNone');
      const updated = ready ? clockText(reading.observedAt || reading.updatedAt) : '';

      return [
        h('div', { key: 'head', className: 'dsh-bc_head' },
          h('div', { className: 'dsh-bc_label' }, t('balance')),
          h('button', {
            key: 'refresh',
            type: 'button',
            className: 'dsh-bc_refresh',
            onClick: () => {
              if (typeof state.refresh === 'function') state.refresh();
            },
          }, t('refresh'))),
        h('div', { key: 'balance', className: 'dsh-bc_row' },
          h('div', { className: 'dsh-bc_strong' }, ready ? money(reading.balance, currency) : '—'),
          h('div', { className: 'dsh-bc_note' },
            [source, updated === '' ? '' : format(t('updated'), { time: updated }), ready && reading.stale ? t('stale') : '']
              .filter(Boolean).join(' · '))),
        h('div', { key: 'today', className: 'dsh-bc_row' },
          h('div', { className: 'dsh-bc_label' }, t('today')),
          h('div', { className: 'dsh-bc_strong' }, ready ? money(reading.todayUsage, currency) : '—'),
          h('div', { className: 'dsh-bc_note' }, t('todayNote'))),
        h('div', { key: 'peak', className: 'dsh-bc_row' },
          h('div', { className: 'dsh-bc_label' },
            t(peak ? 'peak' : 'offpeak') + (countdown === '' ? '' : ' ' + countdown)),
          h('div', { className: 'dsh-bc_note' }, t('peakNote'))),
      ];
    }

    function turnRows(t, turn) {
      const price = priceForModel(turn.model);
      const index = turn.peak ? 1 : 0;
      return [
        h('div', { key: 'total', className: 'dsh-bc_row' },
          h('div', { className: 'dsh-bc_label' }, t('turnTitle')),
          h('div', { className: 'dsh-bc_strong' }, yuan(turn.cost)),
          h('div', { className: 'dsh-bc_note' },
            [format(t('turnTotal'), { n: turn.steps }), format(t('turnModel'), { model: turn.model })].join(' · '))),
        h('div', { key: 'tokens', className: 'dsh-bc_row' },
          h('div', { className: 'dsh-bc_label' }, format(t('turnTokens'), {
            input: tokenText(turn.input),
            cache: tokenText(turn.cache),
            output: tokenText(turn.output),
          }))),
        h('div', { key: 'rate', className: 'dsh-bc_row' },
          h('div', { className: 'dsh-bc_note' }, format(t('turnRate'), {
            phase: t(turn.peak ? 'peak' : 'offpeak'),
            miss: price.miss[index],
            hit: price.hit[index],
            out: price.out[index],
          }))),
      ];
    }

    function DetailsPanel(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key;
      const state = usePanelState();
      const panelRef = React.useRef(null);
      const open = state.open === true && state.anchor !== null;

      React.useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          const box = panelRef.current;
          const anchor = state.anchor;
          if (box !== null && box.contains(event.target)) return;
          if (anchor !== null && anchor.contains(event.target)) return;
          closePanel();
        };
        const onKeyDown = (event) => {
          if (event.key === 'Escape') closePanel();
        };
        const onViewportChange = (event) => {
          const box = panelRef.current;
          if (event && event.target && box !== null && box.contains(event.target)) return;
          closePanel();
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('resize', onViewportChange);
        document.addEventListener('scroll', onViewportChange, true);
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown, true);
          window.removeEventListener('resize', onViewportChange);
          document.removeEventListener('scroll', onViewportChange, true);
        };
      }, [open, state.anchor]);

      if (!open) return null;

      const rect = state.anchor.getBoundingClientRect();
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 12));
      const style = {
        left: left + 'px',
        top: Math.max(12, rect.top - 8) + 'px',
        transform: 'translateY(-100%)',
      };

      const rows = state.mode === 'turn' && state.turn !== null
        ? turnRows(t, state.turn)
        : balanceRows(t, state);

      return h('div', {
        ref: panelRef,
        className: 'dsh-bc_pop',
        style,
        role: 'dialog',
        'aria-label': t('details'),
      }, rows);
    }

    //#endregion

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          for (const stale of document.querySelectorAll('style[data-plugin-css^="@akagiyui/balance-chip/"]')) stale.remove();
          const tag = document.createElement('style');
          tag.dataset.plugin = '@akagiyui/balance-chip';
          tag.dataset.pluginCss = '@akagiyui/balance-chip/chip.css';
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'balance-chip: stylesheet');

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'balance-chip: dictionaries');

        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'balance-chip',
          order: 2,
          locale: NS,
        }, BalanceChip));

        ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
          name: 'conversation.chat.assistant-actions',
          id: 'balance-chip-turn',
          order: 50,
          locale: NS,
        }, TurnCost));

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'balance-chip.panel',
          order: 40,
          locale: NS,
        }, DetailsPanel));
      },
    };
  },
});
