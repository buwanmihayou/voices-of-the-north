/* =============================================================================
 * 20-audio — 音訊播放（故事頁、錄音卡、助手來源跳轉共用）
 * -----------------------------------------------------------------------------
 * * 全站播放音量／速度由設定頁統一控制；
 * * 故事只有一個音檔欄位（data/stories.json 的 audio），冇音檔的故事會如實
 *   標示「未附音檔」，不會假裝可以跳秒；
 * * 跳秒一律等 loadedmetadata 後才 seek，避免跳到 0 秒。
 * ========================================================================== */

(function () {
  'use strict';

  var VTN = window.VTN;
  var U = VTN.util;

  var hidden = null;
  var current = null;
  var currentStoryId = null;
  var timeHandlers = [];

  function prefs() { return VTN.store.prefs(); }

  function applyPrefs(audioEl) {
    if (!audioEl) return;
    var p = prefs();
    try { audioEl.volume = U.clamp(p.volume / 100, 0, 1); } catch (e) { /* ignore */ }
    try { audioEl.playbackRate = Number(p.speed) || 1; } catch (e) { /* ignore */ }
  }

  document.addEventListener('play', function (event) {
    var el = event.target;
    if (el && el.tagName === 'AUDIO') applyPrefs(el);
  }, true);

  document.addEventListener('loadedmetadata', function (event) {
    var el = event.target;
    if (el && el.tagName === 'AUDIO') applyPrefs(el);
  }, true);

  U.on('vtn:prefs-changed', function () {
    Array.prototype.forEach.call(document.querySelectorAll('audio'), applyPrefs);
  });

  function ensureHidden() {
    if (hidden) return hidden;
    hidden = new Audio();
    hidden.preload = 'metadata';
    hidden.addEventListener('timeupdate', function () {
      timeHandlers.forEach(function (fn) {
        try { fn(hidden.currentTime, currentStoryId); } catch (e) { /* ignore */ }
      });
    });
    hidden.addEventListener('ended', function () {
      U.emit('vtn:audio-ended', { storyId: currentStoryId });
    });
    return hidden;
  }

  function seekPlay(audioEl, seconds) {
    if (!audioEl) return;
    applyPrefs(audioEl);
    var sec = Math.max(0, Number(seconds) || 0);
    function start() {
      try { audioEl.currentTime = sec; } catch (e) { /* ignore */ }
      var promise = audioEl.play();
      if (promise && promise.catch) promise.catch(function () { /* 自動播放被擋 */ });
    }
    /* 已載入 metadata 就直接跳秒；切勿再呼叫 load()，否則會把時間重設回 0 秒。 */
    if (audioEl.readyState >= 1) { start(); return; }
    audioEl.addEventListener('loadedmetadata', start, { once: true });
    try { audioEl.load(); } catch (e) { /* ignore */ }
  }

  function storyById(id) {
    return VTN.stories ? VTN.stories.get(id) : null;
  }

  /**
   * 播放某則故事（可指定秒數）。冇音檔時回傳 false，由呼叫方如實提示。
   */
  function playStory(storyId, seconds) {
    var story = storyById(storyId);
    if (!story) return false;

    var detailAudio = document.getElementById('storyAudio');
    var useDetail = detailAudio && detailAudio.getAttribute('data-story') === storyId;
    var src = story.audio || '';
    if (!src) {
      pauseStory();
      return false;
    }

    var audioEl;
    if (useDetail) {
      audioEl = detailAudio;
    } else {
      audioEl = ensureHidden();
      if (audioEl.getAttribute('data-src') !== src) {
        audioEl.src = src;
        audioEl.setAttribute('data-src', src);
      }
    }
    current = audioEl;
    currentStoryId = storyId;
    audioEl.setAttribute('data-story', storyId);
    seekPlay(audioEl, seconds || 0);
    U.emit('vtn:audio-play', { storyId: storyId, seconds: seconds || 0 });
    return true;
  }

  function pauseStory() {
    if (current && !current.paused) current.pause();
    if (hidden && !hidden.paused) hidden.pause();
    U.emit('vtn:audio-paused', { storyId: currentStoryId });
  }

  function playingStoryId() {
    if (current && !current.paused) return currentStoryId;
    if (hidden && !hidden.paused) return currentStoryId;
    return null;
  }

  function currentTime() {
    if (current) return current.currentTime || 0;
    return hidden ? (hidden.currentTime || 0) : 0;
  }

  function onTime(fn) { timeHandlers.push(fn); }

  VTN.audio = {
    applyPrefs: applyPrefs,
    seekPlay: seekPlay,
    playStory: playStory,
    pauseStory: pauseStory,
    playingStoryId: playingStoryId,
    currentTime: currentTime,
    onTime: onTime,
    elements: function () { return Array.prototype.slice.call(document.querySelectorAll('audio')); }
  };
})();
