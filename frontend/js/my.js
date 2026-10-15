/* =============================================================================
 * Voices of the North — 我的（管理中心）
 * 職責：
 *  1. 「我的錄音與故事」為真實連結，跳轉錄音管理頁（FR-MY2）。
 *  2. 隱私分享範圍、更正/撤回、關於頁尚未建成：以 Toast 誠實標示「準備中」，
 *     並在提示中保留已確立的私隱承諾（預設私人、撤回後音訊仍歸講述者）。
 *  3. 語言選擇：開啟底部彈層；當前版本僅「繁體中文（香港）」可用，
 *     English 與簡體中文誠實標示「準備中」，點擊只提示、不切換。
 *  4. 不設帳戶、姓名或統計功能（FR-MY7），故本頁無任何假資料。
 * ========================================================================== */

(function () {
  'use strict';

  /* ---------- 1. 輕提示 Toast ---------- */
  var toastEl = document.getElementById('appToast');
  var toastText = document.getElementById('appToastText');
  var toastTimer = null;

  function showToast(message) {
    if (!toastEl || !toastText) return;
    toastText.textContent = message;
    toastEl.classList.remove('is-show');
    void toastEl.offsetWidth;
    toastEl.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('is-show');
    }, 3800);
  }

  /* ---------- 2. 尚未建成的管理入口 ---------- */
  function initEntries() {
    var pending = {
      meEntryPrivacy:
        '分享範圍設定準備中。預設為最私密的「私人」，日後可隨時更改。',
      meEntryCorrection:
        '更正與撤回功能準備中。撤回後故事會離開共享面，音訊仍保留在你手中。',
      meEntryAbout:
        '「關於 Voices of the North」頁面準備中。'
    };

    Object.keys(pending).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('click', function () {
        showToast(pending[id]);
      });
    });
  }

  /* ---------- 3. 語言選擇底部彈層 ---------- */
  function initLanguageSheet() {
    var entry = document.getElementById('meEntryLanguage');
    var sheet = document.getElementById('langSheet');
    var overlay = document.getElementById('langOverlay');
    var closeBtn = document.getElementById('langSheetClose');
    var cancelBtn = document.getElementById('langSheetCancel');
    var options = Array.prototype.slice.call(
      document.querySelectorAll('.lang-option'));
    if (!entry || !sheet || !overlay) return;

    var lastFocused = null;
    var closeTimer = null;

    var SOON_MESSAGES = {
      en: 'English 介面準備中，當前版本提供繁體中文（香港）。',
      'zh-CN': '簡體中文介面準備中，當前版本提供繁體中文（香港）。'
    };

    function openSheet() {
      clearTimeout(closeTimer);
      lastFocused = document.activeElement;
      sheet.hidden = false;
      overlay.hidden = false;
      document.body.style.overflow = 'hidden';
      // 下一幀再加 class，確保滑入過渡生效
      requestAnimationFrame(function () {
        sheet.classList.add('is-show');
        overlay.classList.add('is-show');
      });
      var selected = document.querySelector('.lang-option.is-selected');
      if (selected) selected.focus();
    }

    function closeSheet() {
      sheet.classList.remove('is-show');
      overlay.classList.remove('is-show');
      document.body.style.overflow = '';
      // 過渡結束後才真正隱藏（與 CSS --dur 380ms 對齊）
      closeTimer = setTimeout(function () {
        sheet.hidden = true;
        overlay.hidden = true;
      }, 380);
      if (lastFocused && typeof lastFocused.focus === 'function') {
        lastFocused.focus();
      }
    }

    entry.addEventListener('click', openSheet);
    closeBtn.addEventListener('click', closeSheet);
    cancelBtn.addEventListener('click', closeSheet);
    overlay.addEventListener('click', closeSheet);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !sheet.hidden) closeSheet();
    });

    options.forEach(function (option) {
      option.addEventListener('click', function () {
        if (option.dataset.available === 'true') {
          // 唯一可用語言即當前語言：確認後關閉彈層
          closeSheet();
          return;
        }
        // 未建成語言：誠實提示，維持當前選擇不變
        showToast(SOON_MESSAGES[option.dataset.lang] ||
                  '該語言介面準備中，當前版本提供繁體中文（香港）。');
      });
    });
  }

  /* ---------- 4. 底部導航（當前頁不跳轉） ---------- */
  function initNav() {
    document.querySelectorAll('.bottom-nav__item').forEach(function (item) {
      item.addEventListener('click', function (e) {
        if (item.getAttribute('data-nav') === 'me') {
          e.preventDefault();  // 已在「我的」頁
        }
        // home / record / stories 為真實連結，不攔截
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initEntries();
    initLanguageSheet();
    initNav();
  });
})();
