/* =============================================================================
 * 50-assistant — Ask the Village 村落問答助手
 * -----------------------------------------------------------------------------
 * 誠實性（第 9、10、11 項）：
 *   1. 只檢索「已授權」的逐字稿（示範故事 + 自己已完成的錄音）；
 *   2. 每條在範圍答案必附時間戳來源；來源可站內跳轉並由指定秒數播放；
 *   3. 範圍外一律用標準拒答句（跟隨介面語言）；
 *   4. 伺服器不可用時只用本機語料，並在面板明確標示「離線／降級」，
 *      不再靜默降級冒充線上模型；
 *   5. 故事撤回後，相關來源膠囊變灰不可點，並清除對話快取中的引用。
 * ========================================================================== */

(function () {
  'use strict';

  var VTN = window.VTN;
  var U = VTN.util;

  var OUT_OF_SCOPE = {};
  (function initMessages() {
    var meta = (window.VTN_STORY_DATA && window.VTN_STORY_DATA.outOfScopeMessage) || {};
    OUT_OF_SCOPE = meta;
  })();

  function t(key, vars) { return VTN.i18n.t(key, vars); }
  function outOfScope() {
    var lang = VTN.i18n.lang();
    return OUT_OF_SCOPE[lang] || OUT_OF_SCOPE['zh-HK'] || t('assistant.outOfScope');
  }

  var store = { messages: [] };
  var busy = false;
  var typingRow = null;
  var lastQuestion = '';

  /* ---------------- 檢索 ---------------- */
  function normalize(text) {
    return String(text || '').toLowerCase()
      .replace(/[？?！!。，,、：:；;（）()「」『』・·\s"']/g, '');
  }

  /* 通用詞單獨命中不足以證明相關（否則「細個」會命中全部故事） */
  var GENERIC = {
    '細個': 1, '童年': 1, '以前': 1, '而家': 1, '近排': 1, '近年': 1, '後來': 1,
    '變化': 1, '轉變': 1, '生活': 1, '朋友': 1, '記憶': 1, '特別': 1, '環境': 1,
    '鄉村': 1, '鄉郊': 1, '地方': 1, '時間': 1, '香港': 1, '村民': 1, '街坊': 1,
    '傳統': 1, '節慶': 1, '故事': 1, '聲音': 1
  };

  function scoreSegment(questionNorm, keywords) {
    var matched = [];
    var score = 0;
    (keywords || []).forEach(function (keyword) {
      var key = normalize(keyword);
      if (key.length < 2 || questionNorm.indexOf(key) === -1) return;
      matched.push(key);
      score += GENERIC[key] ? 0.5 : 2;
    });
    if (!matched.length) return 0;
    var allGeneric = matched.every(function (key) { return !!GENERIC[key]; });
    if (allGeneric && matched.length < 2) return 0;
    return score;
  }

  function bigrams(text) {
    var s = normalize(text);
    var out = [];
    for (var i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
    return out;
  }

  function scopedStories(context) {
    var scope = context || VTN.stories.queryContext();
    return VTN.stories.visible().filter(function (story) {
      return scope.storyIds.indexOf(story.id) !== -1;
    });
  }

  function searchStories(question, context) {
    var q = normalize(question);
    if (!q) return [];
    var hits = [];
    scopedStories(context).forEach(function (story) {
      if (!story.authorized) return;
      (story.segments || []).forEach(function (segment) {
        var score = scoreSegment(q, segment.keywords);
        if (score <= 0) return;
        if (segment.end > story.durationSec + 0.001) return; /* 防禦：時間戳不可超出時長 */
        hits.push({
          story: story,
          segment: segment,
          score: score,
          label: 'Source: [' + story.id + '] at ' + U.fmtTime(segment.start),
          source: {
            storyId: story.id,
            title: story.title,
            teller: story.teller,
            start: segment.start,
            end: segment.end,
            label: 'Source: [' + story.id + '] at ' + U.fmtTime(segment.start)
          }
        });
      });
    });
    if (!hits.length) return [];

    var best = hits.reduce(function (max, hit) { return Math.max(max, hit.score); }, 0);
    hits = hits.filter(function (hit) { return hit.score >= Math.max(1, best * 0.45); });

    /* 單一主題問題：只保留最相關故事的段落，避免拼接無關內容 */
    var scores = {};
    hits.forEach(function (hit) { scores[hit.story.id] = (scores[hit.story.id] || 0) + hit.score; });
    var ranked = Object.keys(scores).sort(function (a, b) { return scores[b] - scores[a]; });
    if (ranked.length > 1 && scores[ranked[0]] > scores[ranked[1]] * 1.6) {
      hits = hits.filter(function (hit) { return hit.story.id === ranked[0]; });
    }

    /* 同一故事內只保留最相關的段落 */
    var grouped = {};
    hits.forEach(function (hit) {
      (grouped[hit.story.id] = grouped[hit.story.id] || []).push(hit);
    });
    var refined = [];
    Object.keys(grouped).forEach(function (id) {
      var group = grouped[id];
      var top = group.reduce(function (max, hit) { return Math.max(max, hit.score); }, 0);
      refined = refined.concat(group.filter(function (hit) { return hit.score >= top * 0.75; }));
    });

    refined.sort(function (a, b) {
      if (a.story.id !== b.story.id) return a.story.id < b.story.id ? -1 : 1;
      return a.segment.start - b.segment.start;
    });
    return refined;
  }

  function ownRecords() {
    return VTN.store.records.list().filter(function (rec) {
      return rec.status === 'done' && rec.qaList && rec.qaList.length &&
        !VTN.store.withdrawn.is(rec.id);
    });
  }

  /** 掃描全部故事（含已撤回），只供建議問題過濾用。 */
  function allStoryHits(question) {
    var q = normalize(question);
    var hits = [];
    if (!q) return hits;
    (VTN.stories.all() || []).forEach(function (story) {
      (story.segments || []).forEach(function (segment) {
        if (scoreSegment(q, segment.keywords) > 0) hits.push({ story: story, segment: segment });
      });
    });
    return hits;
  }

  /**
   * 伺服器回來的答案一律再驗一次：來源必須仍然存在、仍然授權、未被撤回；
   * 否則視為不可信，改用本機語料或如實拒答。
   */
  function normalizeServerResult(result, context) {
    if (!result) return null;
    var inScope = result.inScope !== undefined ? result.inScope : result.in_scope;
    // 服務端已按授權／撤回／視口拒答時，不能再用本機全庫覆蓋。
    if (inScope === false) {
      return { inScope: false, answer: outOfScope(), sources: [], mode: 'server' };
    }
    if (inScope !== true || !Array.isArray(result.sources)) return null;
    var allowed = scopedStories(context).map(function (story) { return story.id; });
    if (Array.isArray(result.visibleIds)) {
      allowed = allowed.filter(function (id) { return result.visibleIds.indexOf(id) !== -1; });
    }
    var sources = (result.sources || []).map(function (source) {
      if (!source) return null;
      var sid = source.storyId || source.story_id;
      if (sid) {
        var story = VTN.stories.get(sid);
        if (!story || allowed.indexOf(sid) === -1) return null;
        var start = Number(source.start) || 0;
        return {
          storyId: sid,
          title: story.title,
          teller: story.teller,
          start: start,
          end: Number(source.end) || 0,
          label: source.label || ('Source: [' + sid + '] at ' + U.fmtTime(start))
        };
      }
      var rid = source.recordId || source.record_id;
      if (rid) {
        if (!context.includeRecords) return null;
        var rec = VTN.store.records.get(rid);
        if (!rec || VTN.store.withdrawn.is(rid)) return null;
        var seconds = Number(source.start) || 0;
        return {
          kind: 'record',
          recordId: rid,
          recordTitle: rec.title,
          start: seconds,
          label: source.label || ('Source: [' + rid + '] at ' + U.fmtTime(seconds))
        };
      }
      return null;
    }).filter(Boolean);

    // 不能只刪壞引用而保留可能含該故事文字的整段答案。
    if (!sources.length || sources.length !== result.sources.length) return null;

    return {
      inScope: !!inScope && sources.length > 0,
      answer: result.answer || '',
      sources: sources,
      demo: !!result.demo,
      mode: 'server'
    };
  }

  function searchRecords(question) {
    var q = normalize(question);
    if (q.length < 2) return null;
    var grams = bigrams(q);
    var best = null;
    ownRecords().forEach(function (rec) {
      rec.qaList.forEach(function (qa) {
        var hay = normalize((qa.question || '') + ' ' + (qa.answer || ''));
        var hit = 0;
        grams.forEach(function (gram) { if (hay.indexOf(gram) !== -1) hit++; });
        if (hit >= 2 && (!best || hit > best.hit)) {
          best = {
            hit: hit,
            rec: rec,
            qa: qa
          };
        }
      });
    });
    if (!best) return null;
    var timestamp = Number(best.qa.timestamp) || 0;
    return {
      inScope: true,
      answer: best.qa.answer || best.qa.question,
      sources: [{
        kind: 'record',
        recordId: best.rec.id,
        recordTitle: best.rec.title,
        start: timestamp,
        label: 'Source: [' + best.rec.id + '] at ' + U.fmtTime(timestamp)
      }],
      demo: best.rec.source === 'demo',
      mode: 'local'
    };
  }

  function localAnswer(question, context) {
    var scope = context || VTN.stories.queryContext();
    var hits = searchStories(question, scope);
    if (hits.length) {
      return {
        inScope: true,
        answer: hits.map(function (hit) { return hit.segment.text; }).join(' '),
        sources: hits.map(function (hit) { return hit.source; }),
        demo: hits.some(function (hit) { return hit.story.rolePlayed; }),
        mode: 'local',
        storyId: hits[0].story.id
      };
    }
    var recordResult = scope.includeRecords ? searchRecords(question) : null;
    if (recordResult) return recordResult;
    return { inScope: false, answer: outOfScope(), sources: [], mode: 'local' };
  }

  /* ---------------- DOM ---------------- */
  var root, mask, launcher, hint, fab, panel, log, form, input, send, btnClose, statusChip;

  function build() {
    if (root) return;

    root = U.node('div', { class: 'vtn-ai-root', 'data-vtn-ai': 'mounted' });
    mask = U.node('div', { class: 'vtn-ai-mask', 'aria-hidden': 'true' });

    launcher = U.node('div', { class: 'vtn-ai-launcher' });
    hint = U.node('div', { class: 'vtn-ai-hint' });
    hint.innerHTML = U.escapeHtml(t('assistant.hint')) + '<small>' + U.escapeHtml(t('assistant.hintSub')) + '</small>';
    var hintClose = U.node('button', { class: 'vtn-ai-hint-close', type: 'button', text: '×', 'aria-label': t('common.close') });
    hint.appendChild(hintClose);

    fab = U.node('button', { class: 'vtn-ai-fab', type: 'button', 'aria-label': t('assistant.fabAria'), 'aria-expanded': 'false' });
    var fabImg = U.node('img', { src: 'assets/mascot.png', alt: '' });
    fabImg.setAttribute('aria-hidden', 'true');
    fab.appendChild(fabImg);

    launcher.appendChild(hint);
    launcher.appendChild(fab);

    panel = U.node('section', {
      class: 'vtn-ai-panel',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': t('assistant.title'),
      'aria-hidden': 'true'
    });

    var head = U.node('header', { class: 'vtn-ai-head' });
    var headImg = U.node('img', { src: 'assets/mascot.png', alt: '' });
    headImg.setAttribute('aria-hidden', 'true');
    var titles = U.node('div', { class: 'vtn-ai-head-titles' });
    titles.appendChild(U.node('p', { class: 'vtn-ai-head-title', text: t('assistant.title') }));
    titles.appendChild(U.node('p', { class: 'vtn-ai-head-sub', text: t('assistant.sub') }));
    statusChip = U.node('span', { class: 'vtn-ai-status' });
    titles.appendChild(statusChip);
    btnClose = U.node('button', { class: 'vtn-ai-head-btn', type: 'button', 'aria-label': t('assistant.close') });
    btnClose.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    head.appendChild(headImg);
    head.appendChild(titles);
    head.appendChild(btnClose);

    log = U.node('div', { class: 'vtn-ai-log', role: 'log', 'aria-live': 'polite', tabindex: '0', 'aria-label': t('assistant.logAria') });

    var pledge = U.node('div', { class: 'vtn-ai-pledge' });
    pledge.innerHTML = '<i class="fa-solid fa-shield-halved" aria-hidden="true"></i><span>' +
      U.escapeHtml(t('assistant.pledge')) + '</span>';

    form = U.node('form', { class: 'vtn-ai-form' });
    input = U.node('input', { class: 'vtn-ai-input', type: 'text', maxlength: '500', autocomplete: 'off', 'aria-label': t('assistant.inputAria') });
    input.placeholder = t('assistant.placeholder');
    send = U.node('button', { class: 'vtn-ai-send', type: 'submit', 'aria-label': t('assistant.send') });
    send.innerHTML = '<i class="fa-solid fa-paper-plane" aria-hidden="true"></i>';
    form.appendChild(input);
    form.appendChild(send);

    panel.appendChild(head);
    panel.appendChild(log);
    panel.appendChild(pledge);
    panel.appendChild(form);

    root.appendChild(mask);
    root.appendChild(launcher);
    root.appendChild(panel);

    var shell = document.getElementById('appShell') || document.body;
    shell.appendChild(root);

    hint.hidden = hintDismissed();

    fab.addEventListener('click', function () { open(true); });
    btnClose.addEventListener('click', function () { close(); });
    mask.addEventListener('click', function () { close(); });
    hintClose.addEventListener('click', function (event) {
      event.stopPropagation();
      hint.hidden = true;
      try { window.localStorage.setItem(VTN.KEYS.hint, '1'); } catch (e) { /* ignore */ }
    });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      ask(input.value);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && root.classList.contains('is-open')) close();
    });

    syncNavHeight();
    window.addEventListener('resize', syncNavHeight);
    window.addEventListener('load', syncNavHeight);
    U.on('vtn:health', renderStatusChip);
    U.on('vtn:lang-changed', refresh);
    U.on('vtn:withdrawn', function () {
      VTN.store.chat.prune();
      if (root.classList.contains('is-open')) renderHistory();
    });
    renderStatusChip();
  }

  function hintDismissed() {
    try { return window.localStorage.getItem(VTN.KEYS.hint) === '1'; } catch (e) { return false; }
  }

  function syncNavHeight() {
    var shell = document.getElementById('appShell');
    var nav = shell && shell.querySelector('.bottom-nav');
    if (!shell || !nav) return;
    var height = nav.getBoundingClientRect().height;
    if (height > 0) shell.style.setProperty('--vtn-nav-h', height + 'px');
  }

  /* ---------------- 狀態 ---------------- */
  function renderStatusChip() {
    if (!statusChip) return;
    var status = VTN.api.aiState();
    statusChip.className = 'vtn-ai-status vtn-ai-status--' + status.state;
    statusChip.textContent = status.state === 'online' ? t('status.onlineShort') :
      status.state === 'degraded' ? t('status.degradedShort') : t('status.offlineShort');
    statusChip.title = t('status.reason.' + (status.reason || 'unchecked'));
  }

  /* ---------------- 訊息 ---------------- */
  function scrollLog() { log.scrollTop = log.scrollHeight; }

  function sourceChip(source) {
    var withdrawn = source.storyId ? VTN.store.withdrawn.is(source.storyId) : false;
    var missingRecord = false;
    if (source.kind === 'record') {
      missingRecord = !VTN.store.records.get(source.recordId);
    }

    var node;
    if (withdrawn || missingRecord) {
      node = U.node('span', {
        class: 'vtn-ai-chip is-disabled',
        'aria-disabled': 'true',
        title: t('source.unavailable')
      });
    } else {
      node = U.node('a', { class: 'vtn-ai-chip', href: '#' });
    }

    node.innerHTML = '<i class="fa-solid ' + (source.kind === 'record' ? 'fa-file-audio' : 'fa-quote-left') +
      '" aria-hidden="true"></i><span></span>';
    node.querySelector('span').textContent = source.label;
    if (withdrawn || missingRecord) {
      node.appendChild(U.node('span', { class: 'vtn-ai-chip__note', text: '・' + t('source.unavailableShort') }));
      return node;
    }

    node.title = source.kind === 'record'
      ? t('source.recordTitle', { title: source.recordTitle || '' })
      : t('source.storyTitle', { title: source.title || '', teller: source.teller || '' });

    node.addEventListener('click', function (event) {
      event.preventDefault();
      if (source.kind === 'record') {
        VTN.router.go('recording', { tab: 'done', rec: source.recordId, t: Math.floor(source.start || 0) });
        VTN.recordings.handleParams({ tab: 'done', rec: source.recordId, t: Math.floor(source.start || 0) });
      } else {
        VTN.stories.openSource(source);
      }
    });
    return node;
  }

  function assistantRow(message) {
    var row = U.node('div', { class: 'vtn-ai-row' });
    var avatar = U.node('img', { class: 'vtn-ai-avatar', src: 'assets/mascot.png', alt: t('assistant.avatarAlt') });
    var bubble = U.node('div', { class: 'vtn-ai-bubble' });

    bubble.appendChild(U.node('span', { text: message.content }));

    if (message.modeLabel) {
      bubble.appendChild(U.node('p', { class: 'vtn-ai-disclosure', text: message.modeLabel }));
    }
    if (message.demo) {
      bubble.appendChild(U.node('p', { class: 'vtn-ai-disclosure', text: t('assistant.demoDisclosure') }));
    }

    if (message.sources && message.sources.length) {
      var label = U.node('div', { class: 'vtn-ai-sources-label' });
      label.innerHTML = '<i class="fa-solid fa-circle-check" aria-hidden="true"></i><span>' +
        U.escapeHtml(t('assistant.sources')) + '</span>';
      bubble.appendChild(label);
      var chips = U.node('div', { class: 'vtn-ai-chips' });
      message.sources.forEach(function (source) { chips.appendChild(sourceChip(source)); });
      bubble.appendChild(chips);
    }

    row.appendChild(avatar);
    row.appendChild(bubble);
    return row;
  }

  function userRow(text) {
    var row = U.node('div', { class: 'vtn-ai-row vtn-ai-row--user' });
    row.appendChild(U.node('div', { class: 'vtn-ai-bubble', text: text }));
    return row;
  }

  function typingNode() {
    var row = U.node('div', { class: 'vtn-ai-row' });
    var avatar = U.node('img', { class: 'vtn-ai-avatar', src: 'assets/mascot.png', alt: '' });
    avatar.setAttribute('aria-hidden', 'true');
    var bubble = U.node('div', { class: 'vtn-ai-bubble' });
    var dots = U.node('span', { class: 'vtn-ai-typing', 'aria-label': t('assistant.thinking') });
    dots.appendChild(U.node('span'));
    dots.appendChild(U.node('span'));
    dots.appendChild(U.node('span'));
    bubble.appendChild(dots);
    row.appendChild(avatar);
    row.appendChild(bubble);
    return row;
  }

  function suggestions() {
    var meta = VTN.stories.meta();
    var base = (meta.suggestedQuestions || []).slice();
    return base.filter(function (question) {
      var hits = allStoryHits(question);
      /* 若這個建議問題只會命中已撤回故事，就不顯示 */
      if (!hits.length) return true;
      return hits.some(function (hit) {
        return hit.story.authorized && !VTN.store.withdrawn.is(hit.story.id) &&
          VTN.store.authorizedFor(hit.story, VTN.store.role(), VTN.store.ownerId());
      });
    }).slice(0, 6);
  }

  function suggestRow() {
    var row = U.node('div', { class: 'vtn-ai-row' });
    var bubble = U.node('div', { class: 'vtn-ai-bubble' });
    bubble.appendChild(U.node('span', { text: t('assistant.welcome') }));

    var chips = U.node('div', { class: 'vtn-ai-suggests' });
    function addChip(question) {
      var btn = U.node('button', { class: 'vtn-ai-suggest', type: 'button', text: question });
      btn.addEventListener('click', function () { if (!busy) ask(question); });
      chips.appendChild(btn);
    }
    suggestions().forEach(addChip);

    var recordQuestions = [];
    var seen = {};
    ownRecords().forEach(function (rec) {
      rec.qaList.forEach(function (qa) {
        var question = qa.question || '';
        if (question && !seen[question] && recordQuestions.length < 2) {
          seen[question] = 1;
          recordQuestions.push(question);
        }
      });
    });
    if (recordQuestions.length) {
      var caption = U.node('p', { class: 'vtn-ai-corpus-note', text: t('assistant.myRecordings') });
      caption.style.marginTop = '10px';
      bubble.appendChild(caption);
      recordQuestions.forEach(addChip);
    }

    bubble.appendChild(chips);
    row.appendChild(bubble);
    return row;
  }

  function renderHistory() {
    if (!log) return;
    log.textContent = '';
    if (!store.messages.length) {
      log.appendChild(suggestRow());
      return;
    }
    store.messages.forEach(function (message) {
      log.appendChild(message.role === 'user' ? userRow(message.content) : assistantRow(message));
    });
    scrollLog();
  }

  /* ---------------- 開關 ---------------- */
  function open(focus) {
    if (!root) build();
    root.classList.add('is-open');
    var shell = document.getElementById('appShell');
    if (shell) shell.classList.add('is-modal-open');
    panel.setAttribute('aria-hidden', 'false');
    mask.setAttribute('aria-hidden', 'false');
    fab.setAttribute('aria-expanded', 'true');
    if (hint && !hint.hidden) {
      hint.hidden = true;
      try { window.localStorage.setItem(VTN.KEYS.hint, '1'); } catch (e) { /* ignore */ }
    }
    store = VTN.store.chat.load();
    renderHistory();
    renderStatusChip();
    if (focus !== false) setTimeout(function () { input.focus(); }, 80);
  }

  function close() {
    if (!root) return;
    root.classList.remove('is-open');
    var shell = document.getElementById('appShell');
    if (shell) shell.classList.remove('is-modal-open');
    root.style.bottom = '';
    panel.setAttribute('aria-hidden', 'true');
    mask.setAttribute('aria-hidden', 'true');
    fab.setAttribute('aria-expanded', 'false');
    fab.focus();
  }

  function setBusy(on) {
    busy = on;
    input.disabled = on;
    send.disabled = on;
    send.innerHTML = on
      ? '<span class="vtn-ai-spinner" aria-hidden="true"></span>'
      : '<i class="fa-solid fa-paper-plane" aria-hidden="true"></i>';
    Array.prototype.forEach.call(log.querySelectorAll('.vtn-ai-suggest'), function (btn) {
      btn.disabled = on;
    });
  }

  /* ---------------- 問答 ---------------- */
  function finish(result, question, context) {
    var answer = normalizeServerResult(result, context);
    // 個人錄音是另一份本機語料；首頁仍可檢索，但不覆蓋故事庫的拒答範圍。
    if (answer && !answer.inScope && context.includeRecords) {
      answer = searchRecords(question) || answer;
    }

    /* 網路失敗或無效答案才降級；沿用送出問題時的篩選與視口快照。 */
    if (!answer) {
      var localContext = context;
      if (result && Array.isArray(result.visibleIds)) {
        localContext = Object.assign({}, context, {
          storyIds: context.storyIds.filter(function (id) { return result.visibleIds.indexOf(id) !== -1; })
        });
      }
      answer = localAnswer(question, localContext);
    }

    var status = VTN.api.aiState().state;
    var modeLabel = '';
    if (status !== 'online') {
      modeLabel = status === 'degraded' ? t('assistant.degradedLabel') : t('assistant.offlineLabel');
    }

    var message = {
      role: 'assistant',
      content: answer.answer || outOfScope(),
      sources: answer.inScope ? answer.sources : [],
      demo: !!answer.demo,
      modeLabel: modeLabel
    };

    if (typingRow && typingRow.parentNode) typingRow.parentNode.removeChild(typingRow);
    typingRow = null;

    store.messages.push(message);
    VTN.store.chat.save(store);
    log.appendChild(assistantRow(message));
    setBusy(false);
    scrollLog();
    input.focus();
    VTN.ui.announce(message.content);
  }

  function ask(question) {
    var text = String(question || '').trim();
    if (!text || busy) return;
    var context = VTN.stories.queryContext();

    lastQuestion = text;
    if (!store.messages.length) log.textContent = '';
    store.messages.push({ role: 'user', content: text });
    VTN.store.chat.save(store);
    log.appendChild(userRow(text));
    scrollLog();

    setBusy(true);
    typingRow = typingNode();
    log.appendChild(typingRow);
    scrollLog();
    input.value = '';

    var status = VTN.api.aiState().state;
    if (status === 'offline') {
      setTimeout(function () { finish(null, text, context); }, 380);
      return;
    }

    VTN.api.ask(text, { lang: VTN.i18n.lang(), context: context })
      .then(function (result) { finish(result, text, context); })
      .catch(function () { finish(null, text, context); });
  }

  function refresh() {
    if (root && root.classList.contains('is-open')) renderHistory();
    renderStatusChip();
    if (fab) fab.setAttribute('aria-label', t('assistant.fabAria'));
    if (hint && !hint.hidden) hint.innerHTML = U.escapeHtml(t('assistant.hint')) + '<small>' + U.escapeHtml(t('assistant.hintSub')) + '</small>';
  }

  function mount() {
    build();
  }

  VTN.assistant = {
    mount: mount,
    open: open,
    close: close,
    ask: ask,
    refresh: refresh,
    localAnswer: localAnswer,
    searchStories: searchStories,
    statusLabel: function () { return VTN.api.aiState().state; }
  };
})();
