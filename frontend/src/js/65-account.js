/* =============================================================================
 * 65-account — 身份、登入遷移、私隱、更正、撤回、匯出
 * -----------------------------------------------------------------------------
 * 第 8 項：訪客／成員／管理員三種身份；登入後把本機草稿與待轉寫遷移到帳戶，
 *         以 id 去重，唔會重複，亦唔會消失。管理員才可審核更正。
 * 第 6 項：每則故事可獨立設定私人／家人／社區／公開，預設私人；
 *         每次改動都寫同意記錄與稽核日誌，並嘗試同步伺服器。
 * 第 7 項：更正走「申請 → 審核 → 新版本」，原文保留；撤回即從故事庫、
 *         地圖、搜尋、建議問題、助手快取與分享連結移除。
 * ========================================================================== */

(function () {
  'use strict';

  var VTN = window.VTN;
  var U = VTN.util;

  function t(key, vars) { return VTN.i18n.t(key, vars); }
  function isStory(item) { return !!(item && item.segments); }
  function titleOf(item) { return item.title || item.formalText || item.id; }

  function currentText(item) {
    if (isStory(item)) {
      return (item.segments || []).map(function (segment) { return segment.text; }).join(' ');
    }
    return item.formalText || item.rawText || '';
  }

  function ownItems() {
    var records = VTN.store.records.list().filter(function (rec) { return rec.status === 'done'; });
    return records.concat(VTN.stories.visible());
  }

  /* =========================================================================
   * 1. 我的頁面
   * ======================================================================= */
  function renderMe() {
    var session = VTN.store.session();
    var role = session ? session.role : 'visitor';
    var roleEl = document.getElementById('accountRole');
    var idEl = document.getElementById('accountId');
    var action = document.getElementById('accountAction');
    var counts = VTN.store.records.counts();

    if (roleEl) roleEl.textContent = t('role.' + role);
    if (idEl) {
      idEl.textContent = session
        ? session.email + (session.school ? '　・　' + session.school : '')
        : t('me.visitorId');
    }
    if (action) action.textContent = session ? t('auth.logout') : t('auth.login');

    var saved = document.getElementById('statSaved');
    var pending = document.getElementById('statPending');
    var shared = document.getElementById('statShared');
    if (saved) saved.textContent = counts.done;
    if (pending) pending.textContent = counts.draft + counts.pending;
    if (shared) shared.textContent = counts.shared;

    var langEl = document.getElementById('meLanguageCurrent');
    if (langEl) langEl.textContent = t('lang.name.' + VTN.i18n.lang());
  }

  /* =========================================================================
   * 2. 登入
   * ======================================================================= */
  function openLogin() {
    var mode = 'email';
    var offlineCode = '';
    var codeSent = false;
    var adminFlag = false;

    var body = U.node('div');

    var seg = U.node('div', { class: 'seg', role: 'group', 'aria-label': t('auth.modeAria') });
    seg.style.marginBottom = '12px';
    var emailBtn = U.node('button', { class: 'seg__btn is-active', type: 'button', text: t('auth.emailTab') });
    var schoolBtn = U.node('button', { class: 'seg__btn', type: 'button', text: t('auth.schoolTab') });
    seg.appendChild(emailBtn);
    seg.appendChild(schoolBtn);
    body.appendChild(seg);

    var host = U.node('div');
    body.appendChild(host);
    var feedback = U.node('p', { class: 'vtn-modal__error', hidden: 'hidden' });
    body.appendChild(feedback);

    var adminLabel = U.node('label', { class: 'radio-card', style: 'margin-top:8px' });
    var adminInput = U.node('input', { type: 'checkbox' });
    adminLabel.appendChild(adminInput);
    var adminText = U.node('span');
    adminText.appendChild(U.node('span', { class: 'radio-card__title', text: t('auth.adminToggle') }));
    adminText.appendChild(U.node('span', { class: 'radio-card__hint', text: t('auth.adminHint') }));
    adminLabel.appendChild(adminText);
    adminInput.addEventListener('change', function () {
      adminFlag = adminInput.checked;
      adminLabel.classList.toggle('is-active', adminFlag);
    });
    body.appendChild(adminLabel);

    var note = U.node('p', { class: 'vtn-modal__note', text: t('auth.privacyNote') });
    body.appendChild(note);

    function showError(message) {
      feedback.textContent = message;
      feedback.hidden = false;
    }

    function renderMode() {
      host.textContent = '';
      feedback.hidden = true;
      emailBtn.classList.toggle('is-active', mode === 'email');
      schoolBtn.classList.toggle('is-active', mode === 'school');

      if (mode === 'email') {
        var emailField = U.node('div', { class: 'vtn-field' });
        emailField.appendChild(U.node('label', { class: 'vtn-field__label', text: t('auth.emailLabel') }));
        var emailInput = U.node('input', { type: 'email', id: 'loginEmail', autocomplete: 'email', placeholder: t('auth.emailPh') });
        emailInput.value = '';
        emailField.appendChild(emailInput);
        host.appendChild(emailField);

        var codeField = U.node('div', { class: 'vtn-field' });
        codeField.appendChild(U.node('label', { class: 'vtn-field__label', text: t('auth.codeLabel') }));
        var codeInput = U.node('input', {
          type: 'text', id: 'loginCode', inputmode: 'numeric', maxlength: '6',
          autocomplete: 'one-time-code', placeholder: t('auth.codePh')
        });
        codeField.appendChild(codeInput);
        host.appendChild(codeField);

        var sendBtn = U.node('button', { class: 'vtn-btn vtn-btn--quiet vtn-btn--block', type: 'button', text: t('auth.sendCode') });
        sendBtn.addEventListener('click', function () {
          var email = (document.getElementById('loginEmail').value || '').trim();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            showError(t('auth.invalidEmail'));
            return;
          }
          sendBtn.disabled = true;
          sendBtn.textContent = t('auth.sending');
          VTN.api.auth.requestCode(email).then(function (data) {
            codeSent = true;
            sendBtn.textContent = t('auth.codeSent');
            if (data && data.dev_code) {
              showError(t('auth.demoCode', { code: data.dev_code }));
              feedback.classList.remove('vtn-modal__error');
            }
          }).catch(function () {
            offlineCode = String(Math.floor(100000 + Math.random() * 900000));
            codeSent = true;
            sendBtn.disabled = false;
            sendBtn.textContent = t('auth.codeSent');
            showError(t('auth.offlineCode', { code: offlineCode }));
          }).then(function () {
            var code = document.getElementById('loginCode');
            if (code) code.focus();
          });
        });
        host.appendChild(sendBtn);
      } else {
        var schoolField = U.node('div', { class: 'vtn-field' });
        schoolField.appendChild(U.node('label', { class: 'vtn-field__label', text: t('auth.schoolLabel') }));
        schoolField.appendChild(U.node('input', { type: 'text', id: 'loginSchool', autocomplete: 'username', placeholder: t('auth.schoolPh') }));
        host.appendChild(schoolField);

        var passField = U.node('div', { class: 'vtn-field' });
        passField.appendChild(U.node('label', { class: 'vtn-field__label', text: t('auth.passwordLabel') }));
        passField.appendChild(U.node('input', { type: 'password', id: 'loginPassword', autocomplete: 'current-password', placeholder: t('auth.passwordPh') }));
        host.appendChild(passField);

        host.appendChild(U.node('p', { class: 'vtn-modal__note', text: t('auth.schoolNote') }));
      }
      var first = host.querySelector('input');
      if (first) first.focus();
    }

    emailBtn.addEventListener('click', function () { mode = 'email'; renderMode(); });
    schoolBtn.addEventListener('click', function () { mode = 'school'; renderMode(); });
    renderMode();

    var dlg = VTN.ui.dialog({
      title: t('auth.title'),
      body: body,
      actions: [
        { label: t('common.cancel'), kind: 'quiet' },
        {
          label: t('auth.login'),
          kind: 'solid',
          keepOpen: true,
          onClick: function (ctx) {
            feedback.hidden = true;
            if (mode === 'email') {
              var email = (document.getElementById('loginEmail').value || '').trim();
              var code = (document.getElementById('loginCode').value || '').trim();
              if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showError(t('auth.invalidEmail')); return; }
              if (!/^\d{6}$/.test(code)) { showError(t('auth.invalidCode')); return; }

              if (codeSent && offlineCode) {
                if (code !== offlineCode) { showError(t('auth.invalidCode')); return; }
                finishLogin({ email: email, role: adminFlag ? 'admin' : 'member', token: 'local-demo', offline: true }, ctx);
                return;
              }
              VTN.api.auth.verify({ email: email, code: code, admin: adminFlag })
                .then(function (data) { finishLogin(data, ctx); })
                .catch(function (error) {
                  if (error && error.offline) {
                    showError(t('auth.serverUnavailable', { url: VTN.api.base() }));
                  } else {
                    showError((error && error.detail) || t('auth.invalidCode'));
                  }
                });
            } else {
              var schoolId = (document.getElementById('loginSchool').value || '').trim();
              var password = (document.getElementById('loginPassword').value || '').trim();
              if (!schoolId || !password) { showError(t('auth.schoolRequired')); return; }
              VTN.api.auth.verify({ school_id: schoolId, password: password, admin: adminFlag })
                .then(function (data) { finishLogin(data, ctx); })
                .catch(function (error) {
                  if (error && error.offline) {
                    finishLogin({
                      email: schoolId.indexOf('@') !== -1 ? schoolId : schoolId + '@school.demo',
                      name: schoolId,
                      role: adminFlag ? 'admin' : 'member',
                      token: 'local-demo',
                      offline: true
                    }, ctx);
                    VTN.ui.toast(t('auth.offlineLogin'), 'error');
                  } else {
                    showError(t('auth.schoolInvalid'));
                  }
                });
            }
          }
        }
      ]
    });

    function finishLogin(data, ctx) {
      var email = data && (data.email || data.user_email);
      if (!email) email = (document.getElementById('loginEmail') && document.getElementById('loginEmail').value) || 'member@demo';
      email = String(email).trim().toLowerCase();
      var role = data && data.role ? data.role : (adminFlag ? 'admin' : 'member');
      if (VTN.ROLES.indexOf(role) === -1) role = 'member';

      var session = {
        email: email,
        name: (data && data.name) || email.split('@')[0],
        school: (data && data.school) || '',
        role: role,
        token: (data && data.token) || 'local-demo',
        offline: !(data && data.token),
        since: new Date().toISOString()
      };
      VTN.store.setSession(session);
      var migration = VTN.store.records.migrate(email);
      VTN.store.audit.log('auth.login', { email: email, role: role, offline: !!session.offline });

      if (ctx) ctx.close('login');
      renderMe();
      VTN.ui.toast(migration.migrated > 0
        ? t('auth.migrated', { n: migration.migrated })
        : t('auth.welcome', { name: session.name }), 'success');

      VTN.api.records.pull().then(function (result) {
        if (result && result.merged) {
          VTN.ui.toast(t('auth.synced', { n: result.merged }), 'success');
        }
        renderMe();
        if (VTN.recordings) VTN.recordings.renderAll();
      }).catch(function () { /* 離線時保留本機 */ });
    }
  }

  function openLogout() {
    var session = VTN.store.session();
    if (!session) return;
    VTN.ui.confirm({
      title: t('auth.logout'),
      message: t('auth.logoutConfirm', { email: session.email }),
      note: t('auth.logoutNote'),
      confirmLabel: t('auth.logout'),
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      VTN.store.audit.log('auth.logout', { email: session.email });
      VTN.store.clearSession();
      renderMe();
      if (VTN.recordings) VTN.recordings.renderAll();
      VTN.ui.toast(t('auth.logoutDone'), 'success');
    });
  }

  /* =========================================================================
   * 3. 私隱與分享範圍
   * ======================================================================= */
  function openPrivacy() {
    var body = U.node('div');
    body.appendChild(U.node('p', { text: t('privacy.intro') }));
    body.appendChild(U.node('p', { class: 'vtn-modal__note', text: t('privacy.serverNote') }));

    var items = ownItems();
    if (!items.length) {
      body.appendChild(U.node('p', { class: 'vtn-modal__note', text: t('privacy.empty') }));
    }

    items.forEach(function (item) {
      var row = U.node('div', { class: 'radio-card' });
      row.style.cursor = 'default';
      var text = U.node('span', { style: 'flex:1 1 auto;min-width:0' });
      text.appendChild(U.node('span', { class: 'radio-card__title', text: titleOf(item) }));
      text.appendChild(U.node('span', {
        class: 'radio-card__hint',
        text: isStory(item) ? t('privacy.storyHint') : t('privacy.recordHint')
      }));
      row.appendChild(text);

      var control = U.node('span', { class: 'setting-row__control' });
      var select = U.node('select', { 'aria-label': t('privacy.selectAria', { title: titleOf(item) }) });
      VTN.SCOPES.forEach(function (scope) {
        select.appendChild(U.node('option', {
          value: scope,
          text: t(VTN.SCOPE_META[scope].labelKey)
        }));
      });
      select.value = VTN.store.scopeOf(item);
      select.addEventListener('change', function () {
        var scope = VTN.store.setScope(item, select.value);
        VTN.api.audit({ action: 'scope.change', targetId: item.id, to: scope }).catch(function () { /* 本機已有稽核 */ });
        VTN.ui.toast(t('scope.saved', { scope: t(VTN.SCOPE_META[scope].labelKey) }), 'success');
      });
      control.appendChild(select);
      row.appendChild(control);
      body.appendChild(row);
    });

    body.appendChild(U.node('p', { class: 'vtn-modal__note', text: t('privacy.auditNote', {
      version: VTN.config.consentPolicyVersion
    }) }));

    VTN.ui.dialog({
      title: t('privacy.title'),
      body: body,
      actions: [{ label: t('common.done'), kind: 'solid' }],
      onClose: function () {
        VTN.stories.render();
        if (VTN.assistant) VTN.assistant.refresh();
      }
    });
  }

  /* =========================================================================
   * 4. 更正
   * ======================================================================= */
  function openCorrectionPicker() {
    var items = ownItems();
    var body = U.node('div');
    if (!items.length) {
      body.appendChild(U.node('p', { text: t('correct.noTargets') }));
      VTN.ui.dialog({ title: t('me.correction'), body: body, actions: [{ label: t('common.close'), kind: 'solid' }] });
      return;
    }
    body.appendChild(U.node('p', { text: t('correct.pickIntro') }));
    var field = U.node('div', { class: 'vtn-field' });
    field.appendChild(U.node('label', { class: 'vtn-field__label', text: t('correct.target') }));
    var select = U.node('select', { id: 'corrTarget' });
    items.forEach(function (item) {
      select.appendChild(U.node('option', {
        value: item.id,
        text: titleOf(item) + (isStory(item) ? t('correct.kindStory') : t('correct.kindRecord'))
      }));
    });
    field.appendChild(select);
    body.appendChild(field);

    VTN.ui.dialog({
      title: t('me.correction'),
      body: body,
      actions: [
        { label: t('common.cancel'), kind: 'quiet' },
        {
          label: t('common.next'), kind: 'solid', onClick: function () {
            var item = items.filter(function (it) { return it.id === select.value; })[0];
            if (item) setTimeout(function () { openCorrection(item); }, 240);
          }
        }
      ]
    });
  }

  function openCorrection(item) {
    var body = U.node('div');
    body.appendChild(U.node('p', {
      class: 'vtn-modal__note',
      text: t('correct.demoNote')
    }));

    var target = U.node('div', { class: 'radio-card is-active' });
    target.style.cursor = 'default';
    var targetText = U.node('span');
    targetText.appendChild(U.node('span', { class: 'radio-card__title', text: titleOf(item) }));
    targetText.appendChild(U.node('span', {
      class: 'radio-card__hint',
      text: (isStory(item) ? t('privacy.storyHint') : t('privacy.recordHint')) + '・' + item.id
    }));
    target.appendChild(targetText);
    body.appendChild(target);

    var fieldBox = U.node('div', { class: 'vtn-field' });
    fieldBox.appendChild(U.node('label', { class: 'vtn-field__label', text: t('correct.field') }));
    var fieldSelect = U.node('select', { id: 'corrField' });
    [
      ['transcript', t('correct.fieldTranscript')],
      ['timestamp', t('correct.fieldTimestamp')],
      ['title', t('correct.fieldTitle')],
      ['other', t('correct.fieldOther')]
    ].forEach(function (def) {
      fieldSelect.appendChild(U.node('option', { value: def[0], text: def[1] }));
    });
    fieldBox.appendChild(fieldSelect);
    body.appendChild(fieldBox);

    var currentBox = U.node('div', { class: 'vtn-field' });
    currentBox.appendChild(U.node('label', { class: 'vtn-field__label', text: t('correct.current') }));
    var currentArea = U.node('textarea', { readonly: 'readonly', rows: '4' });
    currentArea.value = currentText(item) || '—';
    currentBox.appendChild(currentArea);
    body.appendChild(currentBox);

    var proposedBox = U.node('div', { class: 'vtn-field' });
    proposedBox.appendChild(U.node('label', { class: 'vtn-field__label', text: t('correct.proposed') }));
    var proposedArea = U.node('textarea', { id: 'corrProposed', rows: '4', placeholder: t('correct.proposedPh') });
    proposedBox.appendChild(proposedArea);
    body.appendChild(proposedBox);

    var reasonBox = U.node('div', { class: 'vtn-field' });
    reasonBox.appendChild(U.node('label', { class: 'vtn-field__label', text: t('correct.reason') }));
    var reasonInput = U.node('input', { type: 'text', id: 'corrReason', placeholder: t('correct.reasonPh') });
    reasonBox.appendChild(reasonInput);
    body.appendChild(reasonBox);

    var feedback = U.node('p', { class: 'vtn-modal__error', hidden: 'hidden' });
    body.appendChild(feedback);

    /* 已提交的申請 */
    var existing = VTN.store.corrections.list().filter(function (c) { return c.targetId === item.id; });
    if (existing.length) {
      body.appendChild(U.node('p', { class: 'vtn-rec-subhead', text: t('correct.listTitle') }));
      existing.forEach(function (entry) {
        var row = U.node('div', { class: 'radio-card' });
        row.style.cursor = 'default';
        var info = U.node('span', { style: 'flex:1 1 auto;min-width:0' });
        info.appendChild(U.node('span', {
          class: 'radio-card__title',
          text: t('correct.status.' + entry.status) + '・' + t('correct.field.' + (entry.field || 'other'))
        }));
        info.appendChild(U.node('span', {
          class: 'radio-card__hint',
          text: (entry.proposedText || '').slice(0, 80)
        }));
        row.appendChild(info);

        if (VTN.store.role() === 'admin' && entry.status === 'submitted') {
          var actions = U.node('span', { class: 'setting-row__control' });
          var approve = U.node('button', { class: 'vtn-btn vtn-btn--sm vtn-btn--solid', type: 'button', text: t('correct.approve') });
          approve.addEventListener('click', function () {
            VTN.store.approveCorrection(entry.id, VTN.store.session().email);
            VTN.api.corrections.review(entry.id, true).catch(function () { /* 本機已記錄 */ });
            VTN.ui.toast(t('correct.approved'), 'success');
            dlg.close('approved');
            setTimeout(function () { openCorrection(VTN.store.records.get(item.id) || item); }, 260);
          });
          var reject = U.node('button', { class: 'vtn-btn vtn-btn--sm vtn-btn--danger', type: 'button', text: t('correct.reject') });
          reject.addEventListener('click', function () {
            VTN.store.rejectCorrection(entry.id, VTN.store.session().email, '');
            VTN.api.corrections.review(entry.id, false).catch(function () { /* 同上 */ });
            VTN.ui.toast(t('correct.rejected'), 'success');
            dlg.close('rejected');
            setTimeout(function () { openCorrection(item); }, 260);
          });
          actions.appendChild(approve);
          actions.appendChild(reject);
          row.appendChild(actions);
        }
        body.appendChild(row);
      });
    }

    if (item.versions && item.versions.length) {
      body.appendChild(U.node('p', { class: 'vtn-rec-subhead', text: t('correct.versions') }));
      item.versions.slice().reverse().forEach(function (version) {
        var row = U.node('div', { class: 'vtn-rec-note' });
        row.textContent = t('correct.versionLine', {
          v: version.version,
          date: U.fmtDate(new Date(version.at).getTime())
        }) + '　' + (version.reason || '');
        body.appendChild(row);
      });
    }

    var dlg = VTN.ui.dialog({
      title: t('correct.title'),
      body: body,
      actions: [
        { label: t('common.cancel'), kind: 'quiet' },
        {
          label: t('correct.submit'),
          kind: 'solid',
          keepOpen: true,
          onClick: function (ctx) {
            var proposed = (document.getElementById('corrProposed').value || '').trim();
            var reason = (document.getElementById('corrReason').value || '').trim();
            if (proposed.length < 2) {
              feedback.textContent = t('correct.needProposed');
              feedback.hidden = false;
              return;
            }
            if (proposed === currentText(item)) {
              feedback.textContent = t('correct.sameText');
              feedback.hidden = false;
              return;
            }
            var entry = VTN.store.corrections.add({
              targetId: item.id,
              targetTitle: titleOf(item),
              targetKind: isStory(item) ? 'story' : 'record',
              field: fieldSelect.value,
              currentText: currentText(item),
              proposedText: proposed,
              reason: reason
            });
            VTN.api.corrections.submit({
              target_id: item.id,
              field: entry.field,
              current_text: entry.currentText,
              proposed_text: proposed,
              reason: reason
            }).catch(function () { /* 離線保留本機申請 */ });
            ctx.close('submitted');
            VTN.ui.toast(t('correct.submitted'), 'success');
          }
        }
      ]
    });
  }

  /* =========================================================================
   * 5. 撤回
   * ======================================================================= */
  function openWithdraw(item) {
    var isRecord = !isStory(item);
    VTN.ui.confirm({
      title: t('withdraw.title'),
      message: t('withdraw.message'),
      note: t('withdraw.note'),
      confirmLabel: t('withdraw.confirm'),
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      VTN.store.withdrawn.add(item, '');
      VTN.api.withdraw(item.id).catch(function () { /* 示範故事未必存在於伺服器 */ });
      VTN.ui.toast(t('withdraw.done'), 'success');
      if (VTN.recordings) VTN.recordings.renderAll();
      if (VTN.stories) {
        VTN.stories.render();
        if (VTN.router && VTN.router.current().view === 'stories') {
          VTN.router.go('stories', {}, { replace: true });
        }
      }
      if (VTN.assistant) VTN.assistant.refresh();
      if (isRecord) VTN.ui.toast(t('withdraw.keptNote'), 'info');
    });
  }

  /* =========================================================================
   * 6. 匯出
   * ======================================================================= */
  function exportTranscript(rec) {
    var lines = [
      t('export.header'),
      'ID: ' + rec.id,
      t('export.time') + ': ' + U.fmtDate(rec.createdAt),
      t('export.duration') + ': ' + U.fmtTime(rec.durationSec),
      t('export.scope') + ': ' + t(VTN.SCOPE_META[VTN.store.scopeOf(rec)].labelKey),
      '',
      rec.formalText || rec.rawText || '—'
    ];
    U.download('vtn-' + rec.id + '.txt', new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
  }

  function exportAudio(rec, audioOverride) {
    var src = audioOverride || rec.audioDataURL || rec.audioUrl;
    if (!src) {
      VTN.ui.toast(t('export.noAudio'), 'error');
      return;
    }
    var ext = rec.mime && /webm/.test(rec.mime) ? 'webm' : (/ogg/.test(rec.mime || '') ? 'ogg' : 'm4a');
    if (src.indexOf('data:') === 0) U.downloadDataUrl('vtn-' + rec.id + '.' + ext, src);
    else window.open(src, '_blank', 'noopener');
  }

  function openExport() {
    var records = VTN.store.records.list();
    var body = U.node('div');
    body.appendChild(U.node('p', { text: t('export.intro') }));
    body.appendChild(U.node('p', { class: 'vtn-modal__note', text: t('export.note') }));

    if (!records.length) {
      body.appendChild(U.node('p', { class: 'vtn-modal__note', text: t('export.empty') }));
    }

    records.forEach(function (rec) {
      var row = U.node('div', { class: 'radio-card' });
      row.style.cursor = 'default';
      var info = U.node('span', { style: 'flex:1 1 auto;min-width:0' });
      info.appendChild(U.node('span', { class: 'radio-card__title', text: titleOf(rec) }));
      info.appendChild(U.node('span', {
        class: 'radio-card__hint',
        text: U.fmtDate(rec.createdAt) + '・' + U.fmtTime(rec.durationSec) + '・' +
          t('rec.status.' + rec.status)
      }));
      row.appendChild(info);
      var actions = U.node('span', { class: 'setting-row__control' });
      var audioBtn = U.node('button', { class: 'vtn-btn vtn-btn--sm', type: 'button', text: t('export.audio') });
      audioBtn.addEventListener('click', function () { exportAudio(rec); });
      audioBtn.disabled = !(rec.audioDataURL || rec.audioUrl);
      var txtBtn = U.node('button', { class: 'vtn-btn vtn-btn--sm', type: 'button', text: t('export.txt') });
      txtBtn.addEventListener('click', function () {
        exportTranscript(rec);
        VTN.ui.toast(t('export.done'), 'success');
      });
      actions.appendChild(audioBtn);
      actions.appendChild(txtBtn);
      row.appendChild(actions);
      body.appendChild(row);
    });

    VTN.ui.dialog({
      title: t('export.title'),
      body: body,
      actions: [
        { label: t('common.close'), kind: 'quiet' },
        {
          label: t('export.allJson'), kind: 'solid', onClick: function () {
            if (!records.length) { VTN.ui.toast(t('export.empty'), 'error'); return; }
            var payload = records.map(function (rec) {
              var copy = Object.assign({}, rec);
              if (copy.audioDataURL) {
                copy.audioIncludedSeparately = true;
                delete copy.audioDataURL;
              }
              return copy;
            });
            var bundle = {
              app: 'Voices of the North',
              version: VTN.config.version,
              exportedAt: new Date().toISOString(),
              consentPolicyVersion: VTN.config.consentPolicyVersion,
              records: payload,
              corrections: VTN.store.corrections.list(),
              consent: VTN.store.consent.list(),
              audit: VTN.store.audit.list()
            };
            U.download('vtn-export-' + Date.now() + '.json',
              new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' }));
            VTN.ui.toast(t('export.done'), 'success');
          }
        }
      ]
    });
  }

  /* =========================================================================
   * 7. 語言
   * ======================================================================= */
  function openLanguage() {
    var body = U.node('div');
    var current = VTN.i18n.lang();
    var options = [
      ['zh-HK', 'lang.name.zh-HK'],
      ['zh-CN', 'lang.name.zh-CN'],
      ['en', 'lang.name.en']
    ];
    options.forEach(function (def) {
      var btn = U.node('button', {
        class: 'lang-option' + (def[0] === current ? ' is-selected' : ''),
        type: 'button',
        'aria-pressed': def[0] === current ? 'true' : 'false'
      });
      btn.appendChild(U.node('span', { text: t(def[1]) }));
      btn.appendChild(U.node('span', { class: 'lang-option__check', text: def[0] === current ? '✓' : '' }));
      btn.addEventListener('click', function () {
        VTN.i18n.setLang(def[0]);
        VTN.store.setPref('lang', def[0]);
        renderMe();
        VTN.ui.toast(t('lang.switched'), 'success');
        if (VTN.assistant) VTN.assistant.refresh();
      });
      body.appendChild(btn);
    });
    body.appendChild(U.node('p', { class: 'vtn-modal__note', text: t('lang.note') }));

    VTN.ui.dialog({
      title: t('me.language'),
      body: body,
      actions: [{ label: t('common.close'), kind: 'solid' }]
    });
  }

  /* =========================================================================
   * 8. 初始化
   * ======================================================================= */
  function init() {
    renderMe();

    var action = document.getElementById('accountAction');
    if (action) {
      action.addEventListener('click', function () {
        if (VTN.store.session()) openLogout();
        else openLogin();
      });
    }

    var bind = function (id, fn) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };
    bind('meEntryRecordings', function () { VTN.router.go('recording', {}); });
    bind('meEntryPrivacy', openPrivacy);
    bind('meEntryCorrection', openCorrectionPicker);
    bind('meEntryExport', openExport);
    bind('meEntryLanguage', openLanguage);
    bind('meEntrySettings', function () { VTN.router.go('settings', {}); });
    bind('meEntryAbout', function () { VTN.router.go('about', {}); });

    U.on('vtn:session-changed', renderMe);
    U.on('vtn:store-changed', renderMe);
    U.on('vtn:prefs-changed', renderMe);
    U.on('vtn:lang-changed', renderMe);
  }

  VTN.account = {
    init: init,
    render: renderMe,
    openLogin: openLogin,
    openPrivacy: openPrivacy,
    openCorrection: openCorrection,
    openCorrectionPicker: openCorrectionPicker,
    openWithdraw: openWithdraw,
    openExport: openExport,
    openLanguage: openLanguage,
    exportAudio: exportAudio,
    exportTranscript: exportTranscript
  };
})();
