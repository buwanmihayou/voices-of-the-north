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

    var seg = U.node('div', { class: 'seg', role: 'group', 'data-i18n-aria': 'auth.modeAria' });
    seg.style.marginBottom = '12px';
    var emailBtn = U.node('button', {
      class: 'seg__btn is-active', type: 'button',
      'data-i18n': 'auth.emailTab', text: t('auth.emailTab')
    });
    var schoolBtn = U.node('button', {
      class: 'seg__btn', type: 'button',
      'data-i18n': 'auth.schoolTab', text: t('auth.schoolTab')
    });
    var mockBtn = U.node('button', {
      class: 'seg__btn', type: 'button',
      'data-i18n': 'auth.mockTab', text: t('auth.mockTab')
    });
    seg.appendChild(emailBtn);
    seg.appendChild(schoolBtn);
    seg.appendChild(mockBtn);
    body.appendChild(seg);

    var host = U.node('div');
    body.appendChild(host);
    var feedback = U.node('p', { class: 'vtn-modal__error', hidden: 'hidden' });
    body.appendChild(feedback);

    var adminLabel = U.node('label', { class: 'radio-card', style: 'margin-top:8px' });
    var adminInput = U.node('input', { type: 'checkbox' });
    adminLabel.appendChild(adminInput);
    var adminText = U.node('span');
    adminText.appendChild(U.node('span', {
      class: 'radio-card__title', 'data-i18n': 'auth.adminToggle', text: t('auth.adminToggle')
    }));
    adminText.appendChild(U.node('span', {
      class: 'radio-card__hint', 'data-i18n': 'auth.adminHint', text: t('auth.adminHint')
    }));
    adminLabel.appendChild(adminText);
    adminInput.addEventListener('change', function () {
      adminFlag = adminInput.checked;
      adminLabel.classList.toggle('is-active', adminFlag);
    });
    body.appendChild(adminLabel);

    var note = U.node('p', {
      class: 'vtn-modal__note', 'data-i18n': 'auth.privacyNote', text: t('auth.privacyNote')
    });
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
      mockBtn.classList.toggle('is-active', mode === 'mock');

      if (mode === 'email') {
        var emailField = U.node('div', { class: 'vtn-field' });
        emailField.appendChild(U.node('label', {
          class: 'vtn-field__label', 'data-i18n': 'auth.emailLabel', text: t('auth.emailLabel')
        }));
        var emailInput = U.node('input', {
          type: 'email', id: 'loginEmail', autocomplete: 'email',
          'data-i18n-ph': 'auth.emailPh', placeholder: t('auth.emailPh')
        });
        emailInput.value = '';
        emailField.appendChild(emailInput);
        host.appendChild(emailField);

        var codeField = U.node('div', { class: 'vtn-field' });
        codeField.appendChild(U.node('label', {
          class: 'vtn-field__label', 'data-i18n': 'auth.codeLabel', text: t('auth.codeLabel')
        }));
        var codeInput = U.node('input', {
          type: 'text', id: 'loginCode', inputmode: 'numeric', maxlength: '6',
          autocomplete: 'one-time-code',
          'data-i18n-ph': 'auth.codePh', placeholder: t('auth.codePh')
        });
        codeField.appendChild(codeInput);
        host.appendChild(codeField);

        var sendBtn = U.node('button', {
          class: 'vtn-btn vtn-btn--quiet vtn-btn--block', type: 'button',
          'data-i18n': 'auth.sendCode', text: t('auth.sendCode')
        });
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
      } else if (mode === 'school') {
        var schoolField = U.node('div', { class: 'vtn-field' });
        schoolField.appendChild(U.node('label', {
          class: 'vtn-field__label', 'data-i18n': 'auth.schoolLabel', text: t('auth.schoolLabel')
        }));
        schoolField.appendChild(U.node('input', {
          type: 'text', id: 'loginSchool', autocomplete: 'username',
          'data-i18n-ph': 'auth.schoolPh', placeholder: t('auth.schoolPh')
        }));
        host.appendChild(schoolField);

        var passField = U.node('div', { class: 'vtn-field' });
        passField.appendChild(U.node('label', {
          class: 'vtn-field__label', 'data-i18n': 'auth.passwordLabel', text: t('auth.passwordLabel')
        }));
        passField.appendChild(U.node('input', {
          type: 'password', id: 'loginPassword', autocomplete: 'current-password',
          'data-i18n-ph': 'auth.passwordPh', placeholder: t('auth.passwordPh')
        }));
        host.appendChild(passField);

        host.appendChild(U.node('p', {
          class: 'vtn-modal__note', 'data-i18n': 'auth.schoolNote', text: t('auth.schoolNote')
        }));
      } else {
        var mockUserField = U.node('div', { class: 'vtn-field' });
        mockUserField.appendChild(U.node('label', {
          class: 'vtn-field__label', 'data-i18n': 'auth.mockUserLabel', text: t('auth.mockUserLabel')
        }));
        mockUserField.appendChild(U.node('input', {
          type: 'text', id: 'loginMockUser', autocomplete: 'username',
          'data-i18n-ph': 'auth.mockUserPh', placeholder: t('auth.mockUserPh')
        }));
        host.appendChild(mockUserField);

        var mockPassField = U.node('div', { class: 'vtn-field' });
        mockPassField.appendChild(U.node('label', {
          class: 'vtn-field__label', 'data-i18n': 'auth.mockPassLabel', text: t('auth.mockPassLabel')
        }));
        mockPassField.appendChild(U.node('input', {
          type: 'password', id: 'loginMockPass', autocomplete: 'current-password',
          'data-i18n-ph': 'auth.mockPassPh', placeholder: t('auth.mockPassPh')
        }));
        host.appendChild(mockPassField);

        var fillBtn = U.node('button', {
          class: 'vtn-btn vtn-btn--quiet vtn-btn--block', type: 'button',
          'data-i18n': 'auth.mockFill', text: t('auth.mockFill')
        });
        fillBtn.addEventListener('click', function () {
          var userInput = document.getElementById('loginMockUser');
          var passInput = document.getElementById('loginMockPass');
          if (userInput) userInput.value = 'contributor';
          if (passInput) passInput.value = 'demo1234';
          feedback.hidden = true;
        });
        host.appendChild(fillBtn);

        host.appendChild(U.node('p', {
          class: 'vtn-modal__note', 'data-i18n': 'auth.mockNote', text: t('auth.mockNote')
        }));
      }
      var first = host.querySelector('input');
      if (first) first.focus();
    }

    emailBtn.addEventListener('click', function () { mode = 'email'; renderMode(); });
    schoolBtn.addEventListener('click', function () { mode = 'school'; renderMode(); });
    mockBtn.addEventListener('click', function () { mode = 'mock'; renderMode(); });
    renderMode();

    var dlg = VTN.ui.dialog({
      titleKey: 'auth.title',
      body: body,
      i18nRefresh: renderMode,
      actions: [
        { labelKey: 'common.cancel', kind: 'quiet' },
        {
          labelKey: 'auth.login',
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
            } else if (mode === 'school') {
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
            } else {
              /* 純前端 Mock：不呼叫任何 API，直接建立虛擬登入身份 */
              var mockUser = (document.getElementById('loginMockUser').value || '').trim();
              var mockPass = (document.getElementById('loginMockPass').value || '').trim();
              if (!mockUser || !mockPass) { showError(t('auth.mockRequired')); return; }
              finishLogin({
                email: mockUser.indexOf('@') !== -1 ? mockUser : mockUser + '@vtn.demo',
                name: mockUser,
                role: adminFlag ? 'admin' : 'member',
                token: 'local-demo',
                offline: true
              }, ctx);
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
      titleKey: 'auth.logout',
      messageKey: 'auth.logoutConfirm',
      messageVars: { email: session.email },
      noteKey: 'auth.logoutNote',
      confirmLabelKey: 'auth.logout',
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
  function makeScopeSelect(id, value, title, onChange) {
    var select = U.node('select', {
      id: id,
      'aria-label': t('privacy.selectAria', { title: title })
    }, VTN.SCOPES.map(function (scope) {
      return U.node('option', { value: scope, text: t(VTN.SCOPE_META[scope].labelKey) });
    }));
    select.value = value;
    select.addEventListener('change', function () { onChange(select.value); });
    return select;
  }

  function setItemScope(item, scope, rerender) {
    var saved = VTN.store.setScope(item, scope);
    if (saved === null) return;
    VTN.api.audit({ action: 'scope.change', targetId: item.id, to: saved })
      .catch(function () { /* 本機已有稽核 */ });
    VTN.ui.toast(t('scope.saved', { scope: t(VTN.SCOPE_META[saved].labelKey) }), 'success');
    if (rerender) rerender();
  }

  function openPrivacy() {
    var body = U.node('div');

    function renderPrivacyBody() {
      body.textContent = '';
      var items = ownItems();
      var preset = VTN.store.scopePreset();
      var exceptions = VTN.store.scopeExceptions(items);

      /* 兩句分開寫，避免「預設私人」與示範故事 community 互相矛盾 */
      body.appendChild(U.node('p', {
        class: 'vtn-modal__note', 'data-i18n': 'privacy.defaultNote', text: t('privacy.defaultNote')
      }));
      body.appendChild(U.node('p', {
        class: 'vtn-modal__note', 'data-i18n': 'privacy.demoNote', text: t('privacy.demoNote')
      }));
      body.appendChild(U.node('p', {
        'data-i18n': 'privacy.intro', text: t('privacy.intro')
      }));

      /* 頂部：一個預設分享範圍 */
      var presetBox = U.node('div', { class: 'privacy-preset' });
      presetBox.appendChild(U.node('label', {
        class: 'vtn-field__label', 'for': 'privacyPreset',
        'data-i18n': 'privacy.preset', text: t('privacy.preset')
      }));
      presetBox.appendChild(makeScopeSelect('privacyPreset', preset, t('privacy.preset'), function (value) {
        VTN.store.setScopePreset(value);
        VTN.ui.toast(t('scope.saved', { scope: t(VTN.SCOPE_META[value].labelKey) }), 'success');
        VTN.stories.render();
        renderPrivacyBody();
      }));
      presetBox.appendChild(U.node('p', {
        class: 'vtn-modal__note', 'data-i18n': 'privacy.presetHint', text: t('privacy.presetHint')
      }));
      body.appendChild(presetBox);

      /* 中部：摺疊的例外清單（列表區限高 50dvh） */
      var details = U.node('details', { class: 'privacy-exceptions' });
      details.appendChild(U.node('summary', {
        class: 'privacy-exceptions__summary',
        text: t('privacy.exceptions', { n: exceptions.length })
      }));
      details.appendChild(U.node('p', {
        class: 'vtn-modal__note', 'data-i18n': 'privacy.exceptionsHint',
        text: t('privacy.exceptionsHint')
      }));
      var list = U.node('div', { class: 'privacy-exceptions__list' });
      if (!exceptions.length) {
        list.appendChild(U.node('p', {
          class: 'vtn-modal__note', 'data-i18n': 'privacy.exceptionsEmpty',
          text: t('privacy.exceptionsEmpty')
        }));
      } else {
        exceptions.forEach(function (entry, index) {
          var item = entry.item;
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
          control.appendChild(makeScopeSelect(
            'privacyScope-' + index,
            VTN.store.scopeOf(item),
            titleOf(item),
            function (value) { setItemScope(item, value, renderPrivacyBody); }
          ));
          row.appendChild(control);
          list.appendChild(row);
        });
      }
      details.appendChild(list);
      body.appendChild(details);

      body.appendChild(U.node('p', {
        class: 'vtn-modal__note',
        text: t('privacy.auditNote', { version: VTN.config.consentPolicyVersion })
      }));
      body.appendChild(U.node('p', {
        class: 'vtn-modal__note', 'data-i18n': 'privacy.serverNote', text: t('privacy.serverNote')
      }));
      if (!items.length) {
        body.appendChild(U.node('p', {
          class: 'vtn-modal__note', 'data-i18n': 'privacy.empty', text: t('privacy.empty')
        }));
      }
    }

    renderPrivacyBody();

    VTN.ui.dialog({
      titleKey: 'privacy.title',
      body: body,
      actions: [
        {
          labelKey: 'privacy.resetExceptions', kind: 'quiet', keepOpen: true,
          onClick: function () {
            VTN.store.clearScopeExceptions();
            VTN.ui.toast(t('privacy.resetDone'), 'success');
            VTN.stories.render();
            renderPrivacyBody();
          }
        },
        {
          labelKey: 'privacy.applyAll', kind: 'gold', keepOpen: true,
          onClick: function () {
            var preset = VTN.store.scopePreset();
            ownItems().forEach(function (item) { VTN.store.setScope(item, preset); });
            VTN.api.audit({ action: 'scope.applyAll', to: preset })
              .catch(function () { /* 本機已有稽核 */ });
            VTN.ui.toast(t('privacy.applyAllDone', {
              scope: t(VTN.SCOPE_META[preset].labelKey)
            }), 'success');
            VTN.stories.render();
            renderPrivacyBody();
          }
        },
        { labelKey: 'common.done', kind: 'solid' }
      ],
      i18nRefresh: renderPrivacyBody,
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

    function renderPickerBody() {
      body.textContent = '';
      if (!items.length) {
        body.appendChild(U.node('p', {
          'data-i18n': 'correct.noTargets', text: t('correct.noTargets')
        }));
        return;
      }
      body.appendChild(U.node('p', {
        'data-i18n': 'correct.pickIntro', text: t('correct.pickIntro')
      }));
      var field = U.node('div', { class: 'vtn-field' });
      field.appendChild(U.node('label', {
        class: 'vtn-field__label', 'for': 'corrTarget',
        'data-i18n': 'correct.target', text: t('correct.target')
      }));
      var select = U.node('select', { id: 'corrTarget' }, items.map(function (item) {
        return U.node('option', {
          value: item.id,
          text: titleOf(item) + (isStory(item) ? t('correct.kindStory') : t('correct.kindRecord'))
        });
      }));
      field.appendChild(select);
      body.appendChild(field);
    }
    renderPickerBody();

    VTN.ui.dialog({
      titleKey: 'me.correction',
      body: body,
      i18nRefresh: renderPickerBody,
      actions: [
        { labelKey: 'common.cancel', kind: 'quiet' },
        {
          labelKey: 'common.next', kind: 'solid', onClick: function () {
            var select = document.getElementById('corrTarget');
            if (!select) return;
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
      class: 'vtn-modal__note', 'data-i18n': 'correct.demoNote', text: t('correct.demoNote')
    }));

    var target = U.node('div', { class: 'radio-card is-active' });
    target.style.cursor = 'default';
    var targetText = U.node('span');
    targetText.appendChild(U.node('span', { class: 'radio-card__title', text: titleOf(item) }));
    var hint = U.node('span', { class: 'radio-card__hint' }, [
      U.node('span', {
        'data-i18n': isStory(item) ? 'privacy.storyHint' : 'privacy.recordHint',
        text: isStory(item) ? t('privacy.storyHint') : t('privacy.recordHint')
      }),
      document.createTextNode('・' + item.id)
    ]);
    targetText.appendChild(hint);
    target.appendChild(targetText);
    body.appendChild(target);

    var fieldBox = U.node('div', { class: 'vtn-field' });
    fieldBox.appendChild(U.node('label', {
      class: 'vtn-field__label', 'data-i18n': 'correct.field', text: t('correct.field')
    }));
    var fieldSelect = U.node('select', { id: 'corrField' });
    [
      ['transcript', 'correct.fieldTranscript'],
      ['timestamp', 'correct.fieldTimestamp'],
      ['title', 'correct.fieldTitle'],
      ['other', 'correct.fieldOther']
    ].forEach(function (def) {
      fieldSelect.appendChild(U.node('option', {
        value: def[0], 'data-i18n': def[1], text: t(def[1])
      }));
    });
    fieldBox.appendChild(fieldSelect);
    body.appendChild(fieldBox);

    var currentBox = U.node('div', { class: 'vtn-field' });
    currentBox.appendChild(U.node('label', {
      class: 'vtn-field__label', 'data-i18n': 'correct.current', text: t('correct.current')
    }));
    var currentArea = U.node('textarea', { readonly: 'readonly', rows: '4' });
    currentArea.value = currentText(item) || '—';
    currentBox.appendChild(currentArea);
    body.appendChild(currentBox);

    var proposedBox = U.node('div', { class: 'vtn-field' });
    proposedBox.appendChild(U.node('label', {
      class: 'vtn-field__label', 'data-i18n': 'correct.proposed', text: t('correct.proposed')
    }));
    var proposedArea = U.node('textarea', {
      id: 'corrProposed', rows: '4',
      'data-i18n-ph': 'correct.proposedPh', placeholder: t('correct.proposedPh')
    });
    proposedBox.appendChild(proposedArea);
    body.appendChild(proposedBox);

    var reasonBox = U.node('div', { class: 'vtn-field' });
    reasonBox.appendChild(U.node('label', {
      class: 'vtn-field__label', 'data-i18n': 'correct.reason', text: t('correct.reason')
    }));
    var reasonInput = U.node('input', {
      type: 'text', id: 'corrReason',
      'data-i18n-ph': 'correct.reasonPh', placeholder: t('correct.reasonPh')
    });
    reasonBox.appendChild(reasonInput);
    body.appendChild(reasonBox);

    var feedback = U.node('p', { class: 'vtn-modal__error', hidden: 'hidden' });
    body.appendChild(feedback);

    /* 已提交的申請 */
    var existing = VTN.store.corrections.list().filter(function (c) { return c.targetId === item.id; });
    if (existing.length) {
      body.appendChild(U.node('p', {
        class: 'vtn-rec-subhead', 'data-i18n': 'correct.listTitle', text: t('correct.listTitle')
      }));
      existing.forEach(function (entry) {
        var row = U.node('div', { class: 'radio-card' });
        row.style.cursor = 'default';
        var info = U.node('span', { style: 'flex:1 1 auto;min-width:0' });
        info.appendChild(U.node('span', { class: 'radio-card__title' }, [
          U.node('span', {
            'data-i18n': 'correct.status.' + entry.status,
            text: t('correct.status.' + entry.status)
          }),
          document.createTextNode('・'),
          U.node('span', {
            'data-i18n': 'correct.field.' + (entry.field || 'other'),
            text: t('correct.field.' + (entry.field || 'other'))
          })
        ]));
        info.appendChild(U.node('span', {
          class: 'radio-card__hint',
          text: (entry.proposedText || '').slice(0, 80)
        }));
        row.appendChild(info);

        if (VTN.store.role() === 'admin' && entry.status === 'submitted') {
          var actions = U.node('span', { class: 'setting-row__control' });
          var approve = U.node('button', {
            class: 'vtn-btn vtn-btn--sm vtn-btn--solid', type: 'button',
            'data-i18n': 'correct.approve', text: t('correct.approve')
          });
          approve.addEventListener('click', function () {
            VTN.store.approveCorrection(entry.id, VTN.store.session().email);
            VTN.api.corrections.review(entry.id, true).catch(function () { /* 本機已記錄 */ });
            VTN.ui.toast(t('correct.approved'), 'success');
            dlg.close('approved');
            setTimeout(function () { openCorrection(VTN.store.records.get(item.id) || item); }, 260);
          });
          var reject = U.node('button', {
            class: 'vtn-btn vtn-btn--sm vtn-btn--danger', type: 'button',
            'data-i18n': 'correct.reject', text: t('correct.reject')
          });
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

    var versionRows = [];
    if (item.versions && item.versions.length) {
      body.appendChild(U.node('p', {
        class: 'vtn-rec-subhead', 'data-i18n': 'correct.versions', text: t('correct.versions')
      }));
      item.versions.slice().reverse().forEach(function (version) {
        var row = U.node('div', { class: 'vtn-rec-note' });
        versionRows.push({ el: row, version: version });
        body.appendChild(row);
      });
    }
    function renderVersionRows() {
      versionRows.forEach(function (pair) {
        pair.el.textContent = t('correct.versionLine', {
          v: pair.version.version,
          date: U.fmtDate(new Date(pair.version.at).getTime())
        }) + '　' + (pair.version.reason || '');
      });
    }
    renderVersionRows();

    var dlg = VTN.ui.dialog({
      titleKey: 'correct.title',
      body: body,
      i18nRefresh: renderVersionRows,
      actions: [
        { labelKey: 'common.cancel', kind: 'quiet' },
        {
          labelKey: 'correct.submit',
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
      titleKey: 'withdraw.title',
      messageKey: 'withdraw.message',
      noteKey: 'withdraw.note',
      confirmLabelKey: 'withdraw.confirm',
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

    function renderExportBody() {
      body.textContent = '';
      body.appendChild(U.node('p', {
        'data-i18n': 'export.intro', text: t('export.intro')
      }));
      body.appendChild(U.node('p', {
        class: 'vtn-modal__note', 'data-i18n': 'export.note', text: t('export.note')
      }));

      if (!records.length) {
        body.appendChild(U.node('p', {
          class: 'vtn-modal__note', 'data-i18n': 'export.empty', text: t('export.empty')
        }));
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
        var audioBtn = U.node('button', {
          class: 'vtn-btn vtn-btn--sm', type: 'button',
          'data-i18n': 'export.audio', text: t('export.audio')
        });
        audioBtn.addEventListener('click', function () { exportAudio(rec); });
        audioBtn.disabled = !(rec.audioDataURL || rec.audioUrl);
        var txtBtn = U.node('button', {
          class: 'vtn-btn vtn-btn--sm', type: 'button',
          'data-i18n': 'export.txt', text: t('export.txt')
        });
        txtBtn.addEventListener('click', function () {
          exportTranscript(rec);
          VTN.ui.toast(t('export.done'), 'success');
        });
        actions.appendChild(audioBtn);
        actions.appendChild(txtBtn);
        row.appendChild(actions);
        body.appendChild(row);
      });
    }
    renderExportBody();

    VTN.ui.dialog({
      titleKey: 'export.title',
      body: body,
      i18nRefresh: renderExportBody,
      actions: [
        { labelKey: 'common.close', kind: 'quiet' },
        {
          labelKey: 'export.allJson', kind: 'solid', onClick: function () {
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
  /* 保留既有呼叫入口，統一導向設定內的語言二級分頁。 */
  function openLanguage() {
    VTN.router.go('settings', { tab: 'language' });
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
