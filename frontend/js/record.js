/* =============================================================================
 * Voices of the North — 真實錄音 → 上傳轉寫流程（主頁「開始錄音」）
 * -----------------------------------------------------------------------------
 * 流程：
 *   準備（健康檢查 8000 服務）→ MediaRecorder 現場收音 → 試聽 →
 *   POST http://127.0.0.1:8000/api/process（multipart）→
 *   逐詞時間戳／書面稿／時間戳 QA → 存入 localStorage → 跳「我的錄音・已完成」。
 *
 * 誠實模式：
 *   - 服務回 mode="offline-demo"（無 GCP 憑證）：只可跑內置示範故事，
 *     卡片會明確標示「離線示範」，绝不把現場錄音冒充成已轉寫。
 *   - 現場錄音上傳遇到 503 STT_UNCONFIGURED：錄音會存為「待轉寫」，
 *     可保留稍後重試，並提供「用示範故事試跑」睇完整效果。
 *
 * 對外 API：window.VTNRecords（record.js 與 recording.js／助手共用）
 * ========================================================================== */

(function () {
  'use strict';

  var API_BASE = (window.VTN_API_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
  var STORE_KEY = 'vtn-records-v1';
  var MAX_RECORD_SEC = 180;
  var AUDIO_QUOTA_BYTES = 6 * 1024 * 1024;

  /* =========================================================================
   * 1. 儲存層
   * ======================================================================= */
  function loadAll() {
    try {
      var arr = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function persistAll(arr) {
    // 音訊總量超配额時，由最舊開始丟棄音訊 dataURL，但保留文字結果
    var audioBytes = 0;
    arr.slice().reverse().forEach(function (r) {
      var len = r.audioDataURL ? r.audioDataURL.length : 0;
      if (audioBytes + len > AUDIO_QUOTA_BYTES) { r.audioDataURL = undefined; }
      audioBytes += len;
    });
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(arr));
      return true;
    } catch (e) {
      // 配额仍爆：再清一次全部音訊
      arr.forEach(function (r) { r.audioDataURL = undefined; });
      try { localStorage.setItem(STORE_KEY, JSON.stringify(arr)); return true; }
      catch (e2) { return false; }
    }
  }
  function saveRecord(rec) {
    var arr = loadAll();
    var idx = -1;
    arr.forEach(function (r, i) { if (r.id === rec.id) idx = i; });
    if (idx >= 0) arr[idx] = rec; else arr.unshift(rec);
    persistAll(arr);
    return rec;
  }
  function removeRecord(id) {
    persistAll(loadAll().filter(function (r) { return r.id !== id; }));
  }
  function getRecord(id) {
    return loadAll().filter(function (r) { return r.id === id; })[0] || null;
  }

  var VTNRecords = {
    list: loadAll,
    get: getRecord,
    save: saveRecord,
    remove: removeRecord,
    API_BASE: API_BASE
  };
  window.VTNRecords = VTNRecords;

  /* =========================================================================
   * 2. 小工具
   * ======================================================================= */
  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtTime(sec) {
    var s = Math.max(0, Math.floor(sec || 0));
    return pad(Math.floor(s / 60)) + ':' + pad(s % 60);
  }
  function fmtDate(ts) {
    var d = new Date(ts);
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
           pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function recordTitle(rec) {
    var t = (rec.formalText || rec.rawText || '').trim();
    if (!t) return rec.source === 'demo' ? '示範故事・元朗・村落晨光' : '未命名錄音';
    return t.length > 26 ? t.slice(0, 26) + '…' : t;
  }
  function makeId() {
    return 'REC-' + Date.now().toString(36).toUpperCase() +
           Math.random().toString(36).slice(2, 5).toUpperCase();
  }

  /* =========================================================================
   * 3. 錄音抽屜（只在主頁掛載）
   * ======================================================================= */
  var startBtn = document.getElementById('startRecordBtn');
  if (startBtn) {
    /* ---------- 骨架 ---------- */
    var overlay = h('div', 'vtn-rec-overlay');
    overlay.setAttribute('aria-hidden', 'true');
    var sheet = h('div', 'vtn-rec-sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', '錄音與語音轉寫');

    var head = h('div', 'vtn-rec-sheet__head');
    var headTitles = h('div', 'vtn-rec-sheet__titles');
    headTitles.appendChild(h('p', 'vtn-rec-sheet__title', '開始錄音'));
    headTitles.appendChild(h('p', 'vtn-rec-sheet__sub', '原音為本・即時粵語轉寫・自動出處時間戳'));
    var btnClose = h('button', 'vtn-rec-sheet__close');
    btnClose.type = 'button';
    btnClose.setAttribute('aria-label', '關閉');
    btnClose.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    head.appendChild(headTitles);
    head.appendChild(btnClose);

    var body = h('div', 'vtn-rec-body');

    // 準備步
    var stepPrep = h('div', 'vtn-rec-step');
    var statusPill = h('span', 'vtn-rec-status vtn-rec-status--checking');
    statusPill.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>正在連接轉寫服務…</span>';
    stepPrep.appendChild(statusPill);
    stepPrep.appendChild(h('p', 'vtn-rec-lead', '講一段你記得嘅村落故事'));
    stepPrep.appendChild(h('p', 'vtn-rec-desc',
      '錄音會即場上傳到你電腦嘅轉寫服務（127.0.0.1:8000），用粵語語音辨識整理成文字，並自動標出時間戳出處。現場錄音只作暫時處理，唔會永久儲存。'));
    var micBtn = h('button', 'vtn-rec-mic');
    micBtn.type = 'button';
    micBtn.setAttribute('aria-label', '開始錄音');
    micBtn.innerHTML = '<i class="fa-solid fa-microphone" aria-hidden="true"></i>';
    stepPrep.appendChild(micBtn);
    var btnDemo = h('button', 'vtn-rec-btn vtn-rec-btn--ghost');
    btnDemo.type = 'button';
    btnDemo.innerHTML = '<i class="fa-solid fa-headphones" aria-hidden="true"></i>先聽示範故事';
    stepPrep.appendChild(btnDemo);
    var btnPrepDemo = h('button', 'vtn-rec-btn vtn-rec-btn--ghost');
    btnPrepDemo.type = 'button';
    btnPrepDemo.hidden = true;
    btnPrepDemo.innerHTML =
      '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>用示範故事試跑完整流程';
    stepPrep.appendChild(btnPrepDemo);
    btnPrepDemo.addEventListener('click', function () { runDemoStory(); });
    var prepNote = h('p', 'vtn-rec-note');
    prepNote.innerHTML = '<i class="fa-solid fa-shield-halved" aria-hidden="true"></i>' +
      '<span>未設定 Google Cloud 憑證時，服務進入「離線示範模式」：可試跑內置示範故事，現場錄音會先存為「待轉寫」，唔會冒充辨識結果。</span>';
    stepPrep.appendChild(prepNote);

    // 錄音步
    var stepRec = h('div', 'vtn-rec-step');
    stepRec.hidden = true;
    var liveMic = h('button', 'vtn-rec-mic is-live');
    liveMic.type = 'button';
    liveMic.setAttribute('aria-label', '停止錄音');
    liveMic.innerHTML = '<i class="fa-solid fa-stop" aria-hidden="true"></i>';
    stepRec.appendChild(liveMic);
    stepRec.appendChild(h('p', 'vtn-rec-timer', '00:00'));
    stepRec.appendChild(h('p', 'vtn-rec-hint-live', '正在收聽你嘅故事…輕觸圓鈕停止（最長 3 分鐘）'));
    var wave = h('div', 'vtn-rec-wave');
    for (var wi = 0; wi < 11; wi++) wave.appendChild(h('i'));
    stepRec.appendChild(wave);
    var btnCancelRec = h('button', 'vtn-rec-btn vtn-rec-btn--ghost', '取消錄音');
    btnCancelRec.type = 'button';
    stepRec.appendChild(btnCancelRec);

    // 試聽步
    var stepReview = h('div', 'vtn-rec-step');
    stepReview.hidden = true;
    stepReview.appendChild(h('p', 'vtn-rec-lead', '試聽確認'));
    stepReview.appendChild(h('p', 'vtn-rec-desc', '上傳前可以先聽一次，確認聲音清楚。'));
    var reviewAudio = h('audio', 'vtn-rec-audio');
    reviewAudio.controls = true;
    stepReview.appendChild(reviewAudio);
    var reviewMeta = h('div', 'vtn-rec-meta-row');
    reviewMeta.appendChild(h('span', 'vtn-rec-pill', '現場錄音'));
    var pillDur = h('span', 'vtn-rec-pill');
    reviewMeta.appendChild(pillDur);
    stepReview.appendChild(reviewMeta);
    var btnUpload = h('button', 'vtn-rec-btn vtn-rec-btn--primary');
    btnUpload.type = 'button';
    btnUpload.innerHTML = '<i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i>上傳並轉寫';
    stepReview.appendChild(btnUpload);
    var btnRerecord = h('button', 'vtn-rec-btn vtn-rec-btn--ghost', '重新錄一段');
    btnRerecord.type = 'button';
    stepReview.appendChild(btnRerecord);

    // 處理步
    var stepProcessing = h('div', 'vtn-rec-step');
    stepProcessing.hidden = true;
    stepProcessing.appendChild(h('p', 'vtn-rec-lead', '正在整理你嘅故事'));
    var stepsList = h('ul', 'vtn-rec-steps');
    [
      ['fa-link', '連接本地轉寫服務'],
      ['fa-language', '粵語語音辨識（逐詞時間戳）'],
      ['fa-wand-magic-sparkles', '書面化整理與問答萃取']
    ].forEach(function (s, i) {
      var li = h('li');
      var ico = h('span', 'step-ico');
      ico.innerHTML = '<i class="fa-solid ' + s[0] + '" aria-hidden="true"></i>';
      li.appendChild(ico);
      li.appendChild(h('span', null, s[1]));
      li._ico = ico;
      li._icoHtml = '<i class="fa-solid ' + s[0] + '" aria-hidden="true"></i>';
      stepsList.appendChild(li);
    });
    stepProcessing.appendChild(stepsList);

    // 結果步
    var stepResult = h('div', 'vtn-rec-step');
    stepResult.hidden = true;

    body.appendChild(stepPrep);
    body.appendChild(stepRec);
    body.appendChild(stepReview);
    body.appendChild(stepProcessing);
    body.appendChild(stepResult);
    sheet.appendChild(head);
    sheet.appendChild(body);
    overlay.appendChild(sheet);

    /* ---------- 狀態 ---------- */
    var health = { checked: false, online: false, reason: '' };
    var mediaRecorder = null;
    var chunks = [];
    var blobUrl = null;
    var blobMime = '';
    var recDuration = 0;
    var recTimer = null;
    var recStartAt = 0;
    var currentBlob = null;
    var lastRecordId = null;

    function showStep(name) {
      [stepPrep, stepRec, stepReview, stepProcessing, stepResult]
        .forEach(function (s) { s.hidden = true; });
      ({
        prep: stepPrep,
        rec: stepRec,
        review: stepReview,
        processing: stepProcessing,
        result: stepResult
      })[name].hidden = false;
      if (name === 'prep') resetPrepDemoBtn();
    }

    /* 彈層掛喺 App 手機框（.app-shell）入面：以手機框做定位參照，
       絕對唔可以 append 去 body——否則桌面睇會變成覆蓋整個瀏覽器視窗。 */
    var shell = document.getElementById('appShell') || document.body;

    function syncNavHeight() {
      var navEl = shell.querySelector('.bottom-nav');
      if (!navEl) return;
      var h = navEl.getBoundingClientRect().height;
      if (h > 0) shell.style.setProperty('--vtn-nav-h', h + 'px');
    }

    function openSheet() {
      syncNavHeight();                        // 以導航實際高度留位
      shell.appendChild(overlay);
      shell.classList.add('is-modal-open');   // 鎖定背景頁滾動
      overlay.classList.add('is-open');
      overlay.setAttribute('aria-hidden', 'false');
      showStep('prep');
      if (!health.checked) checkHealth();
    }
    function closeSheet() {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
      shell.classList.remove('is-modal-open');
      stopRecording(true);
      setTimeout(function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 260);
    }

    function setPill(mode, html) {
      statusPill.className = 'vtn-rec-status vtn-rec-status--' + mode;
      statusPill.innerHTML = html;
    }

    function checkHealth() {
      setPill('checking',
        '<i class="fa-solid fa-circle-notch fa-spin"></i><span>正在連接轉寫服務…</span>');
      fetch(API_BASE + '/api/health', { signal: AbortSignal.timeout(4000) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          health.checked = true;
          health.online = !!j.stt_ready;
          health.reason = j.stt_reason || '';
          if (j.stt_ready) {
            setPill('online',
              '<i class="fa-solid fa-circle-check"></i><span>線上模式・Google 粵語語音辨識已就緒</span>');
            btnPrepDemo.hidden = true;
          } else {
            setPill('offline',
              '<i class="fa-solid fa-triangle-exclamation"></i><span>離線示範模式・現場錄音將存為待轉寫</span>');
            btnPrepDemo.hidden = false;
          }
        })
        .catch(function () {
          health.checked = true;
          health.online = false;
          health.reason = 'server-down';
          setPill('offline',
            '<i class="fa-solid fa-plug-circle-xmark"></i><span>未偵測到轉寫服務（請先啟動 python tools/server.py）</span>');
        });
    }

    /* ---------- MediaRecorder ---------- */
    function pickMime() {
      var cands = [
        'audio/webm;codecs=opus', 'audio/webm',
        'audio/ogg;codecs=opus', 'audio/mp4'
      ];
      for (var i = 0; i < cands.length; i++) {
        if (window.MediaRecorder && MediaRecorder.isTypeSupported(cands[i])) {
          return cands[i];
        }
      }
      return '';
    }
    function extOfMime(mime) {
      if (/webm/.test(mime)) return '.webm';
      if (/ogg/.test(mime)) return '.ogg';
      if (/mp4|aac/.test(mime)) return '.m4a';
      return '.audio';
    }

    function startRecording() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
        setPill('offline',
          '<i class="fa-solid fa-triangle-exclamation"></i><span>此瀏覽器不支援現場錄音，請用最新版 Chrome／Edge，並以 http://127.0.0.1 開啟</span>');
        return;
      }
      navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: true,
        noiseSuppression: true
      } }).then(function (stream) {
        chunks = [];
        var mime = pickMime();
        mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime })
                             : new MediaRecorder(stream);
        blobMime = mediaRecorder.mimeType || mime || 'audio/webm';
        mediaRecorder.addEventListener('dataavailable', function (e) {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        });
        mediaRecorder.addEventListener('stop', function () {
          stream.getTracks().forEach(function (t) { t.stop(); });
          currentBlob = new Blob(chunks, { type: blobMime });
          recDuration = (Date.now() - recStartAt) / 1000;
          enterReview();
        });
        mediaRecorder.start(250);
        recStartAt = Date.now();
        runTimer();
        showStep('rec');
      }).catch(function (err) {
        var msg = /denied|NotAllowed/.test(String(err))
          ? '麥克風權限被拒絕，請按瀏覽器網址列圖示允許麥克風。'
          : '未能啟動麥克風：' + (err && err.message ? err.message : err);
        setPill('offline',
          '<i class="fa-solid fa-triangle-exclamation"></i><span></span>');
        statusPill.querySelector('span').textContent = msg;
      });
    }

    function runTimer() {
      var el = stepRec.querySelector('.vtn-rec-timer');
      clearInterval(recTimer);
      recTimer = setInterval(function () {
        var t = (Date.now() - recStartAt) / 1000;
        el.textContent = fmtTime(t);
        if (t >= MAX_RECORD_SEC) stopRecording(false);
      }, 250);
    }

    function stopRecording(silent) {
      clearInterval(recTimer);
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try { mediaRecorder.stop(); } catch (e) { /* ignore */ }
      }
      if (silent) { mediaRecorder = null; chunks = []; currentBlob = null; }
    }

    function enterReview() {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(currentBlob);
      reviewAudio.src = blobUrl;
      pillDur.textContent = '長度 ' + fmtTime(recDuration);
      showStep('review');
    }

    /* ---------- 上傳 ---------- */
    function setStepState(idx, state) {
      var li = stepsList.children[idx];
      if (!li) return;
      li.classList.remove('is-active', 'is-done');
      if (state === 'active') li.classList.add('is-active');
      else if (state === 'done') li.classList.add('is-done');
      if (state === 'active') {
        li._ico.innerHTML = '<span class="vtn-rec-spinner" aria-hidden="true"></span>';
      } else if (state === 'done') {
        li._ico.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i>';
      } else if (li._icoHtml) {
        li._ico.innerHTML = li._icoHtml;
      }
    }

    function buildRecord(extra) {
      var rec = {
        id: extra.id || makeId(),
        createdAt: extra.createdAt || Date.now(),
        durationSec: extra.durationSec || 0,
        mime: extra.mime || '',
        source: extra.source || 'live',
        mode: extra.mode || 'online',
        status: extra.status || 'done',
        audioDataURL: extra.audioDataURL,
        audioUrl: extra.audioUrl,
        rawText: extra.rawText || '',
        words: extra.words || [],
        formalText: extra.formalText || '',
        qaList: extra.qaList || []
      };
      rec.title = recordTitle(rec);
      return rec;
    }

    function blobToDataURL(blob) {
      return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { resolve(null); };
      reader.readAsDataURL(blob);
      });
    }

    function uploadAndSave() {
      showStep('processing');
      setStepState(0, 'active');

      var fd = new FormData();
      var filename = 'recording' + extOfMime(blobMime);
      fd.append('file', currentBlob, filename);

      fetch(API_BASE + '/api/process', { method: 'POST', body: fd })
        .then(function (r) {
          setStepState(0, 'done');
          setStepState(1, 'active');
          if (!r.ok) {
            return r.json().catch(function () { return null; }).then(function (j) {
              var err = new Error('HTTP ' + r.status);
              err.status = r.status;
              err.detail = j && j.detail ? j.detail : null;
              throw err;
            });
          }
          return r.json();
        })
        .then(function (data) {
          setStepState(1, 'done');
          setStepState(2, 'active');
          return blobToDataURL(currentBlob).then(function (dataUrl) {
            var rec = buildRecord({
              durationSec: recDuration,
              mime: blobMime,
              source: 'live',
              mode: data.mode || 'online',
              audioDataURL: dataUrl || undefined,
              rawText: data.raw_text || '',
              words: data.words || [],
              formalText: (data.llm_result && data.llm_result.formal_text) || '',
              qaList: (data.llm_result && data.llm_result.qa_list) || []
            });
            saveRecord(rec);
            lastRecordId = rec.id;
            setStepState(2, 'done');
            renderResult(rec, true);
          });
        })
        .catch(function (err) {
          // 503：STT 未設定 → 誠實存為待轉寫，提供示範試跑
          if (err.status === 503 || health.reason === 'server-down') {
            return blobToDataURL(currentBlob).then(function (dataUrl) {
              var rec = buildRecord({
                status: 'pending',
                durationSec: recDuration,
                mime: blobMime,
                source: 'live',
                mode: 'offline',
                audioDataURL: dataUrl || undefined,
                rawText: '',
                formalText: '',
                qaList: []
              });
              saveRecord(rec);
              lastRecordId = rec.id;
              renderOffline(rec);
            });
          }
          setStepState(1, '');
          renderError('網絡唔太順利，轉寫未完成。你嘅錄音未被保存，請重試。',
            function () { showStep('review'); });
        });
    }

    function runDemoStory() {
      // 按鈕 loading 回饋（請求完進入處理步，返回準備頁時復原）
      btnPrepDemo.disabled = true;
      btnPrepDemo.innerHTML =
        '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>示範故事整理中…';
      showStep('processing');
      setStepState(0, 'active');
      fetch(API_BASE + '/api/process', { method: 'POST' })
        .then(function (r) {
          setStepState(0, 'done');
          setStepState(1, 'active');
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (data) {
          setStepState(1, 'done');
          setStepState(2, 'active');
          var existing = loadAll().filter(function (r) { return r.source === 'demo'; })[0];
          var rec = buildRecord({
            id: existing ? existing.id : undefined,
            source: 'demo',
            mode: data.mode || 'offline-demo',
            audioUrl: 'assets/demo-story.m4a',
            durationSec: 50.7,
            rawText: data.raw_text || '',
            words: data.words || [],
            formalText: (data.llm_result && data.llm_result.formal_text) || '',
            qaList: (data.llm_result && data.llm_result.qa_list) || []
          });
          saveRecord(rec);
          lastRecordId = rec.id;
          setStepState(2, 'done');
          renderResult(rec, false);
        })
        .catch(function () {
          setStepState(0, '');
          resetPrepDemoBtn();
          renderError('轉寫服務未啟動。請先喺專案執行：python tools\\server.py（埠號 8000）。',
            function () { showStep('prep'); });
        });
    }

    function resetPrepDemoBtn() {
      btnPrepDemo.disabled = false;
      btnPrepDemo.innerHTML =
        '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>用示範故事試跑完整流程';
    }

    /* ---------- 結果畫面 ---------- */
    function resetSteps() {
      for (var i = 0; i < 3; i++) setStepState(i, '');
    }

    function renderResult(rec, isLive) {
      resetSteps();
      stepResult.textContent = '';

      var head2 = h('div', 'vtn-rec-result-head');
      head2.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#2C5742"></i><span></span>';
      head2.querySelector('span').textContent =
        isLive ? '轉寫完成・已存入「我的錄音」' : '示範故事整理完成';
      stepResult.appendChild(head2);

      var tags = h('div', 'vtn-rec-meta-row');
      tags.appendChild(h('span', 'vtn-rec-pill',
        rec.source === 'demo' ? '示範故事' : '現場錄音'));
      tags.appendChild(h('span', 'vtn-rec-pill',
        '模式：' + (rec.mode === 'online' ? '線上語音辨識' : '離線示範稿')));
      tags.appendChild(h('span', 'vtn-rec-pill', fmtTime(rec.durationSec)));
      stepResult.appendChild(tags);

      if (rec.formalText) {
        stepResult.appendChild(h('p', 'vtn-rec-subhead', '整理後文字稿'));
        stepResult.appendChild(h('p', 'vtn-rec-formal', rec.formalText));
      }

      if (rec.qaList.length) {
        stepResult.appendChild(h('p', 'vtn-rec-subhead', '時間戳問答（按時間可跳聽原音）'));
        var qaBox = h('div', 'vtn-rec-qa');
        rec.qaList.forEach(function (qa) {
          (function (qa) {
            var b = h('button');
            b.type = 'button';
            var q = h('span', 'qa-q', qa.question);
            var t = h('span', 'qa-t', fmtTime(qa.timestamp));
            b.appendChild(q);
            b.appendChild(t);
            b.addEventListener('click', function () {
              location.href = 'recording.html?t=' +
                encodeURIComponent(qa.timestamp) + '#rec-' + rec.id;
            });
            qaBox.appendChild(b);
          })(qa);
        });
        stepResult.appendChild(qaBox);
      }

      if (rec.words.length) {
        stepResult.appendChild(h('p', 'vtn-rec-subhead', '逐詞辨識（紅框為低置信度，可跳聽核對）'));
        var words = h('div', 'vtn-rec-words');
        rec.words.forEach(function (w) {
          (function (w) {
            var s = h('button', 'vtn-rec-word' + (w.confidence < 0.75 ? ' is-low' : ''));
            s.type = 'button';
            s.textContent = w.word;
            s.appendChild(h('span', 'w-t', fmtTime(w.start)));
            s.addEventListener('click', function () {
              location.href = 'recording.html?t=' +
                encodeURIComponent(w.start) + '#rec-' + rec.id;
            });
            words.appendChild(s);
          })(w);
        });
        stepResult.appendChild(words);
      }

      var go = h('button', 'vtn-rec-btn vtn-rec-btn--primary');
      go.type = 'button';
      go.innerHTML = '<i class="fa-solid fa-folder-open"></i>去「我的錄音」查看';
      go.addEventListener('click', function () {
        closeSheet();
        location.href = 'recording.html?done=' + encodeURIComponent(rec.id) + '#rec-' + rec.id;
      });
      stepResult.appendChild(go);

      var again = h('button', 'vtn-rec-btn vtn-rec-btn--ghost');
      again.type = 'button';
      again.textContent = isLive ? '再錄一段' : '返準備頁錄我嘅故事';
      again.addEventListener('click', function () { showStep('prep'); });
      stepResult.appendChild(again);

      var note = h('p', 'vtn-rec-note');
      note.innerHTML = '<i class="fa-solid fa-shield-halved"></i><span></span>';
      note.querySelector('span').textContent =
        '呢段文字已成為 Ask the Village 助手嘅可回答內容，答案只會引述呢段錄音並附時間戳出處。';
      stepResult.appendChild(note);

      showStep('result');
    }

    function renderOffline(pendingRec) {
      resetSteps();
      stepResult.textContent = '';

      var head2 = h('div', 'vtn-rec-result-head');
      head2.innerHTML = '<i class="fa-solid fa-circle-exclamation" style="color:#B55443"></i>' +
        '<span>錄音已保存為「待轉寫」</span>';
      stepResult.appendChild(head2);

      stepResult.appendChild(h('p', 'vtn-rec-desc',
        '而家未設定 Google Cloud 語音辨識憑證，系統唔會臆測你講咗啲乜。' +
        '設定憑證並重啟服務後，可於「我的錄音・待轉寫」一按重試；而家可以先用內置示範故事體驗完整效果。'));

      var tags = h('div', 'vtn-rec-meta-row');
      tags.appendChild(h('span', 'vtn-rec-pill--red vtn-rec-pill', '待轉寫'));
      tags.appendChild(h('span', 'vtn-rec-pill', fmtTime(pendingRec.durationSec)));
      stepResult.appendChild(tags);

      var demo = h('button', 'vtn-rec-btn vtn-rec-btn--gold');
      demo.type = 'button';
      demo.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i>用示範故事試跑完整流程';
      demo.addEventListener('click', runDemoStory);
      stepResult.appendChild(demo);

      var go = h('button', 'vtn-rec-btn vtn-rec-btn--ghost');
      go.type = 'button';
      go.textContent = '去「待轉寫」睇我嘅錄音';
      go.addEventListener('click', function () {
        closeSheet();
        location.href = 'recording.html?done=' + encodeURIComponent(pendingRec.id) +
          '&tab=pending#rec-' + pendingRec.id;
      });
      stepResult.appendChild(go);

      showStep('result');
    }

    function renderError(message, onBack) {
      resetSteps();
      stepResult.textContent = '';
      var head2 = h('div', 'vtn-rec-result-head');
      head2.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#B55443"></i>' +
        '<span>出現少少狀況</span>';
      stepResult.appendChild(head2);
      stepResult.appendChild(h('p', 'vtn-rec-desc', message));
      var b = h('button', 'vtn-rec-btn vtn-rec-btn--primary', '返轉頭');
      b.type = 'button';
      b.addEventListener('click', onBack);
      stepResult.appendChild(b);
      showStep('result');
    }

    /* ---------- 事件 ---------- */
    startBtn.addEventListener('click', openSheet);
    btnClose.addEventListener('click', closeSheet);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeSheet();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('is-open')) closeSheet();
    });
    micBtn.addEventListener('click', startRecording);
    liveMic.addEventListener('click', function () { stopRecording(false); });
    btnCancelRec.addEventListener('click', function () {
      stopRecording(true);
      showStep('prep');
    });
    btnUpload.addEventListener('click', uploadAndSave);
    btnRerecord.addEventListener('click', function () {
      currentBlob = null;
      startRecording();
    });
    btnDemo.addEventListener('click', function () {
      if (btnDemo.disabled) return;
      if (!window.VTNDemoAudio) return;
      // 播放中狀態回饋，先俾長者見到「播放緊」先關彈窗
      btnDemo.disabled = true;
      btnDemo.innerHTML =
        '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>播放緊示範故事…';
      window.VTNDemoAudio.play(0);
      setTimeout(function () {
        closeSheet();
        btnDemo.disabled = false;
        btnDemo.innerHTML =
          '<i class="fa-solid fa-headphones" aria-hidden="true"></i>先聽示範故事';
      }, 500);
    });
  }
})();
