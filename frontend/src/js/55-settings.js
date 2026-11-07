/* =============================================================================
 * 55-settings — 設定頁：字級、音量、速度、主題、減少動態、高對比、恢復預設
 * -----------------------------------------------------------------------------
 * 底線：正文不小於 18px（標準 = 18px，大 = 20px，特大 = 22px）；
 *       深色模式文字對比 ≥ 4.5:1；所有設定即時生效並只存本機。
 * ========================================================================== */

(function () {
  'use strict';

  var VTN = window.VTN;
  var U = VTN.util;
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function t(key) { return VTN.i18n.t(key); }

  function applyTheme(prefs) {
    var theme = prefs.theme || 'system';
    var resolved = theme === 'system' ? (media && media.matches ? 'dark' : 'light') : theme;
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.setAttribute('data-theme-preference', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#131E18' : '#F6F1E6');
  }

  function apply(prefs) {
    var html = document.documentElement;
    html.setAttribute('data-font-size', prefs.fontSize || 'md');
    html.setAttribute('data-contrast', prefs.contrast ? 'high' : 'normal');
    html.setAttribute('data-reduce-motion', prefs.reduceMotion ? 'true' : 'false');
    applyTheme(prefs);
  }

  function refreshControls() {
    var prefs = VTN.store.prefs();

    Array.prototype.forEach.call(document.querySelectorAll('button[data-font-size]'), function (btn) {
      var active = btn.getAttribute('data-font-size') === prefs.fontSize;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    var theme = document.getElementById('setTheme');
    if (theme) theme.value = prefs.theme;

    var contrast = document.getElementById('setContrast');
    if (contrast) {
      contrast.textContent = t(prefs.contrast ? 'settings.on' : 'settings.off');
      contrast.setAttribute('aria-pressed', prefs.contrast ? 'true' : 'false');
    }
    var motion = document.getElementById('setMotion');
    if (motion) {
      motion.textContent = t(prefs.reduceMotion ? 'settings.on' : 'settings.off');
      motion.setAttribute('aria-pressed', prefs.reduceMotion ? 'true' : 'false');
    }

    var volume = document.getElementById('setVolume');
    var volumeOut = document.getElementById('setVolumeOut');
    if (volume) volume.value = prefs.volume;
    if (volumeOut) volumeOut.textContent = prefs.volume + '%';

    var speed = document.getElementById('setSpeed');
    if (speed) speed.value = String(prefs.speed);
  }

  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll('button[data-font-size]'), function (btn) {
      btn.addEventListener('click', function () {
        VTN.store.setPref('fontSize', btn.getAttribute('data-font-size'));
        refreshControls();
        VTN.ui.toast(t('settings.saved'), 'success');
      });
    });

    var theme = document.getElementById('setTheme');
    if (theme) {
      theme.addEventListener('change', function () {
        VTN.store.setPref('theme', theme.value);
        refreshControls();
      });
    }

    var contrast = document.getElementById('setContrast');
    if (contrast) {
      contrast.addEventListener('click', function () {
        VTN.store.setPref('contrast', !VTN.store.getPref('contrast'));
        refreshControls();
      });
    }

    var motion = document.getElementById('setMotion');
    if (motion) {
      motion.addEventListener('click', function () {
        VTN.store.setPref('reduceMotion', !VTN.store.getPref('reduceMotion'));
        refreshControls();
      });
    }

    var volume = document.getElementById('setVolume');
    var volumeOut = document.getElementById('setVolumeOut');
    if (volume) {
      volume.addEventListener('input', function () {
        var value = Number(volume.value) || 0;
        if (volumeOut) volumeOut.textContent = value + '%';
        VTN.store.setPref('volume', value);
      });
    }

    var speed = document.getElementById('setSpeed');
    if (speed) {
      speed.addEventListener('change', function () {
        VTN.store.setPref('speed', Number(speed.value) || 1);
      });
    }

    var reset = document.getElementById('setReset');
    if (reset) {
      reset.addEventListener('click', function () {
        VTN.ui.confirm({
          title: t('settings.reset'),
          message: t('settings.resetConfirm'),
          confirmLabel: t('settings.resetBtn'),
          danger: true
        }).then(function (ok) {
          if (!ok) return;
          VTN.store.resetPrefs();
          apply(VTN.store.prefs());
          VTN.i18n.setLang(VTN.store.getPref('lang'));
          refreshControls();
          VTN.ui.toast(t('settings.resetDone'), 'success');
        });
      });
    }

    U.on('vtn:prefs-changed', function (event) {
      apply(VTN.store.prefs());
      if (event && event.detail && event.detail.key === 'lang') return;
      refreshControls();
    });
    U.on('vtn:lang-changed', refreshControls);

    if (media) {
      var onChange = function () {
        if (VTN.store.getPref('theme') === 'system') applyTheme(VTN.store.prefs());
      };
      if (media.addEventListener) media.addEventListener('change', onChange);
      else if (media.addListener) media.addListener(onChange);
    }
  }

  function init() {
    apply(VTN.store.prefs());
    bind();
    refreshControls();
  }

  VTN.settings = { init: init, apply: apply, refresh: refreshControls };
})();
