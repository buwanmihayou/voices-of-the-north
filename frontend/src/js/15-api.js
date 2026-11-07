/* =============================================================================
 * 15-api — 與後端溝通（單一出口，含 AI 狀態、授權標頭、離線判定）
 * -----------------------------------------------------------------------------
 * 所有請求都帶 X-VTN-User / X-VTN-Role，讓伺服器可以按分享範圍過濾，
 * 而不是只靠前端隱藏。API 只放伺服器端，前端永遠不含任何金鑰。
 * ========================================================================== */

(function () {
  'use strict';

  var VTN = window.VTN;
  var U = VTN.util;

  var healthCache = { at: 0, data: null, error: null };
  var HEALTH_TTL = 20000;

  function base() { return VTN.config.apiBase || ''; }

  function viewerHeaders() {
    var session = VTN.store.session();
    var headers = {
      'X-VTN-User': session ? session.email : 'visitor-' + (visitorTag()),
      'X-VTN-Role': session ? session.role : 'visitor'
    };
    if (session && session.token && session.token !== 'local-demo') {
      headers.Authorization = 'Bearer ' + session.token;
    }
    return headers;
  }

  var visitorTagCache = null;
  function visitorTag() {
    if (visitorTagCache) return visitorTagCache;
    var tag = null;
    try { tag = window.localStorage.getItem('vtn.v2.visitor'); } catch (e) { /* ignore */ }
    if (!tag) {
      tag = Math.random().toString(36).slice(2, 10);
      try { window.localStorage.setItem('vtn.v2.visitor', tag); } catch (e) { /* ignore */ }
    }
    visitorTagCache = tag;
    return tag;
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        var err = new Error('timeout');
        err.offline = true;
        err.code = 'TIMEOUT';
        reject(err);
      }, ms || 12000);
      promise.then(function (value) {
        clearTimeout(timer);
        resolve(value);
      }, function (error) {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  function parseBody(response) {
    var type = response.headers.get('content-type') || '';
    if (type.indexOf('application/json') === -1) {
      return response.text().then(function (text) { return { raw: text }; });
    }
    return response.json().catch(function () { return null; });
  }

  /**
   * @returns {Promise<any>} 失敗時 reject 一個帶 status / code / offline 的 Error
   */
  function request(path, options) {
    var opts = options || {};
    var headers = Object.assign({}, viewerHeaders(), opts.headers || {});
    var fetchOpts = { method: opts.method || 'GET', headers: headers };
    if (opts.body instanceof FormData) {
      fetchOpts.body = opts.body;
    } else if (opts.body !== undefined && opts.body !== null) {
      headers['Content-Type'] = 'application/json';
      fetchOpts.body = JSON.stringify(opts.body);
    }

    var url = /^https?:/i.test(path) ? path : base() + path;
    var task = fetch(url, fetchOpts).then(function (response) {
      return parseBody(response).then(function (data) {
        if (response.ok) return data;
        var detail = data && (data.detail || data.error || data.message);
        var err = new Error(detail || ('HTTP ' + response.status));
        err.status = response.status;
        err.code = data && data.code ? data.code : (detail || 'HTTP_' + response.status);
        err.detail = detail || '';
        throw err;
      });
    }).catch(function (error) {
      if (error && error.status) throw error;
      var offline = new Error(error && error.message ? error.message : 'network');
      offline.offline = true;
      offline.code = 'NETWORK';
      throw offline;
    });

    return withTimeout(task, opts.timeout || 15000);
  }

  /* ---------------- 健康檢查與 AI 狀態 ---------------- */
  function health(force) {
    var now = Date.now();
    if (!force && healthCache.data && now - healthCache.at < HEALTH_TTL) {
      return Promise.resolve(healthCache.data);
    }
    if (!force && healthCache.error && now - healthCache.at < 5000) {
      return Promise.reject(healthCache.error);
    }
    return request('/api/health', { timeout: 5000 }).then(function (data) {
      healthCache = { at: Date.now(), data: data, error: null };
      U.emit('vtn:health', data);
      return data;
    }).catch(function (error) {
      healthCache = { at: Date.now(), data: null, error: error };
      U.emit('vtn:health', null);
      throw error;
    });
  }

  /**
   * 三態：online（轉寫＋AI 都在線）／degraded（服務在，但能力受限）／offline（連不上）
   */
  function aiState() {
    if (healthCache.error) return { state: 'offline', reason: 'unreachable' };
    var data = healthCache.data;
    if (!data) return { state: 'offline', reason: 'unchecked' };
    var stt = !!data.stt_ready;
    var llm = !!(data.gemini_ready || data.llm_ready);
    if (stt && llm) return { state: 'online', reason: '', data: data };
    if (stt || llm || data.status === 'ok') {
      return { state: 'degraded', reason: stt ? 'llm-offline' : (llm ? 'stt-offline' : 'capability-offline'), data: data };
    }
    return { state: 'offline', reason: 'service-down', data: data };
  }

  function refreshHealth() { return health(true).catch(function () { return null; }); }

  /* ---------------- 錄音同步 ---------------- */
  function toBase64(dataUrl) {
    if (!dataUrl || String(dataUrl).indexOf(';base64,') < 0) return '';
    return String(dataUrl).split(';base64,')[1];
  }

  function syncRecord(rec) {
    var payload = Object.assign({}, rec);
    payload.audioBase64 = toBase64(rec.audioDataURL);
    delete payload.audioDataURL;
    delete payload.syncError;
    return request('/api/records', { method: 'POST', body: payload, timeout: 30000 })
      .then(function (data) {
        var patch = { sync: 'synced', syncAt: Date.now(), syncError: null };
        if (data && data.record && data.record.audioUrl) {
          patch.audioUrl = tokenizeAudioUrl(data.record.audioUrl);
        }
        return VTN.store.records.patch(rec.id, patch);
      });
  }

  function tokenizeAudioUrl(url) {
    if (!url) return url;
    var session = VTN.store.session();
    if (!session || !session.token) return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(session.token);
  }

  function pullRecords() {
    return request('/api/records', { timeout: 12000 }).then(function (data) {
      var list = (data && data.records) || [];
      list.forEach(function (rec) { if (rec.audioUrl) rec.audioUrl = tokenizeAudioUrl(rec.audioUrl); });
      var merged = VTN.store.records.merge(list);
      return { merged: merged, total: list.length, mode: data && data.mode };
    });
  }

  function deleteRecord(id) {
    return request('/api/records/' + encodeURIComponent(id), { method: 'DELETE', timeout: 12000 });
  }

  /* ---------------- 帳戶 ---------------- */
  function requestLoginCode(email) {
    return request('/api/auth/request-code', { method: 'POST', body: { email: email } });
  }

  function verifyLogin(payload) {
    return request('/api/auth/verify', { method: 'POST', body: payload });
  }

  /* ---------------- 故事與助手 ---------------- */
  function fetchStories(options) {
    var path = '/api/stories';
    var bbox = options && options.bbox;
    if (Array.isArray(bbox) && bbox.length === 2 && bbox[0].length === 2 && bbox[1].length === 2) {
      path += '?bbox=' + [bbox[0][0], bbox[0][1], bbox[1][0], bbox[1][1]]
        .map(function (n) { return Number(n).toFixed(5); }).join(',');
    }
    return request(path, { timeout: 10000 }).then(function (data) {
      return (data && data.stories) || [];
    });
  }

  function ask(question, options) {
    return request('/api/ask-village', {
      method: 'POST',
      body: { question: question, lang: options && options.lang },
      timeout: 12000
    });
  }

  function submitCorrection(payload) {
    return request('/api/corrections', { method: 'POST', body: payload, timeout: 10000 });
  }

  function reviewCorrection(id, approve, note) {
    return request('/api/corrections/' + encodeURIComponent(id) + '/review', {
      method: 'POST',
      body: { approve: !!approve, note: note || '' },
      timeout: 10000
    });
  }

  function withdrawStory(id, reason) {
    return request('/api/stories/' + encodeURIComponent(id) + '/withdraw', {
      method: 'POST',
      body: { reason: reason || '' },
      timeout: 10000
    });
  }

  function pushAudit(entry) {
    return request('/api/audit', { method: 'POST', body: entry, timeout: 6000 });
  }

  function pushConsent(entry) {
    return request('/api/consent', { method: 'POST', body: entry, timeout: 6000 });
  }

  VTN.api = {
    base: base,
    request: request,
    health: health,
    refreshHealth: refreshHealth,
    aiState: aiState,
    cachedHealth: function () { return healthCache.data; },
    viewerHeaders: viewerHeaders,
    records: {
      sync: syncRecord,
      pull: pullRecords,
      remove: deleteRecord
    },
    auth: { requestCode: requestLoginCode, verify: verifyLogin },
    stories: fetchStories,
    ask: ask,
    corrections: { submit: submitCorrection, review: reviewCorrection },
    withdraw: withdrawStory,
    audit: pushAudit,
    consent: pushConsent
  };
})();
