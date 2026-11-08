/* =============================================================================
 * 10-store — 統一儲存層（頁面所有讀寫都經這裡）
 * -----------------------------------------------------------------------------
 * 為什麼要統一：
 *   1. 之後換成伺服器版時，只需換掉本層的 persistence，畫面不用改；
 *   2. 錄音狀態機（草稿／待轉寫／已完成）、配額淘汰、私隱範圍、同意與稽核
 *      全部在同一個地方落地，不會再有「這裡寫 localStorage、那裡寫另一個 key」。
 *
 * 配額策略（修復「儲存滿了丟掉新錄音」）：
 *   * 新寫入的錄音永遠受保護，不會被淘汰；
 *   * 先淘汰最舊錄音的「音訊本體」（保留逐字稿），仍不足才整筆移除最舊紀錄；
 *   * 每次淘汰都回報給呼叫方，由 UI 明確講「儲存空間不足，請先刪除舊錄音」。
 * ========================================================================== */

(function () {
  'use strict';

  var VTN = window.VTN;
  var U = VTN.util;
  var K = VTN.KEYS;

  var memory = {};
  var storageAvailable = true;

  function rawGet(key) {
    try {
      var value = window.localStorage.getItem(key);
      if (value !== null) return value;
      return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
    } catch (e) {
      storageAvailable = false;
      return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
    }
  }

  function rawSet(key, value) {
    memory[key] = value;
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      storageAvailable = false;
      return false;
    }
  }

  function rawRemove(key) {
    delete memory[key];
    try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  function readArray(key) {
    var parsed = U.parseJSON(rawGet(key), []);
    return Array.isArray(parsed) ? parsed : [];
  }

  function readObject(key, fallback) {
    var parsed = U.parseJSON(rawGet(key), fallback);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  }

  /* =========================================================================
   * 1. 偏好設定
   * ======================================================================= */
  var PREF_DEFAULTS = {
    fontSize: 'md',
    theme: 'system',
    contrast: false,
    reduceMotion: false,
    volume: 100,
    speed: 1,
    lang: 'zh-HK'
  };

  var prefs = Object.assign({}, PREF_DEFAULTS, readObject(K.prefs, {}));
  if (VTN.SCOPES.indexOf(prefs.scope) === -1) prefs.scope = 'private';
  if (['md', 'lg', 'xl'].indexOf(prefs.fontSize) === -1) prefs.fontSize = 'md';
  if (['light', 'dark', 'system'].indexOf(prefs.theme) === -1) prefs.theme = 'system';

  function getPrefs() { return Object.assign({}, prefs); }

  function setPref(key, value) {
    prefs[key] = value;
    rawSet(K.prefs, JSON.stringify(prefs));
    U.emit('vtn:prefs-changed', { key: key, value: value });
    return prefs[key];
  }

  function resetPrefs() {
    prefs = Object.assign({}, PREF_DEFAULTS);
    rawSet(K.prefs, JSON.stringify(prefs));
    U.emit('vtn:prefs-changed', { key: '*', value: null });
    return getPrefs();
  }

  /* =========================================================================
   * 2. 工作階段（訪客 / 成員 / 管理員）
   * ======================================================================= */
  function getSession() {
    var s = readObject(K.session, null);
    if (!s || typeof s !== 'object') return null;
    if (!s.email || VTN.ROLES.indexOf(s.role) === -1) return null;
    return s;
  }

  function setSession(session) {
    if (!session) { rawRemove(K.session); U.emit('vtn:session-changed', null); return null; }
    rawSet(K.session, JSON.stringify(session));
    U.emit('vtn:session-changed', session);
    return session;
  }

  function clearSession() {
    rawRemove(K.session);
    U.emit('vtn:session-changed', null);
  }

  function ownerId() {
    var session = getSession();
    return session ? String(session.email).toLowerCase() : 'local';
  }

  function role() {
    var session = getSession();
    return session ? session.role : 'visitor';
  }

  /* =========================================================================
   * 3. 錄音紀錄（狀態機：draft → pending → done）
   * ======================================================================= */
  var records = readArray(K.records);
  var lastQuotaReport = null;

  function serialize(list) { return JSON.stringify(list); }

  function totalAudioBytes(list) {
    return list.reduce(function (sum, r) { return sum + U.dataUrlBytes(r.audioDataURL); }, 0);
  }

  /**
   * 寫入並在必要時淘汰最舊資料。
   * @param {Array} list 完整紀錄
   * @param {string} protectId 今次寫入的紀錄，永不淘汰
   */
  function persistRecords(list, protectId) {
    var json = serialize(list);
    var evicted = [];

    if (json.length <= VTN.config.storageLimitChars) {
      var okFast = rawSet(K.records, json);
      lastQuotaReport = { evicted: evicted, persisted: okFast, chars: json.length };
      return lastQuotaReport;
    }

    /* 第一階段：由最舊開始丟棄音訊本體，保留逐字稿 */
    var byAge = list.slice().sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    for (var i = 0; i < byAge.length && json.length > VTN.config.storageLimitChars; i++) {
      var rec = byAge[i];
      if (!rec.audioDataURL || rec.id === protectId) continue;
      rec.audioDataURL = null;
      rec.audioDropped = true;
      rec.audioDroppedAt = Date.now();
      evicted.push({ id: rec.id, title: rec.title || '', kind: 'audio' });
      json = serialize(list);
    }

    /* 第二階段：仍不足，整筆移除最舊紀錄（受保護者除外） */
    var removable = byAge.filter(function (r) { return r.id !== protectId; });
    for (var j = 0; j < removable.length && json.length > VTN.config.storageLimitChars; j++) {
      var target = removable[j];
      var index = list.findIndex(function (r) { return r.id === target.id; });
      if (index === -1) continue;
      evicted.push({ id: target.id, title: target.title || '', kind: 'record' });
      list.splice(index, 1);
      json = serialize(list);
    }

    var ok = rawSet(K.records, json);
    if (!ok) {
      /* 最後手段：把音訊全部移出持久層，避免整批寫入失敗 */
      list.forEach(function (r) {
        if (r.id !== protectId && r.audioDataURL) {
          r.audioDataURL = null;
          r.audioDropped = true;
          evicted.push({ id: r.id, title: r.title || '', kind: 'audio' });
        }
      });
      ok = rawSet(K.records, serialize(list));
    }

    lastQuotaReport = {
      evicted: evicted,
      persisted: ok,
      chars: serialize(list).length,
      storageAvailable: storageAvailable
    };
    return lastQuotaReport;
  }

  function normalizeRecord(rec) {
    var now = Date.now();
    var out = Object.assign({}, rec);
    out.id = out.id || U.uid('REC');
    out.createdAt = Number(out.createdAt) || now;
    out.updatedAt = Number(out.updatedAt) || now;
    out.owner = out.owner || ownerId();
    out.status = ['draft', 'pending', 'done'].indexOf(out.status) === -1 ? 'pending' : out.status;
    out.sync = ['local', 'synced', 'failed', 'syncing'].indexOf(out.sync) === -1 ? 'local' : out.sync;
    out.scope = VTN.SCOPES.indexOf(out.scope) === -1 ? (prefs.scope || 'private') : out.scope;
    out.words = Array.isArray(out.words) ? out.words : [];
    out.qaList = Array.isArray(out.qaList) ? out.qaList : [];
    out.versions = Array.isArray(out.versions) ? out.versions : [];
    out.durationSec = Number(out.durationSec) || 0;
    out.durationSource = out.durationSource || (out.audioDataURL || out.audioUrl ? 'measured' : 'transcript');
    out.title = out.title || deriveTitle(out);
    if (out.sync === 'synced' && out.syncAt) out.syncAt = Number(out.syncAt);
    return out;
  }

  function deriveTitle(rec) {
    var text = String(rec.formalText || rec.rawText || '').trim();
    if (text) return text.length > 26 ? text.slice(0, 26) + '…' : text;
    if (rec.source === 'demo') return VTN.i18n ? VTN.i18n.t('rec.demoTitle') : '示範故事';
    if (rec.status === 'draft') return VTN.i18n ? VTN.i18n.t('rec.untitledDraft') : '未命名草稿';
    return VTN.i18n ? VTN.i18n.t('rec.untitled') : '未命名錄音';
  }

  function isMine(rec) {
    return rec.owner === ownerId() || (ownerId() === 'local' && (!rec.owner || rec.owner === 'local'));
  }

  function listRecords() {
    return records.filter(isMine).slice().sort(function (a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function allRecordsRaw() { return records.slice(); }

  function getRecord(id) {
    return records.filter(function (r) { return r.id === id; })[0] || null;
  }

  function saveRecord(rec) {
    var normalized = normalizeRecord(rec);
    var index = -1;
    for (var i = 0; i < records.length; i++) {
      if (records[i].id === normalized.id) { index = i; break; }
    }
    if (index >= 0) {
      var previous = records[index];
      normalized.createdAt = previous.createdAt;
      normalized.sync = normalized.sync === 'local' && previous.sync === 'synced' ? 'synced' : normalized.sync;
      records[index] = normalized;
    } else {
      records.unshift(normalized);
    }

    var report = persistRecords(records, normalized.id);
    U.emit('vtn:store-changed', { type: 'records', id: normalized.id, quota: report });
    return { record: normalized, quota: report };
  }

  /**
   * 局部更新（狀態機轉換用），回傳更新後紀錄。
   */
  function patchRecord(id, patch) {
    var rec = getRecord(id);
    if (!rec) return null;
    var merged = Object.assign({}, rec, patch, { updatedAt: Date.now() });
    return saveRecord(merged).record;
  }

  function removeRecord(id) {
    var before = records.length;
    records = records.filter(function (r) { return r.id !== id; });
    if (records.length === before) return false;
    rememberDeleted(id);
    persistRecords(records, null);
    U.emit('vtn:store-changed', { type: 'records', id: id, removed: true });
    return true;
  }

  function rememberDeleted(id) {
    var tombs = readArray(K.deleted);
    if (tombs.indexOf(id) === -1) {
      tombs.push(id);
      if (tombs.length > 200) tombs = tombs.slice(-200);
      rawSet(K.deleted, JSON.stringify(tombs));
    }
  }

  function deletedIds() { return readArray(K.deleted); }

  /**
   * 登入後遷移：只把「未登入的本機紀錄」歸入帳戶；以 id 去重，不重複、不消失。
   * 其他帳戶的紀錄（例如家人共用裝置）不會被搶走。
   */
  function migrateToAccount(email) {
    var target = String(email || '').toLowerCase();
    if (!target) return { migrated: 0, total: records.length };

    var migrated = 0;
    records.forEach(function (rec) {
      if (rec.owner === 'local' || !rec.owner) {
        rec.owner = target;
        migrated++;
      }
    });

    var index = {};
    var deduped = [];
    records.forEach(function (rec) {
      if (index[rec.id] === undefined) {
        index[rec.id] = deduped.length;
        deduped.push(rec);
      } else if ((rec.updatedAt || 0) > (deduped[index[rec.id]].updatedAt || 0)) {
        deduped[index[rec.id]] = rec;
      }
    });
    records = deduped;

    persistRecords(records, null);
    rawSet(K.migration, JSON.stringify({ email: target, at: Date.now(), migrated: migrated }));
    U.emit('vtn:store-changed', { type: 'records', migrated: migrated });
    return { migrated: migrated, total: records.length };
  }

  /**
   * 合併伺服器回來的紀錄：以 updatedAt 較新者為準，本機音訊作離線快取保留。
   */
  function mergeRemote(remoteList) {
    if (!Array.isArray(remoteList)) return 0;
    var map = {};
    records.forEach(function (r) { map[r.id] = r; });
    var changed = 0;
    remoteList.forEach(function (remote) {
      if (!remote || !remote.id) return;
      if (deletedIds().indexOf(remote.id) !== -1) return;
      var local = map[remote.id];
      if (!local) {
        map[remote.id] = normalizeRecord(remote);
        changed++;
        return;
      }
      if ((remote.updatedAt || 0) >= (local.updatedAt || 0)) {
        var merged = Object.assign({}, local, remote, { sync: 'synced' });
        if (local.audioDataURL) merged.audioDataURL = local.audioDataURL;
        if (!merged.audioUrl && local.audioUrl) merged.audioUrl = local.audioUrl;
        map[remote.id] = normalizeRecord(merged);
        changed++;
      }
    });
    records = Object.keys(map).map(function (k) { return map[k]; });
    persistRecords(records, null);
    if (changed) U.emit('vtn:store-changed', { type: 'records', merged: changed });
    return changed;
  }

  function counts() {
    var mine = listRecords();
    return {
      total: mine.length,
      draft: mine.filter(function (r) { return r.status === 'draft'; }).length,
      pending: mine.filter(function (r) { return r.status === 'pending'; }).length,
      done: mine.filter(function (r) { return r.status === 'done'; }).length,
      shared: mine.filter(function (r) { return r.status === 'done' && r.scope !== 'private'; }).length,
      audioBytes: totalAudioBytes(mine)
    };
  }

  function lastQuota() { return lastQuotaReport; }

  /* =========================================================================
   * 4. 分享範圍（每則故事可獨立設定，改動留同意記錄＋稽核）
   * ======================================================================= */
  var scopeOverrides = readObject(K.scopes, {});

  function scopeOf(item) {
    if (!item) return prefs.scope || 'private';
    if (scopeOverrides[item.id]) return scopeOverrides[item.id];
    if (VTN.SCOPES.indexOf(item.scope) !== -1) return item.scope;
    return prefs.scope || 'private';
  }

  function setScope(item, scope, options) {
    if (VTN.SCOPES.indexOf(scope) === -1) return null;
    var previous = scopeOf(item);
    scopeOverrides[item.id] = scope;
    rawSet(K.scopes, JSON.stringify(scopeOverrides));

    if (item && !item.owner) {
      /* 示範故事：本機覆寫（伺服器以自己的授權資料為準） */
    } else if (item && item.id) {
      var rec = getRecord(item.id);
      if (rec) patchRecord(rec.id, { scope: scope });
    }

    var actor = ownerId();
    addConsent({
      action: 'scope-change',
      targetId: item.id,
      targetTitle: item.title || '',
      from: previous,
      to: scope,
      policyVersion: VTN.config.consentPolicyVersion,
      actor: actor
    });
    addAudit('scope.change', {
      targetId: item.id,
      from: previous,
      to: scope,
      note: options && options.note ? options.note : ''
    });
    U.emit('vtn:scope-changed', { id: item.id, scope: scope, from: previous });
    return scope;
  }

  /* =========================================================================
   * 4a. 「一個預設 + 例外清單」所需的四個函式（11.08）
   * 只讀寫既有的 prefs.scope 與 K.scopes，不更動上面任何儲存邏輯。
   * ======================================================================= */
  function scopePreset() {
    return VTN.SCOPES.indexOf(prefs.scope) === -1 ? 'private' : prefs.scope;
  }

  function setScopePreset(scope) {
    if (VTN.SCOPES.indexOf(scope) === -1) return null;
    var previous = scopePreset();
    setPref('scope', scope);
    U.emit('vtn:scope-changed', { id: '*', scope: scope, from: previous });
    return scope;
  }

  function scopeExceptions(items) {
    var preset = scopePreset();
    return (items || []).filter(function (item) {
      return item && scopeOverrides[item.id] && scopeOverrides[item.id] !== preset;
    }).map(function (item) {
      return { item: item, scope: scopeOverrides[item.id] };
    });
  }

  function clearScopeExceptions() {
    var count = Object.keys(scopeOverrides).length;
    scopeOverrides = {};
    rawSet(K.scopes, JSON.stringify(scopeOverrides));
    addAudit('scope.reset', { cleared: count, to: scopePreset() });
    U.emit('vtn:scope-changed', { id: '*', scope: scopePreset(), reset: true });
    return count;
  }

  /* =========================================================================
   * 4b. 示範故事的更正版本（原文不動，只新增版本；存本機）
   * ======================================================================= */
  var storyPatches = readObject(K.storyPatches, {});

  function storyPatch(id) { return storyPatches[id] || null; }

  function addStoryVersion(id, version) {
    var patch = storyPatches[id] || { versions: [] };
    patch.versions = patch.versions || [];
    patch.versions.push(version);
    patch.updatedAt = Date.now();
    storyPatches[id] = patch;
    rawSet(K.storyPatches, JSON.stringify(storyPatches));
    U.emit('vtn:story-version', { id: id, version: version });
    return patch;
  }

  /* =========================================================================
   * 5. 同意記錄與稽核日誌
   * ======================================================================= */
  function addConsent(entry) {
    var list = readArray(K.consent);
    list.push(Object.assign({
      id: U.uid('CONSENT'),
      at: new Date().toISOString(),
      policyVersion: VTN.config.consentPolicyVersion,
      actor: ownerId()
    }, entry));
    if (list.length > 400) list = list.slice(-400);
    rawSet(K.consent, JSON.stringify(list));
    U.emit('vtn:consent-added', list[list.length - 1]);
    return list[list.length - 1];
  }

  function listConsent() { return readArray(K.consent); }

  function addAudit(action, meta) {
    var list = readArray(K.audit);
    var entry = {
      id: U.uid('AUDIT'),
      at: new Date().toISOString(),
      action: action,
      actor: ownerId(),
      role: role(),
      meta: meta || {}
    };
    list.push(entry);
    if (list.length > 400) list = list.slice(-400);
    rawSet(K.audit, JSON.stringify(list));
    U.emit('vtn:audit-added', entry);
    return entry;
  }

  function listAudit() { return readArray(K.audit); }

  /* =========================================================================
   * 6. 更正申請（申請 → 審核 → 新版本，原文保留）
   * ======================================================================= */
  function listCorrections() { return readArray(K.corrections); }

  function addCorrection(payload) {
    var list = listCorrections();
    var entry = Object.assign({
      id: U.uid('CORR'),
      status: 'submitted',
      submittedAt: new Date().toISOString(),
      submittedBy: ownerId()
    }, payload);
    list.unshift(entry);
    rawSet(K.corrections, JSON.stringify(list));
    addAudit('correction.submit', { id: entry.id, targetId: entry.targetId, field: entry.field });
    U.emit('vtn:corrections-changed', entry);
    return entry;
  }

  function updateCorrection(id, patch) {
    var list = listCorrections();
    var found = null;
    list = list.map(function (item) {
      if (item.id !== id) return item;
      found = Object.assign({}, item, patch);
      return found;
    });
    rawSet(K.corrections, JSON.stringify(list));
    U.emit('vtn:corrections-changed', found);
    return found;
  }

  /**
   * 審核通過：建立新版本，舊版原文永不覆寫。
   * 對「本機錄音」直接加 version；對「示範故事」只記錄在更正清單與版本表。
   */
  function approveCorrection(id, reviewer) {
    var list = listCorrections();
    var entry = list.filter(function (c) { return c.id === id; })[0];
    if (!entry) return null;

    var rec = getRecord(entry.targetId);
    var version = {
      version: 1,
      at: new Date().toISOString(),
      formalText: entry.proposedText,
      reason: entry.reason,
      approvedBy: reviewer || ownerId(),
      previousText: entry.currentText
    };

    if (rec) {
      version.version = (rec.versions.length || 0) + 2;
      var versions = rec.versions.concat([{
        version: version.version,
        at: version.at,
        formalText: entry.proposedText,
        previousText: entry.currentText,
        reason: entry.reason,
        approvedBy: version.approvedBy
      }]);
      patchRecord(rec.id, { formalText: entry.proposedText, versions: versions });
    } else {
      var patch = storyPatch(entry.targetId);
      version.version = ((patch && patch.versions.length) || 0) + 2;
      addStoryVersion(entry.targetId, version);
    }

    var updated = updateCorrection(id, {
      status: 'approved',
      reviewedAt: new Date().toISOString(),
      reviewedBy: reviewer || ownerId(),
      newVersion: version.version
    });
    addConsent({
      action: 'correction-approved',
      targetId: entry.targetId,
      targetTitle: entry.targetTitle || '',
      policyVersion: VTN.config.consentPolicyVersion,
      actor: reviewer || ownerId()
    });
    addAudit('correction.approve', { id: id, targetId: entry.targetId, version: version.version });
    return updated;
  }

  function rejectCorrection(id, reviewer, reason) {
    var updated = updateCorrection(id, {
      status: 'rejected',
      reviewedAt: new Date().toISOString(),
      reviewedBy: reviewer || ownerId(),
      reviewNote: reason || ''
    });
    addAudit('correction.reject', { id: id, reason: reason || '' });
    return updated;
  }

  /* =========================================================================
   * 7. 撤回（列表／地圖／篩選／建議問題／助手快取／搜尋／分享連結一併清除）
   * ======================================================================= */
  function listWithdrawn() { return readArray(K.withdrawn); }

  function isWithdrawn(id) {
    return listWithdrawn().some(function (w) { return w.id === id; });
  }

  function withdraw(item, reason) {
    var list = listWithdrawn();
    if (!isWithdrawn(item.id)) {
      list.push({
        id: item.id,
        title: item.title || '',
        at: new Date().toISOString(),
        by: ownerId(),
        reason: reason || ''
      });
      rawSet(K.withdrawn, JSON.stringify(list));
    }
    addConsent({
      action: 'withdraw',
      targetId: item.id,
      targetTitle: item.title || '',
      policyVersion: VTN.config.consentPolicyVersion,
      actor: ownerId(),
      reason: reason || ''
    });
    addAudit('story.withdraw', { id: item.id, reason: reason || '' });
    pruneChatForWithdrawn();
    U.emit('vtn:withdrawn', { id: item.id });
    return true;
  }

  function isAuthorizedForViewer(item, viewerRole, viewerId) {
    if (!item) return false;
    if (item.authorized === false) return false;
    var scope = scopeOf(item);
    if (viewerRole === 'admin') return true;
    if (item.owner && viewerId && String(item.owner).toLowerCase() === String(viewerId).toLowerCase()) return true;
    if (scope === 'public' || scope === 'community') return true;
    if (scope === 'family' && item.familyId && item.familyId === viewerId) return true;
    return false;
  }

  /* =========================================================================
   * 8. 助手對話快取
   * ======================================================================= */
  function loadChat() {
    var data = readObject(K.chat, { messages: [] });
    return data && Array.isArray(data.messages) ? data : { messages: [] };
  }

  function saveChat(data) {
    rawSet(K.chat, JSON.stringify(data && data.messages ? data : { messages: [] }));
  }

  function pruneChatForWithdrawn() {
    var data = loadChat();
    var removed = 0;
    var kept = data.messages.filter(function (msg) {
      if (!msg || !Array.isArray(msg.sources)) return true;
      var alive = msg.sources.filter(function (src) {
        if (!src || !src.storyId) return true;
        return !isWithdrawn(src.storyId);
      });
      if (alive.length !== msg.sources.length) removed++;
      msg.sources = alive;
      return true;
    });
    if (removed) saveChat({ messages: kept });
    return removed;
  }

  /* =========================================================================
   * 9. 對外 API
   * ======================================================================= */
  VTN.store = {
    /* 偏好 */
    prefs: getPrefs,
    getPref: function (key) { return prefs[key]; },
    setPref: setPref,
    resetPrefs: resetPrefs,
    /* 工作階段 */
    session: getSession,
    setSession: setSession,
    clearSession: clearSession,
    ownerId: ownerId,
    role: role,
    /* 錄音 */
    records: {
      list: listRecords,
      all: allRecordsRaw,
      get: getRecord,
      save: saveRecord,
      patch: patchRecord,
      remove: removeRecord,
      counts: counts,
      merge: mergeRemote,
      migrate: migrateToAccount,
      quota: lastQuota,
      deletedIds: deletedIds
    },
    /* 私隱 */
    scopeOf: scopeOf,
    setScope: setScope,
    scopePreset: scopePreset,
    setScopePreset: setScopePreset,
    scopeExceptions: scopeExceptions,
    clearScopeExceptions: clearScopeExceptions,
    authorizedFor: isAuthorizedForViewer,
    storyPatch: storyPatch,
    addStoryVersion: addStoryVersion,
    /* 同意 / 稽核 */
    consent: { add: addConsent, list: listConsent },
    audit: { log: addAudit, list: listAudit },
    corrections: {
      list: listCorrections,
      add: addCorrection,
      update: updateCorrection,
      approve: approveCorrection,
      reject: rejectCorrection
    },
    withdrawn: { list: listWithdrawn, is: isWithdrawn, add: withdraw },
    chat: { load: loadChat, save: saveChat, prune: pruneChatForWithdrawn },
    storageAvailable: function () { return storageAvailable; }
  };
})();
