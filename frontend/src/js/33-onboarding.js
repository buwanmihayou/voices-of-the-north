/* Story-map coach marks: spotlight, anchored arrow and live controls. */
(function () {
  'use strict';
  var VTN = window.VTN;
  var U = VTN.util;
  var SEEN_KEY = (VTN.KEYS && VTN.KEYS.onboarded) || 'vtn.v2.onboarded';
  var STEPS = [
    { id: 'map', title: 'onboard.step1Title', body: 'onboard.step1Body', edge: 'top' },
    { id: 'type', title: 'onboard.step2Title', body: 'onboard.step2Body', edge: 'bottom' },
    { id: 'era', title: 'onboard.step3Title', body: 'onboard.step3Body', edge: 'top' }
  ];
  var root = null;
  var current = 0;
  var lastFocus = null;
  var autoTimer = null;
  var advanceTimer = null;
  var frame = null;
  var observer = null;
  var resizeObserver = null;
  var pointer = null;
  var bound = false;
  function t(key, vars) { return VTN.i18n.t(key, vars); }
  function el(id) { return document.getElementById(id); }
  function active() { return !!(root && !root.hidden); }
  function paused() { return !!(root && root.getAttribute('data-paused') === 'true'); }
  function seen() {
    try { return window.localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { return false; }
  }
  function markSeen() {
    try { window.localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* optional storage */ }
  }
  function visible(node) {
    if (!node || !node.isConnected) return false;
    var rect = node.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1 &&
      window.getComputedStyle(node).visibility !== 'hidden';
  }
  function focus(node) {
    if (!visible(node) || node.disabled) return;
    try { node.focus({ preventScroll: true }); } catch (e) { node.focus(); }
  }
  function mapReady() {
    return VTN.map && /^(maplibre|leaflet)$/.test(VTN.map.status());
  }
  function buttons(node) {
    return node ? Array.prototype.slice.call(node.querySelectorAll('button, input, [tabindex="0"]')) : [];
  }
  function target(index) {
    var node;
    if (VTN.stories && VTN.stories.mode() === 'list') {
      node = el('atlasListBack');
      return index === 0 && visible(node) ?
        { node: node, rect: node.getBoundingClientRect(), nodes: [node], kind: 'list' } : null;
    }
    if (index === 0) {
      if (VTN.map && VTN.map.status() === 'failed') {
        node = el('atlasViewBtn');
        return visible(node) ?
          { node: node, rect: node.getBoundingClientRect(), nodes: [node], kind: 'fallback' } : null;
      }
      node = el('vtnMap');
      var atlas = el('storyAtlas');
      if (!visible(atlas)) return null;
      var rect = atlas.getBoundingClientRect();
      var top = atlas.querySelector('.atlas__top');
      var bottom = atlas.querySelector('.atlas__bottom');
      var start = visible(top) ? top.getBoundingClientRect().bottom + 8 : rect.top + 16;
      var end = visible(bottom) ? bottom.getBoundingClientRect().top - 8 : rect.bottom - 16;
      if (end <= start) return null;
      var core = { left: rect.left + 12, top: start, width: rect.width - 24, height: end - start };
      return {
        node: node || atlas, rect: core,
        nodes: [node && node.querySelector('canvas[tabindex]'), el('atlasZoomIn'),
          el('atlasZoomOut'), el('atlasRecenter')].filter(Boolean),
        kind: mapReady() ? 'map' : 'loading'
      };
    }
    node = el(index === 1 ? 'atlasLegend' : 'atlasTimeline');
    return visible(node) && (index !== 1 || node.querySelector('button')) ?
      { node: node, rect: node.getBoundingClientRect(), nodes: buttons(node), kind: STEPS[index].id } : null;
  }
  function text(id, value) {
    var node = el(id);
    if (node && node.textContent !== value) node.textContent = value;
  }
  function copy(info, announce) {
    var title = STEPS[current].title;
    var body = STEPS[current].body;
    if (info && info.kind === 'fallback') {
      title = 'onboard.mapFallbackTitle'; body = 'onboard.mapFallbackBody';
    } else if (info && info.kind === 'list') {
      title = 'onboard.listTitle'; body = 'onboard.listBody';
    } else if (info && info.kind === 'loading') {
      body = 'onboard.mapLoadingBody';
    }
    text('onboardTitle', t(title));
    text('onboardBody', t(body));
    text('onboardProgress', t('onboard.progress', { n: current + 1, total: STEPS.length }));
    text('onboardNext', t(current === STEPS.length - 1 ? 'onboard.start' : 'onboard.next'));
    if (announce) text('onboardAnnouncement',
      t('onboard.progress', { n: current + 1, total: STEPS.length }) + '. ' + t(title) + '. ' + t(body));
  }
  function box(node, x, y, width, height) {
    if (!node) return;
    node.style.left = x + 'px'; node.style.top = y + 'px';
    node.style.width = Math.max(0, width) + 'px';
    node.style.height = Math.max(0, height) + 'px';
  }
  function svgRect(node, rect) {
    if (!node) return;
    ['x', 'y', 'width', 'height'].forEach(function (key) { node.setAttribute(key, rect[key]); });
  }
  function layout() {
    frame = null;
    if (!active()) return;
    var bounds = root.getBoundingClientRect();
    var card = el('onboardCard');
    if (!card || bounds.width < 1 || bounds.height < 1) return;
    var w = bounds.width;
    var h = bounds.height;
    var wasPaused = paused();
    if (h < 440) {
      cancelAdvance(); pointer = null;
      root.setAttribute('data-paused', 'true');
      text('onboardTitle', t('onboard.moreRoomTitle'));
      text('onboardBody', t('onboard.moreRoomBody'));
      text('onboardAnnouncement', t('onboard.moreRoomTitle') + '. ' + t('onboard.moreRoomBody'));
      card.style.left = '12px'; card.style.top = '12px';
      card.style.maxHeight = Math.max(60, h - 24) + 'px';
      if (!wasPaused) {
        if (/^onboard(Back|Next)$/.test(document.activeElement.id)) focus(el('onboardSkip'));
      }
      return;
    }
    root.removeAttribute('data-paused');
    if (wasPaused) card.scrollTop = 0;
    var info = target(current);
    if (!info) {
      if (current < STEPS.length - 1) render(current + 1, false);
      else close();
      return;
    }
    copy(info, wasPaused);
    card.style.maxHeight = Math.max(60, h - 24) + 'px';
    var naturalHeight = card.getBoundingClientRect().height;
    var raw = info.rect;
    var r = { x: Math.max(0, raw.left - bounds.left), y: Math.max(0, raw.top - bounds.top),
      width: Math.min(raw.width, w), height: Math.min(raw.height, h) };
    r.width = Math.max(1, Math.min(r.width, w - r.x));
    r.height = Math.max(1, Math.min(r.height, h - r.y));
    // On short screens keep a usable map strip below the complete bubble.
    // Never spotlight the whole atlas merely because the map strip is short.
    if (current === 0 && (info.kind === 'map' || info.kind === 'loading')) {
      var endY = r.y + r.height;
      r.y = Math.min(Math.max(r.y, naturalHeight + 33), endY - Math.min(56, r.height));
      r.height = endY - r.y;
    }
    var hole = { x: Math.max(0, r.x - 7), y: Math.max(0, r.y - 7) };
    hole.width = Math.min(w - hole.x, r.width + 14);
    hole.height = Math.min(h - hole.y, r.height + 14);
    root.setAttribute('data-step', STEPS[current].id);
    root.setAttribute('data-target', info.node.id || STEPS[current].id);
    Array.prototype.forEach.call(root.querySelectorAll('svg.vtn-onboard__shade, svg.vtn-onboard__pointer'),
      function (svg) { svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h); });
    svgRect(el('onboardHole'), hole);
    svgRect(el('onboardRing'), hole);
    box(root.querySelector('[data-onboard-block="top"]'), 0, 0, w, hole.y);
    box(root.querySelector('[data-onboard-block="bottom"]'), 0, hole.y + hole.height,
      w, h - hole.y - hole.height);
    box(root.querySelector('[data-onboard-block="left"]'), 0, hole.y, hole.x, hole.height);
    box(root.querySelector('[data-onboard-block="right"]'), hole.x + hole.width, hole.y,
      w - hole.x - hole.width, hole.height);
    // Keep the bubble at an edge, outside the actual spotlight.
    var above = Math.max(0, hole.y - 26);
    var below = Math.max(0, h - hole.y - hole.height - 26);
    card.style.maxHeight = Math.max(60, Math.min(h - 24, Math.max(above, below))) + 'px';
    var size = card.getBoundingClientRect();
    var topEdge = STEPS[current].edge === 'top';
    if (topEdge && above < size.height) topEdge = false;
    if (!topEdge && below < size.height) topEdge = true;
    var x = current === 2 ? w - size.width - 12 : 12;
    var y = topEdge ? 12 : h - size.height - 12;
    card.style.left = Math.max(12, Math.min(x, w - size.width - 12)) + 'px';
    card.style.top = Math.max(12, Math.min(y, h - size.height - 12)) + 'px';
    card.setAttribute('data-placement', topEdge ? 'above' : 'below');
    var sx = Math.max(18, Math.min(w - 18, x + size.width / 2));
    var sy = topEdge ? y + size.height + 3 : y - 3;
    var tx = Math.max(12, Math.min(w - 12, r.x + r.width / 2));
    var ty = topEdge ? r.y - 11 : r.y + r.height + 11;
    var bend = Math.max(12, Math.min(w - 12, sx + (current === 1 ? -32 : 32)));
    var d = 'M ' + sx + ' ' + sy + ' Q ' + bend + ' ' + ((sy + ty) / 2) + ' ' + tx + ' ' + ty;
    ['onboardArrowHalo', 'onboardArrow'].forEach(function (id) {
      var path = el(id); if (path) path.setAttribute('d', d);
    });
  }
  function queueLayout() {
    if (active() && frame === null) frame = window.requestAnimationFrame(layout);
  }
  function cancelAdvance() {
    if (advanceTimer) window.clearTimeout(advanceTimer);
    advanceTimer = null;
  }
  function render(index, moveFocus) {
    cancelAdvance(); pointer = null;
    current = Math.max(0, Math.min(STEPS.length - 1, index));
    var back = el('onboardBack');
    if (back) back.hidden = current === 0;
    var dots = el('onboardDots');
    if (dots) Array.prototype.forEach.call(dots.children, function (dot, i) {
      dot.classList.toggle('is-active', i === current);
    });
    copy(target(current), true);
    layout();
    if (moveFocus !== false && active()) focus(el('onboardCard'));
  }
  function advance(interaction) {
    if (!active() || paused()) return;
    if (current === STEPS.length - 1) close({ restoreFocus: !interaction });
    else render(current + 1);
  }
  function learned() {
    if (advanceTimer || !active() || paused()) return;
    advanceTimer = window.setTimeout(function () {
      advanceTimer = null; advance(true);
    }, 450);
  }
  function focusables() {
    var info = target(current);
    return (info ? info.nodes : []).concat(buttons(el('onboardCard'))).filter(function (node, i, all) {
      return visible(node) && !node.disabled && all.indexOf(node) === i;
    });
  }
  function onKeydown(event) {
    if (!active()) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); close(); return;
    }
    if (event.key !== 'Tab' || paused()) return;
    var nodes = focusables();
    if (!nodes.length) return;
    var index = nodes.indexOf(document.activeElement);
    var next = event.shiftKey ? (index <= 0 ? nodes.length - 1 : index - 1) : (index + 1) % nodes.length;
    event.preventDefault(); focus(nodes[next]);
  }
  function open(index) {
    root = root || el('vtnOnboard');
    if (!root) return;
    if (active()) { render(typeof index === 'number' ? index : 0); return; }
    if (autoTimer) window.clearTimeout(autoTimer);
    autoTimer = null; lastFocus = document.activeElement;
    root.hidden = false; root.setAttribute('aria-hidden', 'false');
    render(typeof index === 'number' ? index : 0);
    if (!active()) return;
    if (window.MutationObserver && el('storyAtlas')) {
      observer = new MutationObserver(queueLayout);
      observer.observe(el('storyAtlas'), { subtree: true, childList: true,
        attributes: true, attributeFilter: ['hidden', 'class'] });
    }
    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(queueLayout);
      resizeObserver.observe(el('appShell')); resizeObserver.observe(el('onboardCard'));
    }
    document.addEventListener('keydown', onKeydown, true);
  }
  function close(options) {
    if (!active()) return;
    var restore = !options || options.restoreFocus !== false;
    root.hidden = true; root.setAttribute('aria-hidden', 'true');
    cancelAdvance(); pointer = null;
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    if (observer) observer.disconnect();
    if (resizeObserver) resizeObserver.disconnect();
    observer = null; resizeObserver = null;
    document.removeEventListener('keydown', onKeydown, true);
    markSeen();
    if (restore) focus(lastFocus);
  }
  function maybeAutoShow(view) {
    if (autoTimer) window.clearTimeout(autoTimer);
    autoTimer = null;
    if (view !== 'stories' || seen() || active()) return;
    var route = VTN.router && VTN.router.current();
    if (route && route.params && route.params.story) return;
    if (VTN.stories && VTN.stories.mode() === 'list') return;
    autoTimer = window.setTimeout(function () {
      autoTimer = null;
      if (VTN.router && VTN.router.current().view === 'stories' && !seen()) open(0);
    }, 700);
  }
  function bind() {
    root = el('vtnOnboard');
    if (!root || bound) return;
    bound = true;
    el('onboardNext').addEventListener('click', function () { advance(false); });
    el('onboardBack').addEventListener('click', function () { render(current - 1); });
    el('onboardSkip').addEventListener('click', function () { close(); });
    el('atlasHelpBtn').addEventListener('click', function () { open(0); });
    Array.prototype.forEach.call(root.querySelectorAll('[data-onboard-close]'), function (mask) {
      mask.addEventListener('click', function () { close(); });
    });
    document.addEventListener('click', function (event) {
      if (!active() || !event.target.closest) return;
      var node = event.target;
      if (node.closest('.vtn-pin, #storyList .story-item__main')) {
        close({ restoreFocus: false }); return;
      }
      if (current === 0 && mapReady() && node.closest('#atlasZoomIn, #atlasZoomOut, #atlasRecenter')) learned();
      if (current === 1 && node.closest('#atlasLegend .legend-chip')) learned();
      if (current === 2 && node.closest('#atlasTicks button, #atlasEraAll')) learned();
    }, true);
    ['input', 'change'].forEach(function (name) {
      document.addEventListener(name, function (event) {
        if (active() && current === 2 && event.target.id === 'atlasEra') learned();
      }, true);
    });
    document.addEventListener('pointerdown', function (event) {
      if (active() && current === 0 && mapReady() && event.target.closest &&
          event.target.closest('#vtnMap') && !event.target.closest('.vtn-pin')) {
        pointer = { x: event.clientX, y: event.clientY };
      }
    }, true);
    document.addEventListener('pointerup', function (event) {
      if (pointer && Math.abs(event.clientX - pointer.x) + Math.abs(event.clientY - pointer.y) > 12) learned();
      pointer = null;
    }, true);
    document.addEventListener('pointercancel', function () { pointer = null; }, true);
    document.addEventListener('wheel', function (event) {
      if (active() && current === 0 && mapReady() && event.target.closest &&
          event.target.closest('#vtnMap') && event.deltaY) learned();
    }, { capture: true, passive: true });
    window.addEventListener('resize', queueLayout);
    window.addEventListener('orientationchange', queueLayout);
    document.addEventListener('scroll', queueLayout, true);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', queueLayout);
      window.visualViewport.addEventListener('scroll', queueLayout);
    }
    U.on('vtn:view-changed', function (event) {
      var view = event && event.detail && event.detail.view;
      var route = VTN.router && VTN.router.current();
      if (active() && (view !== 'stories' || (route && route.params && route.params.story))) {
        close({ restoreFocus: false });
      }
      maybeAutoShow(view);
    });
    U.on('vtn:stories-mode', function (event) {
      if (active() && event.detail && event.detail.mode === 'list') close({ restoreFocus: false });
      else queueLayout();
    });
    U.on('vtn:lang-changed', function () { if (active()) render(current, false); });
  }
  VTN.onboard = {
    init: function () { bind(); if (VTN.router) maybeAutoShow(VTN.router.current().view); },
    open: open, close: close, render: render, isSeen: seen,
    reset: function () {
      try { window.localStorage.removeItem(SEEN_KEY); } catch (e) { /* optional storage */ }
    }
  };
})();
