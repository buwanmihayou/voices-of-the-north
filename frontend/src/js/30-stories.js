/* =============================================================================
 * 30-stories — 故事庫：組合篩選、故事詳情、地圖聯動、來源跳轉、分享網址
 * -----------------------------------------------------------------------------
 * 資料唯一來源：data/stories.json（建置時內嵌成 window.VTN_STORY_DATA）。
 * 新增故事只改資料檔，不改這裡的頁面邏輯。
 *
 * 篩選規則（第 15 項）：
 *   不同類別 = AND；同一類別多選 = OR；關鍵詞為全文比對；
 *   排序與篩選狀態全部寫入網址，可分享。
 * ========================================================================== */

(function () {
  'use strict';

  var VTN = window.VTN;
  var U = VTN.util;
  var DATA = window.VTN_STORY_DATA || { stories: [], suggestedQuestions: [] };

  var state = {
    filters: { location: [], topic: [], era: [], language: [], keyword: '', sort: 'newest' },
    selectedId: null,
    overview: false,
    playingSegment: null,
    lastList: []
  };

  function t(key, vars) { return VTN.i18n.t(key, vars); }

  /* =========================================================================
   * 1. 資料存取與授權
   * ======================================================================= */
  function all() { return DATA.stories || []; }

  function get(id) {
    var base = all().filter(function (s) { return s.id === id; })[0] || null;
    if (!base) return null;
    var patch = VTN.store.storyPatch ? VTN.store.storyPatch(id) : null;
    if (patch && patch.versions && patch.versions.length) {
      var latest = patch.versions[patch.versions.length - 1];
      return Object.assign({}, base, {
        versions: patch.versions,
        correctedText: latest.formalText,
        correctedVersion: latest.version
      });
    }
    return base;
  }

  function isWithdrawn(story) { return VTN.store.withdrawn.is(story.id); }

  function visible() {
    var role = VTN.store.role();
    var me = VTN.store.ownerId();
    return all().filter(function (story) {
      if (isWithdrawn(story)) return false;
      return VTN.store.authorizedFor(story, role, me);
    });
  }

  function villageLabel(key) { return t('village.' + key); }
  function topicLabel(key) { return t('topic.' + key); }
  function eraLabel(key) { return t('era.' + key); }
  function languageLabel(key) { return t('lang.' + key); }

  function durationLabel(story) {
    var base = U.fmtTime(story.durationSec);
    return story.durationSource === 'transcript' ? base + ' ' + t('story.transcriptLength') : base;
  }

  /* =========================================================================
   * 2. 篩選
   * ======================================================================= */
  function toggleValue(group, value) {
    var list = state.filters[group];
    var index = list.indexOf(value);
    if (index === -1) list.push(value);
    else list.splice(index, 1);
    syncUrl();
    render();
  }

  function setKeyword(value) {
    state.filters.keyword = String(value || '').trim();
    syncUrl();
    render();
  }

  function setSort(value) {
    state.filters.sort = value || 'newest';
    syncUrl();
    render();
  }

  function clearFilters() {
    state.filters = { location: [], topic: [], era: [], language: [], keyword: '', sort: state.filters.sort };
    var search = document.getElementById('storySearch');
    if (search) search.value = '';
    syncUrl();
    render();
  }

  function activeCount() {
    var f = state.filters;
    return f.location.length + f.topic.length + f.era.length + f.language.length + (f.keyword ? 1 : 0);
  }

  function keywordHaystack(story) {
    var parts = [story.title, story.titleEn, story.teller, villageLabel(story.villageKey)];
    (story.topicKeys || []).forEach(function (k) { parts.push(topicLabel(k)); });
    parts.push(eraLabel(story.eraKey), languageLabel(story.languageKey));
    (story.segments || []).forEach(function (seg) { parts.push(seg.text); });
    return parts.join(' ').toLowerCase();
  }

  function matches(story) {
    var f = state.filters;
    if (f.location.length && f.location.indexOf(story.villageKey) === -1) return false;
    if (f.era.length && f.era.indexOf(story.eraKey) === -1) return false;
    if (f.language.length && f.language.indexOf(story.languageKey) === -1) return false;
    if (f.topic.length) {
      var hit = (story.topicKeys || []).some(function (k) { return f.topic.indexOf(k) !== -1; });
      if (!hit) return false;
    }
    if (f.keyword) {
      var needle = f.keyword.toLowerCase();
      if (keywordHaystack(story).indexOf(needle) === -1) return false;
    }
    return true;
  }

  function sorted(list) {
    var sort = state.filters.sort;
    return list.slice().sort(function (a, b) {
      if (sort === 'oldest') return String(a.publishedAt).localeCompare(String(b.publishedAt));
      if (sort === 'duration') return (b.durationSec || 0) - (a.durationSec || 0);
      if (sort === 'era') return String(a.eraKey).localeCompare(String(b.eraKey));
      if (sort === 'title') return String(a.title).localeCompare(String(b.title), 'zh-Hant');
      return String(b.publishedAt).localeCompare(String(a.publishedAt));
    });
  }

  function filtered() { return sorted(visible().filter(matches)); }

  function optionsFor(group) {
    var map = {};
    var order = [];
    visible().forEach(function (story) {
      var values = group === 'topic' ? (story.topicKeys || []) :
        group === 'location' ? [story.villageKey] :
          group === 'era' ? [story.eraKey] : [story.languageKey];
      values.forEach(function (value) {
        if (!map[value]) { map[value] = 0; order.push(value); }
        map[value]++;
      });
    });
    return order.map(function (value) { return { value: value, count: map[value] }; });
  }

  /* =========================================================================
   * 3. 網址同步與分享
   * ======================================================================= */
  function currentParams() {
    var f = state.filters;
    var params = {};
    if (f.location.length) params.loc = f.location.join(',');
    if (f.topic.length) params.topic = f.topic.join(',');
    if (f.era.length) params.era = f.era.join(',');
    if (f.language.length) params.lang = f.language.join(',');
    if (f.keyword) params.q = f.keyword;
    if (f.sort && f.sort !== 'newest') params.sort = f.sort;
    if (state.selectedId) params.story = state.selectedId;
    if (state.overview) params.map = 'overview';
    return params;
  }

  function syncUrl() {
    if (!VTN.router) return;
    VTN.router.replace('stories', currentParams());
  }

  function shareUrl(storyId, seconds) {
    var params = { story: storyId };
    if (typeof seconds === 'number' && isFinite(seconds)) params.t = Math.floor(seconds);
    var url = new URL(window.location.href);
    url.hash = VTN.router ? VTN.router.buildHash('stories', params) : '#stories?story=' + storyId;
    return url.toString();
  }

  function applyParams(params) {
    var f = state.filters;
    f.location = params.loc ? String(params.loc).split(',') : [];
    f.topic = params.topic ? String(params.topic).split(',') : [];
    f.era = params.era ? String(params.era).split(',') : [];
    f.language = params.lang ? String(params.lang).split(',') : [];
    f.keyword = params.q || '';
    f.sort = params.sort || 'newest';
    state.overview = params.map === 'overview';
    state.selectedId = params.story || null;

    var search = document.getElementById('storySearch');
    if (search && search.value !== f.keyword) search.value = f.keyword;
    var sortSelect = document.getElementById('filterSort');
    if (sortSelect) sortSelect.value = f.sort;
    if (params.story) VTN.router.go('stories', params, { replace: true, silent: true });
  }

  /* =========================================================================
   * 4. 選擇故事（含來源跳轉）
   * ======================================================================= */
  function select(storyId, options) {
    var opts = options || {};
    var story = get(storyId);
    if (!story || isWithdrawn(story)) {
      VTN.ui.toast(t('story.withdrawnSource'), 'error');
      return false;
    }
    state.selectedId = storyId;
    state.overview = false;

    if (opts.updateUrl !== false) {
      var params = currentParams();
      params.story = storyId;
      if (opts.t !== undefined && opts.t !== null) params.t = Math.floor(opts.t);
      else delete params.t;
      VTN.router.go('stories', params, { replace: opts.replace });
    }

    render();
    if (opts.focus !== false) {
      setTimeout(function () {
        var card = document.getElementById('storyDetail');
        if (card && !card.hidden) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 40);
    }
    if (opts.playAt !== undefined && opts.playAt !== null) {
      var ok = VTN.audio.playStory(storyId, opts.playAt);
      if (!ok) VTN.ui.toast(t('story.noAudio'), 'error');
    }
    return true;
  }

  function openSource(source) {
    if (!source || !source.storyId) return;
    if (VTN.store.withdrawn.is(source.storyId)) {
      VTN.ui.toast(t('story.withdrawnSource'), 'error');
      return;
    }
    var seconds = Number(source.start) || 0;
    VTN.router.go('stories', { story: source.storyId, t: Math.floor(seconds) });
  }

  /* =========================================================================
   * 5. 渲染：篩選晶片、摘要、結果數
   * ======================================================================= */
  function chip(label, value, group, pressed) {
    var btn = U.node('button', {
      class: 'chip' + (pressed ? ' is-active' : ''),
      type: 'button',
      'aria-pressed': pressed ? 'true' : 'false',
      'data-value': value,
      text: label
    });
    btn.addEventListener('click', function () { toggleValue(group, value); });
    return btn;
  }

  function renderFilterChips() {
    var groups = [
      ['filterLocation', 'location', villageLabel],
      ['filterTopic', 'topic', topicLabel],
      ['filterEra', 'era', eraLabel],
      ['filterLanguage', 'language', languageLabel]
    ];
    groups.forEach(function (def) {
      var host = document.getElementById(def[0]);
      if (!host) return;
      host.textContent = '';
      optionsFor(def[1]).forEach(function (opt) {
        host.appendChild(chip(def[2](opt.value), opt.value, def[1],
          state.filters[def[1]].indexOf(opt.value) !== -1));
      });
    });
  }

  function renderSummary() {
    var host = document.getElementById('filterSummary');
    var badge = document.getElementById('filterBadge');
    var toggle = document.getElementById('filterToggle');
    if (!host) return;
    host.textContent = '';
    var defs = [
      ['location', 'loc', villageLabel],
      ['topic', 'topic', topicLabel],
      ['era', 'era', eraLabel],
      ['language', 'lang', languageLabel]
    ];
    defs.forEach(function (def) {
      state.filters[def[0]].forEach(function (value) {
        var btn = U.node('button', {
          class: 'filter-summary__chip',
          type: 'button',
          'aria-label': t('filter.remove', { label: def[2](value) })
        });
        btn.appendChild(U.node('span', { text: def[2](value) }));
        btn.appendChild(U.node('i', { class: 'fa-solid fa-xmark', 'aria-hidden': 'true' }));
        btn.addEventListener('click', function () { toggleValue(def[0], value); });
        host.appendChild(btn);
      });
    });
    if (state.filters.keyword) {
      var kw = U.node('button', {
        class: 'filter-summary__chip',
        type: 'button',
        'aria-label': t('filter.remove', { label: state.filters.keyword })
      });
      kw.appendChild(U.node('span', { text: '「' + state.filters.keyword + '」' }));
      kw.appendChild(U.node('i', { class: 'fa-solid fa-xmark', 'aria-hidden': 'true' }));
      kw.addEventListener('click', function () {
        var search = document.getElementById('storySearch');
        if (search) search.value = '';
        setKeyword('');
      });
      host.appendChild(kw);
    }

    var count = activeCount();
    if (badge) {
      badge.textContent = count;
      badge.hidden = count === 0;
    }
    if (toggle) toggle.setAttribute('aria-expanded', document.getElementById('filterPanel').hidden ? 'false' : 'true');
  }

  function renderCount(list) {
    var el = document.getElementById('resultCount');
    if (!el) return;
    var total = visible().length;
    var text = t('filter.result', { n: list.length, total: total });
    el.textContent = text;
    VTN.ui.announce(text);
  }

  /* =========================================================================
   * 6. 渲染：故事列表
   * ======================================================================= */
  function coverNode(story) {
    var wrap = U.node('span', { class: 'story-item__cover' });
    if (story.cover) {
      var img = U.node('img', { src: story.cover, alt: '', width: '62', height: '62' });
      wrap.appendChild(img);
    } else {
      wrap.appendChild(U.node('i', { class: 'fa-solid fa-book-open', 'aria-hidden': 'true' }));
    }
    return wrap;
  }

  function storyItem(story) {
    var item = U.node('article', {
      class: 'story-item' + (state.selectedId === story.id ? ' is-selected' : ''),
      role: 'listitem',
      id: 'story-' + story.id,
      'data-story': story.id
    });
    var main = U.node('button', { class: 'story-item__main', type: 'button' });
    main.appendChild(coverNode(story));
    var body = U.node('span', { class: 'story-item__body' });
    body.appendChild(U.node('span', { class: 'story-item__title', text: story.title }));
    body.appendChild(U.node('span', {
      class: 'story-item__meta',
      text: villageLabel(story.villageKey) + ' ・ ' + eraLabel(story.eraKey) + ' ・ ' +
        languageLabel(story.languageKey) + ' ・ ' + durationLabel(story)
    }));
    var tags = U.node('span', { class: 'story-item__tags' });
    (story.topicKeys || []).slice(0, 2).forEach(function (key) {
      tags.appendChild(U.node('span', { class: 'tag', text: topicLabel(key) }));
    });
    if (story.rolePlayed) tags.appendChild(U.node('span', { class: 'tag tag--gold', text: t('story.rolePlayed') }));
    if (!story.audio) tags.appendChild(U.node('span', { class: 'tag tag--line', text: t('story.noAudioTag') }));
    body.appendChild(tags);
    main.appendChild(body);
    main.addEventListener('click', function () { select(story.id); });
    item.appendChild(main);
    return item;
  }

  function renderList(list) {
    var host = document.getElementById('storyList');
    if (!host) return;
    host.textContent = '';
    list.forEach(function (story) { host.appendChild(storyItem(story)); });

    var emptyPanel = document.getElementById('storiesEmpty');
    if (emptyPanel) emptyPanel.hidden = list.length !== 0;
  }

  /* =========================================================================
   * 7. 渲染：故事詳情
   * ======================================================================= */
  function badge(text, kind) {
    return U.node('span', { class: 'tag' + (kind ? ' tag--' + kind : ''), text: text });
  }

  function renderDetail() {
    var host = document.getElementById('storyDetail');
    if (!host) return;
    var story = state.selectedId ? get(state.selectedId) : null;
    if (!story || isWithdrawn(story) || !VTN.store.authorizedFor(story, VTN.store.role(), VTN.store.ownerId())) {
      host.hidden = true;
      host.textContent = '';
      return;
    }

    host.hidden = false;
    host.textContent = '';

    var head = U.node('div', { class: 'story-detail__head' });
    var titles = U.node('div', { class: 'story-detail__titles' });
    titles.appendChild(U.node('h2', { class: 'story-detail__title', text: story.title }));
    titles.appendChild(U.node('p', {
      class: 'story-detail__meta',
      text: story.teller + ' ・ ' + villageLabel(story.villageKey) + ' ・ ' +
        eraLabel(story.eraKey) + ' ・ ' + languageLabel(story.languageKey) + ' ・ ' + durationLabel(story)
    }));
    head.appendChild(titles);
    host.appendChild(head);

    var badges = U.node('div', { class: 'story-detail__badges' });
    if (story.rolePlayed) badges.appendChild(badge(t('story.rolePlayed'), 'gold'));
    badges.appendChild(badge(story.authorized ? t('story.authorized') : t('story.unauthorized'),
      story.authorized ? 'line' : 'red'));
    badges.appendChild(badge(t('scope.label', { scope: t(VTN.SCOPE_META[VTN.store.scopeOf(story)].labelKey) }), 'line'));
    if (story.consentRef) badges.appendChild(badge(story.consentRef, 'line'));
    host.appendChild(badges);

    if (story.correctedText) {
      var versionBox = U.node('div', { class: 'story-detail__empty' });
      versionBox.appendChild(U.node('p', {
        class: 'vtn-rec-subhead',
        text: t('story.correctedTitle', { v: story.correctedVersion })
      }));
      versionBox.appendChild(U.node('p', { text: story.correctedText }));
      versionBox.appendChild(U.node('p', {
        class: 'vtn-rec-note',
        text: t('story.originalKept')
      }));
      host.appendChild(versionBox);
    }

    host.appendChild(U.node('p', {
      class: 'story-detail__note',
      html: '<i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>' +
        U.escapeHtml(t('story.demoDisclosure')) + '</span>'
    }));

    if (story.audio) {
      var audio = U.node('audio', {
        class: 'story-detail__audio',
        id: 'storyAudio',
        controls: 'controls',
        preload: 'metadata',
        src: story.audio
      });
      audio.setAttribute('data-story', story.id);
      host.appendChild(audio);
      VTN.audio.applyPrefs(audio);
    } else {
      var noAudio = U.node('div', { class: 'story-detail__empty' });
      noAudio.appendChild(U.node('p', { text: t('story.noAudioExplain') }));
      host.appendChild(noAudio);
    }

    var actions = U.node('div', { class: 'story-detail__actions' });

    if (story.audio) {
      var playBtn = U.node('button', { class: 'vtn-btn vtn-btn--solid', type: 'button' });
      playBtn.innerHTML = '<i class="fa-solid fa-play" aria-hidden="true"></i><span>' +
        U.escapeHtml(t('story.play')) + '</span>';
      playBtn.addEventListener('click', function () { VTN.audio.playStory(story.id, 0); });
      actions.appendChild(playBtn);
    }

    var shareBtn = U.node('button', { class: 'vtn-btn', type: 'button' });
    shareBtn.innerHTML = '<i class="fa-solid fa-link" aria-hidden="true"></i><span>' +
      U.escapeHtml(t('story.share')) + '</span>';
    shareBtn.addEventListener('click', function () {
      var url = shareUrl(story.id);
      U.copyText(url).then(function (ok) {
        VTN.ui.toast(ok ? t('story.shareCopied') : t('story.shareFailed', { url: url }), ok ? 'success' : 'error');
      });
    });
    actions.appendChild(shareBtn);

    var scopeBtn = U.node('button', { class: 'vtn-btn', type: 'button' });
    scopeBtn.innerHTML = '<i class="fa-solid fa-shield-halved" aria-hidden="true"></i><span>' +
      U.escapeHtml(t('story.scope')) + '</span>';
    scopeBtn.addEventListener('click', function () { openScopeDialog(story); });
    actions.appendChild(scopeBtn);

    var corrBtn = U.node('button', { class: 'vtn-btn vtn-btn--quiet', type: 'button' });
    corrBtn.innerHTML = '<i class="fa-solid fa-file-pen" aria-hidden="true"></i><span>' +
      U.escapeHtml(t('story.correct')) + '</span>';
    corrBtn.addEventListener('click', function () {
      if (VTN.account) VTN.account.openCorrection(story);
    });
    actions.appendChild(corrBtn);

    var withdrawBtn = U.node('button', { class: 'vtn-btn vtn-btn--danger', type: 'button' });
    withdrawBtn.innerHTML = '<i class="fa-solid fa-ban" aria-hidden="true"></i><span>' +
      U.escapeHtml(t('story.withdraw')) + '</span>';
    withdrawBtn.addEventListener('click', function () {
      if (VTN.account) VTN.account.openWithdraw(story);
    });
    actions.appendChild(withdrawBtn);
    host.appendChild(actions);

    host.appendChild(U.node('p', {
      class: 'story-detail__subhead',
      text: t('story.transcriptHint')
    }));

    var list = U.node('div', { class: 'segments' });
    (story.segments || []).forEach(function (seg, index) {
      var btn = U.node('button', { class: 'segment', type: 'button' });
      btn.appendChild(U.node('span', { class: 'segment__t', text: U.fmtTime(seg.start) }));
      btn.appendChild(U.node('span', { class: 'segment__text', text: seg.text }));
      btn.setAttribute('data-start', seg.end);
      btn.addEventListener('click', function () {
        state.playingSegment = index;
        highlightSegment(seg.start);
        if (story.audio) VTN.audio.playStory(story.id, seg.start);
        else VTN.ui.toast(t('story.noAudio'), 'error');
      });
      list.appendChild(btn);
    });
    host.appendChild(list);
  }

  function highlightSegment(start) {
    var host = document.getElementById('storyDetail');
    if (!host) return;
    Array.prototype.forEach.call(host.querySelectorAll('.segment'), function (el) {
      var value = Number(el.getAttribute('data-start'));
      el.classList.toggle('is-playing', Math.abs(value - Number(start)) < 0.6);
    });
  }

  /* =========================================================================
   * 8. 分享範圍對話框（每則故事獨立設定）
   * ======================================================================= */
  function openScopeDialog(item) {
    var current = VTN.store.scopeOf(item);
    var body = U.node('div');
    body.appendChild(U.node('p', {
      text: t('scope.intro', { title: item.title || '' })
    }));

    var chosen = current;
    var cards = {};
    VTN.SCOPES.forEach(function (scope) {
      var meta = VTN.SCOPE_META[scope];
      var label = U.node('label', { class: 'radio-card' + (scope === current ? ' is-active' : '') });
      var input = U.node('input', { type: 'radio', name: 'vtn-scope', value: scope });
      input.checked = scope === current;
      var text = U.node('span');
      text.appendChild(U.node('span', { class: 'radio-card__title', text: t(meta.labelKey) }));
      text.appendChild(U.node('span', { class: 'radio-card__hint', text: t(meta.hintKey) }));
      label.appendChild(input);
      label.appendChild(text);
      label.addEventListener('click', function () {
        chosen = scope;
        Object.keys(cards).forEach(function (key) { cards[key].classList.toggle('is-active', key === scope); });
      });
      cards[scope] = label;
      body.appendChild(label);
    });

    body.appendChild(U.node('p', {
      class: 'vtn-modal__note',
      text: t('scope.auditNote', { version: VTN.config.consentPolicyVersion })
    }));

    var dlg = VTN.ui.dialog({
      title: t('scope.title'),
      body: body,
      actions: [
        { label: t('common.cancel'), kind: 'quiet' },
        {
          label: t('common.save'),
          kind: 'solid',
          keepOpen: true,
          onClick: function (ctx) {
            var scope = VTN.store.setScope(item, chosen);
            VTN.api.audit({
              action: 'scope.change',
              targetId: item.id,
              to: scope,
              policyVersion: VTN.config.consentPolicyVersion
            }).catch(function () { /* 離線時只留本機稽核 */ });
            VTN.api.consent({
              action: 'scope-change',
              targetId: item.id,
              to: scope,
              policyVersion: VTN.config.consentPolicyVersion
            }).catch(function () { /* 同上 */ });
            ctx.close('saved');
            VTN.ui.toast(t('scope.saved', { scope: t(VTN.SCOPE_META[scope].labelKey) }), 'success');
            render();
            if (VTN.recordings) VTN.recordings.renderAll();
            if (VTN.assistant) VTN.assistant.refresh();
          }
        }
      ]
    });
    return dlg;
  }

  /* =========================================================================
   * 9. 首頁精選
   * ======================================================================= */
  function renderFeatured() {
    var host = document.getElementById('featuredStory');
    if (!host) return;
    host.textContent = '';
    var story = filtered()[0] || visible()[0];
    if (!story) {
      host.appendChild(U.node('p', { class: 'settings-foot', text: t('stories.noResult') }));
      return;
    }
    var card = U.node('article', { class: 'story-item' });
    var main = U.node('button', { class: 'story-item__main', type: 'button' });
    main.appendChild(coverNode(story));
    var body = U.node('span', { class: 'story-item__body' });
    body.appendChild(U.node('span', { class: 'story-item__title', text: story.title }));
    body.appendChild(U.node('span', {
      class: 'story-item__meta',
      text: story.villageKey ? villageLabel(story.villageKey) + ' ・ ' + durationLabel(story) : ''
    }));
    var tags = U.node('span', { class: 'story-item__tags' });
    if (story.rolePlayed) tags.appendChild(U.node('span', { class: 'tag tag--gold', text: t('story.rolePlayed') }));
    if (!story.audio) tags.appendChild(U.node('span', { class: 'tag tag--line', text: t('story.noAudioTag') }));
    body.appendChild(tags);
    main.appendChild(body);
    main.addEventListener('click', function () {
      VTN.router.go('stories', { story: story.id });
      select(story.id, { updateUrl: false });
    });
    card.appendChild(main);
    host.appendChild(card);
  }

  /* =========================================================================
   * 10. 主渲染
   * ======================================================================= */
  function render() {
    var list = filtered();
    state.lastList = list;

    if (state.selectedId) {
      var selectedAlive = list.some(function (s) { return s.id === state.selectedId; });
      if (!selectedAlive) state.selectedId = null;
    }

    renderFilterChips();
    renderSummary();
    renderCount(list);
    renderList(list);
    renderDetail();
    renderFeatured();

    if (VTN.map) {
      VTN.map.update({
        stories: list,
        selectedId: state.selectedId,
        overview: state.overview,
        empty: list.length === 0,
        titleStory: state.selectedId ? get(state.selectedId) : null
      });
    }
  }

  function toggleOverview(force) {
    state.overview = typeof force === 'boolean' ? force : !state.overview;
    if (state.overview) state.selectedId = null;
    syncUrl();
    render();
  }

  function init() {
    var search = document.getElementById('storySearch');
    if (search) {
      var onInput = U.debounce(function () { setKeyword(search.value); }, 220);
      search.addEventListener('input', onInput);
      search.addEventListener('search', function () { setKeyword(search.value); });
    }

    var toggleBtn = document.getElementById('filterToggle');
    var panel = document.getElementById('filterPanel');
    if (toggleBtn && panel) {
      toggleBtn.addEventListener('click', function () {
        var open = panel.hidden;
        panel.hidden = !open;
        toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) {
          var first = panel.querySelector('button');
          if (first) first.focus();
        }
      });
    }
    var doneBtn = document.getElementById('filterDone');
    if (doneBtn && panel) {
      doneBtn.addEventListener('click', function () {
        panel.hidden = true;
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
        if (toggleBtn) toggleBtn.focus();
      });
    }
    var clearBtn = document.getElementById('filterClear');
    if (clearBtn) clearBtn.addEventListener('click', clearFilters);
    var emptyClear = document.getElementById('storiesEmptyClear');
    if (emptyClear) emptyClear.addEventListener('click', clearFilters);

    var sortSelect = document.getElementById('filterSort');
    if (sortSelect) {
      sortSelect.addEventListener('change', function () { setSort(sortSelect.value); });
    }

    var mapBtn = document.getElementById('mapModeBtn');
    if (mapBtn) {
      mapBtn.addEventListener('click', function () { toggleOverview(); });
    }

    VTN.audio.onTime(function (seconds, storyId) {
      var story = storyId ? get(storyId) : null;
      if (!story) return;
      (story.segments || []).forEach(function (seg) {
        if (seconds >= seg.start && seconds < seg.end) highlightSegment(seg.start);
      });
    });

    render();
  }

  VTN.stories = {
    init: init,
    render: render,
    all: all,
    get: get,
    visible: visible,
    filtered: filtered,
    select: select,
    applyParams: applyParams,
    currentParams: currentParams,
    openSource: openSource,
    openScopeDialog: openScopeDialog,
    shareUrl: shareUrl,
    toggleOverview: toggleOverview,
    durationLabel: durationLabel,
    villageLabel: villageLabel,
    topicLabel: topicLabel,
    eraLabel: eraLabel,
    languageLabel: languageLabel,
    lastList: function () { return state.lastList; },
    selectedId: function () { return state.selectedId; },
    isOverview: function () { return state.overview; },
    meta: function () { return DATA; },
    clearFilters: clearFilters
  };
})();
