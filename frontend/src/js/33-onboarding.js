/* =============================================================================
 * 33-onboarding — 故事地圖首次進入引導（3 步）＋「?」重看
 * -----------------------------------------------------------------------------
 * 只在地圖頁首次進入時自動彈一次；之後可從地圖右上角的「?」重看。
 * 不使用假資料、不遮住底導航；Esc／點遮罩／跳過都會關閉並記住。
 * ========================================================================== */

(function () {
  'use strict';

  var VTN = window.VTN;
  var U = VTN.util;

  var SEEN_KEY = (VTN.KEYS && VTN.KEYS.onboarded) || 'vtn.v2.onboarded';
  var STEPS = [
    { title: 'onboard.step1Title', body: 'onboard.step1Body' },
    { title: 'onboard.step2Title', body: 'onboard.step2Body' },
    { title: 'onboard.step3Title', body: 'onboard.step3Body' }
  ];

  var root = null;
  var current = 0;
  var lastFocus = null;
  var autoTimer = null;

  function t(key, vars) { return VTN.i18n.t(key, vars); }

  function readSeen() {
    try { return window.localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { return false; }
  }

  function markSeen() {
    try { window.localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* ignore */ }
  }

  function el(id) { return document.getElementById(id); }

  function render(index) {
    current = Math.max(0, Math.min(STEPS.length - 1, index));
    var step = STEPS[current];
    var title = el('onboardTitle');
    var body = el('onboardBody');
    var progress = el('onboardProgress');
    var next = el('onboardNext');
    var dots = el('onboardDots');
    if (title) title.textContent = t(step.title);
    if (body) body.textContent = t(step.body);
    if (progress) progress.textContent = t('onboard.progress', { n: current + 1, total: STEPS.length });
    if (next) next.textContent = current === STEPS.length - 1 ? t('onboard.start') : t('onboard.next');
    if (dots) {
      Array.prototype.forEach.call(dots.children, function (dot, i) {
        dot.classList.toggle('is-active', i === current);
      });
    }
  }

  function focusables() {
    if (!root) return [];
    return Array.prototype.filter.call(
      root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      function (node) { return !node.disabled && node.offsetParent !== null; }
    );
  }

  function onKeydown(event) {
    if (!root || root.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    var nodes = focusables();
    if (!nodes.length) return;
    var first = nodes[0];
    var last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function open(index) {
    root = root || el('vtnOnboard');
    if (!root) return;
    lastFocus = document.activeElement;
    root.hidden = false;
    root.setAttribute('aria-hidden', 'false');
    render(typeof index === 'number' ? index : 0);
    var next = el('onboardNext');
    if (next) next.focus();
    document.addEventListener('keydown', onKeydown, true);
  }

  function close() {
    if (!root || root.hidden) return;
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', onKeydown, true);
    markSeen();
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  function maybeAutoShow(view) {
    if (view !== 'stories' || readSeen()) return;
    if (autoTimer) window.clearTimeout(autoTimer);
    autoTimer = window.setTimeout(function () {
      autoTimer = null;
      if (VTN.router && VTN.router.current().view === 'stories') open(0);
    }, 700);
  }

  function bind() {
    root = el('vtnOnboard');
    if (!root) return;

    var next = el('onboardNext');
    var skip = el('onboardSkip');
    var help = el('atlasHelpBtn');
    var mask = root.querySelector('[data-onboard-close]');

    if (next) {
      next.addEventListener('click', function () {
        if (current >= STEPS.length - 1) close();
        else render(current + 1);
      });
    }
    if (skip) skip.addEventListener('click', close);
    if (mask) mask.addEventListener('click', close);
    if (help) help.addEventListener('click', function () { open(0); });

    U.on('vtn:view-changed', function (event) {
      var view = event && event.detail ? event.detail.view : null;
      if (!root.hidden) close();
      maybeAutoShow(view);
    });
    U.on('vtn:lang-changed', function () {
      if (root && !root.hidden) render(current);
    });
  }

  function init() {
    bind();
    var route = VTN.router ? VTN.router.current() : null;
    if (route) maybeAutoShow(route.view);
  }

  VTN.onboard = {
    init: init,
    open: open,
    close: close,
    render: render,
    isSeen: readSeen,
    reset: function () {
      try { window.localStorage.removeItem(SEEN_KEY); } catch (e) { /* ignore */ }
    }
  };
})();
