/* =============================================================================
 * 55-settings — 設定頁：一般設定與語言詳情、本機偏好
 * -----------------------------------------------------------------------------
 * 底線：正文不小於 18px（標準 = 18px，大 = 20px，特大 = 22px）；
 *       本階段只提供淺色主題，不再跟隨系統深色；所有設定即時生效並只存本機。
 * ========================================================================== */

(function () {
  'use strict';

  var VTN = window.VTN;
  var U = VTN.util;

  function t(key) { return VTN.i18n.t(key); }

  function show(params) {
    var language = !!(params && params.tab === 'language');
    var generalPanel = document.getElementById('settingsPanelGeneral');
    var languagePanel = document.getElementById('settingsPanelLanguage');
    if (generalPanel) generalPanel.hidden = language;
    if (languagePanel) languagePanel.hidden = !language;
    refreshControls();
    var heading = document.getElementById(language ? 'setLanguage' : 'settingsGeneralTitle');
    if (heading) heading.focus();
  }

  /* 2026-11-09：產品拍板本階段只做淺色。即使本機舊設定存了 dark/system，
     也一律以淺色呈現，避免深色下森林綠被提亮成淺綠、文字對比不足。 */
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.setAttribute('data-theme-preference', 'light');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', '#F6F1E6');
  }

  function apply(prefs) {
    var html = document.documentElement;
    html.setAttribute('data-font-size', prefs.fontSize || 'md');
    html.setAttribute('data-contrast', prefs.contrast ? 'high' : 'normal');
    html.setAttribute('data-reduce-motion', prefs.reduceMotion ? 'true' : 'false');
    applyTheme();
  }

  function refreshControls() {
    var prefs = VTN.store.prefs();

    var languageCurrent = document.getElementById('setLanguageCurrent');
    if (languageCurrent) languageCurrent.textContent = t('lang.name.' + VTN.i18n.lang());

    Array.prototype.forEach.call(document.querySelectorAll('#settingsLanguageOptions [data-lang]'), function (btn) {
      var active = btn.getAttribute('data-lang') === VTN.i18n.lang();
      btn.classList.toggle('is-selected', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      var mark = btn.querySelector('.lang-option__check');
      if (mark) mark.textContent = active ? '✓' : '';
    });

    Array.prototype.forEach.call(document.querySelectorAll('button[data-font-size]'), function (btn) {
      var active = btn.getAttribute('data-font-size') === prefs.fontSize;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

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
    var back = document.getElementById('settingsBack');
    if (back) back.addEventListener('click', function () {
      var languagePanel = document.getElementById('settingsPanelLanguage');
      var fromLanguage = languagePanel && !languagePanel.hidden;
      VTN.router.go(fromLanguage ? 'settings' : 'me', {});
      var target = document.getElementById(fromLanguage ? 'setLanguageEntry' : 'meEntrySettings');
      if (target) target.focus();
    });

    var languageEntry = document.getElementById('setLanguageEntry');
    if (languageEntry) languageEntry.addEventListener('click', function () {
      VTN.router.go('settings', { tab: 'language' });
    });

    Array.prototype.forEach.call(document.querySelectorAll('#settingsLanguageOptions [data-lang]'), function (btn) {
      btn.addEventListener('click', function () {
        var code = btn.getAttribute('data-lang');
        if (VTN.i18n.langs.indexOf(code) === -1) return;
        VTN.i18n.setLang(code);
        VTN.store.setPref('lang', code);
        VTN.ui.toast(t('lang.switched'), 'success');
        if (VTN.assistant) VTN.assistant.refresh();
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('button[data-font-size]'), function (btn) {
      btn.addEventListener('click', function () {
        VTN.store.setPref('fontSize', btn.getAttribute('data-font-size'));
        refreshControls();
        VTN.ui.toast(t('settings.saved'), 'success');
      });
    });

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
          titleKey: 'settings.reset',
          messageKey: 'settings.resetConfirm',
          confirmLabelKey: 'settings.resetBtn',
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
  }

  function init() {
    apply(VTN.store.prefs());
    bind();
    refreshControls();
  }

  VTN.settings = { init: init, apply: apply, refresh: refreshControls, show: show };
})();
