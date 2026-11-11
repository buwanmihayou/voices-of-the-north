/* =============================================================================
 * 70-router — 分頁路由與可分享網址
 * -----------------------------------------------------------------------------
 * 網址格式：#stories?story=YL-002&t=17&loc=yuen-long&topic=agriculture
 *   * 故事與時間可分享，開啟後直接跳到該故事、地圖聚焦、由該秒播放；
 *   * 篩選、排序、地圖總覽狀態都可分享；
 *   * 靜態檔案（file://）亦可用，不需要伺服器改寫路徑。
 * ========================================================================== */

(function () {
  'use strict';

  var VTN = window.VTN;
  var U = VTN.util;

  var VIEWS = ['home', 'recording', 'stories', 'me', 'settings', 'about'];
  var NAV_OF = { home: 'home', recording: 'record', stories: 'stories', me: 'me', settings: 'me', about: 'me' };
  var lastRoute = { view: 'home', params: {} };
  var applying = false;

  function t(key) { return VTN.i18n.t(key); }

  function buildHash(view, params) {
    var query = [];
    Object.keys(params || {}).forEach(function (key) {
      var value = params[key];
      if (value === null || value === undefined || value === '') return;
      query.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    });
    return '#' + view + (query.length ? '?' + query.join('&') : '');
  }

  function parse() {
    var raw = String(window.location.hash || '').replace(/^#/, '');
    var index = raw.indexOf('?');
    var view = index === -1 ? raw : raw.slice(0, index);
    var query = index === -1 ? '' : raw.slice(index + 1);
    if (VIEWS.indexOf(view) === -1) view = 'home';
    var params = {};
    try {
      new URLSearchParams(query).forEach(function (value, key) { params[key] = value; });
    } catch (e) { /* ignore */ }
    return { view: view, params: params };
  }

  function setNav(view) {
    var target = NAV_OF[view] || 'home';
    Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (item) {
      var active = item.getAttribute('data-nav') === target;
      item.classList.toggle('is-active', active);
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
  }

  function apply(route) {
    if (applying) return;
    applying = true;
    lastRoute = route;

    Array.prototype.forEach.call(document.querySelectorAll('.vtn-view'), function (view) {
      var active = view.getAttribute('data-view') === route.view;
      view.classList.toggle('is-active', active);
      view.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
    setNav(route.view);
    document.body.setAttribute('data-view', route.view);
    if (VTN.util && VTN.util.emit) {
      VTN.util.emit('vtn:view-changed', { view: route.view });
    }

    if (route.view !== 'stories') {
      VTN.audio.pauseStory();
      if (VTN.stories && VTN.stories.pauseVideo) VTN.stories.pauseVideo();
      if (VTN.media && VTN.media.close) VTN.media.close();
    }

    try {
      if (route.view === 'home') {
        VTN.stories.render();
      } else if (route.view === 'recording') {
        VTN.recordings.renderAll();
        VTN.recordings.handleParams(route.params);
      } else if (route.view === 'stories') {
        VTN.stories.applyParams(route.params);
        VTN.stories.render();
        VTN.map.ensureVisible();
        if (route.params.story) {
          var seconds = route.params.t !== undefined ? Number(route.params.t) : null;
          if (seconds !== null && isFinite(seconds)) {
            VTN.stories.select(route.params.story, {
              t: seconds, playAt: seconds, updateUrl: false, focus: false
            });
          }
        }
      } else if (route.view === 'me') {
        VTN.account.render();
      } else if (route.view === 'settings') {
        VTN.settings.refresh();
      } else if (route.view === 'about') {
        VTN.about.render();
      }
    } catch (error) {
      if (window.console) console.error('[router]', error);
    }

    var shell = document.getElementById('appShell');
    if (shell) shell.scrollTop = 0;
    window.scrollTo(0, 0);
    applying = false;
  }

  function go(view, params, options) {
    var opts = options || {};
    if (VIEWS.indexOf(view) === -1) view = 'home';
    var hash = buildHash(view, params || {});
    if (opts.replace) {
      try { window.history.replaceState(null, '', hash); } catch (e) { window.location.hash = hash; }
      if (!opts.silent) apply(parse());
      return;
    }
    if (window.location.hash === hash) {
      apply(parse());
      return;
    }
    try {
      window.history.pushState(null, '', hash);
      apply(parse());
    } catch (e) {
      window.location.hash = hash;
    }
  }

  function replace(view, params) {
    var hash = buildHash(view, params || {});
    try { window.history.replaceState(null, '', hash); } catch (e) { /* ignore */ }
  }

  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll('.bottom-nav__item'), function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        var view = (link.getAttribute('href') || '#home').replace(/^#/, '').split('?')[0];
        go(view, {});
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-back]'), function (btn) {
      btn.addEventListener('click', function () {
        go(btn.getAttribute('data-back') || 'me', {});
      });
    });

    window.addEventListener('popstate', function () { apply(parse()); });
    window.addEventListener('hashchange', function () { apply(parse()); });
  }

  function init() {
    bind();
    apply(parse());
    var greeting = document.getElementById('greeting');
    if (greeting) {
      var hour = new Date().getHours();
      greeting.textContent = hour < 12 ? t('greeting.morning') :
        hour < 18 ? t('greeting.afternoon') : t('greeting.evening');
    }
  }

  VTN.router = {
    init: init,
    go: go,
    replace: replace,
    parse: parse,
    buildHash: buildHash,
    current: function () { return lastRoute; },
    views: VIEWS.slice(),
    updateGreeting: function () {
      var greeting = document.getElementById('greeting');
      if (!greeting) return;
      var hour = new Date().getHours();
      greeting.textContent = hour < 12 ? t('greeting.morning') :
        hour < 18 ? t('greeting.afternoon') : t('greeting.evening');
    }
  };
})();
