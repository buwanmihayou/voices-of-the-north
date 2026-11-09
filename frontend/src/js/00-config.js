/* =============================================================================
 * 00-config — 全域設定、API 位址解析、共用小工具
 * -----------------------------------------------------------------------------
 * API_BASE 規則（修復「靜態 8421 開頁但 API 404」）：
 *   1. ?api=https://...             （最高優先，方便即場切換）
 *   2. window.VTN_API_BASE = '...'  （部署時可覆寫）
 *   3. localStorage['vtn.api-base'] （偵錯用）
 *   4. 靜態預覽埠（8421 / 5500 / 5173 / 3000 / 8080）→ http://127.0.0.1:8000
 *      其餘 http(s) 來源 → 同源（Render 由同一個 FastAPI 服務前端＋API）
 *   5. file:// → http://127.0.0.1:8000
 * 預設值寫入 README，唔會再指向不存在的相對路徑。
 * ========================================================================== */

(function () {
  'use strict';

  var VTN = window.VTN = window.VTN || {};

  var APP_VERSION = '2026.11.09';
  var DEFAULT_API_BASE = 'http://127.0.0.1:8000';
  var STATIC_PORTS = ['8421', '5500', '5173', '3000', '8080', '8081', '4173'];

  function trimSlash(value) {
    return String(value || '').replace(/\/+$/, '');
  }

  function queryParam(name) {
    try {
      return new URLSearchParams(window.location.search).get(name);
    } catch (e) {
      return null;
    }
  }

  function readLocal(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  function resolveApiBase() {
    var fromQuery = queryParam('api');
    if (fromQuery) return trimSlash(fromQuery);
    if (window.VTN_API_BASE) return trimSlash(window.VTN_API_BASE);
    var stored = readLocal('vtn.api-base');
    if (stored) return trimSlash(stored);

    var protocol = window.location.protocol;
    var host = window.location.hostname;
    var port = window.location.port;
    if (protocol === 'file:' || !host) return DEFAULT_API_BASE;
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host) && STATIC_PORTS.indexOf(port) !== -1) {
      return DEFAULT_API_BASE;
    }
    return trimSlash(window.location.origin);
  }

  var API_BASE = resolveApiBase();

  VTN.config = {
    version: APP_VERSION,
    apiBase: API_BASE,
    defaultApiBase: DEFAULT_API_BASE,
    staticPorts: STATIC_PORTS.slice(),
    /* 與 data/stories.json 的 consentPolicyVersion 保持一致；
       兩者不一致時 build_frontend.py 會以資料檔為準重新內嵌。 */
    consentPolicyVersion: 'CONSENT-2026-11-v2',
    consentPolicyDate: '2026-11-05',
    storageLimitChars: 3800000,
    maxAudioBytes: 10 * 1024 * 1024,
    maxRecordSeconds: 180
  };

  VTN.KEYS = {
    records: 'vtn.v2.records',
    prefs: 'vtn.v2.prefs',
    consent: 'vtn.v2.consent',
    audit: 'vtn.v2.audit',
    corrections: 'vtn.v2.corrections',
    withdrawn: 'vtn.v2.withdrawn',
    scopes: 'vtn.v2.scope-overrides',
    storyPatches: 'vtn.v2.story-versions',
    onboarded: 'vtn.v2.onboarded',
    session: 'vtn.v2.session',
    chat: 'vtn.v2.chat',
    migration: 'vtn.v2.migrated',
    hint: 'vtn.v2.assistant-hint',
    deleted: 'vtn.v2.deleted'
  };

  VTN.SCOPES = ['private', 'family', 'community', 'public'];

  VTN.SCOPE_META = {
    private: { icon: 'fa-lock', labelKey: 'scope.private', hintKey: 'scope.privateHint' },
    family: { icon: 'fa-house-user', labelKey: 'scope.family', hintKey: 'scope.familyHint' },
    community: { icon: 'fa-people-group', labelKey: 'scope.community', hintKey: 'scope.communityHint' },
    public: { icon: 'fa-globe', labelKey: 'scope.public', hintKey: 'scope.publicHint' }
  };

  VTN.ROLES = ['visitor', 'member', 'admin'];

  /* ---------------- 共用小工具 ---------------- */
  var util = {};

  util.byId = function (id) { return document.getElementById(id); };

  util.h = function (tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };

  util.node = function (tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'text') node.textContent = String(value);
        else if (key === 'html') node.innerHTML = value;
        else if (key === 'class') node.className = value;
        else if (key === 'dataset') {
          Object.keys(value).forEach(function (k) { node.dataset[k] = value[k]; });
        } else if (key.indexOf('on') === 0 && typeof value === 'function') {
          node.addEventListener(key.slice(2), value);
        } else if (key === 'style') {
          node.style.cssText = value;
        } else {
          node.setAttribute(key, value === true ? '' : value);
        }
      });
    }
    (children || []).forEach(function (child) {
      if (child === null || child === undefined) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  };

  util.pad2 = function (n) { return String(n).padStart(2, '0'); };

  util.fmtTime = function (sec) {
    var s = Math.max(0, Math.floor(Number(sec) || 0));
    return util.pad2(Math.floor(s / 60)) + ':' + util.pad2(s % 60);
  };

  util.fmtDate = function (ts) {
    var d = new Date(Number(ts) || Date.now());
    return d.getFullYear() + '-' + util.pad2(d.getMonth() + 1) + '-' + util.pad2(d.getDate()) +
      ' ' + util.pad2(d.getHours()) + ':' + util.pad2(d.getMinutes());
  };

  util.uid = function (prefix) {
    return (prefix || 'REC') + '-' + Date.now().toString(36).toUpperCase() +
      Math.random().toString(36).slice(2, 5).toUpperCase();
  };

  util.clamp = function (value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || 0));
  };

  util.debounce = function (fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  };

  util.escapeHtml = function (text) {
    return String(text === undefined || text === null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  util.parseJSON = function (raw, fallback) {
    try {
      var parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  };

  util.copyText = function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; })
        .catch(function () { return util.copyFallback(text); });
    }
    return Promise.resolve(util.copyFallback(text));
  };

  util.copyFallback = function (text) {
    try {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:absolute;left:-9999px;top:0';
      document.body.appendChild(area);
      area.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch (e) { return false; }
  };

  util.download = function (filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  };

  util.downloadDataUrl = function (filename, dataUrl) {
    var a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  util.dataUrlBytes = function (dataUrl) {
    if (!dataUrl || String(dataUrl).indexOf(';base64,') < 0) return 0;
    return Math.floor(String(dataUrl).length * 0.75);
  };

  util.emit = function (type, detail) {
    try {
      window.dispatchEvent(new CustomEvent(type, { detail: detail || null }));
    } catch (e) { /* 舊瀏覽器忽略 */ }
  };

  util.on = function (type, fn) { window.addEventListener(type, fn); };

  VTN.util = util;
})();
