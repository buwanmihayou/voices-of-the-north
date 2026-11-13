/* =============================================================================
 * 40-recorder — 錄音 → 草稿 → 上傳轉寫
 * -----------------------------------------------------------------------------
 * 狀態機（第 1 項）：
 *   按下停止 → 立即存成 draft（含音訊、實測時長），無論之後發生什麼都不會消失；
 *   上傳成功 → done；任何失敗（404 / 503 / 429 / 斷網 / 其他）→ pending，可重試。
 *   任何情況都唔會再講「你嘅錄音未被保存」。
 *
 * 誠實文案（第 12、20 項）：
 *   同意書講明「先存本機、上傳才會離開裝置、測試伺服器可能暫存、可實體刪除」，
 *   並附版本號 CONSENT-2026-11-v2；唔會再寫「非永久儲存、可隨時撤回」而實際做唔到。
 * ========================================================================== */

(function () {
  'use strict';

  var VTN = window.VTN;
  var U = VTN.util;
  var CFG = VTN.config;

  var ui = null;
  var overlay = null;
  var sheet = null;
  var steps = {};
  var state = {
    health: { checked: false, stt: false, reason: '' },
    recorder: null,
    chunks: [],
    blob: null,
    mime: '',
    elapsed: 0,
    duration: 0,
    startedAt: 0,
    timer: null,
    recordId: null,
    selectedCard: null,
    cards: [],
    attachMedia: null,
    attachUrl: null
  };

  function t(key, vars) { return VTN.i18n.t(key, vars); }

  /* ---- 錄音自選小圖示（40-recorder 與 45-recordings 共用）-----------------
     純裝飾性標記：存落 record.iconKey，只喺「我的錄音」顯示；
     唔寫入地圖、唔補座標（私隱紅線：位置只顯示 800m 模糊範圍）。 */
  function iconKeys() {
    return VTN.store.records.iconKeys ? VTN.store.records.iconKeys() : [];
  }
  function iconOf(key) {
    try { return VTN.stories.typeIcon(key) || 'fa-feather-pointed'; }
    catch (e) { return 'fa-feather-pointed'; }
  }
  function iconLabel(key) { return t('storyType.' + key); }

  function buildIconPicker(currentKey, onPick) {
    var wrap = U.node('div', { class: 'vtn-rec-icons' });
    wrap.appendChild(U.node('p', { class: 'vtn-rec-subhead', text: t('rec.iconTitle') }));
    wrap.appendChild(U.node('p', { class: 'vtn-rec-note', text: t('rec.iconHint') }));
    var row = U.node('div', {
      class: 'vtn-rec-icons__row', role: 'group', 'aria-label': t('rec.iconTitle')
    });
    var current = U.node('p', { class: 'vtn-rec-icons__current' });
    function refresh(key) {
      Array.prototype.forEach.call(row.children, function (btn) {
        var active = btn.getAttribute('data-icon-key') === key;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      current.textContent = key ? t('rec.iconCurrent', { name: iconLabel(key) }) : t('rec.iconNone');
    }
    iconKeys().forEach(function (key) {
      var btn = U.node('button', {
        type: 'button', class: 'vtn-rec-icon',
        'data-icon-key': key, 'aria-label': iconLabel(key), title: iconLabel(key)
      });
      btn.innerHTML = '<i class="fa-solid ' + iconOf(key) + '" aria-hidden="true"></i>';
      btn.addEventListener('click', function () {
        refresh(key);
        if (onPick) onPick(key);
      });
      row.appendChild(btn);
    });
    wrap.appendChild(row);
    wrap.appendChild(current);
    refresh(currentKey || null);
    return wrap;
  }

  VTN.recIcons = {
    keys: iconKeys, iconOf: iconOf, labelOf: iconLabel, build: buildIconPicker
  };

  function apiHost() {
    try { return new URL(VTN.api.base()).host; } catch (e) { return VTN.api.base(); }
  }

  var FALLBACK_CARDS = [
    { id: 'C03', category: '暖身', prompt: '細個你喺邊度玩得多？', hint: '唔使講門牌' },
    { id: 'C04', category: '生活', prompt: '過年最記得食咩、做咩？', hint: '味道同儀式都得' },
    { id: 'C09', category: '地方', prompt: '村口以前係點嘅樣？', hint: '樹、橋、舖頭' }
  ];

  /* =========================================================================
   * 1. 建立介面
   * ======================================================================= */
  function build() {
    if (overlay) return;

    overlay = U.node('div', { class: 'vtn-rec-overlay', 'aria-hidden': 'true' });
    sheet = U.node('div', {
      class: 'vtn-rec-sheet',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'recSheetTitle'
    });

    var head = U.node('div', { class: 'vtn-rec-sheet__head' });
    var titles = U.node('div', { class: 'vtn-rec-sheet__titles' });
    titles.appendChild(U.node('p', { class: 'vtn-rec-sheet__title', id: 'recSheetTitle', text: t('rec.sheetTitle') }));
    titles.appendChild(U.node('p', { class: 'vtn-rec-sheet__sub', text: t('rec.sheetSub') }));
    var closeBtn = U.node('button', { class: 'vtn-rec-sheet__close', type: 'button', 'aria-label': t('common.close') });
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    closeBtn.addEventListener('click', close);
    head.appendChild(titles);
    head.appendChild(closeBtn);

    var body = U.node('div', { class: 'vtn-rec-body' });

    /* ---- 準備 ---- */
    steps.prep = U.node('div', { class: 'vtn-rec-step' });
    state.pill = U.node('span', { class: 'vtn-rec-status vtn-rec-status--checking' });
    steps.prep.appendChild(state.pill);
    steps.prep.appendChild(U.node('p', { class: 'vtn-rec-lead', text: t('rec.prepLead') }));
    steps.prep.appendChild(U.node('p', { class: 'vtn-rec-desc', text: t('rec.prepDesc', { host: apiHost() }) }));

    var cardBox = U.node('div', { style: 'margin:14px 0' });
    cardBox.appendChild(U.node('p', { class: 'vtn-rec-subhead', text: t('rec.cardTitle') }));
    var cardSelect = U.node('select', {
      'aria-label': t('rec.cardTitle'),
      style: 'width:100%;min-height:44px;padding:10px;border-radius:12px;border:1.5px solid var(--sage-line);background:var(--cream);font-size:.95rem;color:var(--ink-body)'
    });
    state.cardSelect = cardSelect;
    cardBox.appendChild(cardSelect);
    var cardNote = U.node('p', { class: 'vtn-rec-note' });
    cardNote.innerHTML = '<i class="fa-solid fa-circle-info" aria-hidden="true"></i><span></span>';
    cardBox.appendChild(cardNote);
    steps.prep.appendChild(cardBox);

    var micBtn = U.node('button', { class: 'vtn-rec-mic', type: 'button', 'aria-label': t('rec.micAria') });
    micBtn.innerHTML = '<i class="fa-solid fa-microphone" aria-hidden="true"></i>';
    micBtn.addEventListener('click', function () { showStep('consent'); });
    steps.prep.appendChild(micBtn);

    var listenBtn = U.node('button', { class: 'vtn-rec-btn vtn-rec-btn--ghost', type: 'button' });
    listenBtn.innerHTML = '<i class="fa-solid fa-headphones" aria-hidden="true"></i><span>' +
      U.escapeHtml(t('rec.listenDemo')) + '</span>';
    listenBtn.addEventListener('click', function () {
      close();
      VTN.router.go('stories', { story: 'YL-001' });
      setTimeout(function () { VTN.audio.playStory('YL-001', 0); }, 260);
    });
    steps.prep.appendChild(listenBtn);

    var demoBtn = U.node('button', { class: 'vtn-rec-btn vtn-rec-btn--gold', type: 'button' });
    demoBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i><span>' +
      U.escapeHtml(t('rec.runDemo')) + '</span>';
    demoBtn.addEventListener('click', runDemo);
    steps.prep.appendChild(demoBtn);

    steps.prep.appendChild(U.node('p', { class: 'vtn-rec-note', html:
      '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>' +
      U.escapeHtml(t('rec.prepNote')) + '</span>' }));

    /* ---- 知情同意 ---- */
    steps.consent = U.node('div', { class: 'vtn-rec-step', hidden: 'hidden' });
    var consentCard = U.node('div', { style:
      'background:var(--cream);border:1.5px solid var(--sage-line);border-radius:18px;padding:16px;margin-bottom:14px' });
    consentCard.appendChild(U.node('h3', {
      text: t('consent.title'),
      style: 'margin:0 0 8px;font-size:1.05rem;font-weight:900;color:var(--ink)'
    }));
    var consentList = U.node('ul', { style: 'margin:0;padding-left:20px;font-size:.86rem;line-height:1.7;color:var(--ink-body)' });
    [
      'consent.point1', 'consent.point2', 'consent.point3', 'consent.point4', 'consent.point5'
    ].forEach(function (key) {
      consentList.appendChild(U.node('li', { text: t(key, { host: apiHost() }) }));
    });
    consentCard.appendChild(consentList);
    consentCard.appendChild(U.node('p', {
      class: 'vtn-rec-note',
      text: t('consent.version', { version: CFG.consentPolicyVersion, date: CFG.consentPolicyDate })
    }));
    steps.consent.appendChild(consentCard);

    var agreeBtn = U.node('button', { class: 'vtn-rec-btn vtn-rec-btn--primary', type: 'button', text: t('consent.agree') });
    agreeBtn.addEventListener('click', startRecording);
    steps.consent.appendChild(agreeBtn);
    var consentBack = U.node('button', { class: 'vtn-rec-btn vtn-rec-btn--ghost', type: 'button', text: t('consent.back') });
    consentBack.addEventListener('click', function () { showStep('prep'); });
    steps.consent.appendChild(consentBack);

    /* ---- 錄音 ---- */
    steps.rec = U.node('div', { class: 'vtn-rec-step', hidden: 'hidden' });
    var liveMic = U.node('button', { class: 'vtn-rec-mic is-live', type: 'button', 'aria-label': t('rec.stopAria') });
    liveMic.innerHTML = '<i class="fa-solid fa-stop" aria-hidden="true"></i>';
    liveMic.addEventListener('click', function () { stopRecording(false); });
    steps.rec.appendChild(liveMic);
    state.timerEl = U.node('p', { class: 'vtn-rec-timer', text: '00:00' });
    steps.rec.appendChild(state.timerEl);
    steps.rec.appendChild(U.node('p', { class: 'vtn-rec-hint-live', text: t('rec.liveHint', { max: 3 }) }));
    state.liveCardHint = U.node('p', { class: 'vtn-rec-desc', hidden: 'hidden' });
    state.liveCardHint.style.cssText = 'background:var(--sage-wash);border-radius:12px;padding:10px 12px;font-weight:700';
    steps.rec.appendChild(state.liveCardHint);
    var wave = U.node('div', { class: 'vtn-rec-wave' });
    for (var i = 0; i < 11; i++) wave.appendChild(U.node('i'));
    steps.rec.appendChild(wave);
    var cancelRec = U.node('button', { class: 'vtn-rec-btn vtn-rec-btn--ghost', type: 'button', text: t('rec.cancelRec') });
    cancelRec.addEventListener('click', function () {
      stopRecording(true);
      showStep('prep');
    });
    steps.rec.appendChild(cancelRec);

    /* ---- 試聽 ---- */
    steps.review = U.node('div', { class: 'vtn-rec-step', hidden: 'hidden' });
    steps.review.appendChild(U.node('p', { class: 'vtn-rec-lead', text: t('rec.reviewLead') }));
    state.draftNote = U.node('p', { class: 'vtn-rec-note' });
    state.draftNote.innerHTML = '<i class="fa-solid fa-circle-check" aria-hidden="true"></i><span></span>';
    steps.review.appendChild(state.draftNote);
    state.reviewAudio = U.node('audio', { class: 'vtn-rec-audio', controls: 'controls' });
    steps.review.appendChild(state.reviewAudio);
    var metaRow = U.node('div', { class: 'vtn-rec-meta-row' });
    metaRow.appendChild(U.node('span', { class: 'vtn-rec-pill', text: t('rec.livePill') }));
    state.durPill = U.node('span', { class: 'vtn-rec-pill' });
    metaRow.appendChild(state.durPill);
    steps.review.appendChild(metaRow);

    steps.review.appendChild(buildAttachBlock());
    state.iconHost = U.node('div', { class: 'vtn-rec-icons-host' });
    steps.review.appendChild(state.iconHost);

    state.uploadBtn = U.node('button', { class: 'vtn-rec-btn vtn-rec-btn--primary', type: 'button' });
    state.uploadBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i><span>' +
      U.escapeHtml(t('rec.upload')) + '</span>';
    state.uploadBtn.addEventListener('click', uploadCurrent);
    steps.review.appendChild(state.uploadBtn);

    var rerecord = U.node('button', { class: 'vtn-rec-btn vtn-rec-btn--ghost', type: 'button', text: t('rec.rerecord') });
    rerecord.addEventListener('click', function () {
      state.blob = null;
      state.duration = 0;
      startRecording();
    });
    steps.review.appendChild(rerecord);

    var reviewBack = U.node('button', { class: 'vtn-rec-btn vtn-rec-btn--ghost', type: 'button', text: t('rec.backToPrep') });
    reviewBack.addEventListener('click', function () { showStep('prep'); });
    steps.review.appendChild(reviewBack);

    /* ---- 處理中 ---- */
    steps.processing = U.node('div', { class: 'vtn-rec-step', hidden: 'hidden' });
    steps.processing.appendChild(U.node('p', { class: 'vtn-rec-lead', text: t('rec.processingLead') }));
    state.stepList = U.node('ul', { class: 'vtn-rec-steps' });
    [
      ['fa-cloud-arrow-up', t('rec.stepUpload')],
      ['fa-language', t('rec.stepStt')],
      ['fa-wand-magic-sparkles', t('rec.stepAi')]
    ].forEach(function (def) {
      var li = U.node('li');
      var ico = U.node('span', { class: 'step-ico' });
      ico.innerHTML = '<i class="fa-solid ' + def[0] + '" aria-hidden="true"></i>';
      li.appendChild(ico);
      li.appendChild(U.node('span', { text: def[1] }));
      li._ico = ico;
      li._icoHtml = ico.innerHTML;
      state.stepList.appendChild(li);
    });
    steps.processing.appendChild(state.stepList);

    /* ---- 結果 ---- */
    steps.result = U.node('div', { class: 'vtn-rec-step', hidden: 'hidden' });

    body.appendChild(steps.prep);
    body.appendChild(steps.consent);
    body.appendChild(steps.rec);
    body.appendChild(steps.review);
    body.appendChild(steps.processing);
    body.appendChild(steps.result);
    sheet.appendChild(head);
    sheet.appendChild(body);
    overlay.appendChild(sheet);

    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) close();
    });

    fillCards();
    fetch(VTN.api.base() + '/api/lab/cards', { headers: VTN.api.viewerHeaders() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (json) {
        if (json && json.cards && json.cards.length) {
          state.cards = json.cards;
          fillCards();
        }
      }).catch(function () { /* 用內置卡片 */ });
  }

  function fillCards() {
    if (!state.cardSelect) return;
    var select = state.cardSelect;
    select.textContent = '';
    select.appendChild(U.node('option', { value: '', text: t('rec.cardNone') }));
    var cards = state.cards.length ? state.cards : FALLBACK_CARDS;
    cards.forEach(function (card) {
      select.appendChild(U.node('option', {
        value: card.id,
        text: (card.category || '') + '｜' + (card.prompt || '')
      }));
    });
    select.onchange = function () {
      state.selectedCard = cards.filter(function (c) { return c.id === select.value; })[0] || null;
      var note = select.parentNode.querySelector('.vtn-rec-note span');
      if (note) {
        note.textContent = state.selectedCard
          ? state.selectedCard.prompt + '（' + (state.selectedCard.hint || '') + '）'
          : t('rec.cardHint');
      }
      if (state.liveCardHint) {
        state.liveCardHint.textContent = state.selectedCard ? state.selectedCard.prompt : '';
        state.liveCardHint.hidden = !state.selectedCard;
      }
    };
  }

  /* =========================================================================
   * 2. 開關與步驟
   * ======================================================================= */
  function showStep(name) {
    Object.keys(steps).forEach(function (key) { steps[key].hidden = key !== name; });
    var first = steps[name].querySelector('button, select, input');
    if (first) setTimeout(function () { first.focus(); }, 40);
  }

  function open() {
    build();
    var shell = document.getElementById('appShell') || document.body;
    shell.appendChild(overlay);
    shell.classList.add('is-modal-open');
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    showStep('prep');
    checkHealth();
    document.addEventListener('keydown', onKeydown, true);
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    var shell = document.getElementById('appShell') || document.body;
    shell.classList.remove('is-modal-open');
    stopRecording(true);
    document.removeEventListener('keydown', onKeydown, true);
    setTimeout(function () {
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 260);
    var trigger = document.getElementById('startRecordBtn');
    if (trigger) trigger.focus();
  }

  function onKeydown(event) {
    if (event.key === 'Escape' && overlay && overlay.classList.contains('is-open')) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab' || !sheet) return;
    var focusables = sheet.querySelectorAll('button:not([disabled]), select, input, audio');
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function checkHealth() {
    setPill('checking', '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i><span>' +
      U.escapeHtml(t('rec.checking')) + '</span>');
    VTN.api.health(true).then(function (data) {
      state.health.checked = true;
      state.health.stt = !!data.stt_ready;
      state.health.reason = data.stt_reason || '';
      if (state.health.stt) setPill('online',
        '<i class="fa-solid fa-circle-check" aria-hidden="true"></i><span>' + U.escapeHtml(t('rec.online')) + '</span>');
      else setPill('offline',
        '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>' + U.escapeHtml(t('rec.offline')) + '</span>');
      VTN.ui.renderStatus();
    }).catch(function () {
      state.health.checked = true;
      state.health.stt = false;
      setPill('offline', '<i class="fa-solid fa-plug-circle-xmark" aria-hidden="true"></i><span>' +
        U.escapeHtml(t('rec.serverDown')) + '</span>');
      VTN.ui.renderStatus();
    });
  }

  function setPill(mode, html) {
    if (!state.pill) return;
    state.pill.className = 'vtn-rec-status vtn-rec-status--' + mode;
    state.pill.innerHTML = html;
  }

  /* =========================================================================
   * 3. 錄音
   * ======================================================================= */
  function pickMime() {
    var candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (var i = 0; i < candidates.length; i++) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
    }
    return '';
  }

  function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      setPill('offline', '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>' +
        U.escapeHtml(t('rec.noMedia')) + '</span>');
      showStep('prep');
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then(function (stream) {
        state.chunks = [];
        /* 每次新錄音都係新紀錄，避免覆寫上一段草稿 */
        state.recordId = null;
        var mime = pickMime();
        state.recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        state.mime = state.recorder.mimeType || mime || 'audio/webm';
        state.recorder.addEventListener('dataavailable', function (event) {
          if (event.data && event.data.size > 0) state.chunks.push(event.data);
        });
        state.recorder.addEventListener('stop', function () {
          stream.getTracks().forEach(function (track) { track.stop(); });
          state.blob = new Blob(state.chunks, { type: state.mime });
          state.elapsed = (Date.now() - state.startedAt) / 1000;
          finalizeDraft();
        });
        state.recorder.start(250);
        state.startedAt = Date.now();
        runTimer();
        showStep('rec');
      })
      .catch(function (error) {
        var message = /denied|NotAllowed/i.test(String(error))
          ? t('rec.micDenied') : t('rec.micError', { msg: error && error.message ? error.message : String(error) });
        setPill('offline', '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>' +
          U.escapeHtml(message) + '</span>');
        showStep('prep');
        VTN.ui.toast(message, 'error');
      });
  }

  function runTimer() {
    clearInterval(state.timer);
    state.timer = setInterval(function () {
      var seconds = (Date.now() - state.startedAt) / 1000;
      if (state.timerEl) state.timerEl.textContent = U.fmtTime(seconds);
      if (seconds >= CFG.maxRecordSeconds) stopRecording(false);
    }, 250);
  }

  function stopRecording(silent) {
    clearInterval(state.timer);
    if (state.recorder && state.recorder.state !== 'inactive') {
      try { state.recorder.stop(); } catch (e) { /* ignore */ }
    }
    if (silent) {
      state.recorder = null;
      state.chunks = [];
      state.blob = null;
    }
  }

  /**
   * 停止後第一件事：量度真實時長 → 立即寫入草稿。
   */
  function finalizeDraft() {
    measureDuration(state.blob, state.elapsed).then(function (seconds) {
      state.duration = seconds;
      var rec = {
        id: state.recordId || U.uid('REC'),
        createdAt: Date.now(),
        source: 'live',
        status: 'draft',
        scope: VTN.store.getPref('scope') || 'private',
        mime: state.mime,
        durationSec: seconds,
        durationSource: 'measured',
        audioDataURL: null,
        rawText: '',
        words: [],
        formalText: '',
        qaList: [],
        questionCard: state.selectedCard ? {
          id: state.selectedCard.id,
          category: state.selectedCard.category,
          prompt: state.selectedCard.prompt
        } : null,
        consentRef: CFG.consentPolicyVersion,
        uploadState: 'draft'
      };
      return blobToDataUrl(state.blob).then(function (dataUrl) {
        rec.audioDataURL = dataUrl;
        var saved = VTN.store.records.save(rec);
        state.recordId = saved.record.id;
        enterReview(saved);
      });
    });
  }

  function measureDuration(blob, fallback) {
    return new Promise(function (resolve) {
      if (!blob || !blob.size) { resolve(Math.max(0, fallback || 0)); return; }
      var url = URL.createObjectURL(blob);
      var audio = new Audio();
      var settled = false;
      function done(value) {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        resolve(Math.round((value || fallback || 0) * 10) / 10);
      }
      audio.preload = 'metadata';
      audio.addEventListener('loadedmetadata', function () {
        done(isFinite(audio.duration) ? audio.duration : fallback);
      });
      audio.addEventListener('error', function () { done(fallback); });
      setTimeout(function () { done(fallback); }, 2500);
      audio.src = url;
    });
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve) {
      if (!blob) { resolve(null); return; }
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { resolve(null); };
      reader.readAsDataURL(blob);
    });
  }

  function enterReview(saved) {
    if (state.reviewAudio) {
      if (state.reviewAudio.src) URL.revokeObjectURL(state.reviewAudio.src);
      state.reviewAudio.src = URL.createObjectURL(state.blob);
    }
    if (state.durPill) state.durPill.textContent = U.fmtTime(state.duration);
    var note = state.draftNote ? state.draftNote.querySelector('span') : null;
    if (note) {
      note.textContent = t('rec.draftSaved', { time: U.fmtTime(state.duration) });
    }
    applyQuotaWarning(saved.quota);
    if (state.iconHost) {
      var recordId = saved && saved.record ? saved.record.id : state.recordId;
      var chosen = saved && saved.record ? saved.record.iconKey : null;
      state.iconHost.textContent = '';
      state.iconHost.appendChild(buildIconPicker(chosen, function (key) {
        VTN.store.records.patch(recordId, { iconKey: key });
      }));
    }
    showStep('review');
  }

  function applyQuotaWarning(quota) {
    if (!quota) return;
    if (quota.evicted && quota.evicted.length) {
      var removedAudio = quota.evicted.filter(function (e) { return e.kind === 'audio'; }).length;
      var removedRecords = quota.evicted.filter(function (e) { return e.kind === 'record'; }).length;
      VTN.ui.toast(t('quota.evicted', { audio: removedAudio, records: removedRecords }), 'error');
    }
    if (quota.persisted === false) {
      VTN.ui.toast(t('quota.writeFailed'), 'error');
    }
  }

  /* =========================================================================
   * 4. 上傳
   * ======================================================================= */
  function uploadCurrent() {
    var rec = VTN.store.records.get(state.recordId);
    if (!rec) {
      VTN.ui.toast(t('rec.draftMissing'), 'error');
      showStep('prep');
      return;
    }
    uploadRecord(rec, { blob: state.blob, onDone: renderSuccess, onFail: renderPending });
  }

  /**
   * 重試入口（我的錄音頁與結果頁共用）。
   */
  function uploadRecord(rec, handlers) {
    var opts = handlers || {};
    if (!overlay) build();
    showStep('processing');
    setStep(0, 'active');

    var blobPromise = opts.blob ? Promise.resolve(opts.blob) : dataUrlToBlob(rec.audioDataURL);
    blobPromise.then(function (blob) {
      if (!blob) throw Object.assign(new Error('no-audio'), { code: 'NO_AUDIO' });
      setStep(0, 'done');
      setStep(1, 'active');

      var form = new FormData();
      var ext = /webm/.test(rec.mime || '') ? '.webm' : (/ogg/.test(rec.mime || '') ? '.ogg' : '.m4a');
      form.append('file', blob, 'recording' + ext);

      return fetch(VTN.api.base() + '/api/process', {
        method: 'POST',
        headers: VTN.api.viewerHeaders(),
        body: form
      }).then(function (response) {
        return response.json().catch(function () { return null; }).then(function (data) {
          if (!response.ok) {
            var error = new Error((data && data.detail) || ('HTTP ' + response.status));
            error.status = response.status;
            error.detail = data && data.detail;
            throw error;
          }
          return data;
        });
      });
    }).then(function (data) {
      setStep(1, 'done');
      setStep(2, 'active');
      var words = normalizeWords(data.words);
      var updated = VTN.store.records.patch(rec.id, {
        status: 'done',
        contributionFlow: true,
        reviewStatus: 'ready',
        requestedScope: rec.scope || VTN.store.getPref('scope') || 'private',
        mode: data.mode || 'online',
        rawText: data.raw_text || '',
        words: words,
        formalText: (data.llm_result && data.llm_result.formal_text) || data.raw_text || '',
        qaList: (data.llm_result && data.llm_result.qa_list) || [],
        durationSec: rec.durationSec,
        durationSource: 'measured',
        confidenceSource: words.length && words[0].confidence !== null ? 'provider' : 'unavailable',
        uploadState: 'done',
        sync: 'local',
        syncError: null
      });
      setStep(2, 'done');
      if (opts.onDone) opts.onDone(updated);
      else {
        VTN.ui.toast(t('rec.doneToast'), 'success');
        showStep('prep');
        close();
        VTN.router.go('recording', { tab: 'done' });
      }
      syncToServer(updated);
    }).catch(function (error) {
      var code = classify(error);
      var pending = VTN.store.records.patch(rec.id, {
        status: 'pending',
        uploadState: 'failed',
        sync: 'failed',
        syncError: code,
        errorCode: code
      });
      if (opts.onFail) opts.onFail(pending, code);
      else {
        VTN.ui.toast(t('err.' + code, { status: error.status || '—', url: VTN.api.base() }), 'error');
        showStep('prep');
        close();
        VTN.router.go('recording', { tab: 'pending' });
      }
    });
  }

  function classify(error) {
    if (!error) return 'unknown';
    if (error.code === 'NO_AUDIO') return 'noAudio';
    if (error.status === 404) return 'notFound';
    if (error.status === 413) return 'tooLarge';
    if (error.status === 429) return 'rateLimited';
    if (error.status === 503) return 'sttUnavailable';
    if (error.status === 401) return 'unauthorized';
    if (error.offline || error.code === 'NETWORK' || error.code === 'TIMEOUT') return 'network';
    return 'unknown';
  }

  function dataUrlToBlob(dataUrl) {
    if (!dataUrl) return Promise.resolve(null);
    return fetch(dataUrl).then(function (r) { return r.blob(); }).catch(function () { return null; });
  }

  function normalizeWords(words) {
    if (!Array.isArray(words)) return [];
    return words.map(function (word) {
      var confidence = word.confidence;
      var hasConfidence = typeof confidence === 'number' && confidence > 0 && confidence <= 1;
      return {
        word: word.word || '',
        start: Number(word.start) || 0,
        end: Number(word.end) || 0,
        /* 第 11 項：取不到就 null，前端顯示「未能取得置信度」，不再寫死 0.92 */
        confidence: hasConfidence ? Math.round(confidence * 100) / 100 : null
      };
    });
  }

  function setStep(index, status) {
    if (!state.stepList) return;
    var li = state.stepList.children[index];
    if (!li) return;
    li.classList.remove('is-active', 'is-done');
    if (status === 'active') {
      li.classList.add('is-active');
      li._ico.innerHTML = '<span class="vtn-rec-spinner" aria-hidden="true"></span>';
    } else if (status === 'done') {
      li.classList.add('is-done');
      li._ico.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i>';
    } else {
      li._ico.innerHTML = li._icoHtml;
    }
  }

  function syncToServer(rec) {
    VTN.api.records.sync(rec).then(function () {
      U.emit('vtn:store-changed', { type: 'records' });
    }).catch(function (error) {
      VTN.store.records.patch(rec.id, {
        sync: 'failed',
        syncError: error && error.status ? String(error.status) : 'network'
      });
      VTN.ui.toast(t('sync.failed'), 'error');
    });
  }

  /* =========================================================================
   * 5. 結果畫面
   * ======================================================================= */
  function resetResult() {
    steps.result.textContent = '';
    for (var i = 0; i < 3; i++) setStep(i, '');
  }

  function renderSuccess(rec) {
    resetResult();
    steps.result.appendChild(headLine('fa-circle-check', t('rec.resultOk'), 'var(--forest)'));

    var tags = U.node('div', { class: 'vtn-rec-meta-row' });
    tags.appendChild(U.node('span', { class: 'vtn-rec-pill', text: U.fmtTime(rec.durationSec) }));
    tags.appendChild(U.node('span', { class: 'vtn-rec-pill', text: t('rec.modeOnline') }));
    tags.appendChild(U.node('span', { class: 'vtn-rec-pill', text: t('scope.label', {
      scope: t(VTN.SCOPE_META[VTN.store.scopeOf(rec)].labelKey)
    }) }));
    if (rec.iconKey) {
      var iconPill = U.node('span', { class: 'vtn-rec-pill' });
      iconPill.innerHTML = '<i class="fa-solid ' + iconOf(rec.iconKey) + '" aria-hidden="true"></i> ' +
        U.escapeHtml(iconLabel(rec.iconKey));
      tags.appendChild(iconPill);
    }
    steps.result.appendChild(tags);

    if (rec.audioDataURL || rec.audioUrl) {
      var audio = U.node('audio', { class: 'vtn-rec-audio', controls: 'controls' });
      audio.src = rec.audioDataURL || rec.audioUrl;
      steps.result.appendChild(audio);
      VTN.audio.applyPrefs(audio);
    }

    if (rec.formalText) {
      steps.result.appendChild(U.node('p', { class: 'vtn-rec-subhead', text: t('rec.formalTitle') }));
      steps.result.appendChild(U.node('p', { class: 'vtn-rec-formal', text: rec.formalText }));
    }

    if (rec.qaList.length) {
      steps.result.appendChild(U.node('p', { class: 'vtn-rec-subhead', text: t('rec.qaTitle') }));
      var qaBox = U.node('div', { class: 'vtn-rec-qa' });
      rec.qaList.forEach(function (qa) {
        var btn = U.node('button', { type: 'button' });
        btn.appendChild(U.node('span', { class: 'qa-q', text: qa.question }));
        btn.appendChild(U.node('span', { class: 'qa-t', text: U.fmtTime(qa.timestamp) }));
        btn.addEventListener('click', function () {
          var el = steps.result.querySelector('audio');
          if (el) VTN.audio.seekPlay(el, qa.timestamp);
        });
        qaBox.appendChild(btn);
      });
      steps.result.appendChild(qaBox);
    }

    if (rec.words.length) {
      steps.result.appendChild(U.node('p', { class: 'vtn-rec-subhead', text: t('rec.wordTitle') }));
      if (rec.confidenceSource !== 'unavailable') {
        var csum = 0, cn = 0;
        rec.words.forEach(function (w) { if (typeof w.confidence === 'number') { csum += w.confidence; cn++; } });
        var cavg = cn ? csum / cn : null;
        var badgeRow = U.node('div', { class: 'vtn-rec-meta-row' });
        badgeRow.appendChild(U.node('span', { class: 'vtn-rec-pill', text: t('rec.confidenceAvg') }));
        badgeRow.appendChild(recConfidenceBadge(cavg));
        steps.result.appendChild(badgeRow);
      }
      steps.result.appendChild(wordCloud(rec.words, steps.result));
      if (rec.confidenceSource === 'unavailable') {
        steps.result.appendChild(U.node('p', { class: 'vtn-rec-note', text: t('rec.confidenceUnavailable') }));
      }
    }

    var go = U.node('button', { class: 'vtn-rec-btn vtn-rec-btn--primary', type: 'button' });
    go.innerHTML = '<i class="fa-solid fa-folder-open" aria-hidden="true"></i><span>' +
      U.escapeHtml(t('rec.goRecordings')) + '</span>';
    go.addEventListener('click', function () {
      close();
      VTN.router.go('recording', { tab: 'done' });
    });
    steps.result.appendChild(go);

    var again = U.node('button', { class: 'vtn-rec-btn vtn-rec-btn--ghost', type: 'button', text: t('rec.again') });
    again.addEventListener('click', function () { showStep('prep'); });
    steps.result.appendChild(again);

    steps.result.appendChild(U.node('p', { class: 'vtn-rec-note', text: t('rec.assistantNote') }));
    showStep('result');
    VTN.ui.announce(t('rec.resultOk'));
  }

  function renderPending(rec, code) {
    resetResult();
    steps.result.appendChild(headLine('fa-circle-exclamation', t('rec.resultPending'), '#B55443'));
    steps.result.appendChild(U.node('p', {
      class: 'vtn-rec-desc',
      text: t('err.' + code, { status: rec.errorCode || '', url: VTN.api.base() })
    }));
    steps.result.appendChild(U.node('p', {
      class: 'vtn-rec-note',
      text: t('rec.pendingSaved', { time: U.fmtTime(rec.durationSec) })
    }));

    var retry = U.node('button', { class: 'vtn-rec-btn vtn-rec-btn--primary', type: 'button' });
    retry.innerHTML = '<i class="fa-solid fa-rotate-right" aria-hidden="true"></i><span>' +
      U.escapeHtml(t('rec.retry')) + '</span>';
    retry.addEventListener('click', function () { uploadRecord(rec); });
    steps.result.appendChild(retry);

    var go = U.node('button', { class: 'vtn-rec-btn vtn-rec-btn--ghost', type: 'button', text: t('rec.goPending') });
    go.addEventListener('click', function () {
      close();
      VTN.router.go('recording', { tab: 'pending' });
    });
    steps.result.appendChild(go);
    showStep('result');
  }

  function headLine(icon, text, color) {
    var head = U.node('div', { class: 'vtn-rec-result-head' });
    head.innerHTML = '<i class="fa-solid ' + icon + '" style="color:' + color + '" aria-hidden="true"></i><span></span>';
    head.querySelector('span').textContent = text;
    return head;
  }

  /* 任務 3：草稿頁附加照片／影片（前端 Mock，僅本地預覽，不真正上傳） */
  function buildAttachBlock() {
    var wrap = U.node('div', { class: 'rec-media-attach' });
    var addBtn = U.node('button', { class: 'rec-media-attach__btn', type: 'button' });
    addBtn.innerHTML = '<i class="fa-solid fa-camera" aria-hidden="true"></i><span>' +
      U.escapeHtml(t('rec.attachMedia')) + '</span>';
    var input = U.node('input', { type: 'file', accept: 'image/*,video/*', class: 'rec-media-attach__input', hidden: 'hidden' });
    var preview = U.node('div', { class: 'rec-media-attach__preview', hidden: 'hidden' });
    var mediaSlot = U.node('div', { class: 'rec-media-attach__media' });
    var name = U.node('span', { class: 'rec-media-attach__name' });
    var remove = U.node('button', { class: 'rec-media-attach__remove', type: 'button', 'aria-label': t('rec.attachRemove') });
    remove.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    var note = U.node('p', { class: 'rec-media-attach__note', hidden: 'hidden', text: t('rec.attachAdded') });
    note.setAttribute('data-i18n', 'rec.attachAdded');

    preview.appendChild(mediaSlot);
    preview.appendChild(name);
    preview.appendChild(remove);
    wrap.appendChild(addBtn);
    wrap.appendChild(input);
    wrap.appendChild(preview);
    wrap.appendChild(note);

    addBtn.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      if (state.attachUrl) { try { URL.revokeObjectURL(state.attachUrl); } catch (e) { /* ignore */ } }
      state.attachMedia = { name: file.name, kind: file.type.indexOf('video') === 0 ? 'video' : 'image' };
      state.attachUrl = URL.createObjectURL(file);
      mediaSlot.textContent = '';
      if (state.attachMedia.kind === 'video') {
        mediaSlot.appendChild(U.node('video', {
          class: 'rec-media-attach__thumb', src: state.attachUrl, controls: 'controls'
        }));
      } else {
        mediaSlot.appendChild(U.node('img', { class: 'rec-media-attach__thumb', src: state.attachUrl, alt: file.name }));
      }
      name.textContent = file.name;
      preview.hidden = false;
      note.hidden = false;
    });
    remove.addEventListener('click', function () {
      if (state.attachUrl) { try { URL.revokeObjectURL(state.attachUrl); } catch (e) { /* ignore */ } }
      state.attachMedia = null; state.attachUrl = null;
      input.value = '';
      mediaSlot.textContent = '';
      preview.hidden = true;
      note.hidden = true;
    });
    return wrap;
  }

  /* 任務 4：錄製審核區的整體置信度徽章（復用 30-stories 的視覺，但自帶最小實作） */
  function recConfidenceBadge(avg) {
    var level = avg == null ? 'none' : (avg >= 0.8 ? 'high' : (avg >= 0.5 ? 'mid' : 'low'));
    var key = 'conf.' + level;
    var b = U.node('span', { class: 'confidence-badge confidence-badge--' + level, text: t(key) });
    b.setAttribute('data-i18n', key);
    return b;
  }

  function wordCloud(words, scope) {
    var host = U.node('div', { class: 'vtn-rec-words' });
    words.slice(0, 160).forEach(function (word) {
      var low = typeof word.confidence === 'number' && word.confidence < 0.75;
      var chip = U.node('button', { class: 'vtn-rec-word' + (low ? ' is-low' : ''), type: 'button', text: word.word });
      if (low) {
        chip.setAttribute('title', t('conf.tooltip'));
        chip.setAttribute('data-i18n-title', 'conf.tooltip');
      }
      chip.appendChild(U.node('span', { class: 'w-t', text: U.fmtTime(word.start) }));
      chip.addEventListener('click', function () {
        var audio = scope.querySelector('audio');
        if (audio) VTN.audio.seekPlay(audio, word.start);
      });
      host.appendChild(chip);
    });
    return host;
  }

  /* =========================================================================
   * 6. 示範故事（離線也可跑完整流程）
   * ======================================================================= */
  function runDemo() {
    var story = VTN.stories.get('YL-001');
    if (!story) { VTN.ui.toast(t('rec.demoMissing'), 'error'); return; }
    var existing = VTN.store.records.list().filter(function (r) {
      return r.source === 'demo' && r.storyId === story.id;
    })[0];

    var rec = {
      id: existing ? existing.id : 'REC-DEMO-' + story.id,
      createdAt: existing ? existing.createdAt : Date.now(),
      source: 'demo',
      storyId: story.id,
      status: 'done',
      scope: VTN.store.scopeOf(story),
      audioUrl: story.audio,
      durationSec: story.durationSec,
      durationSource: story.durationSource,
      mime: 'audio/wav',
      rawText: (story.segments || []).map(function (s) { return s.text; }).join(' '),
      formalText: (story.segments || []).map(function (s) { return s.text; }).join(' '),
      words: [],
      qaList: [],
      confidenceSource: 'unavailable',
      rolePlayed: true,
      sync: 'local',
      consentRef: story.consentRef
    };
    var saved = VTN.store.records.save(rec);
    VTN.ui.toast(t('rec.demoDone'), 'success');
    close();
    VTN.router.go('recording', { tab: 'done' });
    applyQuotaWarning(saved.quota);
  }

  /* =========================================================================
   * 7. 對外 API
   * ======================================================================= */
  VTN.recorder = {
    open: open,
    close: close,
    uploadRecord: uploadRecord,
    renderPending: renderPending,
    normalizeWords: normalizeWords,
    runDemo: runDemo
  };

  document.addEventListener('DOMContentLoaded', function () {
    var trigger = document.getElementById('startRecordBtn');
    if (trigger) trigger.addEventListener('click', open);
  });
})();
