/* =============================================================================
 * 60-about — 關於頁：版本資訊、內容授權與誠實紅線
 * ========================================================================== */

(function () {
  'use strict';

  var VTN = window.VTN;
  var U = VTN.util;

  function t(key, vars) { return VTN.i18n.t(key, vars); }

  function versionText() {
    var data = VTN.stories.meta() || {};
    var stories = (data.stories || []);
    var withAudio = stories.filter(function (s) { return !!s.audio; }).length;
    return t('about.versionBody', {
      app: VTN.config.version,
      content: data.contentVersion || '—',
      consent: VTN.config.consentPolicyVersion,
      n: stories.length,
      audio: withAudio
    });
  }

  function renderVersion() {
    var el = document.getElementById('aboutVersion');
    if (!el) return;
    el.textContent = versionText();
  }

  function init() {
    renderVersion();
    U.on('vtn:lang-changed', renderVersion);
  }

  VTN.about = { init: init, render: renderVersion };
})();
