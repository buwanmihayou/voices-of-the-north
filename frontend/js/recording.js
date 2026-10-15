/* =============================================================================
 * Voices of the North — 錄音管理頁（我的錄音）
 * 職責：
 *  1. 草稿／待轉寫／已完成三個分頁的切換（ARIA tabs，鍵盤可達）
 *  2. 渲染 record.js 存入 localStorage 嘅真實錄音（VTNRecords）：
 *     - 已完成：試聽原音、整理稿、時間戳 QA／逐詞跳聽、刪除
 *     - 待轉寫：離線模式保存嘅現場錄音，可一按重試上傳或移除
 *  3. 深鏈：?done=ID、?tab=pending、#rec-ID、?t=17.5（助手出處跳入即時播放）
 * 草稿維持誠實空狀態（唔自動生成）。
 * ========================================================================== */

(function () {
  'use strict';

  /* ---------- 小工具 ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
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
    return (d.getMonth() + 1) + ' 月 ' + d.getDate() + '日 ' +
           pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  var toastEl = $('#appToast');
  var toastText = $('#appToastText');
  var toastTimer = null;
  function showToast(message) {
    if (!toastEl || !toastText) return;
    toastText.textContent = message;
    toastEl.classList.remove('is-show');
    void toastEl.offsetWidth;
    toastEl.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-show'); }, 3200);
  }

  /* ---------- 分頁 ---------- */
  var tablist = $('.tabs[role="tablist"]');
  var tabs = tablist ? Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]')) : [];
  var selectTab = function () {};

  function initTabs() {
    if (!tablist) return;
    selectTab = function (tab, shouldFocus) {
      tabs.forEach(function (t) {
        var selected = t === tab;
        t.classList.toggle('is-active', selected);
        t.setAttribute('aria-selected', selected ? 'true' : 'false');
        t.tabIndex = selected ? 0 : -1;
        var panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) {
          if (selected) {
            panel.hidden = false;
            requestAnimationFrame(function () { panel.classList.add('is-show'); });
          } else {
            panel.classList.remove('is-show');
            panel.hidden = true;
          }
        }
      });
      if (shouldFocus) tab.focus();
    };

    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { selectTab(tab, false); });
      tab.addEventListener('keydown', function (e) {
        var next = null;
        if (e.key === 'ArrowRight' || e.key === 'Down') next = tabs[(i + 1) % tabs.length];
        else if (e.key === 'ArrowLeft' || e.key === 'Up') next = tabs[(i - 1 + tabs.length) % tabs.length];
        else if (e.key === 'Home') next = tabs[0];
        else if (e.key === 'End') next = tabs[tabs.length - 1];
        if (next) { e.preventDefault(); selectTab(next, true); }
      });
    });
  }

  /* =========================================================================
   * 錄音卡片
   * ======================================================================= */
  function audioSrc(rec) {
    return rec.audioDataURL || rec.audioUrl || '';
  }

  function seekPlay(audioEl, sec) {
    function go() {
      try { audioEl.currentTime = sec || 0; } catch (e) { /* ignore */ }
      var pr = audioEl.play();
      if (pr && pr.catch) pr.catch(function () {});
    }
    if (audioEl.readyState >= 1) go();
    else audioEl.addEventListener('loadedmetadata', go, { once: true });
  }

  function buildCard(rec, state) {
    var card = h('article', 'vtn-rec-card' + (state === 'pending' ? ' is-pending' : ''));
    card.id = 'rec-' + rec.id;

    var head = h('button', 'vtn-rec-card__head');
    head.type = 'button';
    head.setAttribute('aria-expanded', 'false');
    var icon = h('span', 'vtn-rec-card__icon' + (state === 'pending' ? ' vtn-rec-card__icon--pending' : ''));
    icon.innerHTML = '<i class="fa-solid ' +
      (state === 'pending' ? 'fa-hourglass-half' : 'fa-file-lines') + '" aria-hidden="true"></i>';
    var main = h('span', 'vtn-rec-card__main');
    main.appendChild(h('p', 'vtn-rec-card__title', rec.title || '未命名錄音'));
    var metaBits = [fmtDate(rec.createdAt)];
    if (rec.durationSec) metaBits.push(fmtTime(rec.durationSec));
    metaBits.push(rec.source === 'demo' ? '示範故事' : '我的現場錄音');
    if (state === 'done' && rec.mode === 'offline-demo') metaBits.push('離線示範稿');
    main.appendChild(h('p', 'vtn-rec-card__meta', metaBits.join('　・　')));
    var chev = h('span', 'vtn-rec-card__chevron');
    chev.innerHTML = '<i class="fa-solid fa-chevron-down" aria-hidden="true"></i>';
    head.appendChild(icon);
    head.appendChild(main);
    head.appendChild(chev);
    card.appendChild(head);

    var body = h('div', 'vtn-rec-card__body');
    body.hidden = true;
    card.appendChild(body);

    if (state === 'pending') {
      body.appendChild(h('p', 'vtn-rec-desc',
        '呢段錄音喺離線示範模式下保存，未經語音辨識。啟動轉寫服務並設定 Google Cloud 憑證後，可一按重試。'));
      var pa = h('audio', 'vtn-rec-audio');
      pa.controls = true;
      pa.src = audioSrc(rec);
      body.appendChild(pa);
      var actions = h('div', 'vtn-rec-card__actions');
      var retry = h('button', 'vtn-rec-card__retry', '重試上傳轉寫');
      retry.type = 'button';
      var remove = h('button', 'vtn-rec-card__remove', '移除');
      remove.type = 'button';
      actions.appendChild(retry);
      actions.appendChild(remove);
      body.appendChild(actions);

      retry.addEventListener('click', function () { retryUpload(rec, retry); });
      remove.addEventListener('click', function () {
        VTNRecords.remove(rec.id);
        renderAll();
        showToast('已移除該段待轉寫錄音。');
      });
    } else {
      var tags = h('div', 'vtn-rec-card__tags');
      tags.appendChild(h('span', 'vtn-rec-pill', rec.source === 'demo' ? '示範故事' : '現場錄音'));
      tags.appendChild(h('span', 'vtn-rec-pill' +
        (rec.mode === 'online' ? '' : ' vtn-rec-pill--gold'),
        rec.mode === 'online' ? '線上語音辨識' : '離線示範稿'));
      if (rec.durationSec) tags.appendChild(h('span', 'vtn-rec-pill', fmtTime(rec.durationSec)));
      body.appendChild(tags);

      var au = h('audio', 'vtn-rec-audio');
      au.controls = true;
      au.preload = 'none';
      au.src = audioSrc(rec);
      body.appendChild(au);

      if (rec.formalText) {
        body.appendChild(h('p', 'vtn-rec-subhead', '整理後文字稿'));
        body.appendChild(h('p', 'vtn-rec-formal', rec.formalText));
      }

      if (rec.qaList && rec.qaList.length) {
        body.appendChild(h('p', 'vtn-rec-subhead', '時間戳問答（按時間跳聽原音）'));
        var qaBox = h('div', 'vtn-rec-qa');
        rec.qaList.forEach(function (qa) {
          var b = h('button');
          b.type = 'button';
          b.appendChild(h('span', 'qa-q', qa.question));
          b.appendChild(h('span', 'qa-t', fmtTime(qa.timestamp)));
          b.addEventListener('click', function () {
            au.preload = 'metadata';
            au.src = audioSrc(rec);
            seekPlay(au, qa.timestamp);
          });
          qaBox.appendChild(b);
        });
        body.appendChild(qaBox);
      }

      if (rec.words && rec.words.length) {
        body.appendChild(h('p', 'vtn-rec-subhead', '逐詞辨識（紅字為低置信度）'));
        var words = h('div', 'vtn-rec-words');
        rec.words.slice(0, 120).forEach(function (w) {
          var s = h('button', 'vtn-rec-word' + (w.confidence < 0.75 ? ' is-low' : ''));
          s.type = 'button';
          s.textContent = w.word;
          s.appendChild(h('span', 'w-t', fmtTime(w.start)));
          s.addEventListener('click', function () {
            au.preload = 'metadata';
            au.src = audioSrc(rec);
            seekPlay(au, w.start);
          });
          words.appendChild(s);
        });
        body.appendChild(words);
      }

      var act2 = h('div', 'vtn-rec-card__actions');
      var del = h('button', 'vtn-rec-card__remove', '刪除呢段錄音');
      del.type = 'button';
      del.addEventListener('click', function () {
        VTNRecords.remove(rec.id);
        renderAll();
        showToast('已刪除錄音及其文字稿。');
      });
      act2.appendChild(del);
      body.appendChild(act2);
    }

    head.addEventListener('click', function () {
      var open = body.hidden;
      body.hidden = !open;
      card.classList.toggle('is-open', open);
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && !au_loadStarted(au || pa)) {
        (au || pa).preload = 'metadata';
      }
    });

    card._body = body;
    card._head = head;
    card._audio = au || pa;
    return card;
  }

  function au_loadStarted(audioEl) {
    return audioEl && audioEl.getAttribute('data-loaded') === '1';
  }

  /* ---------- 待轉寫重試 ---------- */
  function retryUpload(rec, btn) {
    if (!rec.audioDataURL) {
      showToast('音訊本體已被瀏覽器清理，請重新錄製。');
      return;
    }
    btn.disabled = true;
    btn.textContent = '上傳中…';
    fetch(VTNRecords.API_BASE + '/api/health')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.stt_ready) {
          var e = new Error('STT offline'); e.status = 503; throw e;
        }
        return fetch(rec.audioDataURL).then(function (r) { return r.blob(); });
      })
      .then(function (blob) {
        var fd = new FormData();
        fd.append('file', blob, 'retry' + (/webm/.test(rec.mime) ? '.webm' : '.m4a'));
        return fetch(VTNRecords.API_BASE + '/api/process', { method: 'POST', body: fd })
          .then(function (r) {
            if (!r.ok) { var e2 = new Error('HTTP ' + r.status); e2.status = r.status; throw e2; }
            return r.json();
          })
          .then(function (data) {
            var updated = {
              ...rec,
              status: 'done',
              mode: data.mode || 'online',
              rawText: data.raw_text || '',
              words: data.words || [],
              formalText: (data.llm_result && data.llm_result.formal_text) || '',
              qaList: (data.llm_result && data.llm_result.qa_list) || []
            };
            updated.title = (updated.formalText || '').slice(0, 26) +
              ((updated.formalText || '').length > 26 ? '…' : '');
            VTNRecords.save(updated);
            renderAll();
            showToast('轉寫完成，已移至「已完成」。');
          });
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = '重試上傳轉寫';
        if (err.status === 503) {
          showToast('轉寫服務仍係離線示範模式，啟用憑證後再試。');
        } else {
          showToast('連唔到轉寫服務，請確認 python tools/server.py 已啟動。');
        }
      });
  }

  /* ---------- 渲染 ---------- */
  function renderAll() {
    var records = (window.VTNRecords ? VTNRecords.list() : []);
    var pending = records.filter(function (r) { return r.status === 'pending'; });
    var done = records.filter(function (r) { return r.status !== 'pending'; });

    var listP = $('#recListPending');
    var listD = $('#recListDone');
    listP.textContent = '';
    listD.textContent = '';
    pending.forEach(function (r) { listP.appendChild(buildCard(r, 'pending')); });
    done.forEach(function (r) { listD.appendChild(buildCard(r, 'done')); });

    $('#emptyPending').hidden = pending.length > 0;
    $('#emptyDone').hidden = done.length > 0;
    var pp = $('#panel-pending');
    var pd = $('#panel-done');
    pp.classList.toggle('has-list', pending.length > 0);
    pd.classList.toggle('has-list', done.length > 0);

    var cP = $('#countPending');
    var cD = $('#countDone');
    cP.hidden = pending.length === 0; cP.textContent = pending.length;
    cD.hidden = done.length === 0; cD.textContent = done.length;

    return { pending: pending, done: done };
  }

  /* ---------- 深鏈：?done / ?tab / #rec-ID / ?t= ---------- */
  function handleDeepLink(groups) {
    var params = new URLSearchParams(location.search);
    var wantTab = params.get('tab');
    var doneId = params.get('done');
    var m = (location.hash || '').match(/#rec-(.+)$/);
    var recId = doneId || (m ? decodeURIComponent(m[1]) : null);
    var t = params.get('t');

    var targetGroup = null;
    if (recId) {
      targetGroup = groups.pending.some(function (r) { return r.id === recId; }) ? 'pending'
                  : groups.done.some(function (r) { return r.id === recId; }) ? 'done' : null;
    } else if (wantTab === 'pending') {
      targetGroup = 'pending';
    }
    if (targetGroup === 'pending') selectTab($('#tab-pending'), false);
    else if (targetGroup === 'done' || doneId) selectTab($('#tab-done'), false);

    if (recId) {
      setTimeout(function () {
        var card = document.getElementById('rec-' + recId);
        if (card) {
          if (card._body.hidden) card._head.click();
          card.classList.add('is-new');
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(function () { card.classList.remove('is-new'); }, 2600);
          if (t !== null && card._audio) {
            card._audio.preload = 'metadata';
            seekPlay(card._audio, parseFloat(t) || 0);
          }
        }
      }, 250);
    }
  }

  /* ---------- 底導航 ---------- */
  function initNav() {
    document.querySelectorAll('.bottom-nav__item').forEach(function (item) {
      item.addEventListener('click', function (e) {
        if (item.getAttribute('data-nav') === 'record') e.preventDefault();
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initTabs();
    initNav();
    var groups = renderAll();
    handleDeepLink(groups);
    // 喺其他分頁完成轉寫（或同一頁程式化更新儲存）後自動刷新清單
    window.addEventListener('storage', function (e) {
      if (e.key === 'vtn-records-v1') renderAll();
    });
    window.addEventListener('vtn:records-changed', function () { renderAll(); });
  });
})();
