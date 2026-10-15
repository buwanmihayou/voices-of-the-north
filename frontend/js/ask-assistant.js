/* =============================================================================
 * Ask the Village — 懸浮村落問答助手（無框架版，四頁原型共用）
 * -----------------------------------------------------------------------------
 * 直接以 ES Module 引用 Next.js 同款語料庫 lib/storyCorpus.js，
 * 與 app/api/ask-village（服務端）、components/FloatingAIAssistant.jsx
 * 使用完全相同的段落／關鍵詞／出處規則，三端答案永不漂移。
 *
 * 誠實性紅線（與服務端一致）：
 *   1. 答案只來自已錄製故事文字稿；
 *   2. 每條在範圍答案附時間戳引用 Source: [YL-001] at 00:21；
 *   3. 超範圍一律回標準拒答句，前端再做一次「無引用即拒答」校驗。
 *
 * 用法（四頁 </body> 前各一行）：
 *   <link href="css/assistant.css" rel="stylesheet">
 *   <script type="module" src="js/ask-assistant.js"></script>
 * ========================================================================== */

import {
  retrieveAnswer,
  SUGGESTED_QUESTIONS,
  OUT_OF_SCOPE_MESSAGE
} from '/lib/storyCorpus.js';

(function () {
  'use strict';

  /* ---------------- 常量 ---------------- */

  var STORAGE_KEY = 'vtn-ask-village-chat-v1';
  var HINT_KEY = 'vtn-ask-village-hint-v1';
  var RECORDS_KEY = 'vtn-records-v1';
  var MASCOT_SRC = '/assets/mascot.png';
  var ANSWER_DELAY_MIN = 550;
  var ANSWER_DELAY_MAX = 950;
  var WELCOME_TEXT =
    '你好！我會根據已經錄製嘅故事回答你，有記錄嘅內容我會直頭話你知。試下問：';

  /* ---------------- 小工具 ---------------- */

  function $(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var data = raw ? JSON.parse(raw) : null;
      if (data && Array.isArray(data.messages)) return data;
    } catch (e) { /* 無儲存或損毀 → 全新開始 */ }
    return { messages: [] };
  }

  function saveStore(store) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) { /* 隱私模式等：略過持久化 */ }
  }

  function hintDismissed() {
    try { return localStorage.getItem(HINT_KEY) === '1'; } catch (e) { return false; }
  }
  function dismissHint() {
    try { localStorage.setItem(HINT_KEY, '1'); } catch (e) { /* ignore */ }
  }

  function fakeDelay() {
    return ANSWER_DELAY_MIN +
      Math.random() * (ANSWER_DELAY_MAX - ANSWER_DELAY_MIN);
  }

  /* ---------- 第二語料層：用戶已轉寫錄音（record.js 存入 localStorage） ----------
   * 後端從真實錄音抽出 qaList（每條附時間戳）；助手只可原樣引述，
   * 命中方式與語料庫同級嚴格：需 ≥2 個共同二元詞，避免「有咩」之類通殺。 */
  function normalizeQ(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[？?！!。，,、：:；;（）()「」『』\s]/g, '');
  }
  function bigrams(text) {
    var s = normalizeQ(text);
    var out = [];
    for (var i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
    return out;
  }
  function loadRecordEntries() {
    var entries = [];
    try {
      var arr = JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]');
      if (!Array.isArray(arr)) return entries;
      arr.forEach(function (rec) {
        if (rec.status === 'pending' || !rec.qaList) return;
        rec.qaList.forEach(function (qa) {
          entries.push({
            recordId: rec.id,
            recordTitle: rec.title || '我的錄音',
            source: rec.source,
            start: qa.timestamp || 0,
            question: qa.question || '',
            answer: qa.answer || '',
            haystack: (qa.question || '') + ' ' + (qa.answer || '')
          });
        });
      });
    } catch (e) { /* 損毀儲存 → 略過 */ }
    return entries;
  }
  function retrieveFromRecords(question) {
    var q = normalizeQ(question);
    if (q.length < 2) return null;
    var qGrams = bigrams(q);
    var best = null;
    loadRecordEntries().forEach(function (e) {
      var grams = bigrams(e.haystack);
      var hit = 0;
      qGrams.forEach(function (g) { if (grams.indexOf(g) !== -1) hit++; });
      if (hit >= 2 && (!best || hit > best.hit)) {
        best = {
          entry: e,
          hit: hit,
          inScope: true,
          answer: e.answer,
          sources: [{
            kind: 'record',
            recordId: e.recordId,
            recordTitle: e.recordTitle,
            start: e.start,
            label: 'Source: [' + e.recordId + '] at ' + fmtTs(e.start)
          }],
          demo: false
        };
      }
    });
    return best;
  }
  function fmtTs(sec) {
    var s = Math.max(0, Math.floor(sec || 0));
    function p(n) { return String(n).padStart(2, '0'); }
    return p(Math.floor(s / 60)) + ':' + p(s % 60);
  }

  /* 前端最後防線：在範圍但無引用 → 強制轉標準拒答；
   * 順序：已發布故事語料庫 → 用戶已轉寫錄音 → 誠實拒答 */
  function honestAnswer(question) {
    var res = retrieveAnswer(question);
    if (res.inScope && (!res.sources || res.sources.length === 0)) {
      res = { inScope: false, answer: OUT_OF_SCOPE_MESSAGE, sources: [] };
    }
    if (res.inScope) return res;
    var recRes = retrieveFromRecords(question);
    if (recRes) return recRes;
    return { inScope: false, answer: OUT_OF_SCOPE_MESSAGE, sources: [], demo: false };
  }

  /* ---------------- DOM 骨架 ---------------- */

  var root = $('div', 'vtn-ai-root');
  root.setAttribute('data-vtn-ai', 'mounted');

  /* 半透明黑色遮罩：點擊關閉 */
  var mask = $('div', 'vtn-ai-mask');
  mask.setAttribute('aria-hidden', 'true');

  /* 預設態：提示氣泡 + FAB */
  var launcher = $('div', 'vtn-ai-launcher');

  var hint = $('div', 'vtn-ai-hint');
  hint.hidden = hintDismissed();
  hint.innerHTML =
    '有咩需要幫忙？<small>How may I help you?</small>';
  var hintClose = $('button', 'vtn-ai-hint-close', '×');
  hintClose.type = 'button';
  hintClose.setAttribute('aria-label', '關閉提示');
  hint.appendChild(hintClose);

  var fab = $('button', 'vtn-ai-fab');
  fab.type = 'button';
  fab.setAttribute('aria-label', '開啟 Ask the Village 村落問答助手');
  fab.setAttribute('aria-expanded', 'false');
  var fabImg = $('img');
  fabImg.src = MASCOT_SRC;
  fabImg.alt = '';
  fabImg.setAttribute('aria-hidden', 'true');
  fab.appendChild(fabImg);
  var fabBadge = $('span', 'vtn-ai-fab-badge');
  fabBadge.innerHTML = '<i class="fa-solid fa-sparkles" aria-hidden="true"></i>';
  fab.appendChild(fabBadge);

  launcher.appendChild(hint);
  launcher.appendChild(fab);

  /* 聊天面板（App 內全寬 BottomSheet，常駐 DOM、靠 root.is-open 滑出） */
  var panel = $('section', 'vtn-ai-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Ask the Village 村落問答');
  panel.setAttribute('aria-hidden', 'true');

  /* 頭欄 */
  var head = $('header', 'vtn-ai-head');
  var headImg = $('img');
  headImg.src = MASCOT_SRC;
  headImg.alt = '';
  var headTitles = $('div', 'vtn-ai-head-titles');
  headTitles.appendChild($('p', 'vtn-ai-head-title', 'Ask the Village'));
  headTitles.appendChild($('p', 'vtn-ai-head-sub', '答案只來自已錄製嘅故事'));
  var btnClose = $('button', 'vtn-ai-head-btn');
  btnClose.type = 'button';
  btnClose.setAttribute('aria-label', '關閉助手');
  btnClose.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
  head.appendChild(headImg);
  head.appendChild(headTitles);
  head.appendChild(btnClose);

  /* 訊息區 */
  var log = $('div', 'vtn-ai-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  log.setAttribute('tabindex', '0');
  log.setAttribute('aria-label', '對話內容');

  /* 金色誠實底註 */
  var pledge = $('div', 'vtn-ai-pledge');
  pledge.innerHTML =
    '<i class="fa-solid fa-shield-halved" aria-hidden="true"></i>' +
    '<span>無來源引用嘅內容，唔會當成答案</span>';

  /* 輸入列 */
  var form = $('form', 'vtn-ai-form');
  var input = $('input', 'vtn-ai-input');
  input.type = 'text';
  input.id = 'vtn-ask-input';
  input.maxLength = 500;
  input.autocomplete = 'off';
  input.placeholder = '輸入問題，例如：以前村民耕種啲乜？';
  input.setAttribute('aria-label', '輸入你嘅問題');
  var send = $('button', 'vtn-ai-send');
  send.type = 'submit';
  send.setAttribute('aria-label', '發送問題');
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

  /* ---------------- 訊息渲染 ---------------- */

  var store = loadStore();
  var busy = false;
  var typingRow = null;
  var lastFallback = null;

  function scrollLog() {
    log.scrollTop = log.scrollHeight;
  }

  function suggestRow() {
    var row = $('div', 'vtn-ai-row');
    var bubble = $('div', 'vtn-ai-bubble');
    bubble.appendChild($('span', null, WELCOME_TEXT));
    var chips = $('div', 'vtn-ai-suggests');
    function addSuggest(q) {
      var b = $('button', 'vtn-ai-suggest', q);
      b.type = 'button';
      b.addEventListener('click', function () {
        if (busy) return;
        ask(q);
      });
      chips.appendChild(b);
    }
    SUGGESTED_QUESTIONS.forEach(addSuggest);

    // 用戶最近已轉寫錄音嘅問題（最多 2 條，直接可問）
    var recQs = [];
    try {
      var seen = {};
      JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]').forEach(function (r) {
        if (r.status === 'pending' || !r.qaList) return;
        r.qaList.forEach(function (qa) {
          var q = qa.question || '';
          if (q && !seen[q] && recQs.length < 2) { seen[q] = 1; recQs.push(q); }
        });
      });
    } catch (e) { /* ignore */ }
    if (recQs.length) {
      var cap = $('p', 'vtn-ai-corpus-note', '— 你最近嘅錄音 —');
      cap.style.marginTop = '10px';
      bubble.appendChild(cap);
      recQs.forEach(addSuggest);
    }

    bubble.appendChild(chips);
    row.appendChild(bubble);
    return row;
  }

  function sourceChip(src) {
    var a = $('a', 'vtn-ai-chip');

    // —— 用戶自己嘅已轉寫錄音：跳到「我的錄音」並跳秒播放 ——
    if (src.kind === 'record') {
      var onRecordingPage = /recording\.html$/.test(location.pathname);
      var href = 'recording.html?t=' + src.start + '#rec-' + src.recordId;
      a.href = onRecordingPage ? '#rec-' + src.recordId + '?t=' + src.start : href;
      a.title = src.recordTitle + ' — 跳到「我的錄音」' +
        src.label.replace('Source: ', '');
      a.innerHTML =
        '<i class="fa-solid fa-file-audio" aria-hidden="true"></i><span></span>';
      a.querySelector('span').textContent = src.label;
      a.addEventListener('click', function (e) {
        if (!onRecordingPage) return; // 普通跳轉
        e.preventDefault();
        var card = document.getElementById('rec-' + src.recordId);
        if (card) {
          if (card._body && card._body.hidden && card._head) card._head.click();
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          if (card._audio) {
            card._audio.preload = 'metadata';
            card._audio.addEventListener('loadedmetadata', function () {
              try { card._audio.currentTime = src.start; } catch (err) { /* ignore */ }
              var pr = card._audio.play();
              if (pr && pr.catch) pr.catch(function () {});
            }, { once: true });
            try { card._audio.currentTime = src.start; } catch (err) { /* ignore */ }
            var pr2 = card._audio.play();
            if (pr2 && pr2.catch) pr2.catch(function () {});
          }
        }
      });
      return a;
    }

    // —— 已發布示範故事：故事頁原地播放，其他頁跳轉 ——
    var onStoriesPage = /stories\.html$/.test(location.pathname);
    a.href = (onStoriesPage
      ? '?t=' + (src.start || 0) + '#story-' + src.storyId
      : 'stories.html?t=' + (src.start || 0) + '#story-' + src.storyId);
    a.title = src.title + ' — ' + src.teller + '（跳到故事 ' +
      src.label.replace('Source: ', '') + '）';
    a.innerHTML =
      '<i class="fa-solid fa-quote-left" aria-hidden="true"></i>' +
      '<span></span>';
    a.querySelector('span').textContent = src.label;
    a.addEventListener('click', function (e) {
      if (onStoriesPage && window.VTNDemoAudio) {
        e.preventDefault();
        var card = document.querySelector('.story-hero-card');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.VTNDemoAudio.play(src.start || 0);
      }
    });
    return a;
  }

  function assistantRow(msg) {
    var row = $('div', 'vtn-ai-row');
    var av = $('img', 'vtn-ai-avatar');
    av.src = MASCOT_SRC;
    av.alt = '村落小幫手';
    var bubble = $('div', 'vtn-ai-bubble');
    if (msg.error) bubble.classList.add('is-error');
    bubble.appendChild($('span', null, msg.content));

    if (msg.sources && msg.sources.length > 0) {
      if (msg.demo) {
        bubble.appendChild($('p', 'vtn-ai-disclosure',
          '角色演示示範答案・依據真實示範錄音之文字稿'));
      }
      bubble.appendChild($('div', 'vtn-ai-sources-label',
        ''));
      var label = bubble.querySelector('.vtn-ai-sources-label');
      label.innerHTML =
        '<i class="fa-solid fa-circle-check" aria-hidden="true"></i>' +
        '<span>來源引用（已錄製故事）</span>';
      var chips = $('div', 'vtn-ai-chips');
      msg.sources.forEach(function (s) { chips.appendChild(sourceChip(s)); });
      bubble.appendChild(chips);
    }

    if (msg.error) {
      var retry = $('button', 'vtn-ai-retry');
      retry.type = 'button';
      retry.innerHTML =
        '<i class="fa-solid fa-rotate-right" aria-hidden="true"></i>重試';
      retry.addEventListener('click', function () {
        if (lastFallback) ask(lastFallback);
      });
      bubble.appendChild(retry);
    }

    row.appendChild(av);
    row.appendChild(bubble);
    return row;
  }

  function userRow(text) {
    var row = $('div', 'vtn-ai-row vtn-ai-row--user');
    row.appendChild($('div', 'vtn-ai-bubble', text));
    return row;
  }

  function typingNode() {
    var row = $('div', 'vtn-ai-row');
    var av = $('img', 'vtn-ai-avatar');
    av.src = MASCOT_SRC;
    av.alt = '村落小幫手輸入中';
    var bubble = $('div', 'vtn-ai-bubble');
    var dots = $('span', 'vtn-ai-typing');
    dots.setAttribute('aria-label', '村落小幫手正在思考');
    dots.appendChild($('span'));
    dots.appendChild($('span'));
    dots.appendChild($('span'));
    bubble.appendChild(dots);
    row.appendChild(av);
    row.appendChild(bubble);
    return row;
  }

  function renderHistory() {
    log.textContent = '';
    if (store.messages.length === 0) {
      log.appendChild(suggestRow());
      return;
    }
    store.messages.forEach(function (m) {
      log.appendChild(m.role === 'user' ? userRow(m.content) : assistantRow(m));
    });
    scrollLog();
  }

  /* ---------------- 開合 ---------------- */

  /* 掛載目標：優先 App 手機框，彈層先會被限制喺視口內 */
  var shell = document.getElementById('appShell') || document.body;

  function openPanel(focus) {
    root.classList.add('is-open');
    shell.classList.add('is-modal-open');
    panel.setAttribute('aria-hidden', 'false');
    mask.setAttribute('aria-hidden', 'false');
    fab.setAttribute('aria-expanded', 'true');
    if (!hint.hidden) { hint.hidden = true; dismissHint(); }
    renderHistory();
    if (focus !== false) setTimeout(function () { input.focus(); }, 60);
  }

  function closePanel() {
    root.classList.remove('is-open');
    shell.classList.remove('is-modal-open');
    root.style.bottom = '';                 // 還原鍵盤托起偏移
    panel.setAttribute('aria-hidden', 'true');
    mask.setAttribute('aria-hidden', 'true');
    fab.setAttribute('aria-expanded', 'false');
    if (document.activeElement && document.activeElement !== document.body) {
      try { document.activeElement.blur(); } catch (e) { /* ignore */ }
    }
    fab.focus();
  }

  function setBusy(on) {
    busy = on;
    input.disabled = on;
    send.disabled = on;
    if (on) {
      send.innerHTML = '<span class="vtn-ai-spinner" aria-hidden="true"></span>';
    } else {
      send.innerHTML = '<i class="fa-solid fa-paper-plane" aria-hidden="true"></i>';
    }
    log.querySelectorAll('.vtn-ai-suggest').forEach(function (b) {
      b.disabled = on;
    });
  }

  /* ---------------- 問答 ---------------- */

  function ask(question) {
    var q = String(question || '').trim();
    if (!q || busy) return;

    lastFallback = q;

    // 移除歡迎列（只在首次發問時）
    if (store.messages.length === 0) log.textContent = '';

    store.messages.push({ role: 'user', content: q });
    saveStore(store);
    log.appendChild(userRow(q));
    scrollLog();

    setBusy(true);
    typingRow = typingNode();
    log.appendChild(typingRow);
    scrollLog();
    input.value = '';

    setTimeout(function () {
      var msg;
      try {
        var res = honestAnswer(q);
        var hasCorpusSource = res.inScope &&
          res.sources.some(function (s) { return !s.kind; });
        msg = {
          role: 'assistant',
          content: res.answer,
          sources: res.inScope ? res.sources : [],
          demo: hasCorpusSource && !!res.demo
        };
      } catch (e) {
        msg = {
          role: 'assistant',
          content: '網絡唔太順利，請再試一次。',
          sources: [],
          error: true
        };
      }

      if (typingRow && typingRow.parentNode) typingRow.parentNode.removeChild(typingRow);
      typingRow = null;

      store.messages.push(msg);
      saveStore(store);
      log.appendChild(assistantRow(msg));
      setBusy(false);
      scrollLog();
      input.focus();
    }, fakeDelay());
  }

  /* ---------------- 事件 ---------------- */

  fab.addEventListener('click', function () { openPanel(true); });
  btnClose.addEventListener('click', closePanel);
  mask.addEventListener('click', closePanel);
  hintClose.addEventListener('click', function (e) {
    e.stopPropagation();
    hint.hidden = true;
    dismissHint();
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    ask(input.value);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && root.classList.contains('is-open')) closePanel();
  });

  /* 從引用膠囊跳來故事頁時，定位到故事卡 */
  if (/stories\.html$/.test(location.pathname) &&
      location.hash === '#story-YL-001') {
    function jumpOnce() {
      var card = document.querySelector('.story-hero-card');
      if (card) card.scrollIntoView({ block: 'center' });
    }
    if (document.readyState === 'complete') jumpOnce();
    else window.addEventListener('load', jumpOnce);
  }

  /* ---------------- 掛載 ---------------- */

  /* 量度底導航實際高度，寫入 --vtn-nav-h（標籤換行／字體載入後高度可能
     同 CSS fallback 77px 有出入；彈層同 FAB 全部依賴呢個變數留位） */
  function syncNavHeight() {
    var shellEl = document.getElementById('appShell');
    var navEl = shellEl && shellEl.querySelector('.bottom-nav');
    if (!shellEl || !navEl) return;
    var h = navEl.getBoundingClientRect().height;
    if (h > 0) shellEl.style.setProperty('--vtn-nav-h', h + 'px');
  }

  function mount() {
    if (document.querySelector('.vtn-ai-root')) return; // 自檢：防重複注入
    /* 必須掛入 .app-shell：position:absolute 先會以手機框為參照，
       桌面視窗下都唔會溢出 App 範圍 */
    (document.getElementById('appShell') || document.body).appendChild(root);
    syncNavHeight();
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
  window.addEventListener('resize', syncNavHeight);
  window.addEventListener('load', syncNavHeight);

  /* 手機鍵盤彈起：visualViewport 會縮細，將整個助手層（含輸入列）一齊托起，
     並把訊息捲到最新；鍵盤收起還原。只喺面板打開時生效。 */
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', function () {
      if (!root.parentNode) return;
      var kb = window.innerHeight - window.visualViewport.height;
      var lifted = kb > 80 && root.classList.contains('is-open');
      root.style.bottom = lifted
        ? 'calc(var(--vtn-nav-h, 77px) + ' + kb + 'px)'
        : '';
      if (lifted) log.scrollTop = log.scrollHeight;
    });
  }
})();
