/* =============================================================================
 * Voices of the North — 示範故事真實音訊播放（主頁／故事頁共用）
 * -----------------------------------------------------------------------------
 * 音軌：assets/demo-story.m4a（Boris Lau 真實示範錄音，約 50.7 秒，非合成人聲）。
 * 職責：
 *   1. 全頁單一 <audio> 單例，[data-demo-play] 按鈕播放／暫停，圖標同步切換
 *   2. [data-demo-duration] 元素在 metadata 載入後顯示真實時長
 *   3. 支援 ?t=17.5 自動跳秒（助手出處膠囊／錄音整理 QA 跳入）
 *   4. 對外 API：window.VTNDemoAudio.play(sec) / pause() / toggle()
 * ========================================================================== */

(function () {
  'use strict';

  var AUDIO_SRC = 'assets/demo-story.m4a';
  var audio = null;
  var toggles = Array.prototype.slice.call(document.querySelectorAll('[data-demo-play]'));

  function pad(n) { return String(n).padStart(2, '0'); }
  function fmt(sec) {
    var s = Math.max(0, Math.floor(sec || 0));
    return pad(Math.floor(s / 60)) + ':' + pad(s % 60);
  }

  function ensureAudio() {
    if (audio) return audio;
    audio = new Audio(AUDIO_SRC);
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', function () {
      document.querySelectorAll('[data-demo-duration]').forEach(function (el) {
        if (isFinite(audio.duration)) el.textContent = fmt(audio.duration);
      });
    });
    audio.addEventListener('play', syncIcons);
    audio.addEventListener('pause', syncIcons);
    audio.addEventListener('ended', function () {
      try { audio.currentTime = 0; } catch (e) { /* ignore */ }
      syncIcons();
    });
    return audio;
  }

  function syncIcons() {
    var playing = !!(audio && !audio.paused);
    toggles.forEach(function (btn) {
      var icon = btn.querySelector('i.fa-solid');
      if (icon) {
        icon.classList.toggle('fa-play', !playing);
        icon.classList.toggle('fa-pause', playing);
      }
      var label = btn.querySelector('[data-demo-label]');
      if (label) label.textContent = playing ? '暫停故事' : '開啟故事';
      btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    });
  }

  function play(sec) {
    var a = ensureAudio();
    if (typeof sec === 'number' && isFinite(sec)) {
      try { a.currentTime = sec; } catch (e) { /* metadata 未到時忽略 */ }
    }
    var pr = a.play();
    if (pr && pr.catch) pr.catch(function () { /* 自動播放被瀏覽器擋下：保持暫停 */ });
  }

  function pause() { if (audio) audio.pause(); }

  function toggle(sec) {
    var a = ensureAudio();
    if (!a.paused) { a.pause(); return; }
    play(typeof sec === 'number' ? sec : undefined);
  }

  toggles.forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      var t = btn.getAttribute('data-demo-play');
      toggle(t ? parseFloat(t) : undefined);
    });
  });

  /* ?t=17.5#story-YL-001：從助手出處膠囊跳來時，定位＋跳秒播放 */
  function maybeAutostart() {
    var params = new URLSearchParams(location.search);
    var wantHash = /#story-YL-001/.test(location.hash);
    var t = params.get('t');
    if (!wantHash && t === null) return;

    var card = document.querySelector('.story-hero-card');
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('is-highlight');
      setTimeout(function () { card.classList.remove('is-highlight'); }, 2600);
    }
    if (t !== null) play(parseFloat(t) || 0);
  }

  window.VTNDemoAudio = { play: play, pause: pause, toggle: toggle };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeAutostart);
  } else {
    maybeAutostart();
  }
})();
