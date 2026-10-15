/* =============================================================================
 * Voices of the North — 村落故事頁
 * 職責：
 *  1. 地點／主題篩選：僅一張真實存在的示範故事卡；篩選值全部來自它的真實屬性。
 *     跨類別為 AND；同類別多選為 OR；全部取消時等同不篩選（顯示全部）。
 *  2. 「開啟故事」：由 js/demo-audio.js 播放真實示範錄音 assets/demo-story.m4a。
 *  3. 底部導航：已建成頁真實跳轉，未建成頁以 Toast 標示「準備中」。
 * 不編造更多故事。
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
    }, 3600);
  }

  /* ---------- 2. 篩選 ---------- */
  function initFilters() {
    var chips = Array.prototype.slice.call(document.querySelectorAll('.chip'));
    var cards = Array.prototype.slice.call(document.querySelectorAll('.story-hero-card'));
    if (!chips.length) return;

    function activeValues(type) {
      var values = [];
      chips.forEach(function (chip) {
        if (chip.getAttribute('data-filter-type') === type &&
            chip.classList.contains('is-active')) {
          values.push(chip.getAttribute('data-filter-value'));
        }
      });
      return values;
    }

    function applyFilters() {
      var locations = activeValues('location');
      var topics = activeValues('topic');

      cards.forEach(function (card) {
        var locOk = locations.length === 0 ||
                    locations.indexOf(card.getAttribute('data-location')) !== -1;
        var topicOk = topics.length === 0 ||
                      topics.indexOf(card.getAttribute('data-topic')) !== -1;
        card.classList.toggle('is-hidden', !(locOk && topicOk));
      });
    }

    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        var pressed = chip.classList.toggle('is-active');
        chip.setAttribute('aria-pressed', pressed ? 'true' : 'false');
        applyFilters();
      });
    });
  }

  /* 「開啟故事」播放由 js/demo-audio.js 統一處理（真實示範錄音）。 */

  /* ---------- 4. 底部導航（四頁均已建成，真實連結；當前頁不跳轉） ---------- */
  function initNav() {
    document.querySelectorAll('.bottom-nav__item').forEach(function (item) {
      item.addEventListener('click', function (e) {
        if (item.getAttribute('data-nav') === 'stories') {
          e.preventDefault(); // 已在故事頁
        }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initFilters();
    initNav();
  });
})();
