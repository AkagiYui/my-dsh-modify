window.__ModuleLoader__.load({
  id: '@akagiyui/dsh-ui-tweaks',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /**
     * One bundle for five independent interface tweaks:
     *
     * 1. Conversation content width — a root attribute widens
     *    `[data-conversation-content]`, from which the chat column, composer,
     *    approval/question cards and user bubbles derive their width.
     * 2. Sidebar account label — the shipped name is hidden, kept, or replaced
     *    by a label typed in Settings, without touching React's tree.
     * 3. Feedback entries — the Like/Dislike pair and the two menu rows
     *    (`意见反馈`, `反馈`) are hidden by label-matched selectors; the menu
     *    rows are found by a MutationObserver because the shell renders them
     *    from data and exposes no stable id.
     * 4. Sidebar "More" row — the shell renders that row itself, so it is
     *    hidden by a scoped stylesheet instead of a slot unregistration.
     * 5. Full-access risk dialog — the shipped two-step confirmation is driven
     *    to its confirm action in the same frame, so picking `完全权限` takes
     *    effect without the modal.
     *
     * Everything is stored in one key so the five toggles stay consistent, and
     * the two keys from the former single-purpose bundles are imported once so
     * existing preferences survive the merge.
     */

    const NS = 'ui-tweaks';
    const STORAGE_KEY = 'dsh.ui-tweaks';
    const LEGACY_WIDTH_KEY = 'dsh.conversation-content-width';
    const LEGACY_ACCOUNT_KEY = 'dsh.sidebar-account-display';

    const ATTR_WIDTH = 'data-dsh-ui-tweaks-width';
    const ATTR_ACCOUNT = 'data-dsh-ui-tweaks-account';
    const ATTR_FEEDBACK = 'data-dsh-ui-tweaks-feedback';
    const ATTR_MORE = 'data-dsh-ui-tweaks-more';
    const ATTR_CONFIRM = 'data-dsh-ui-tweaks-full-access';
    const ACCOUNT_VAR = '--dsh-ui-tweaks-account-label';
    const ROW_MARK = 'data-dsh-ui-tweaks-feedback-row';
    const OPTION_MARK = 'data-dsh-ui-tweaks-feedback-option';
    const DIALOG_MARK = 'data-dsh-ui-tweaks-full-access-dialog';

    /** The shipped modal portal; hiding it takes the mask and the dialog together. */
    const MODAL_ROOT_SELECTOR = '[role="presentation"]';
    const DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"]';
    const CONFIRM_ATTEMPTS = 45;

    // The Host package that owns the /feedback command and the sessionFeedback
    // Remote; disabling its row removes the command from the catalog, so both
    // composer menus lose the entry instead of merely hiding it.
    const COMMAND_MODULE = '@deepseek-ai/dsh-command-feedback';
    const COMMAND_ENTRY = 'include:command-feedback';
    const MANAGED_KEY = 'dsh.ui-tweaks.feedback-command-managed';

    const WIDTH_MODES = ['default', 'wide'];
    const ACCOUNT_MODES = ['original', 'hidden', 'custom'];
    const ACCOUNT_MAX_TEXT = 24;

    const DEFAULTS = {
      width: 'default',
      account: { mode: 'hidden', text: '' },
      hideFeedback: true,
      hideSidebarMore: true,
      skipFullAccessConfirm: true,
    };

    const ACTIONS_SLOT = '[data-slot="conversation.chat.assistant-actions"]';

    /** Localized Like/Dislike labels, active ratings included. */
    const RATING_LABELS = [
      '好的回答',
      '有问题的回答',
      '取消标记',
      'Good response',
      'Bad response',
      'Remove rating',
    ];

    /** Localized labels of the account-menu `contact` row and the header-menu `feedback` row. */
    const MENU_LABELS = new Set([
      '意见反馈',
      'Feedback',
      'フィードバック',
      'Comentarios',
      'Commentaires',
      'Rückmeldung',
      'Обратная связь',
      'Comentários',
      '反馈',
    ]);

    /** The sidebar "More" row's accessible name in the shipped translations. */
    const MORE_LABELS = ['更多', 'More', 'その他', 'Más', 'Plus', 'Mehr', 'Ещё', 'Mais'];

    /**
     * The full-access risk dialog's title and primary action in every shipped
     * dictionary. `RiskConfirmation` has no stable identity of its own, so the
     * title plus the acknowledgement checkbox is what distinguishes this dialog
     * from the other risk modal (Auto review), which must stay untouched.
     */
    const FULL_ACCESS_TITLES = new Set([
      '确认启用完全权限？',
      'Enable Full access?',
      'フルアクセスを有効にしますか？',
      '¿Habilitar acceso completo?',
      "Activer l'accès complet ?",
      'Vollzugriff aktivieren?',
      'Включить полный доступ?',
      'Ativar acesso total?',
    ]);

    const FULL_ACCESS_ENABLE = new Set([
      '启用完全权限',
      'Enable Full access',
      'フルアクセスを有効にする',
      'Habilitar acceso completo',
      "Activer l'accès complet",
      'Aktivieren Sie Vollzugriff',
      'Включить полный доступ',
      'Ativar acesso total',
    ]);

    const quote = (value) => JSON.stringify(value);

    const zh = {
      'meta.title': '界面微调',
      'meta.description': '一个插件控制对话内容宽度、侧边栏账号显示，并可按需隐藏反馈入口、侧边栏的「更多」和启用完全权限时的风险确认，开关都在 设置 → 通用 中。',
      'width.title': '对话内容宽度',
      'width.description': '默认沿用内置宽度并可拖动两侧手柄；宽屏让对话内容铺满窗口，左右只保留细边距。',
      'width.mode.default': '默认',
      'width.mode.wide': '宽屏',
      'account.title': '侧边栏账号显示',
      'account.description': '控制侧边栏底部账号行显示的内容：原名称、仅头像或自定义文字。',
      'account.mode.original': '默认',
      'account.mode.hidden': '仅头像',
      'account.mode.custom': '自定义',
      'account.placeholder': '输入要显示的名称',
      'feedback.title': '隐藏反馈入口',
      'feedback.description': '隐藏回答评分、账号菜单、更多菜单和输入框「+」菜单里的反馈入口，并从 Host 侧停用反馈命令，使其从命令菜单中真正移除。',
      'more.title': '隐藏侧边栏的「更多」',
      'more.description': '隐藏侧边栏面板列表末尾的「更多」入口，插件与自动化任务等入口保持不变。',
      'fullAccess.title': '完全权限二次确认',
      'fullAccess.description': '在权限菜单里选择「完全权限」时，不再弹出勾选风险提示的确认窗口，直接生效。关闭后恢复内置的二次确认。',
      'toggle.show': '显示',
      'toggle.hide': '隐藏',
    };

    const en = {
      'meta.title': 'Interface tweaks',
      'meta.description': 'One plugin for conversation content width, the sidebar account label, and optionally hiding the feedback entries, the sidebar More row, and the Full access risk dialog. Every switch lives in Settings → General.',
      'width.title': 'Conversation content width',
      'width.description': 'Default keeps the built-in width and its side drag handles; widescreen fills the window with slim side gutters.',
      'width.mode.default': 'Default',
      'width.mode.wide': 'Widescreen',
      'account.title': 'Sidebar account label',
      'account.description': 'Choose what the account row at the foot of the sidebar shows: the shipped name, the avatar alone, or your own text.',
      'account.mode.original': 'Default',
      'account.mode.hidden': 'Avatar only',
      'account.mode.custom': 'Custom',
      'account.placeholder': 'Name to display',
      'feedback.title': 'Hide feedback entries',
      'feedback.description': 'Hide the reply ratings, the account and More-actions menu entries, and the composer + menu entry, and disable the feedback command on the Host so it leaves the command catalog.',
      'more.title': 'Hide the sidebar More row',
      'more.description': 'Hide the More entry at the end of the sidebar panel list; plugin and automation entries stay unchanged.',
      'fullAccess.title': 'Full access confirmation',
      'fullAccess.description': 'Choosing Full access in the permission menu applies it at once instead of opening the risk dialog. Turn this off to restore the shipped two-step confirmation.',
      'toggle.show': 'Show',
      'toggle.hide': 'Hide',
    };

    /** Compare a label by visible text: NBSP (fr), nested spans and odd spacing collapse away. */
    function normalizeLabel(value) {
      return String(value ?? '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function sanitizeText(value) {
      return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, ACCOUNT_MAX_TEXT);
    }

    function normalize(raw) {
      const source = raw !== null && typeof raw === 'object' ? raw : {};
      const account = source.account !== null && typeof source.account === 'object' ? source.account : {};
      return {
        width: WIDTH_MODES.includes(source.width) ? source.width : DEFAULTS.width,
        account: {
          mode: ACCOUNT_MODES.includes(account.mode) ? account.mode : DEFAULTS.account.mode,
          text: sanitizeText(account.text),
        },
        hideFeedback: typeof source.hideFeedback === 'boolean' ? source.hideFeedback : DEFAULTS.hideFeedback,
        hideSidebarMore: typeof source.hideSidebarMore === 'boolean' ? source.hideSidebarMore : DEFAULTS.hideSidebarMore,
        skipFullAccessConfirm: typeof source.skipFullAccessConfirm === 'boolean'
          ? source.skipFullAccessConfirm
          : DEFAULTS.skipFullAccessConfirm,
      };
    }

    /**
     * Import the two keys written by the former single-purpose bundles. The
     * old keys are left untouched so rolling back to those bundles keeps its
     * preferences.
     */
    function legacyState() {
      let width = DEFAULTS.width;
      try {
        const stored = localStorage.getItem(LEGACY_WIDTH_KEY);
        if (WIDTH_MODES.includes(stored)) width = stored;
      } catch (_unreadable) {
        // Storage being unavailable only costs persistence.
      }

      let account = { ...DEFAULTS.account };
      try {
        const raw = localStorage.getItem(LEGACY_ACCOUNT_KEY);
        if (raw !== null) {
          const parsed = JSON.parse(raw);
          if (ACCOUNT_MODES.includes(parsed?.mode)) {
            account = {
              mode: parsed.mode,
              text: sanitizeText(parsed?.text),
            };
          }
        }
      } catch (_unreadable) {
        // A malformed legacy value falls back to the shipped default.
      }

      return { width, account, hideFeedback: true, hideSidebarMore: true };
    }

    function readState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw !== null) return normalize(JSON.parse(raw));
      } catch (_unreadable) {
        // Fall through to the legacy import.
      }
      const migrated = normalize(legacyState());
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      } catch (_full) {
        // A blocked storage area only costs persistence.
      }
      return migrated;
    }

    function writeState(next) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch (_full) {
        // A blocked storage area only costs persistence, never the live change.
      }
    }

    let state = readState();

    /** The plugin-manager client face, when the profile has one. */
    let commandManager = null;

    /** Feedback menu rows this effect disabled, so disposal restores only its own writes. */
    let feedbackWatch = null;

    /** The full-access confirmation this effect is driving, while it is mounted. */
    let confirmWatch = null;

    function menuLabel(button) {
      for (const child of button.children) {
        if (child.tagName !== 'SPAN') continue;
        if (child.getAttribute('aria-hidden') === 'true') continue;
        const text = (child.textContent ?? '').trim();
        if (text !== '') return text;
      }
      return '';
    }

    /**
     * The visible title of a composer menu option. The popupSelect view leads
     * with `span.label`, while the input-trigger menu leads with an aria-hidden
     * icon span followed by `span.itemName`, `span.itemAlias` (the command name)
     * and `span.itemDescription`; the first non-hidden span with text is the
     * title in both.
     */
    function optionLabel(option) {
      for (const span of option.querySelectorAll('span')) {
        if (span.getAttribute('aria-hidden') === 'true') continue;
        const text = (span.textContent ?? '').trim();
        if (text !== '') return text;
      }
      return '';
    }

    function startFeedbackWatch() {
      if (feedbackWatch !== null || typeof document === 'undefined' || document.body === null) return;

      const disabled = new Set();

      const hideRow = (button) => {
        if (button.hasAttribute(ROW_MARK)) return;
        const wrapper = button.parentElement;
        // `div(itemWrap)` wraps a row; a submenu row can sit directly in the
        // `[role=menu]` list, where the button itself is the unit.
        const target = wrapper !== null && wrapper.getAttribute('role') !== 'menu' ? wrapper : button;
        target.setAttribute(ROW_MARK, '');
        button.setAttribute(ROW_MARK, '');
        if (!button.disabled) {
          button.disabled = true;
          disabled.add(button);
        }
        button.setAttribute('aria-hidden', 'true');
        button.tabIndex = -1;
      };

      const consider = (button) => {
        if (button.hasAttribute(ROW_MARK)) return;
        if (!MENU_LABELS.has(menuLabel(button))) return;
        hideRow(button);
      };

      /** The composer + and / menus render plain option rows, not buttons. */
      const hideOption = (option) => {
        if (option.hasAttribute(OPTION_MARK)) return;
        if (!MENU_LABELS.has(optionLabel(option))) return;
        option.setAttribute(OPTION_MARK, '');
        option.setAttribute('aria-hidden', 'true');
      };

      const scan = (node) => {
        if (node === null || node.nodeType !== 1) return;
        if (node.tagName === 'BUTTON' && node.getAttribute('role') === 'menuitem') consider(node);
        for (const button of node.querySelectorAll('button[role="menuitem"]')) consider(button);
        if (node.getAttribute('role') === 'option') hideOption(node);
        for (const option of node.querySelectorAll('[role="option"]')) hideOption(option);
      };

      // Menus mount on demand (the account menu portals to the document body),
      // so only newly inserted subtrees need inspection.
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) scan(node);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      scan(document.body);

      feedbackWatch = { observer, disabled };
    }

    function stopFeedbackWatch() {
      if (feedbackWatch === null) return;
      feedbackWatch.observer.disconnect();
      for (const element of document.querySelectorAll(`[${ROW_MARK}]`)) element.removeAttribute(ROW_MARK);
      for (const element of document.querySelectorAll(`[${OPTION_MARK}]`)) {
        element.removeAttribute(OPTION_MARK);
        element.removeAttribute('aria-hidden');
      }
      for (const button of feedbackWatch.disabled) {
        button.disabled = false;
        button.removeAttribute('aria-hidden');
        button.removeAttribute('tabindex');
      }
      feedbackWatch = null;
    }

    /**
     * The shipped full-access risk dialog. `RiskConfirmation` renders no id or
     * stable class, so the title (checked in every shipped language) and the
     * acknowledgement checkbox together identify it; the Auto-review dialog
     * carries a different title and is left alone.
     */
    function isFullAccessDialog(dialog) {
      const heading = dialog.querySelector('h2');
      const title = normalizeLabel(heading !== null ? heading.textContent : '');
      if (!FULL_ACCESS_TITLES.has(title) && !FULL_ACCESS_TITLES.has(normalizeLabel(dialog.getAttribute('aria-label')))) return false;
      return dialog.querySelector('input[type="checkbox"]') !== null;
    }

    /**
     * The dialog's primary action, found by its shipped label or by the
     * `confirmAction` class of the CSS module. Anything else returns null: this
     * code runs unattended, so it must never press an unidentified button.
     */
    function confirmActionOf(dialog) {
      const buttons = Array.from(dialog.querySelectorAll('button'));
      const labeled = buttons.filter((button) => FULL_ACCESS_ENABLE.has(normalizeLabel(button.textContent)));
      if (labeled.length > 0) return labeled[labeled.length - 1];
      const styled = buttons.filter((button) => String(button.className ?? '').includes('confirmAction'));
      return styled.length > 0 ? styled[styled.length - 1] : null;
    }

    function startConfirmWatch() {
      if (confirmWatch !== null || typeof document === 'undefined' || document.body === null) return;

      const watch = { observer: null, pending: new Map(), frames: new Set(), stopped: false };
      confirmWatch = watch;

      /**
       * Schedule a step ahead of the next paint. `requestAnimationFrame` is
       * shared with the page, so cancellation is a flag check rather than an
       * id lookup, which keeps disposal free of bookkeeping.
       */
      const schedule = (run) => {
        const step = () => {
          watch.frames.delete(step);
          if (!watch.stopped) run();
        };
        watch.frames.add(step);
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(step);
        else setTimeout(step, 16);
      };

      const drop = (entry) => {
        entry.done = true;
        watch.pending.delete(entry.dialog);
      };

      /** Give the dialog back to the user instead of leaving it hidden and stuck. */
      const release = (entry) => {
        entry.root.removeAttribute(DIALOG_MARK);
        drop(entry);
      };

      const step = (entry) => {
        if (entry.done) return;
        const dialog = entry.dialog;
        if (dialog.isConnected === false) {
          drop(entry);
          return;
        }

        // Identify the primary action before touching the dialog: nothing is
        // pressed when the surface is not the one this tweak understands.
        const action = confirmActionOf(dialog);
        if (action === null) {
          release(entry);
          return;
        }

        // The checkbox is the modal's autofocus target and a controlled input:
        // a real click is what flips React's `acknowledged` state.
        const box = dialog.querySelector('input[type="checkbox"]');
        if (box !== null && box.checked !== true && !box.disabled) box.click();

        // The confirm button stays disabled until that state lands, which can
        // take a render; one more frame is normally enough.
        if (!action.disabled) {
          action.click();
          drop(entry);
          return;
        }

        entry.attempts += 1;
        if (entry.attempts > CONFIRM_ATTEMPTS) release(entry);
        else schedule(() => step(entry));
      };

      const consider = (dialog) => {
        if (watch.pending.has(dialog) || !isFullAccessDialog(dialog)) return;
        const root = dialog.closest(MODAL_ROOT_SELECTOR) ?? dialog.parentElement ?? dialog;
        const entry = { root, dialog, attempts: 0, done: false };
        watch.pending.set(dialog, entry);
        // Mark before the frame paints: MutationObserver callbacks run ahead of
        // rendering, so the unconfirmed dialog never flashes on screen.
        root.setAttribute(DIALOG_MARK, '');
        schedule(() => step(entry));
      };

      const scan = (node) => {
        if (node === null || node.nodeType !== 1) return;
        if (typeof node.matches === 'function' && node.matches(DIALOG_SELECTOR)) consider(node);
        for (const dialog of node.querySelectorAll(DIALOG_SELECTOR)) consider(dialog);
      };

      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) scan(node);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      scan(document.body);

      watch.observer = observer;
    }

    function stopConfirmWatch() {
      if (confirmWatch === null) return;
      confirmWatch.stopped = true;
      confirmWatch.observer.disconnect();
      for (const entry of confirmWatch.pending.values()) entry.root.removeAttribute(DIALOG_MARK);
      confirmWatch.pending.clear();
      for (const element of document.querySelectorAll(`[${DIALOG_MARK}]`)) element.removeAttribute(DIALOG_MARK);
      confirmWatch = null;
    }

    /** Mirror the whole preference object onto the root element the stylesheet reads. */
    function applyDom() {
      if (typeof document === 'undefined') return;
      const root = document.documentElement;

      if (state.width === 'wide') root.setAttribute(ATTR_WIDTH, 'wide');
      else root.removeAttribute(ATTR_WIDTH);

      const label = state.account.text.trim();
      const custom = state.account.mode === 'custom' && label !== '';
      if (custom) {
        root.setAttribute(ATTR_ACCOUNT, 'custom');
        root.style.setProperty(ACCOUNT_VAR, JSON.stringify(label));
      } else {
        root.style.removeProperty(ACCOUNT_VAR);
        if (state.account.mode === 'hidden' || state.account.mode === 'custom') root.setAttribute(ATTR_ACCOUNT, 'hidden');
        else root.removeAttribute(ATTR_ACCOUNT);
      }

      if (state.hideFeedback) {
        root.setAttribute(ATTR_FEEDBACK, '');
        startFeedbackWatch();
      } else {
        root.removeAttribute(ATTR_FEEDBACK);
        stopFeedbackWatch();
      }

      if (state.hideSidebarMore) root.setAttribute(ATTR_MORE, '');
      else root.removeAttribute(ATTR_MORE);

      if (state.skipFullAccessConfirm) {
        root.setAttribute(ATTR_CONFIRM, '');
        startConfirmWatch();
      } else {
        root.removeAttribute(ATTR_CONFIRM);
        stopConfirmWatch();
      }
    }

    function readManaged() {
      try {
        return localStorage.getItem(MANAGED_KEY) === '1';
      } catch (_unreadable) {
        return false;
      }
    }

    function writeManaged(value) {
      try {
        if (value) localStorage.setItem(MANAGED_KEY, '1');
        else localStorage.removeItem(MANAGED_KEY);
      } catch (_full) {
        // A blocked storage area only costs the managed marker.
      }
    }

    /**
     * Mirror the switch onto the Host row that owns the /feedback command.
     * Disabling that row removes the command from the catalog and, because the
     * client feedback surface requires its `sessionFeedback` Remote, retires
     * the rating buttons and dialog too. Re-enabling only happens for a row this
     * plugin disabled, so a row the user turned off by hand stays off.
     */
    /** Resolve the plugin-manager client face without making it a hard dependency. */
    function resolveCommandManager(ctx) {
      try {
        if (ctx.remote?.pluginManager) return ctx.remote.pluginManager;
        if (typeof ctx.get === 'function' && ctx.get('remote')?.pluginManager) return ctx.get('remote').pluginManager;
        return null;
      } catch (_unavailable) {
        return null;
      }
    }

    /** Remote answers carry a `{ ok, value }` envelope; plain values pass through. */
    function unwrap(answer) {
      if (answer !== null && typeof answer === 'object' && 'ok' in answer) {
        if (answer.ok !== true) {
          const code = answer.error?.code ?? answer.error?.message ?? 'remote-failed';
          throw new Error(String(code));
        }
        return answer.value;
      }
      return answer;
    }

    /**
     * Mirror the switch onto the Host row that owns the /feedback command.
     * Disabling that row removes the command from the catalog and, because the
     * client feedback surface requires its `sessionFeedback` Remote, retires
     * the rating buttons and dialog too. Turning the switch off re-enables the
     * row this plugin disabled.
     */
    async function syncFeedbackCommand(hide) {
      const manager = commandManager;
      if (manager === null || typeof manager.listPlugins !== 'function' || typeof manager.setPluginEnabled !== 'function') return;
      let rows;
      try {
        rows = unwrap(await manager.listPlugins());
      } catch (error) {
        console.warn('[ui-tweaks] could not read plugin state; feedback command left as is', error);
        return;
      }
      const row = (Array.isArray(rows) ? rows : []).find((item) => item.moduleName === COMMAND_MODULE || item.entryId === COMMAND_ENTRY);
      if (row === void 0 || row.entryId === void 0) return;
      const disabled = row.enabled === false;
      const managed = readManaged();
      if (hide === true && !disabled) {
        try {
          unwrap(await manager.setPluginEnabled(row.entryId, false));
          writeManaged(true);
        } catch (error) {
          console.warn('[ui-tweaks] could not disable the feedback command', error);
        }
      } else if (hide === true && disabled) {
        writeManaged(true);
      } else if (hide === false && disabled && managed) {
        try {
          unwrap(await manager.setPluginEnabled(row.entryId, true));
          writeManaged(false);
        } catch (error) {
          console.warn('[ui-tweaks] could not re-enable the feedback command', error);
        }
      } else if (hide === false) {
        writeManaged(false);
      }
    }

    function commit(patch) {
      state = normalize({ ...state, ...patch });
      writeState(state);
      applyDom();
      if (patch.hideFeedback !== undefined) void syncFeedbackCommand(state.hideFeedback);
    }

    const CSS = [
      ':root[data-dsh-ui-tweaks-width="wide"] [data-conversation-content] {',
      '  --dsh-chat-content-width: 100% !important;',
      '}',
      ':root[data-dsh-ui-tweaks-width="wide"] [data-width-handle] {',
      '  display: none;',
      '}',
      ':root[data-dsh-ui-tweaks-account="hidden"] [data-slot="settings.launcher"] button[aria-haspopup="menu"]:has(> span + span) > span + span,',
      ':root[data-dsh-ui-tweaks-account="custom"] [data-slot="settings.launcher"] button[aria-haspopup="menu"]:has(> span + span) > span + span {',
      '  display: none;',
      '}',
      ':root[data-dsh-ui-tweaks-account="custom"] [data-slot="settings.launcher"] button[aria-haspopup="menu"]:has(> span + span)::after {',
      '  content: var(--dsh-ui-tweaks-account-label, "");',
      '  min-width: 0;',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '  white-space: nowrap;',
      '}',
      '/* Rating pair inside the finalized assistant message action strip. */',
      ':root[data-dsh-ui-tweaks-feedback] ' + RATING_LABELS.map(
        (label) => `${ACTIONS_SLOT} button[aria-label=${quote(label)}]`,
      ).join(',\n:root[data-dsh-ui-tweaks-feedback] ') + ' {',
      '  display: none !important;',
      '}',
      '/* Menu rows stamped by the observer. */',
      `:root[data-dsh-ui-tweaks-feedback] [${ROW_MARK}] {`,
      '  display: none !important;',
      '}',
      `:root[data-dsh-ui-tweaks-feedback] [${OPTION_MARK}] {`,
      '  display: none !important;',
      '  pointer-events: none;',
      '}',
      '/* Full-access risk dialog: hidden while the plugin drives it to confirm. */',
      `:root[${ATTR_CONFIRM}] [${DIALOG_MARK}] {`,
      '  display: none !important;',
      '}',
      '/* Sidebar More row: shell-rendered, identified by its stable anchor class or localized name. */',
      ':root[data-dsh-ui-tweaks-more] nav [class*="_moreAnchor"],',
      ...MORE_LABELS.map((label) => `:root[data-dsh-ui-tweaks-more] nav button[aria-haspopup="menu"][aria-label=${quote(label)}]`),
      '{',
      '  display: none !important;',
      '}',
      '/* Settings rows follow the shipped General rows: text left, control right, one hairline. */',
      '.dsh-ui-tweaks_row { display: flex; align-items: center; gap: 8px; padding: 16px 0; border-bottom: .5px solid var(--dsw-alias-border-l2); }',
      '.dsh-ui-tweaks_text { display: flex; flex-direction: column; flex: 1; gap: 4px; min-width: 0; padding-right: 48px; }',
      '.dsh-ui-tweaks_title { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 400; line-height: 22px; }',
      '.dsh-ui-tweaks_desc { color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 400; line-height: 18px; }',
      '.dsh-ui-tweaks_seg { display: inline-flex; flex: none; align-items: center; gap: 2px; padding: 2px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2); }',
      '.dsh-ui-tweaks_opt { height: 32px; margin: 0; padding: 0 12px; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 20px; white-space: nowrap; cursor: pointer; }',
      '.dsh-ui-tweaks_opt:hover { color: var(--dsw-alias-label-primary); }',
      '.dsh-ui-tweaks_opt[aria-pressed="true"] { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }',
      '.dsh-ui-tweaks_opt:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }',
      '.dsh-ui-tweaks_block { display: flex; flex-direction: column; border-bottom: .5px solid var(--dsw-alias-border-l2); }',
      '.dsh-ui-tweaks_block .dsh-ui-tweaks_row { border-bottom: 0; }',
      '.dsh-ui-tweaks_input { box-sizing: border-box; width: 100%; max-width: 320px; height: 32px; margin: 0 0 16px; padding: 0 10px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; }',
      '.dsh-ui-tweaks_input::placeholder { color: var(--dsw-alias-label-secondary); }',
      '.dsh-ui-tweaks_input:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }',
    ].join('\n');

    /** Bound by the locale service in `apply`; owner rows receive no locale props. */
    let translate = (key) => key;

    function translation(props) {
      const source = props ?? {};
      if (typeof source.t === 'function') return source.t;
      return typeof translate === 'function' ? translate : (key) => key;
    }

    function Row({ t, title, description, children }) {
      return h('div', { className: 'dsh-ui-tweaks_row' }, [
        h('div', { key: 'text', className: 'dsh-ui-tweaks_text' }, [
          h('div', { key: 'title', className: 'dsh-ui-tweaks_title' }, t(title)),
          h('div', { key: 'desc', className: 'dsh-ui-tweaks_desc' }, t(description)),
        ]),
        h('div', { key: 'control', className: 'dsh-ui-tweaks_control' }, children),
      ]);
    }

    function Segmented({ t, label, value, options, onChange }) {
      return h('div', {
        className: 'dsh-ui-tweaks_seg',
        role: 'group',
        'aria-label': label,
      }, options.map((option) => h('button', {
        key: option.value,
        type: 'button',
        className: 'dsh-ui-tweaks_opt',
        'aria-pressed': value === option.value,
        onClick: () => onChange(option.value),
      }, t(option.key))));
    }

    function WidthRow(props) {
      const t = translation(props);
      const [mode, setMode] = React.useState(() => state.width);
      const choose = (next) => {
        commit({ width: next });
        setMode(next);
      };
      return h(Row, { t, title: 'width.title', description: 'width.description' },
        h(Segmented, {
          t,
          label: t('width.title'),
          value: mode,
          options: WIDTH_MODES.map((value) => ({ value, key: `width.mode.${value}` })),
          onChange: choose,
        }));
    }

    function AccountRow(props) {
      const t = translation(props);
      const [preference, setPreference] = React.useState(() => state.account);
      const choose = (next) => {
        const safe = {
          mode: ACCOUNT_MODES.includes(next.mode) ? next.mode : state.account.mode,
          text: sanitizeText(next.text),
        };
        commit({ account: safe });
        setPreference(safe);
      };
      const children = [
        h(Row, { key: 'row', t, title: 'account.title', description: 'account.description' },
          h(Segmented, {
            t,
            label: t('account.title'),
            value: preference.mode,
            options: ACCOUNT_MODES.map((value) => ({ value, key: `account.mode.${value}` })),
            onChange: (mode) => choose({ ...preference, mode }),
          })),
      ];
      if (preference.mode === 'custom') {
        children.push(h('input', {
          key: 'input',
          className: 'dsh-ui-tweaks_input',
          type: 'text',
          value: preference.text,
          maxLength: ACCOUNT_MAX_TEXT,
          placeholder: t('account.placeholder'),
          'aria-label': t('account.placeholder'),
          onChange: (event) => choose({ ...preference, text: event.target.value }),
        }));
      }
      return h('div', { className: 'dsh-ui-tweaks_block' }, children);
    }

    /** Build one Show/Hide row bound to a boolean field. */
    function toggleRow(titleKey, descriptionKey, field) {
      return function ToggleRow(props) {
        const t = translation(props);
        const [hidden, setHidden] = React.useState(() => state[field]);
        const choose = (next) => {
          const value = next === 'hide';
          commit({ [field]: value });
          setHidden(value);
        };
        return h(Row, { t, title: titleKey, description: descriptionKey },
          h(Segmented, {
            t,
            label: t(titleKey),
            value: hidden ? 'hide' : 'show',
            options: [
              { value: 'show', key: 'toggle.show' },
              { value: 'hide', key: 'toggle.hide' },
            ],
            onChange: choose,
          }));
      };
    }

    const FeedbackRow = toggleRow('feedback.title', 'feedback.description', 'hideFeedback');
    const MoreRow = toggleRow('more.title', 'more.description', 'hideSidebarMore');
    const FullAccessRow = toggleRow('fullAccess.title', 'fullAccess.description', 'skipFullAccessConfirm');

    const GENERAL_ROWS = [
      { id: 'ui-tweaks-width', order: 13.1, Component: WidthRow },
      { id: 'ui-tweaks-account', order: 13.2, Component: AccountRow },
      { id: 'ui-tweaks-full-access', order: 13.3, Component: FullAccessRow },
      { id: 'ui-tweaks-feedback', order: 13.4, Component: FeedbackRow },
      { id: 'ui-tweaks-more', order: 13.5, Component: MoreRow },
    ];

    return {
      inject: ['slots', 'locale', 'remote', 'remote.pluginManager'],
      apply(ctx) {
        commandManager = resolveCommandManager(ctx);
        if (commandManager !== null) void syncFeedbackCommand(state.hideFeedback);

        ctx.effect(() => {
          // Drop stylesheets left behind by an earlier bundle generation so a
          // re-install never stacks duplicate rules.
          for (const stale of document.querySelectorAll('style[data-plugin-css^="@akagiyui/dsh-ui-tweaks/"]')) stale.remove();
          const tag = document.createElement('style');
          tag.dataset.plugin = '@akagiyui/dsh-ui-tweaks';
          tag.dataset.pluginCss = '@akagiyui/dsh-ui-tweaks/ui-tweaks.css';
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'ui-tweaks: stylesheet');

        ctx.effect(() => {
          applyDom();
          return () => {
            const root = document.documentElement;
            root.removeAttribute(ATTR_WIDTH);
            root.removeAttribute(ATTR_ACCOUNT);
            root.removeAttribute(ATTR_FEEDBACK);
            root.removeAttribute(ATTR_MORE);
            root.removeAttribute(ATTR_CONFIRM);
            root.style.removeProperty(ACCOUNT_VAR);
            stopFeedbackWatch();
            stopConfirmWatch();
          };
        }, 'ui-tweaks: preferences');

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-tweaks: dictionaries');

        ctx.effect(() => {
          const bound = ctx.locale.bind(NS);
          translate = (key) => bound(key);
          return () => {
            translate = (key) => key;
          };
        }, 'ui-tweaks: translations');

        ctx.slots.inject('settings.general.item', () => {
          const disposers = GENERAL_ROWS.map((row) => ctx.slots.register({
            name: 'settings.general.item',
            id: row.id,
            order: row.order,
            locale: NS,
          }, row.Component));
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
