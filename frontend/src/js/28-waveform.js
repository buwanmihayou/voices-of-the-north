/* =============================================================================
 * 28-waveform — 由真實音檔解出振幅，供故事播放器繪製波形
 * -----------------------------------------------------------------------------
 * 原則：只畫實測振幅。解碼失敗（檔案不存在、格式不支援、跨域被擋）時
 *       回傳 null，播放器維持原本的細進度條，**不生成任何假波形**。
 * 技術：fetch → AudioContext.decodeAudioData → 每柱 RMS → 歸一化 + 動態壓縮。
 *       一個 url 只解碼一次，結果以 Promise 快取。
 * ========================================================================== */

(function () {
  'use strict';

  var VTN = window.VTN;
  var BARS = 60;
  var MAX_SAMPLES_PER_BAR = 240;
  var cache = Object.create(null);
  var buildHits = [];
  var context = null;

  function getContext() {
    if (context) return context;
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try { context = new Ctor(); } catch (e) { return null; }
    return context;
  }

  function decodeArrayBuffer(buffer) {
    var ctx = getContext();
    if (!ctx) return Promise.reject(new Error('no AudioContext'));
    return new Promise(function (resolve, reject) {
      var result;
      try {
        /* 現代瀏覽器回傳 Promise；舊版 Safari 走第 2/3 個 callback 參數。
           同一次呼叫同時相容兩者，避免對已 detach 的 ArrayBuffer 再解一次。 */
        result = ctx.decodeAudioData(buffer, resolve, reject);
      } catch (e) {
        reject(e);
        return;
      }
      if (result && typeof result.then === 'function') result.then(resolve, reject);
    });
  }

  function peaks(audio) {
    var channels = Math.min(audio.numberOfChannels || 1, 2);
    var length = audio.length || 0;
    if (!length || !channels) return null;

    var perBar = Math.max(1, Math.floor(length / BARS));
    var step = Math.max(1, Math.floor(perBar / MAX_SAMPLES_PER_BAR));
    var out = new Array(BARS);
    var max = 0;

    for (var b = 0; b < BARS; b++) {
      var start = b * perBar;
      var end = Math.min(length, start + perBar);
      var sum = 0;
      var n = 0;
      var peak = 0;
      for (var c = 0; c < channels; c++) {
        var data = audio.getChannelData(c);
        for (var i = start; i < end; i += step) {
          var v = data[i];
          sum += v * v;
          var av = v < 0 ? -v : v;
          if (av > peak) peak = av;
          n++;
        }
      }
      var rms = n ? Math.sqrt(sum / n) : 0;
      /* 純 RMS 會把語音壓成近等高柱；混入峰值後停頓與重音才看得出來 */
      var value = 0.6 * rms + 0.4 * peak;
      out[b] = value;
      if (value > max) max = value;
    }

    if (!(max > 0)) return null; /* 全靜音視為無法判讀，不硬湊波形 */
    for (var j = 0; j < BARS; j++) {
      /* 0.85 次方：只做輕微動態壓縮，保留真實起伏 */
      out[j] = Math.min(1, Math.pow(out[j] / max, 0.85));
    }
    return out;
  }

  /**
   * 取得某個音檔的實測振幅（0..1，長度 BARS）。失敗 resolve(null)。
   * 優先讀構建期快取 window.VTN_WAVEFORMS，其次才在執行期 fetch + decode。
   */
  function get(url, storyId) {
    var baked = (storyId && window.VTN_WAVEFORMS) ? window.VTN_WAVEFORMS[storyId] : null;
    if (Array.isArray(baked) && baked.length) {
      if (buildHits.indexOf(storyId) < 0) buildHits.push(storyId);
      return Promise.resolve(baked);
    }
    if (!url) return Promise.resolve(null);
    if (cache[url]) return cache[url];
    if (typeof fetch !== 'function' || !(window.AudioContext || window.webkitAudioContext)) {
      cache[url] = Promise.resolve(null);
      return cache[url];
    }
    cache[url] = fetch(url)
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.arrayBuffer();
      })
      .then(decodeArrayBuffer)
      .then(peaks)
      .catch(function () { return null; });
    return cache[url];
  }

  VTN.waveform = {
    bars: BARS,
    get: get,
    debug: function () {
      return {
        buildHits: buildHits.slice(),
        bakedCount: Object.keys(window.VTN_WAVEFORMS || {}).length,
        runtimeDecodes: Object.keys(cache),
        contextReady: !!context
      };
    }
  };
})();
