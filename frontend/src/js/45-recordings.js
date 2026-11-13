/* =============================================================================
 * 45-recordings — 我的錄音：三個分頁、數量、重試、刪除、更正／撤回、匯出
 * -----------------------------------------------------------------------------
 * 全部分頁與數量由 VTN.store 的資料驅動，任何一處寫入後即時刷新（不用手動重整）。
 * 失敗文案一律講清原因同可否重試，並明確標示「已存於本機」。
 * ========================================================================== */

(function () {
  'use strict';

  var VTN = window.VTN;
  var U = VTN.util;

  var expanded = {};
  var currentTab = 'drafts';

  function t(key, vars) { return VTN.i18n.t(key, vars); }

  /* =========================================================================
   * 1. 分頁
   * ======================================================================= */
  var tabs = [];
  var panels = {};

  function initTabs() {
    var list = document.querySelector('.tabs[role="tablist"]');
    if (!list) return;
    tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));
    tabs.forEach(function (tab) {
      panels[tab.id] = document.getElementById(tab.getAttribute('aria-controls'));
      tab.addEventListener('click', function () { selectTab(tab, false, true); });
      tab.addEventListener('keydown', function (event) {
        var index = tabs.indexOf(tab);
        var next = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = tabs[(index + 1) % tabs.length];
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = tabs[(index - 1 + tabs.length) % tabs.length];
        else if (event.key === 'Home') next = tabs[0];
        else if (event.key === 'End') next = tabs[tabs.length - 1];
        if (next) { event.preventDefault(); selectTab(next, true, true); }
      });
    });
  }

  function selectTab(tab, focus, updateUrl) {
    tabs.forEach(function (item) {
      var selected = item === tab;
      item.classList.toggle('is-active', selected);
      item.setAttribute('aria-selected', selected ? 'true' : 'false');
      item.tabIndex = selected ? 0 : -1;
      var panel = panels[item.id];
      if (!panel) return;
      if (selected) {
        panel.hidden = false;
        requestAnimationFrame(function () { panel.classList.add('is-show'); });
      } else {
        panel.classList.remove('is-show');
        panel.hidden = true;
      }
    });
    currentTab = tab.id.replace('tab-', '');
    if (focus) tab.focus();
    if (updateUrl && VTN.router) {
      var params = { tab: currentTab === 'drafts' ? null : currentTab };
      VTN.router.replace('recording', params);
    }
  }

  function showTab(name) {
    var map = { drafts: 'tab-drafts', pending: 'tab-pending', done: 'tab-done' };
    var tab = document.getElementById(map[name] || 'tab-drafts');
    if (tab) selectTab(tab, false, false);
  }

  /* =========================================================================
   * 2. 卡片
   * ======================================================================= */
  function audioSource(rec) { return rec.audioDataURL || rec.audioUrl || ''; }

  function syncLabel(rec) {
    if (rec.sync === 'synced') return { text: t('sync.synced'), cls: 'vtn-rec-sync' };
    if (rec.sync === 'failed') return { text: t('sync.failedShort'), cls: 'vtn-rec-sync vtn-rec-sync--failed' };
    if (rec.sync === 'syncing') return { text: t('sync.syncing'), cls: 'vtn-rec-sync' };
    return { text: t('sync.local'), cls: 'vtn-rec-sync vtn-rec-sync--local' };
  }

  function statusIcon(rec) {
    if (rec.status === 'draft') return { cls: 'vtn-rec-card__icon vtn-rec-card__icon--draft', icon: 'fa-pen-ruler' };
    if (rec.status === 'pending') return { cls: 'vtn-rec-card__icon vtn-rec-card__icon--pending', icon: 'fa-hourglass-half' };
    return { cls: 'vtn-rec-card__icon', icon: 'fa-file-lines' };
  }

  function buildCard(rec) {
    var state = rec.status;
    var card = U.node('article', {
      class: 'vtn-rec-card' + (state === 'pending' ? ' is-pending' : ''),
      id: 'rec-' + rec.id
    });
    var iconDef = statusIcon(rec);
    var head = U.node('button', {
      class: 'vtn-rec-card__head',
      type: 'button',
      'aria-expanded': expanded[rec.id] ? 'true' : 'false'
    });
    var icon = U.node('span', { class: iconDef.cls });
    icon.innerHTML = '<i class="fa-solid ' + iconDef.icon + '" aria-hidden="true"></i>';
    var main = U.node('span', { class: 'vtn-rec-card__main' });
    main.appendChild(U.node('p', { class: 'vtn-rec-card__title', text: rec.title || t('rec.untitled') }));

    var meta = [U.fmtDate(rec.createdAt), U.fmtTime(rec.durationSec)];
    meta.push(rec.source === 'demo' ? t('rec.sourceDemo') : t('rec.sourceLive'));
    main.appendChild(U.node('p', { class: 'vtn-rec-card__meta', text: meta.join('　・　') }));

    if (rec.iconKey && VTN.recIcons) {
      var chosen = U.node('span', {
        class: 'vtn-rec-card__chosen', title: VTN.recIcons.labelOf(rec.iconKey)
      });
      chosen.innerHTML = '<i class="fa-solid ' + VTN.recIcons.iconOf(rec.iconKey) + '" aria-hidden="true"></i>';
      chosen.appendChild(U.node('span', { text: VTN.recIcons.labelOf(rec.iconKey) }));
      main.appendChild(chosen);
    }

    var sync = syncLabel(rec);
    main.appendChild(U.node('span', { class: sync.cls, text: sync.text }));
    var chevron = U.node('span', { class: 'vtn-rec-card__chevron' });
    chevron.innerHTML = '<i class="fa-solid fa-chevron-down" aria-hidden="true"></i>';
    head.appendChild(icon);
    head.appendChild(main);
    head.appendChild(chevron);
    card.appendChild(head);

    var body = U.node('div', { class: 'vtn-rec-card__body' });
    body.hidden = !expanded[rec.id];
    card.appendChild(body);

    if (state === 'draft') renderDraftBody(rec, body);
    else if (state === 'pending') renderPendingBody(rec, body);
    else renderDoneBody(rec, body);

    if (VTN.recIcons) {
      body.appendChild(VTN.recIcons.build(rec.iconKey, function (key) {
        VTN.store.records.patch(rec.id, { iconKey: key });
        VTN.ui.toast(t('rec.iconSaved'), 'success');
      }));
    }

    head.addEventListener('click', function () {
      var open = body.hidden;
      body.hidden = !open;
      expanded[rec.id] = open;
      card.classList.toggle('is-open', open);
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    card._body = body;
    card._head = head;
    card._audio = body.querySelector('audio');
    return card;
  }

  function audioNode(rec) {
    var src = audioSource(rec);
    if (!src) return null;
    var audio = U.node('audio', { class: 'vtn-rec-audio', controls: 'controls', preload: 'none' });
    audio.src = src;
    VTN.audio.applyPrefs(audio);
    return audio;
  }

  function renderDraftBody(rec, body) {
    body.appendChild(U.node('p', { class: 'vtn-rec-desc', text: t('rec.draftBody') }));
    var audio = audioNode(rec);
    if (audio) body.appendChild(audio);
    else body.appendChild(U.node('p', { class: 'vtn-rec-missing-audio', text: t('rec.audioDropped') }));

    var actions = U.node('div', { class: 'vtn-rec-card__actions' });
    var upload = U.node('button', { class: 'vtn-rec-card__retry', type: 'button', text: t('rec.upload') });
    upload.addEventListener('click', function () { retryUpload(rec, upload); });
    upload.disabled = !audioSource(rec);
    var remove = U.node('button', { class: 'vtn-rec-card__remove', type: 'button', text: t('rec.deleteDraft') });
    remove.addEventListener('click', function () { removeRecord(rec); });
    actions.appendChild(upload);
    actions.appendChild(remove);
    body.appendChild(actions);
  }

  function renderPendingBody(rec, body) {
    var code = rec.errorCode || 'network';
    body.appendChild(U.node('p', { class: 'vtn-rec-desc', text: t('err.' + code, {
      status: rec.errorCode || '', url: VTN.api.base()
    }) }));
    body.appendChild(U.node('p', { class: 'vtn-rec-note', text: t('rec.pendingBody') }));

    var audio = audioNode(rec);
    if (audio) body.appendChild(audio);
    else body.appendChild(U.node('p', { class: 'vtn-rec-missing-audio', text: t('rec.audioDropped') }));

    var actions = U.node('div', { class: 'vtn-rec-card__actions' });
    var retry = U.node('button', { class: 'vtn-rec-card__retry', type: 'button', text: t('rec.retry') });
    retry.disabled = !audioSource(rec);
    retry.addEventListener('click', function () { retryUpload(rec, retry); });
    var remove = U.node('button', { class: 'vtn-rec-card__remove', type: 'button', text: t('common.delete') });
    remove.addEventListener('click', function () { removeRecord(rec); });
    actions.appendChild(retry);
    actions.appendChild(remove);
    body.appendChild(actions);
  }

  function renderDoneBody(rec, body) {
    var tags = U.node('div', { class: 'vtn-rec-card__tags' });
    tags.appendChild(U.node('span', { class: 'vtn-rec-pill', text: rec.source === 'demo' ? t('rec.sourceDemo') : t('rec.sourceLive') }));
    tags.appendChild(U.node('span', {
      class: 'vtn-rec-pill' + (rec.mode === 'online' ? '' : ' vtn-rec-pill--gold'),
      text: rec.mode === 'online' ? t('rec.modeOnline') : t('rec.modeOffline')
    }));
    tags.appendChild(U.node('span', { class: 'vtn-rec-pill', text: U.fmtTime(rec.durationSec) }));
    tags.appendChild(U.node('span', {
      class: 'vtn-rec-pill',
      text: t('scope.label', { scope: t(VTN.SCOPE_META[VTN.store.scopeOf(rec)].labelKey) })
    }));
    if (rec.rolePlayed) tags.appendChild(U.node('span', { class: 'vtn-rec-pill vtn-rec-pill--gold', text: t('story.rolePlayed') }));
    body.appendChild(tags);

    if (rec.audioDataURL) {
      body.appendChild(U.node('p', { class: 'vtn-rec-note', text: t('rec.audioLocalNote') }));
    } else if (rec.audioDropped) {
      body.appendChild(U.node('p', { class: 'vtn-rec-missing-audio', text: t('rec.audioDropped') }));
    }

    var audio = audioNode(rec);
    if (audio) body.appendChild(audio);

    if (rec.formalText) {
      body.appendChild(U.node('p', { class: 'vtn-rec-subhead', text: t('rec.formalTitle') }));
      body.appendChild(U.node('p', { class: 'vtn-rec-formal', text: rec.formalText }));
    }

    if (rec.versions && rec.versions.length) {
      var last = rec.versions[rec.versions.length - 1];
      body.appendChild(U.node('p', {
        class: 'vtn-rec-note',
        text: t('rec.versionNote', { v: last.version, date: U.fmtDate(new Date(last.at).getTime()) })
      }));
    }

    if (rec.qaList && rec.qaList.length) {
      body.appendChild(U.node('p', { class: 'vtn-rec-subhead', text: t('rec.qaTitle') }));
      var qaBox = U.node('div', { class: 'vtn-rec-qa' });
      rec.qaList.forEach(function (qa) {
        var btn = U.node('button', { type: 'button' });
        btn.appendChild(U.node('span', { class: 'qa-q', text: qa.question }));
        btn.appendChild(U.node('span', { class: 'qa-t', text: U.fmtTime(qa.timestamp) }));
        btn.addEventListener('click', function () {
          var el = body.querySelector('audio');
          if (el) VTN.audio.seekPlay(el, qa.timestamp);
        });
        qaBox.appendChild(btn);
      });
      body.appendChild(qaBox);
    }

    if (rec.words && rec.words.length) {
      body.appendChild(U.node('p', { class: 'vtn-rec-subhead', text: t('rec.wordTitle') }));
      var words = U.node('div', { class: 'vtn-rec-words' });
      rec.words.slice(0, 160).forEach(function (word) {
        var low = typeof word.confidence === 'number' && word.confidence < 0.75;
        var chip = U.node('button', { class: 'vtn-rec-word' + (low ? ' is-low' : ''), type: 'button', text: word.word });
        chip.appendChild(U.node('span', { class: 'w-t', text: U.fmtTime(word.start) }));
        chip.addEventListener('click', function () {
          var el = body.querySelector('audio');
          if (el) VTN.audio.seekPlay(el, word.start);
        });
        words.appendChild(chip);
      });
      body.appendChild(words);
      if (rec.confidenceSource !== 'provider') {
        body.appendChild(U.node('p', { class: 'vtn-rec-note', text: t('rec.confidenceUnavailable') }));
      }
    } else {
      body.appendChild(U.node('p', { class: 'vtn-rec-note', text: t('rec.noWords') }));
    }

    var actions = U.node('div', { class: 'vtn-rec-card__actions' });
    var scopeBtn = U.node('button', { class: 'vtn-rec-card__retry', type: 'button', text: t('story.scope') });
    scopeBtn.addEventListener('click', function () {
      VTN.stories.openScopeDialog(rec);
      /* 範圍改動會經 store 觸發刷新 */
    });
    var exportBtn = U.node('button', { class: 'vtn-rec-card__remove', type: 'button', text: t('export.one') });
    exportBtn.addEventListener('click', function () { exportRecord(rec); });
    actions.appendChild(scopeBtn);
    actions.appendChild(exportBtn);
    body.appendChild(actions);

    var actions2 = U.node('div', { class: 'vtn-rec-card__actions' });
    var correct = U.node('button', { class: 'vtn-rec-card__remove', type: 'button', text: t('story.correct') });
    correct.addEventListener('click', function () { if (VTN.account) VTN.account.openCorrection(rec); });
    var withdraw = U.node('button', { class: 'vtn-rec-card__remove', type: 'button', text: t('story.withdraw') });
    withdraw.addEventListener('click', function () { if (VTN.account) VTN.account.openWithdraw(rec); });
    actions2.appendChild(correct);
    actions2.appendChild(withdraw);
    body.appendChild(actions2);

    var actions3 = U.node('div', { class: 'vtn-rec-card__actions' });
    var del = U.node('button', { class: 'vtn-rec-card__remove', type: 'button', text: t('rec.deleteRecord') });
    del.addEventListener('click', function () { removeRecord(rec); });
    actions3.appendChild(del);
    body.appendChild(actions3);
  }

  /* =========================================================================
   * 3. 操作
   * ======================================================================= */
  function retryUpload(rec, btn) {
    if (btn) { btn.disabled = true; btn.textContent = t('rec.uploading'); }
    VTN.recorder.uploadRecord(rec, {
      onDone: function (updated) {
        VTN.ui.toast(t('rec.retryOk'), 'success');
        renderAll();
        if (updated) showTab('done');
      },
      onFail: function (pending, code) {
        VTN.ui.toast(t('err.' + code, { status: pending.errorCode || '', url: VTN.api.base() }), 'error');
        renderAll();
      }
    });
  }

  function removeRecord(rec) {
    VTN.ui.confirm({
      titleKey: 'delete.title',
      messageKey: rec.sync === 'synced' ? 'delete.confirmSynced' : 'delete.confirmLocal',
      noteKey: 'delete.note',
      confirmLabelKey: 'common.delete',
      cancelLabelKey: 'common.cancel',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      VTN.store.records.remove(rec.id);
      VTN.store.audit.log('record.delete', { id: rec.id, synced: rec.sync === 'synced' });
      renderAll();
      VTN.api.records.remove(rec.id).then(function () {
        VTN.ui.toast(t('delete.serverOk'), 'success');
      }).catch(function (error) {
        if (error && error.status === 404) {
          VTN.ui.toast(t('delete.localOnly'), 'success');
        } else {
          VTN.ui.toast(t('delete.serverFailed'), 'error');
        }
      });
    });
  }

  function exportRecord(rec) {
    var lines = [
      t('export.header'),
      'ID: ' + rec.id,
      t('export.time') + ': ' + U.fmtDate(rec.createdAt),
      t('export.duration') + ': ' + U.fmtTime(rec.durationSec) + ' (' + rec.durationSec + 's)',
      t('export.scope') + ': ' + t(VTN.SCOPE_META[VTN.store.scopeOf(rec)].labelKey),
      t('export.consent') + ': ' + (rec.consentRef || '—'),
      '',
      t('export.transcript') + ':',
      rec.formalText || rec.rawText || '—',
      ''
    ];
    if (rec.qaList && rec.qaList.length) {
      lines.push(t('export.qa') + ':');
      rec.qaList.forEach(function (qa) {
        lines.push('[' + U.fmtTime(qa.timestamp) + '] ' + qa.question + ' — ' + (qa.answer || ''));
      });
    }
    if (rec.words && rec.words.length) {
      lines.push('', t('export.words') + ':');
      lines.push(rec.words.map(function (w) {
        return w.word + '[' + w.start + 's' + (typeof w.confidence === 'number' ? ' c=' + w.confidence : '') + ']';
      }).join(' '));
    }

    U.download('vtn-' + rec.id + '.txt', new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
    var src = audioSource(rec);
    if (src) {
      var ext = rec.mime && /webm/.test(rec.mime) ? 'webm' : (/ogg/.test(rec.mime || '') ? 'ogg' : 'm4a');
      if (src.indexOf('data:') === 0) U.downloadDataUrl('vtn-' + rec.id + '.' + ext, src);
      else window.open(src, '_blank', 'noopener');
    }
    VTN.ui.toast(t('export.done'), 'success');
  }

  /* =========================================================================
   * 4. 渲染全部
   * ======================================================================= */
  function renderList(hostId, emptyId, list, status) {
    var host = document.getElementById(hostId);
    var empty = document.getElementById(emptyId);
    if (!host) return;
    host.textContent = '';
    list.forEach(function (rec) { host.appendChild(buildCard(rec)); });
    if (empty) empty.hidden = list.length > 0;
    var panel = host.parentNode;
    if (panel) panel.classList.toggle('has-list', list.length > 0);
  }

  function renderAll() {
    var all = VTN.store.records.list();
    var groups = {
      drafts: all.filter(function (r) { return r.status === 'draft'; }),
      pending: all.filter(function (r) { return r.status === 'pending'; }),
      done: all.filter(function (r) { return r.status === 'done'; })
    };

    renderList('recListDrafts', 'emptyDrafts', groups.drafts, 'draft');
    renderList('recListPending', 'emptyPending', groups.pending, 'pending');
    renderList('recListDone', 'emptyDone', groups.done, 'done');

    [
      ['countDrafts', groups.drafts.length],
      ['countPending', groups.pending.length],
      ['countDone', groups.done.length]
    ].forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (!el) return;
      el.textContent = pair[1];
      el.hidden = pair[1] === 0;
    });

    var note = document.getElementById('recStorageNote');
    if (note) {
      var count = groups.drafts.length + groups.pending.length + groups.done.length;
      var bytes = VTN.store.records.counts().audioBytes;
      note.hidden = count === 0;
      note.textContent = t('quota.usage', {
        n: count,
        mb: (bytes / (1024 * 1024)).toFixed(1)
      });
    }

    VTN.ui.announce(t('rec.countAnnounce', {
      draft: groups.drafts.length,
      pending: groups.pending.length,
      done: groups.done.length
    }));
  }

  /* =========================================================================
   * 5. 深鏈與事件
   * ======================================================================= */
  function handleParams(params) {
    if (!params) return;
    showTab(params.tab || 'drafts');
    if (params.rec) {
      setTimeout(function () {
        var card = document.getElementById('rec-' + params.rec);
        if (!card) return;
        if (card._body && card._body.hidden) card._head.click();
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('is-new');
        setTimeout(function () { card.classList.remove('is-new'); }, 2400);
        if (card._audio && params.t !== undefined) {
          VTN.audio.seekPlay(card._audio, Number(params.t) || 0);
        }
      }, 180);
    }
  }

  function init() {
    initTabs();
    renderAll();
    var onStore = function () { renderAll(); };
    U.on('vtn:store-changed', onStore);
    U.on('vtn:session-changed', onStore);
    window.addEventListener('storage', function (event) {
      if (event.key === VTN.KEYS.records) renderAll();
    });
  }

  VTN.recordings = {
    init: init,
    renderAll: renderAll,
    showTab: showTab,
    handleParams: handleParams,
    exportRecord: exportRecord,
    currentTab: function () { return currentTab; }
  };
})();
