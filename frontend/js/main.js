/* =============================================================================
 * Voices of the North — 主頁互動（Home）
 * 職責：
 *  1. 按裝置時段更新歡迎語（早晨／午安／晚安）
 *  2. 開始錄音 → js/record.js 真實錄音流程
 *  3. 示範故事播放 → js/demo-audio.js 真實示範錄音
 * 本檔只保留時段問候與底導航；轉寫/問答邏輯分見 record.js／ask-assistant.js。
 * ========================================================================== */

(function () {
  'use strict';

  /* ---------- 1. 時段問候 ---------- */
  function updateGreeting() {
    var el = document.getElementById('greeting');
    if (!el) return;
    var h = new Date().getHours();
    var word;
    if (h >= 5 && h < 12) {
      word = '早晨，歡迎返嚟';
    } else if (h >= 12 && h < 18) {
      word = '午安，歡迎返嚟';
    } else {
      word = '晚安，歡迎返嚟';
    }
    el.textContent = word;
  }

  /* ---------- 2. 輕提示 Toast ---------- */
  var toastEl = document.getElementById('appToast');
  var toastText = document.getElementById('appToastText');
  var toastTimer = null;

  function showToast(message) {
    if (!toastEl || !toastText) return;
    toastText.textContent = message;
    // 重置計時，容許連續點擊
    toastEl.classList.remove('is-show');
    // 強制 reflow，確保 class 切換能重新觸發過渡
    void toastEl.offsetWidth;
    toastEl.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('is-show');
    }, 3200);
  }

  /* ---------- 3. 事件綁定 ---------- */
  function bind() {
    // 開始錄音 CTA：由 js/record.js 綁定真實錄音抽屜
    // 示範故事播放／封面：由 js/demo-audio.js 綁定真實音訊

    // 底部導航：四頁均已建成（真實連結）；主頁為當前頁不跳轉
    var navItems = document.querySelectorAll('.bottom-nav__item');

    navItems.forEach(function (item) {
      item.addEventListener('click', function (e) {
        if (item.getAttribute('data-nav') === 'home') {
          e.preventDefault(); // 已在主頁
        }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    updateGreeting();
    bind();
  });
})();
