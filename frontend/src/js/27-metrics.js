/* 27-metrics — 指標三事件：地圖瀏覽時長、點位點擊率、音訊完成率。
   只記錄數值與故事 ID，不記錄逐字稿／標題／個人資料；離線時留本機緩衝。 */
(function () {
  'use strict';
  var VTN = window.VTN;
  var U = VTN.util;
  var KEY = 'vtn-metrics-v1';
  var LIMIT = 100;
  var ALLOWED = ['storyId', 'durationMs', 'ratio', 'zoom', 'engine', 'view', 'source', 'count', 'event'];
  var buffer = load();
  var mapStart = null;
  var playStart = null;

  function load() {
    try {
      var parsed = JSON.parse(window.localStorage.getItem(KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }

  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(buffer)); } catch (e) { /* ignore */ }
  }

  function clean(meta) {
    var out = {};
    Object.keys(meta || {}).forEach(function (key) {
      if (ALLOWED.indexOf(key) < 0) return;
      var value = meta[key];
      if (typeof value === 'number' && isFinite(value)) out[key] = Math.round(value * 1000) / 1000;
      else if (typeof value === 'string') out[key] = value.slice(0, 64);
    });
    return out;
  }
  /* util.on 綁的是原生 CustomEvent，資料在 event.detail */
  function detailOf(event) { return (event && event.detail) || {}; }

  function track(event, meta) {
    var entry = { at: new Date().toISOString(), event: event, meta: clean(meta) };
    buffer.push(entry);
    if (buffer.length > LIMIT) buffer = buffer.slice(-LIMIT);
    save();
    try {
      if (VTN.api && VTN.api.audit) {
        var bodyMeta = clean(meta);
        bodyMeta.event = event;
        VTN.api.audit({ action: 'metric.' + event, meta: bodyMeta })
          .catch(function () { /* 離線：已留本機緩衝 */ });
      }
    } catch (e) { /* 後端未就緒 */ }
    U.emit('vtn:metric', entry);
    return entry;
  }

  function engineName() {
    return (VTN.map && VTN.map.status) ? VTN.map.status() : 'unknown';
  }

  function beginMapView() {
    if (mapStart) return;
    mapStart = Date.now();
  }

  function endMapView(source) {
    if (!mapStart) return;
    var ms = Date.now() - mapStart;
    mapStart = null;
    if (ms < 500) return;
    track('map.view', { durationMs: ms, view: 'map', engine: engineName(), source: source });
  }
  function reportProgress(storyId, source) {
    if (!storyId || !VTN.stories || !VTN.audio || !VTN.audio.currentTime) return;
    var story = VTN.stories.get(storyId);
    var dur = story && story.durationSec;
    if (!dur) return;
    var ratio = (VTN.audio.currentTime() || 0) / dur;
    if (ratio <= 0.02 || ratio >= 0.95) return;
    track('audio.progress', { storyId: storyId, ratio: ratio, source: source });
  }

  function reportPlaying(source) {
    if (!VTN.audio || !VTN.audio.playingStoryId()) return;
    reportProgress(VTN.audio.playingStoryId(), source);
  }

  U.on('vtn:view-changed', function (event) {
    var view = detailOf(event).view;
    if (view !== 'stories') {
      reportPlaying('leave');
      endMapView('leave');
      return;
    }
    var mode = (VTN.stories && VTN.stories.mode) ? VTN.stories.mode() : 'map';
    if (mode === 'map') beginMapView();
    else endMapView('list');
  });

  U.on('vtn:stories-mode', function (event) {
    if (detailOf(event).mode === 'map') beginMapView();
    else endMapView('list');
  });

  U.on('vtn:audio-play', function () { playStart = Date.now(); });

  U.on('vtn:audio-ended', function (event) {
    track('audio.complete', {
      storyId: detailOf(event).storyId || '',
      ratio: 1,
      durationMs: playStart ? Date.now() - playStart : 0
    });
    playStart = null;
  });

  U.on('vtn:audio-paused', function (event) {
    reportProgress(detailOf(event).storyId, 'pause');
    playStart = null;
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      reportPlaying('hidden');
      endMapView('hidden');
    } else if (document.body.getAttribute('data-view') === 'stories' &&
      (!VTN.stories || !VTN.stories.mode || VTN.stories.mode() === 'map')) {
      beginMapView();
    }
  });

  window.addEventListener('pagehide', function () {
    reportPlaying('pagehide');
    endMapView('pagehide');
  });
  VTN.metrics = {
    track: track,
    debug: function () { return { count: buffer.length, recent: buffer.slice(-6) }; },
    clear: function () { buffer = []; save(); }
  };
})();
