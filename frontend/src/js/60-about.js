/* =============================================================================
 * 60-about — 關於頁：版本資訊、內容授權與誠實紅線
 * -----------------------------------------------------------------------------
 * 故事數／附音檔數／音檔秒數全部由 stories.json（window.VTN_STORY_DATA）計算，
 * 不再在字典或 HTML 裡寫死，補錄音或加故事後不會失真。
 * ========================================================================== */

(function () {
  'use strict';

  var VTN = window.VTN;
  var U = VTN.util;

  function t(key, vars) { return VTN.i18n.t(key, vars); }

  function storyStats() {
    var data = (VTN.stories && VTN.stories.meta && VTN.stories.meta()) || {};
    var stories = data.stories || [];
    var withAudio = stories.filter(function (s) { return !!s.audio; });
    var seconds = withAudio.reduce(function (sum, s) {
      return sum + (Number(s.durationSec) || 0);
    }, 0);
    return {
      app: VTN.config.version,
      content: data.contentVersion || '—',
      consent: VTN.config.consentPolicyVersion,
      n: stories.length,
      audio: withAudio.length,
      duration: (Math.round(seconds * 10) / 10).toFixed(1)
    };
  }

  function versionText() {
    return t('about.versionBody', storyStats());
  }

  function dataText() {
    return t('about.dataBody', storyStats());
  }

  function render() {
    var version = document.getElementById('aboutVersion');
    if (version) version.textContent = versionText();
    var data = document.getElementById('aboutDataBody');
    if (data) data.textContent = dataText();
  }

  function init() {
    render();
    U.on('vtn:lang-changed', render);
  }

  VTN.about = { init: init, render: render };
})();
