/**
 * Client half of generic lifecycle hooks.
 *
 * The bundle's page in Plugins → (this bundle) is the whole surface: a list of
 * hooks, an inline editor, and the last run of each one. Everything is stored
 * on the Host at `/generic-hooks/state`; this file only renders and posts the
 * list back, so the page and the agent runtime always see the same hooks.
 *
 * No other harness dialect is involved: the event picker is DSH's own event
 * catalog and the hint under the form says what a blocking exit means there.
 */
window.__ModuleLoader__.load({
  id: 'dsh-generic-hooks',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'generic-hooks';
    const ENDPOINT = '/generic-hooks/state';
    const DEFAULT_TIMEOUT_SEC = 60;

    const zh = {
      title: '生命周期钩子',
      summary: '{count} 个钩子 · {enabled} 个启用',
      summaryEmpty: '还没有钩子',
      empty: '还没有钩子。添加一个，让命令在事件发生时运行。',
      add: '添加钩子',
      newTitle: '新建钩子',
      editTitle: '编辑钩子',
      event: '事件',
      matcher: '匹配器',
      matcherHint: '工具名精确匹配；含正则符号（. * ^ $ 等）时按正则；用 | 分隔多个。',
      runner: '执行方式',
      runnerShell: 'Shell 命令',
      runnerProcess: '进程',
      program: '程序',
      args: '参数',
      argsHint: '一行一个参数，按字面作为 argv；不经过 shell。',
      processNote: '不经过 shell：没有管道、重定向或 $VAR，参数按字面传递，退出码原样保留。',
      shellNote: '交给 shell 解释：支持管道、重定向和变量，但受平台 shell 差异影响。',
      command: '命令',
      commandHint: '在会话目录下运行，stdin 收到一段 JSON。',
      timeout: '超时（秒）',
      enabled: '启用',
      disabled: '停用',
      save: '保存',
      saving: '保存中…',
      loading: '读取中…',
      cancel: '取消',
      edit: '编辑',
      delete: '删除',
      confirmDelete: '删除这个钩子？',
      confirm: '删除',
      keep: '保留',
      refresh: '刷新',
      retry: '重试',
      loadFailed: '读取钩子失败：{error}',
      saveFailed: '保存失败：{error}',
      commandRequired: '命令不能为空。',
      allTools: '所有工具',
      never: '尚未运行',
      lastRun: '退出码 {exit} · {ms} ms',
      lastBlocked: '已拦截 · {ms} ms',
      lastError: '运行出错 · {ms} ms',
      hintDenyAsk: '退出码 2 拦截该工具调用，stderr 作为原因；输出 {"decision":"ask"} 则先询问。',
      hintBlock: '退出码 2 用 stderr 作为反馈替换工具结果。',
      hintReject: '退出码 2 在模型运行前丢弃这条提示词。',
      hintObserve: '随事件一起运行，只记录结果，不参与决策。',
      payload: 'stdin：{hook_event, session_id, cwd, …事件字段}',
      note: '命令通过 harness 的 shell 执行，受会话沙箱约束：默认只能写工作区。',
      observe: '观察',
      blocking: '可拦截',
      runState: '最近一次运行',
    };

    const en = {
      title: 'Lifecycle hooks',
      summary: '{count} hooks · {enabled} enabled',
      summaryEmpty: 'No hooks yet',
      empty: 'No hooks yet. Add one to run a command when an event happens.',
      add: 'Add hook',
      newTitle: 'New hook',
      editTitle: 'Edit hook',
      event: 'Event',
      matcher: 'Matcher',
      matcherHint: 'Exact tool name; a part with regex syntax (. * ^ $ …) is used as a regex; | lists alternatives.',
      runner: 'Runner',
      runnerShell: 'Shell command',
      runnerProcess: 'Process',
      program: 'Program',
      args: 'Arguments',
      argsHint: 'One argument per line, passed literally as argv; no shell.',
      processNote: 'No shell: no pipes, redirects or $VARs; arguments are literal and the exit code survives intact.',
      shellNote: 'Handed to the shell: pipes, redirects and variables work, with platform shell differences.',
      command: 'Command',
      commandHint: 'Runs in the session directory with a JSON payload on stdin.',
      timeout: 'Timeout (seconds)',
      enabled: 'Enabled',
      disabled: 'Disabled',
      save: 'Save',
      saving: 'Saving…',
      loading: 'Loading…',
      cancel: 'Cancel',
      edit: 'Edit',
      delete: 'Delete',
      confirmDelete: 'Delete this hook?',
      confirm: 'Delete',
      keep: 'Keep',
      refresh: 'Refresh',
      retry: 'Retry',
      loadFailed: 'Could not load hooks: {error}',
      saveFailed: 'Could not save: {error}',
      commandRequired: 'A command is required.',
      allTools: 'all tools',
      never: 'never run',
      lastRun: 'exit {exit} · {ms} ms',
      lastBlocked: 'blocked · {ms} ms',
      lastError: 'failed · {ms} ms',
      hintDenyAsk: 'Exit 2 blocks the tool and shows stderr as the reason; {"decision":"ask"} asks first.',
      hintBlock: 'Exit 2 replaces the tool result with stderr as feedback.',
      hintReject: 'Exit 2 drops the prompt before the model runs.',
      hintObserve: 'Runs alongside the event. The result is recorded and decides nothing.',
      payload: 'stdin: {hook_event, session_id, cwd, …event fields}',
      note: 'Commands run through the harness shell under the session sandbox, so writes stay inside the workspace by default.',
      observe: 'observe',
      blocking: 'blocking',
      runState: 'Last run',
    };

    const CSS = `
.dsh-gh_root { display: flex; flex-direction: column; gap: 10px; color: var(--dsw-alias-label-primary); }
.dsh-gh_head { display: flex; align-items: baseline; gap: 8px; }
.dsh-gh_title { font-size: 13px; font-weight: 600; }
.dsh-gh_count { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-gh_spacer { flex: 1; }
.dsh-gh_textButton { appearance: none; border: 0; background: none; padding: 2px 4px; font: inherit; font-size: 12px; color: var(--dsw-alias-label-secondary); cursor: pointer; border-radius: 6px; }
.dsh-gh_textButton:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
.dsh-gh_textButton:disabled { opacity: .5; cursor: default; }
.dsh-gh_primary { appearance: none; border: 0; padding: 6px 12px; font: inherit; font-size: 12px; font-weight: 500; color: #fff; background: var(--dsw-alias-brand-primary); border-radius: 8px; cursor: pointer; }
.dsh-gh_primary:disabled { opacity: .5; cursor: default; }
.dsh-gh_ghost { appearance: none; padding: 6px 12px; font: inherit; font-size: 12px; color: var(--dsw-alias-label-primary); background: transparent; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; cursor: pointer; }
.dsh-gh_ghost:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-gh_list { display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); }
.dsh-gh_row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; min-height: 34px; }
.dsh-gh_row + .dsh-gh_row { border-top: 1px solid var(--dsw-alias-border-l1); }
.dsh-gh_dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--dsw-alias-state-idle-primary); opacity: .5; }
.dsh-gh_dot[data-state="ok"] { background: var(--dsw-alias-state-success-primary); opacity: 1; }
.dsh-gh_dot[data-state="blocked"] { background: var(--dsw-alias-state-warn-primary); opacity: 1; }
.dsh-gh_dot[data-state="error"] { background: var(--dsw-alias-state-error-primary); opacity: 1; }
.dsh-gh_event { flex: none; font-size: 12px; font-weight: 500; }
.dsh-gh_tag { flex: none; font-size: 10px; line-height: 1; padding: 3px 5px; border-radius: 4px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }
.dsh-gh_match { flex: none; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-gh_command { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-gh_run { flex: none; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-gh_actions { flex: none; display: flex; gap: 2px; }
.dsh-gh_editor { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
.dsh-gh_editorHead { font-size: 12px; font-weight: 600; }
.dsh-gh_form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
.dsh-gh_field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dsh-gh_field--wide { grid-column: 1 / -1; }
.dsh-gh_label { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-gh_input, .dsh-gh_select, .dsh-gh_area { box-sizing: border-box; width: 100%; padding: 6px 8px; font: inherit; font-size: 12px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; }
.dsh-gh_area { resize: vertical; min-height: 52px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.dsh-gh_input:focus, .dsh-gh_select:focus, .dsh-gh_area:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.dsh-gh_input:disabled { opacity: .55; }
.dsh-gh_hint { font-size: 11px; line-height: 1.45; color: var(--dsw-alias-label-secondary); }
.dsh-gh_error { font-size: 11px; color: var(--dsw-alias-state-error-primary); }
.dsh-gh_footer { display: flex; align-items: center; gap: 8px; }
.dsh-gh_note { font-size: 11px; line-height: 1.45; color: var(--dsw-alias-label-secondary); }
.dsh-gh_summary { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-gh_check { display: flex; align-items: center; gap: 6px; font-size: 12px; }
`;

    let translate = (key) => key;

    function translation(props) {
      const source = props || {};
      if (typeof source.t === 'function') return source.t;
      return translate;
    }

    function format(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (_match, key) => (key in values ? String(values[key]) : ''));
    }

    async function request(method, body) {
      const response = await fetch(ENDPOINT, {
        method,
        headers: body === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
        cache: 'no-store',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const payload = await response.json().catch(() => null);
      if (!payload || payload.ok !== true) {
        throw new Error((payload && payload.error) || `HTTP ${response.status}`);
      }
      return payload;
    }

    function emptyDraft() {
      return { id: '', event: 'tools/pre-execute', matcher: '', runner: 'shell', command: '', argsText: '', timeoutSec: DEFAULT_TIMEOUT_SEC, enabled: true };
    }

    function eventOf(events, name) {
      return events.find((entry) => entry.event === name) || events[0];
    }

    function runState(run) {
      if (!run) return 'idle';
      if (run.error !== undefined || run.timedOut === true) return 'error';
      if (run.decision === 'block' || run.exitCode === 2) return 'blocked';
      if (run.exitCode === 0) return 'ok';
      return 'error';
    }

    function runText(t, run) {
      if (!run) return t('never');
      const ms = typeof run.durationMs === 'number' ? run.durationMs : 0;
      if (run.error !== undefined) return format(t('lastError'), { ms });
      if (run.exitCode === 2 || run.decision === 'block') return format(t('lastBlocked'), { ms });
      return format(t('lastRun'), { exit: run.exitCode === null || run.exitCode === undefined ? '—' : run.exitCode, ms });
    }

    function hintFor(t, decision) {
      if (decision === 'deny-ask') return t('hintDenyAsk');
      if (decision === 'block') return t('hintBlock');
      if (decision === 'reject') return t('hintReject');
      return t('hintObserve');
    }

    function Summary(props) {
      const t = translation(props);
      const data = props.data;
      if (!data) return h('div', { className: 'dsh-gh_summary' }, t('summaryEmpty'));
      const enabled = data.hooks.filter((hook) => hook.enabled).length;
      return h('div', { className: 'dsh-gh_summary' },
        format(t('summary'), { count: data.hooks.length, enabled }));
    }

    function Field(props) {
      return h('div', { className: 'dsh-gh_field' + (props.wide ? ' dsh-gh_field--wide' : '') },
        h('span', { className: 'dsh-gh_label' }, props.label),
        props.children);
    }

    function HooksPanel(props) {
      const t = translation(props);
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState('');
      const [formError, setFormError] = React.useState('');
      const [draft, setDraft] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [loading, setLoading] = React.useState(false);
      const [confirming, setConfirming] = React.useState('');

      const load = () => {
        setLoading(true);
        request('GET')
          .then((next) => {
            setData(next);
            setError('');
          })
          .catch((failure) => setError(String((failure && failure.message) || failure)))
          .finally(() => setLoading(false));
      };

      React.useEffect(() => {
        load();
      }, []);

      const save = (next) => {
        setBusy(true);
        setFormError('');
        request('POST', { hooks: next })
          .then((saved) => {
            setData(saved);
            setDraft(null);
            setError('');
          })
          .catch((failure) => setFormError(String((failure && failure.message) || failure)))
          .finally(() => setBusy(false));
      };

      const commit = () => {
        if (!draft) return;
        const command = String(draft.command || '').trim();
        if (command === '') {
          setFormError(t('commandRequired'));
          return;
        }
        const timeout = Math.min(Math.max(Math.round(Number(draft.timeoutSec) || DEFAULT_TIMEOUT_SEC), 1), 600);
        const runner = draft.runner === 'process' ? 'process' : 'shell';
        const args = runner === 'process'
          ? String(draft.argsText || '').split('\n').map((line) => line.trim()).filter((line) => line !== '')
          : [];
        const entry = {
          event: draft.event,
          matcher: String(draft.matcher || '').trim(),
          runner,
          command,
          args,
          timeoutSec: timeout,
          enabled: draft.enabled !== false,
        };
        const hooks = data ? data.hooks.slice() : [];
        if (draft.id) {
          const index = hooks.findIndex((hook) => hook.id === draft.id);
          if (index >= 0) hooks[index] = Object.assign({}, hooks[index], entry, { id: draft.id });
          else hooks.push(entry);
        } else {
          hooks.push(entry);
        }
        save(hooks);
      };

      const toggle = (hook) => {
        if (!data) return;
        save(data.hooks.map((entry) => entry.id === hook.id ? Object.assign({}, entry, { enabled: !entry.enabled }) : entry));
      };

      const remove = (hook) => {
        if (!data) return;
        setConfirming('');
        save(data.hooks.filter((entry) => entry.id !== hook.id));
      };

      if (props.view === 'summary') return h(Summary, { t, data });

      const events = data ? data.events : [];

      return h('div', { className: 'dsh-gh_root' },
        h('div', { className: 'dsh-gh_head' },
          h('span', { className: 'dsh-gh_title' }, t('title')),
          h('span', { className: 'dsh-gh_count' }, data ? format(t('summary'), {
            count: data.hooks.length,
            enabled: data.hooks.filter((hook) => hook.enabled).length,
          }) : ''),
          h('span', { className: 'dsh-gh_spacer' }),
          h('button', {
            type: 'button',
            className: 'dsh-gh_textButton',
            onClick: load,
            disabled: loading,
          }, loading ? t('saving') : t('refresh'))),

        error !== '' ? h('div', { className: 'dsh-gh_error' }, format(t('loadFailed'), { error })) : null,
        error !== '' ? h('div', null, h('button', { type: 'button', className: 'dsh-gh_ghost', onClick: load }, t('retry'))) : null,

        data && data.hooks.length === 0 && draft === null
          ? h('div', { className: 'dsh-gh_hint' }, t('empty'))
          : null,

        data && data.hooks.length > 0
          ? h('div', { className: 'dsh-gh_list' }, data.hooks.map((hook) => {
            const run = data.runs ? data.runs[hook.id] : undefined;
            const event = eventOf(events, hook.event);
            return h('div', { className: 'dsh-gh_row', key: hook.id },
              h('span', { className: 'dsh-gh_dot', 'data-state': runState(run) }),
              h('span', { className: 'dsh-gh_event' }, event ? event.label : hook.event),
              event && event.decision === 'observe' ? h('span', { className: 'dsh-gh_tag' }, t('observe')) : null,
              h('span', { className: 'dsh-gh_match', title: hook.matcher || t('allTools') }, hook.matcher || '·'),
              h('code', { className: 'dsh-gh_command', title: hook.command }, hook.command),
              h('span', { className: 'dsh-gh_run', title: t('runState') }, runText(t, run)),
              h('span', { className: 'dsh-gh_actions' },
                h('button', {
                  type: 'button',
                  role: 'switch',
                  'aria-checked': hook.enabled ? 'true' : 'false',
                  'aria-label': t('enabled'),
                  className: 'dsh-gh_textButton',
                  style: { color: hook.enabled ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)' },
                  disabled: busy,
                  onClick: () => toggle(hook),
                }, hook.enabled ? '●' : '○'),
                h('button', {
                  type: 'button',
                  className: 'dsh-gh_textButton',
                  disabled: busy,
                  onClick: () => {
                    setFormError('');
                    setDraft(Object.assign({}, hook, { argsText: (hook.args || []).join('\n') }));
                  },
                }, t('edit')),
                confirming === hook.id
                  ? h('span', null,
                    h('span', { className: 'dsh-gh_hint' }, t('confirmDelete')),
                    h('button', { type: 'button', className: 'dsh-gh_textButton', onClick: () => remove(hook) }, t('confirm')),
                    h('button', { type: 'button', className: 'dsh-gh_textButton', onClick: () => setConfirming('') }, t('keep')))
                  : h('button', {
                    type: 'button',
                    className: 'dsh-gh_textButton',
                    disabled: busy,
                    onClick: () => setConfirming(hook.id),
                  }, t('delete'))));
          }))
          : null,

        data === null && draft === null
          ? (error === '' ? h('div', { className: 'dsh-gh_hint' }, t('loading')) : null)
          : draft === null
            ? h('div', null, h('button', {
            type: 'button',
            className: 'dsh-gh_ghost',
            onClick: () => {
              setFormError('');
              setDraft(emptyDraft());
              },
            }, '+ ' + t('add')))
            : h('div', { className: 'dsh-gh_editor' },
            h('div', { className: 'dsh-gh_editorHead' }, draft.id ? t('editTitle') : t('newTitle')),
            h('div', { className: 'dsh-gh_form' },
              h(Field, { label: t('runner') },
                h('select', {
                  className: 'dsh-gh_select',
                  value: draft.runner === 'process' ? 'process' : 'shell',
                  onChange: (event) => setDraft(Object.assign({}, draft, { runner: event.target.value })),
                },
                h('option', { value: 'shell' }, t('runnerShell')),
                h('option', { value: 'process' }, t('runnerProcess')))),
              h(Field, { label: t('event') },
                h('select', {
                  className: 'dsh-gh_select',
                  value: draft.event,
                  onChange: (event) => {
                    const value = event.target.value;
                    const info = eventOf(events, value);
                    setDraft(Object.assign({}, draft, {
                      event: value,
                      matcher: info && info.tool ? draft.matcher : '',
                    }));
                  },
                }, events.map((entry) => h('option', { key: entry.event, value: entry.event }, entry.label)))),
              h(Field, { label: t('matcher') },
                h('input', {
                  className: 'dsh-gh_input',
                  type: 'text',
                  value: draft.matcher,
                  disabled: !(eventOf(events, draft.event) || {}).tool,
                  placeholder: 'bash|write|edit',
                  onChange: (event) => setDraft(Object.assign({}, draft, { matcher: event.target.value })),
                })),
              h(Field, { label: t('timeout') },
                h('input', {
                  className: 'dsh-gh_input',
                  type: 'number',
                  min: 1,
                  max: 600,
                  value: draft.timeoutSec,
                  onChange: (event) => setDraft(Object.assign({}, draft, { timeoutSec: event.target.value })),
                })),
              h(Field, { label: draft.runner === 'process' ? t('program') : t('command'), wide: true },
                draft.runner === 'process'
                  ? h('input', {
                    className: 'dsh-gh_input',
                    type: 'text',
                    value: draft.command,
                    placeholder: 'node',
                    onChange: (event) => setDraft(Object.assign({}, draft, { command: event.target.value })),
                  })
                  : h('textarea', {
                    className: 'dsh-gh_area',
                    rows: 2,
                    value: draft.command,
                    placeholder: 'node scripts/check.mjs',
                    onChange: (event) => setDraft(Object.assign({}, draft, { command: event.target.value })),
                  })),
              draft.runner === 'process'
                ? h(Field, { label: t('args'), wide: true },
                  h('textarea', {
                    className: 'dsh-gh_area',
                    rows: 3,
                    value: draft.argsText || '',
                    placeholder: 'scripts/check.mjs\n--strict',
                    onChange: (event) => setDraft(Object.assign({}, draft, { argsText: event.target.value })),
                  }))
                : null,
              h(Field, { label: t('enabled') },
                h('label', { className: 'dsh-gh_check' },
                  h('input', {
                    type: 'checkbox',
                    checked: draft.enabled !== false,
                    onChange: (event) => setDraft(Object.assign({}, draft, { enabled: event.target.checked })),
                  }),
                  h('span', { className: 'dsh-gh_label' }, draft.enabled !== false ? t('enabled') : t('disabled'))))),

            h('div', { className: 'dsh-gh_hint' }, hintFor(t, (eventOf(events, draft.event) || {}).decision)),
            h('div', { className: 'dsh-gh_hint' }, draft.runner === 'process' ? t('processNote') : t('shellNote')),
            h('div', { className: 'dsh-gh_hint' }, draft.runner === 'process' ? t('argsHint') : t('commandHint')),
            h('div', { className: 'dsh-gh_hint' }, t('matcherHint')),
            h('div', { className: 'dsh-gh_hint' }, t('payload')),
            formError !== '' ? h('div', { className: 'dsh-gh_error' }, formError) : null,
            h('div', { className: 'dsh-gh_footer' },
              h('button', { type: 'button', className: 'dsh-gh_primary', disabled: busy, onClick: commit }, busy ? t('saving') : t('save')),
              h('button', { type: 'button', className: 'dsh-gh_ghost', onClick: () => setDraft(null) }, t('cancel')))),

        h('div', { className: 'dsh-gh_note' }, t('note')));
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          for (const stale of document.querySelectorAll('style[data-plugin-css^="dsh-generic-hooks/"]')) stale.remove();
          const tag = document.createElement('style');
          tag.dataset.plugin = 'dsh-generic-hooks';
          tag.dataset.pluginCss = 'dsh-generic-hooks/hooks.css';
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'generic-hooks: stylesheet');

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'generic-hooks: dictionaries');

        ctx.effect(() => {
          const bound = ctx.locale.bind(NS);
          translate = (key) => bound(key);
          return () => {
            translate = (key) => key;
          };
        }, 'generic-hooks: translations');

        // The bundle page dispatches one key per package name. A local link
        // installs under @local/generic-hooks, npm under dsh-generic-hooks.
        ctx.slots.inject('plugins.bundle.config', () => {
          const disposers = ['dsh-generic-hooks', '@local/generic-hooks'].map((name) => ctx.slots.register({
            name: 'plugins.bundle.config',
            key: name,
            locale: NS,
          }, HooksPanel));
          return () => {
            for (const dispose of disposers) {
              if (typeof dispose === 'function') dispose();
            }
          };
        });
      },
    };
  },
});
