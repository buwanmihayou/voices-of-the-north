/* =============================================================================
 * 25-ui — 對話框、提示、朗讀區、AI 狀態徽章
 * -----------------------------------------------------------------------------
 * 無障礙要求（第 21 項）：
 *   role="dialog" + aria-modal + aria-labelledby、Esc 關閉、Tab 焦點環繞、
 *   關閉後焦點回到入口；篩選結果數與儲存結果用 aria-live 朗讀。
 * ========================================================================== */

(function () {
  'use strict';

  var VTN = window.VTN;
  var U = VTN.util;

  /* ---------------- 朗讀區（獨立於 toast，避免重複訊息不朗讀） ---------------- */
  var live = null;
  function ensureLive() {
    if (live) return live;
    live = U.node('div', { class: 'vtn-sr', 'aria-live': 'polite', 'aria-atomic': 'true' });
    document.body.appendChild(live);
    return live;
  }

  function announce(text) {
    if (!text) return;
    ensureLive();
    live.textContent = '';
    setTimeout(function () { live.textContent = text; }, 30);
  }

  /* ---------------- Toast ---------------- */
  var toastTimer = null;
  function toast(message, type) {
    var el = document.getElementById('appToast');
    var text = document.getElementById('appToastText');
    if (!el || !text) { announce(message); return; }
    var icon = el.querySelector('.toast__icon');
    text.textContent = message;
    el.classList.remove('is-show');
    void el.offsetWidth;
    el.classList.add('is-show');
    if (icon) {
      icon.className = 'fa-solid toast__icon ' +
        (type === 'error' ? 'fa-circle-exclamation' :
          type === 'success' ? 'fa-circle-check' : 'fa-circle-info');
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-show'); }, 4200);
    announce(message);
  }

  /* ---------------- 對話框 ---------------- */
  var openDialogs = [];

  function dialog(options) {
    var opts = options || {};
    var id = 'vtn-dlg-' + Math.random().toString(36).slice(2, 8);
    var titleId = id + '-title';

    var mask = U.node('div', { class: 'vtn-modal-mask' });
    var modal = U.node('section', {
      class: 'vtn-modal',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      id: id
    });

    var head = U.node('div', { class: 'vtn-modal__head' });
    var title = U.node('h2', {
      class: 'vtn-modal__title',
      id: titleId,
      text: opts.titleKey ? VTN.i18n.t(opts.titleKey) : (opts.title || '')
    });
    if (opts.titleKey) title.setAttribute('data-i18n', opts.titleKey);
    var closeBtn = U.node('button', {
      class: 'vtn-modal__close',
      type: 'button',
      'aria-label': VTN.i18n.t('common.close'),
      'data-i18n-aria': 'common.close'
    });
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    head.appendChild(title);
    head.appendChild(closeBtn);

    var body = U.node('div', { class: 'vtn-modal__body' });
    if (opts.body) body.appendChild(opts.body);

    modal.appendChild(head);
    modal.appendChild(body);
    mask.appendChild(modal);

    var previousFocus = document.activeElement;
    var closed = false;
    var controller = {
      mask: mask,
      modal: modal,
      body: body,
      close: close,
      title: title,
      setTitle: function (t) { title.textContent = t; },
      refresh: refreshDialog
    };

    /* 語言切換時重繪：先保存表單值，讓 i18nRefresh 可以整塊重建內容而不丟失輸入 */
    function fieldKey(el, index) {
      if (el.id) return el.id;
      if (el.type === 'radio') return (el.getAttribute('name') || 'radio') + ':' + el.value;
      return el.getAttribute('name') || ('#' + index);
    }

    function formSnapshot(root) {
      var fields = root.querySelectorAll('input, textarea, select');
      return Array.prototype.map.call(fields, function (el, index) {
        return {
          key: fieldKey(el, index),
          checked: el.type === 'checkbox' || el.type === 'radio' ? el.checked : null,
          value: el.value
        };
      });
    }

    function restoreForm(root, snapshot) {
      var fields = root.querySelectorAll('input, textarea, select');
      Array.prototype.forEach.call(fields, function (el, index) {
        var key = fieldKey(el, index);
        var entry = snapshot.filter(function (item) { return item.key === key; })[0];
        if (!entry) return;
        if (entry.checked !== null) el.checked = entry.checked;
        else el.value = entry.value;
      });
    }

    function refreshDialog() {
      if (closed) return;
      var snapshot = formSnapshot(modal);
      if (VTN.i18n && VTN.i18n.apply) VTN.i18n.apply(modal);
      if (typeof opts.i18nRefresh === 'function') opts.i18nRefresh(controller);
      restoreForm(modal, snapshot);
    }

    if (opts.actions && opts.actions.length) {
      var foot = U.node('div', { class: 'vtn-modal__foot' });
      opts.actions.forEach(function (action) {
        var btn = U.node('button', {
          class: 'vtn-btn ' + (action.kind === 'solid' ? 'vtn-btn--solid' :
            action.kind === 'danger' ? 'vtn-btn--danger' :
              action.kind === 'gold' ? 'vtn-btn--gold' : 'vtn-btn--quiet'),
          type: 'button',
          text: action.labelKey ? VTN.i18n.t(action.labelKey) : action.label
        });
        if (action.labelKey) btn.setAttribute('data-i18n', action.labelKey);
        btn.addEventListener('click', function () {
          if (action.onClick) {
            var result = action.onClick(controller);
            if (result === false) return;
          }
          if (action.keepOpen !== true) close(action.value);
        });
        foot.appendChild(btn);
      });
      modal.appendChild(foot);
    }

    function onKeydown(event) {
      if (closed) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close('escape');
        return;
      }
      if (event.key !== 'Tab') return;
      var focusables = modal.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function close(reason) {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeydown, true);
      openDialogs = openDialogs.filter(function (d) { return d !== controller; });
      mask.classList.remove('is-open');
      setTimeout(function () {
        if (mask.parentNode) mask.parentNode.removeChild(mask);
      }, 220);
      if (previousFocus && typeof previousFocus.focus === 'function') {
        setTimeout(function () { previousFocus.focus(); }, 40);
      }
      if (opts.onClose) opts.onClose(reason);
    }

    closeBtn.addEventListener('click', function () { close('close-button'); });
    mask.addEventListener('click', function (event) {
      if (event.target === mask) close('mask');
    });
    document.addEventListener('keydown', onKeydown, true);

    var shell = document.getElementById('appShell') || document.body;
    shell.appendChild(mask);
    openDialogs.push(controller);
    requestAnimationFrame(function () {
      mask.classList.add('is-open');
      var focusTarget = modal.querySelector('[data-autofocus]') ||
        modal.querySelector('input, textarea, select, button.vtn-btn, button');
      if (focusTarget) focusTarget.focus();
    });

    return controller;
  }

  function confirmDialog(options) {
    return new Promise(function (resolve) {
      var decided = false;
      var body = U.node('div');
      function renderBody() {
        body.textContent = '';
        var message = options.messageKey
          ? VTN.i18n.t(options.messageKey, options.messageVars) : options.message;
        var note = options.noteKey
          ? VTN.i18n.t(options.noteKey, options.noteVars) : options.note;
        if (message) body.appendChild(U.node('p', { text: message }));
        if (note) body.appendChild(U.node('p', { class: 'vtn-modal__note', text: note }));
      }
      renderBody();
      dialog({
        title: options.title,
        titleKey: options.titleKey || (options.title ? null : 'common.confirm'),
        body: body,
        actions: [
          {
            label: options.cancelLabel,
            labelKey: options.cancelLabelKey || (options.cancelLabel ? null : 'common.cancel'),
            kind: 'quiet', value: false
          },
          {
            label: options.confirmLabel,
            labelKey: options.confirmLabelKey || (options.confirmLabel ? null : 'common.ok'),
            kind: options.danger ? 'danger' : 'solid',
            value: true
          }
        ],
        i18nRefresh: renderBody,
        onClose: function (value) {
          if (decided) return;
          decided = true;
          resolve(value === true);
        }
      });
    });
  }

  /* ---------------- AI 狀態徽章 ---------------- */
  var STATE_KEY = { online: 'status.online', degraded: 'status.degraded', offline: 'status.offline' };

  function renderStatus() {
    var btn = document.getElementById('aiStatusBtn');
    var text = document.getElementById('aiStatusText');
    if (!btn || !text) return;
    var status = VTN.api.aiState();
    btn.classList.remove('ai-status--online', 'ai-status--degraded', 'ai-status--offline');
    btn.classList.add('ai-status--' + status.state);
    text.textContent = VTN.i18n.t(STATE_KEY[status.state] || 'status.offline');
    var reason = status.reason ? VTN.i18n.t('status.reason.' + status.reason) : '';
    btn.setAttribute('title', reason || VTN.i18n.t('status.aria'));
    btn.setAttribute('data-state', status.state);
  }

  function showStatusDialog() {
    var status = VTN.api.aiState();
    var data = status.data || {};
    var body = U.node('div');
    function renderBody() {
      body.textContent = '';
      body.appendChild(U.node('p', {
        text: VTN.i18n.t('status.dialogState', { state: VTN.i18n.t(STATE_KEY[status.state]) })
      }));
      var list = U.node('ul');
      [
        ['status.stt', data.stt_ready],
        ['status.llm', !!(data.gemini_ready || data.llm_ready)],
        ['status.storage', data.storage_ready],
        ['status.answer', data.ask_village_ready]
      ].forEach(function (pair) {
        list.appendChild(U.node('li', {
          text: VTN.i18n.t(pair[0]) + '：' + VTN.i18n.t(pair[1] ? 'status.ready' : 'status.notReady')
        }));
      });
      body.appendChild(list);
      body.appendChild(U.node('p', {
        class: 'vtn-modal__note', text: VTN.i18n.t('status.apiBase', { url: VTN.api.base() })
      }));
      if (status.reason) {
        body.appendChild(U.node('p', {
          class: 'vtn-modal__note', text: VTN.i18n.t('status.reason.' + status.reason)
        }));
      }
      body.appendChild(U.node('p', {
        class: 'vtn-modal__note', text: VTN.i18n.t('status.honesty')
      }));
    }
    renderBody();
    dialog({
      titleKey: 'status.title',
      body: body,
      actions: [{ labelKey: 'common.close', kind: 'solid' }],
      i18nRefresh: renderBody
    });
  }

  function bindStatus() {
    var btn = document.getElementById('aiStatusBtn');
    if (!btn) return;
    btn.addEventListener('click', showStatusDialog);
    U.on('vtn:health', renderStatus);
    U.on('vtn:prefs-changed', renderStatus);
    renderStatus();
  }

  /* 語言切換後統一重繪所有開啟中的彈層（含關閉按鈕 aria-label）。 */
  function refreshOpenDialogs() {
    openDialogs.slice().forEach(function (d) {
      if (typeof d.refresh === 'function') d.refresh();
    });
  }

  U.on('vtn:lang-changed', refreshOpenDialogs);

  VTN.ui = {
    toast: toast,
    announce: announce,
    dialog: dialog,
    confirm: confirmDialog,
    renderStatus: renderStatus,
    bindStatus: bindStatus,
    refreshOpenDialogs: refreshOpenDialogs,
    closeAll: function () {
      openDialogs.slice().forEach(function (d) { d.close('all'); });
    }
  };
})();
