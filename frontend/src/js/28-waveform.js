/* =============================================================================
 * 28-waveform — 由真實音檔解出振幅，供故事播放器繪製波形
 * -----------------------------------------------------------------------------
 * 原則：只畫實測振幅。解碼失敗（檔案不存在、格式不支援、跨域被擋）時
 *       回傳 null，播放器維持原本的細進度條，**不生成任何假波形**。
 * 一致性：構建期（tools/build_frontend.py）與執行期共用同一套
 *         8 kHz 重採樣網格 + 60 柱 RMS/峰值混合，兩條路徑畫的是同一條波形，
 *         不再因 AudioContext 取樣率不同而產生可解釋性問題。
 * 資料：優先讀構建期快取 window.VTN_WAVEFORMS；故事量大時可改用
 *       window.VTN_WAVEFORMS_URL 指向外置 waveforms.json 按需載入。
 * ========================================================================== */

(function () {
  'use strict';

  var VTN = window.VTN;
  var BARS = 60;
  var TARGET_RATE = 8000;
  var cache = Object.create(null);
  var buildHits = [];
  var externalPromise = null;
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

  /* 任意取樣率的單聲道 PCM → 8 kHz 線性插值網格。
     與 tools/build_frontend.py 的 waveform_peaks 逐樣本對齊（含取整規則）。 */
  function resample(data, sourceRate) {
    var duration = data.length / sourceRate;
    var count = Math.max(BARS, Math.round(duration * TARGET_RATE));
    var out = new Float32Array(count);
    var ratio = sourceRate / TARGET_RATE;
    for (var i = 0; i < count; i++) {
      var pos = i * ratio;
      var lo = Math.floor(pos);
      var frac = pos - lo;
      var a = lo < data.length ? data[lo] : 0;
      var b = lo + 1 < data.length ? data[lo + 1] : a;
      out[i] = a + (b - a) * frac;
    }
    return out;
  }

  function peaks(samples) {
    var length = samples.length;
    if (length < BARS) return null;
    var out = new Array(BARS);
    var max = 0;

    for (var b = 0; b < BARS; b++) {
      var start = Math.floor(b * length / BARS);
      var end = Math.max(start + 1, Math.floor((b + 1) * length / BARS));
      if (end > length) end = length;
      var sum = 0;
      var n = 0;
      var peak = 0;
      for (var i = start; i < end; i++) {
        var v = samples[i];
        sum += v * v;
        var av = v < 0 ? -v : v;
        if (av > peak) peak = av;
        n++;
      }
      var rms = n ? Math.sqrt(sum / n) : 0;
      /* 純 RMS 會把語音壓成近等高柱；混入峰值後停頓與重音才看得出來 */
      var value = 0.6 * rms + 0.4 * peak;
      out[b] = value;
      if (value > max) max = value;
    }

    if (!(max > 0)) return null; /* 全靜音視為無法判讀，不硬湊波形 */
    for (var j = 0; j < BARS; j++) {
      /* 0.85 次方：只做輕微動態壓縮，保留真實起伏；四捨五入與構建期一致 */
      out[j] = Math.round(Math.min(1, Math.pow(out[j] / max, 0.85)) * 1000) / 1000;
    }
    return out;
  }

  function peaksFromAudio(audio) {
    if (!audio || !audio.length || !audio.sampleRate) return null;
    return peaks(resample(audio.getChannelData(0), audio.sampleRate));
  }

  function loadExternal() {
    var url = window.VTN_WAVEFORMS_URL;
    if (!url || typeof fetch !== 'function') return Promise.resolve(null);
    if (!externalPromise) {
      externalPromise = fetch(url)
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.json();
        })
        .then(function (data) {
          if (!data || typeof data !== 'object') return null;
          window.VTN_WAVEFORMS = data;
          return data;
        })
        .catch(function () { return null; });
    }
    return externalPromise;
  }

  function runtime(url) {
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
      .then(peaksFromAudio)
      .catch(function () { return null; });
    return cache[url];
  }

  /**
   * 取得某個音檔的實測振幅（0..1，長度 BARS）。失敗 resolve(null)。
   * 順序：內嵌快取 → 外置 waveforms.json → 執行期 fetch + decode。
   */
  function get(url, storyId) {
    var baked = (storyId && window.VTN_WAVEFORMS) ? window.VTN_WAVEFORMS[storyId] : null;
    if (Array.isArray(baked) && baked.length) {
      if (buildHits.indexOf(storyId) < 0) buildHits.push(storyId);
      return Promise.resolve(baked);
    }
    if (!window.VTN_WAVEFORMS_URL) return runtime(url);
    return loadExternal().then(function (data) {
      var hit = data && storyId ? data[storyId] : null;
      if (Array.isArray(hit) && hit.length) {
        if (buildHits.indexOf(storyId) < 0) buildHits.push(storyId);
        return hit;
      }
      return runtime(url);
    });
  }

  VTN.waveform = {
    bars: BARS,
    rate: TARGET_RATE,
    get: get,
    debug: function () {
      return {
        buildHits: buildHits.slice(),
        bakedCount: Object.keys(window.VTN_WAVEFORMS || {}).length,
        externalUrl: window.VTN_WAVEFORMS_URL || null,
        runtimeDecodes: Object.keys(cache),
        contextReady: !!context
      };
    }
  };
})();
