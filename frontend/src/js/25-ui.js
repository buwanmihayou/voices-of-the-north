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
    var title = U.node('h2', { class: 'vtn-modal__title', id: titleId, text: opts.title || '' });
    var closeBtn = U.node('button', { class: 'vtn-modal__close', type: 'button', 'aria-label': VTN.i18n.t('common.close') });
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
      setTitle: function (t) { title.textContent = t; }
    };

    if (opts.actions && opts.actions.length) {
      var foot = U.node('div', { class: 'vtn-modal__foot' });
      opts.actions.forEach(function (action) {
        var btn = U.node('button', {
          class: 'vtn-btn ' + (action.kind === 'solid' ? 'vtn-btn--solid' :
            action.kind === 'danger' ? 'vtn-btn--danger' :
              action.kind === 'gold' ? 'vtn-btn--gold' : 'vtn-btn--quiet'),
          type: 'button',
          text: action.label
        });
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
      if (options.message) body.appendChild(U.node('p', { text: options.message }));
      if (options.note) body.appendChild(U.node('p', { class: 'vtn-modal__note', text: options.note }));
      var dlg = dialog({
        title: options.title || VTN.i18n.t('common.confirm'),
        body: body,
        actions: [
          { label: options.cancelLabel || VTN.i18n.t('common.cancel'), kind: 'quiet', value: false },
          {
            label: options.confirmLabel || VTN.i18n.t('common.ok'),
            kind: options.danger ? 'danger' : 'solid',
            value: true
          }
        ],
        onClose: function (value) {
          if (decided) return;
          decided = true;
          resolve(value === true);
        }
      });
      /* 確保按鈕結果回傳 */
      if (dlg) { /* no-op，onClose 會收到 value */ }
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
      var li = U.node('li', {
        text: VTN.i18n.t(pair[0]) + '：' + VTN.i18n.t(pair[1] ? 'status.ready' : 'status.notReady')
      });
      list.appendChild(li);
    });
    body.appendChild(list);
    body.appendChild(U.node('p', { class: 'vtn-modal__note', text: VTN.i18n.t('status.apiBase', { url: VTN.api.base() }) }));
    if (status.reason) {
      body.appendChild(U.node('p', { class: 'vtn-modal__note', text: VTN.i18n.t('status.reason.' + status.reason) }));
    }
    body.appendChild(U.node('p', { class: 'vtn-modal__note', text: VTN.i18n.t('status.honesty') }));
    dialog({
      title: VTN.i18n.t('status.title'),
      body: body,
      actions: [{ label: VTN.i18n.t('common.close'), kind: 'solid' }]
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

  VTN.ui = {
    toast: toast,
    announce: announce,
    dialog: dialog,
    confirm: confirmDialog,
    renderStatus: renderStatus,
    bindStatus: bindStatus,
    closeAll: function () {
      openDialogs.slice().forEach(function (d) { d.close('all'); });
    }
  };
})();
