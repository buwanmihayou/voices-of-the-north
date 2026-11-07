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

  /* 年代軸：只做「故事年代」篩選，不假裝切換歷史底圖。
     刻度由資料的 year 分佈動態產生，只保留「真的會改變結果」的年份，
     最後一格＝全部；避免資料全在 1990 前、刻度卻停在 2026 而成為擺設。 */
  function eraStopsFromData() {
    var years = (DATA.stories || []).map(yearOf).filter(function (y) {
      return typeof y === 'number' && isFinite(y);
    });
    if (!years.length) return [1950, 1970, 1990, 2010, 2026];
    var min = Math.min.apply(null, years);
    var max = Math.max.apply(null, years);
    var stops = [];
    for (var y = Math.floor(min / 10) * 10; y <= Math.ceil(max / 10) * 10; y += 10) {
      var hasBefore = years.some(function (v) { return v <= y; });
      var hasAfter = years.some(function (v) { return v > y; });
      if (hasBefore && hasAfter) stops.push(y);
    }
    if (!stops.length) stops.push(Math.floor(min / 10) * 10);
    stops.push(Math.ceil(max / 10) * 10); /* 最後一格：全部年代 */
    return stops;
  }
  var ERA_STOPS = eraStopsFromData();
  var STORY_TYPE_ORDER = ['festival', 'farming', 'migration', 'architecture', 'oral', 'market', 'other'];
  var TYPE_ICON = {
    festival: 'fa-fire',
    farming: 'fa-wheat-awn',
    migration: 'fa-route',
    architecture: 'fa-building-columns',
    oral: 'fa-microphone-lines',
    market: 'fa-basket-shopping',
    other: 'fa-feather-pointed'
  };

  var state = {
    filters: { type: [], location: [], topic: [], era: [], language: [], keyword: '', sort: 'newest' },
    mode: 'map',              // map | list
    eraIndex: ERA_STOPS.length - 1,
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

  /* 視口查詢：只回已授權、且中心點落在 bbox 內的故事 */
  function inBbox(bounds) {
    if (!bounds || bounds.length !== 2) return visible();
    var sw = bounds[0], ne = bounds[1];
    if (!sw || !ne || sw.length !== 2 || ne.length !== 2) return visible();
    return visible().filter(function (story) {
      var loc = story.location;
      return loc && typeof loc.lat === 'number' && typeof loc.lng === 'number' &&
        loc.lng >= sw[0] && loc.lng <= ne[0] && loc.lat >= sw[1] && loc.lat <= ne[1];
    });
  }

  function distanceM(a, b) {
    var rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad;
    var dLng = (b.lng - a.lng) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /* 同圈合併：中心距不超過較大的模糊半徑，視為同一個 800m 圈。
     不搬動座標、不收窄半徑，只是把點位歸組供地圖顯示數字與選擇。 */
  function fuzzGroups(list) {
    var source = (list || visible()).filter(function (s) { return s && s.location; });
    var used = {};
    var groups = [];
    source.forEach(function (story, i) {
      if (used[story.id]) return;
      var ids = [story.id];
      used[story.id] = true;
      source.forEach(function (other, j) {
        if (j <= i || used[other.id]) return;
        var radius = Math.max(story.location.radiusM || 800, other.location.radiusM || 800);
        if (distanceM(story.location, other.location) <= radius) {
          used[other.id] = true;
          ids.push(other.id);
        }
      });
      groups.push({ id: story.id, ids: ids, count: ids.length, location: story.location });
    });
    return groups;
  }

  function villageLabel(key) { return t('village.' + key); }
  function topicLabel(key) { return t('topic.' + key); }
  function eraLabel(key) { return t('era.' + key); }
  function languageLabel(key) { return t('lang.' + key); }

  function durationLabel(story) {
    var base = U.fmtTime(story.durationSec);
    return story.durationSource === 'transcript' ? base + ' ' + t('story.transcriptLength') : base;
  }

  function storyTypeOf(story) {
    return story && story.storyType && TYPE_ICON[story.storyType] ? story.storyType : 'other';
  }

  function typeLabel(key) { return t('storyType.' + (key || 'other')); }
  function moodLabel(key) { return t('mood.' + key); }
  function typeIcon(key) { return TYPE_ICON[key] || TYPE_ICON.other; }

  function yearOf(story) {
    if (typeof story.year === 'number') return story.year;
    var era = String(story.eraKey || '').replace(/s$/, '');
    var parsed = parseInt(era, 10);
    return isFinite(parsed) ? parsed + 5 : null;
  }

  function eraCutoff() {
    return ERA_STOPS[U.clamp(state.eraIndex, 0, ERA_STOPS.length - 1)];
  }

  function eraLabelText() {
    var cutoff = eraCutoff();
    return cutoff >= ERA_STOPS[ERA_STOPS.length - 1]
      ? t('atlas.eraAll')
      : t('atlas.eraBefore', { y: cutoff });
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

  function setKeyword(value, options) {
    var opts = options || {};
    state.filters.keyword = String(value || '').trim();
    var list = filtered();

    /* 搜尋結果直接在地圖定位：一則就飛過去，多則 fit 到全部結果 */
    if (opts.locate && state.mode === 'map' && state.filters.keyword) {
      state.selectedId = list.length === 1 ? list[0].id : null;
    }
    syncUrl();
    render();

    if (!opts.locate || !VTN.map) return;
    if (!state.filters.keyword || state.mode !== 'map') {
      VTN.map.fitAll();
      return;
    }
    if (list.length === 1) {
      VTN.map.focusStory(list[0].id);
    } else if (list.length && VTN.map.fitStories) {
      VTN.map.fitStories(list.map(function (s) { return s.id; }));
    }
  }

  function setSort(value) {
    state.filters.sort = value || 'newest';
    syncUrl();
    render();
  }

  function clearFilters() {
    state.filters = { type: [], location: [], topic: [], era: [], language: [], keyword: '', sort: state.filters.sort };
    state.eraIndex = ERA_STOPS.length - 1;
    var search = document.getElementById('storySearch');
    if (search) search.value = '';
    var era = document.getElementById('atlasEra');
    if (era) era.value = String(state.eraIndex);
    syncUrl();
    render();
    if (VTN.map) VTN.map.fitAll();
  }

  function activeCount() {
    var f = state.filters;
    var count = f.type.length + f.location.length + f.topic.length + f.era.length +
      f.language.length + (f.keyword ? 1 : 0);
    if (state.eraIndex < ERA_STOPS.length - 1) count++;
    return count;
  }

  function keywordHaystack(story) {
    var parts = [story.title, story.titleEn, story.teller, villageLabel(story.villageKey)];
    (story.topicKeys || []).forEach(function (k) { parts.push(topicLabel(k)); });
    parts.push(eraLabel(story.eraKey), languageLabel(story.languageKey));
    parts.push(typeLabel(storyTypeOf(story)));
    if (story.mood) parts.push(moodLabel(story.mood));
    if (story.year) parts.push(String(story.year));
    (story.segments || []).forEach(function (seg) { parts.push(seg.text); });
    return parts.join(' ').toLowerCase();
  }

  function matchesExceptType(story) {
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
    var year = yearOf(story);
    if (state.eraIndex < ERA_STOPS.length - 1 && year !== null && year > eraCutoff()) return false;
    return true;
  }

  function matches(story) {
    var f = state.filters;
    if (f.type.length && f.type.indexOf(storyTypeOf(story)) === -1) return false;
    if (!matchesExceptType(story)) return false;
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
    if (f.type.length) params.storyType = f.type.join(',');
    if (f.location.length) params.loc = f.location.join(',');
    if (f.topic.length) params.topic = f.topic.join(',');
    if (f.era.length) params.era = f.era.join(',');
    if (f.language.length) params.lang = f.language.join(',');
    if (f.keyword) params.q = f.keyword;
    if (f.sort && f.sort !== 'newest') params.sort = f.sort;
    if (state.selectedId) params.story = state.selectedId;
    if (state.mode === 'list') params.view = 'list';
    if (state.eraIndex < ERA_STOPS.length - 1) params.since = ERA_STOPS[state.eraIndex];
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
    f.type = params.storyType ? String(params.storyType).split(',') : [];
    f.location = params.loc ? String(params.loc).split(',') : [];
    f.topic = params.topic ? String(params.topic).split(',') : [];
    f.era = params.era ? String(params.era).split(',') : [];
    f.language = params.lang ? String(params.lang).split(',') : [];
    f.keyword = params.q || '';
    f.sort = params.sort || 'newest';
    state.mode = params.view === 'list' ? 'list' : 'map';
    state.overview = false;
    state.selectedId = params.story || null;

    /* 刻度改由資料分佈產生後，舊分享連結的 since（1950/1970/…/2026）
       可能不在新刻度上：映射到「不大於 since 的最後一格」，超過上限視為全部。 */
    var since = Number(params.since);
    if (since && ERA_STOPS.indexOf(since) !== -1) state.eraIndex = ERA_STOPS.indexOf(since);
    else if (since && isFinite(since)) {
      var mapped = 0;
      ERA_STOPS.forEach(function (year, index) {
        if (year <= since && index < ERA_STOPS.length - 1) mapped = index;
      });
      state.eraIndex = since >= ERA_STOPS[ERA_STOPS.length - 1] ? ERA_STOPS.length - 1 : mapped;
    } else state.eraIndex = ERA_STOPS.length - 1;

    var search = document.getElementById('storySearch');
    if (search && search.value !== f.keyword) search.value = f.keyword;
    var sortSelect = document.getElementById('filterSort');
    if (sortSelect) sortSelect.value = f.sort;
    var era = document.getElementById('atlasEra');
    if (era) era.value = String(state.eraIndex);
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
    /* 指標口徑：pin.click 只代表點到點位／同圈氣泡；真正打開故事記 story.open */
    if (VTN.metrics) VTN.metrics.track('story.open', {
      storyId: storyId, source: opts.source || 'direct'
    });

    if (opts.updateUrl !== false) {
      var params = currentParams();
      params.story = storyId;
      if (opts.t !== undefined && opts.t !== null) params.t = Math.floor(opts.t);
      else delete params.t;
      VTN.router.go('stories', params, { replace: opts.replace });
    }

    render();

    if (VTN.sheet) {
      VTN.sheet.open({
        onClose: handleSheetClosed,
        expanded: opts.expanded === true,
        focus: opts.focus !== false
      });
    }
    if (VTN.map) VTN.map.focusStory(storyId);

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
    var type = storyTypeOf(story);
    var wrap = U.node('span', { class: 'story-item__cover story-item__cover--' + type });
    if (story.cover) {
      var img = U.node('img', { src: story.cover, alt: '', width: '62', height: '62' });
      wrap.appendChild(img);
    } else {
      wrap.appendChild(U.node('i', {
        class: 'fa-solid ' + typeIcon(type),
        'aria-hidden': 'true'
      }));
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
    var typeTag = U.node('span', {
      class: 'tag tag--type vtn-type--' + storyTypeOf(story)
    });
    typeTag.innerHTML = '<i class="fa-solid ' + typeIcon(storyTypeOf(story)) + '" aria-hidden="true"></i>' +
      U.escapeHtml(typeLabel(storyTypeOf(story)));
    tags.appendChild(typeTag);
    /* 心情只在二級抽屜顯示：列表與地圖維持「類型」單一編碼 */
    (story.topicKeys || []).slice(0, 1).forEach(function (key) {
      tags.appendChild(U.node('span', { class: 'tag', text: topicLabel(key) }));
    });
    if (story.rolePlayed) tags.appendChild(U.node('span', { class: 'tag tag--gold', text: t('story.rolePlayed') }));
    if (!story.audio) tags.appendChild(U.node('span', { class: 'tag tag--line', text: t('story.noAudioTag') }));
    body.appendChild(tags);
    main.appendChild(body);
    main.addEventListener('click', function () { select(story.id, { source: 'list' }); });
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

  function moodTagOf(mood) {
    if (!mood) return null;
    var tag = U.node('span', { class: 'mood-tag vtn-mood--' + mood });
    tag.appendChild(U.node('span', { class: 'mood-tag__dot', 'aria-hidden': 'true' }));
    tag.appendChild(U.node('span', { text: moodLabel(mood) }));
    return tag;
  }

  /* 波形只由實測振幅產生：兩層同一組 SVG 柱，上層用 clip-path 顯示已播放部分 */
  function drawWave(player, track, amps, story) {
    var bars = '';
    amps.forEach(function (amp, i) {
      var h = 2.5 + amp * 27;
      bars += '<rect x="' + (i * 4 + 0.7).toFixed(2) +
        '" y="' + ((30 - h) / 2).toFixed(2) +
        '" width="2.6" height="' + h.toFixed(2) + '" rx="1.3"></rect>';
    });
    var open = '<svg class="player__waveSvg" viewBox="0 0 ' + (amps.length * 4) +
      ' 30" preserveAspectRatio="none" focusable="false" aria-hidden="true">';
    var playedOpen = open.replace(
      'class="player__waveSvg"',
      'class="player__waveSvg player__waveSvg--played"'
    );
    var wave = track.querySelector('[data-role="wave"]');
    if (!wave) return;
    wave.innerHTML = open + bars + '</svg>' + playedOpen + bars + '</svg>';
    player.classList.add('player--wave');
    track.setAttribute('data-wave', 'measured');
    var note = player.querySelector('[data-role="note"]');
    if (note) note.textContent = t('atlas.playerMetaWave', {
      n: (story.segments || []).length,
      dur: U.fmtTime(story.durationSec)
    });
  }

  function playerNode(story) {
    if (!story.audio) {
      return U.node('div', {
        class: 'player player--noaudio',
        text: t('story.noAudioExplain')
      });
    }
    var wrap = U.node('div', { class: 'player', 'data-player-story': story.id });
    var btn = U.node('button', {
      class: 'player__btn', type: 'button', 'data-role': 'play',
      'aria-label': t('atlas.playAria', { title: story.title })
    });
    btn.innerHTML = '<i class="fa-solid fa-play" aria-hidden="true"></i>';

    var main = U.node('div', { class: 'player__main' });
    var track = U.node('div', {
      class: 'player__track', 'data-role': 'track',
      role: 'slider', 'aria-label': t('atlas.seekAria'),
      'aria-valuemin': '0', 'aria-valuemax': String(Math.round(story.durationSec)),
      'aria-valuenow': '0', tabindex: '0'
    });
    track.appendChild(U.node('div', { class: 'player__wave', 'data-role': 'wave', 'aria-hidden': 'true' }));
    track.appendChild(U.node('div', { class: 'player__fill', 'data-role': 'fill' }));
    (story.segments || []).forEach(function (seg) {
      var pct = story.durationSec ? (seg.start / story.durationSec) * 100 : 0;
      var tick = U.node('span', { class: 'player__tick', 'aria-hidden': 'true' });
      tick.style.left = Math.max(0, Math.min(100, pct)) + '%';
      track.appendChild(tick);
    });

    var meta = U.node('div', { class: 'player__meta' });
    meta.appendChild(U.node('span', { class: 'player__now', 'data-role': 'now', text: '00:00' }));
    meta.appendChild(U.node('span', {
      class: 'player__note', 'data-role': 'note',
      text: t('atlas.playerMeta', { n: (story.segments || []).length, dur: U.fmtTime(story.durationSec) })
    }));

    main.appendChild(track);
    main.appendChild(meta);
    wrap.appendChild(btn);
    wrap.appendChild(main);

    btn.addEventListener('click', function () {
      if (VTN.audio.playingStoryId() === story.id) {
        VTN.audio.pauseStory();
        refreshPlayerUI();
        return;
      }
      VTN.audio.playStory(story.id, 0);
      setTimeout(refreshPlayerUI, 120);
    });

    track.addEventListener('click', function (event) {
      var rect = track.getBoundingClientRect();
      var ratio = U.clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      VTN.audio.playStory(story.id, ratio * (story.durationSec || 0));
      setTimeout(refreshPlayerUI, 120);
    });

    track.addEventListener('keydown', function (event) {
      var dur = story.durationSec || 0;
      var cur = Number(track.getAttribute('aria-valuenow')) || 0;
      var next;
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = cur + 5;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = cur - 5;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = dur;
      else return;
      event.preventDefault();
      VTN.audio.playStory(story.id, U.clamp(next, 0, dur));
      setTimeout(refreshPlayerUI, 120);
    });

    /* 解碼成功才換成波形；失敗時維持細進度條，不畫假波形 */
    if (VTN.waveform) {
      VTN.waveform.get(story.audio, story.id).then(function (amps) {
        if (!amps) return;
        if (!wrap.isConnected || wrap.getAttribute('data-player-story') !== story.id) return;
        drawWave(wrap, track, amps, story);
      });
    }

    return wrap;
  }

  function refreshPlayerUI() {
    var host = document.getElementById('storyDetail');
    if (!host) return;
    var player = host.querySelector('.player');
    if (!player) return;
    var storyId = player.getAttribute('data-player-story');
    var story = storyId ? get(storyId) : null;
    if (!story) return;
    var playing = VTN.audio.playingStoryId() === storyId;
    var btn = player.querySelector('[data-role="play"]');
    if (btn) {
      btn.classList.toggle('is-playing', playing);
      btn.innerHTML = '<i class="fa-solid ' + (playing ? 'fa-pause' : 'fa-play') + '" aria-hidden="true"></i>';
      btn.setAttribute('aria-label', playing ? t('atlas.pauseAria') : t('atlas.playAria', { title: story.title }));
    }
  }

  function updatePlayerProgress(seconds, storyId) {
    var host = document.getElementById('storyDetail');
    if (!host) return;
    var player = host.querySelector('.player');
    if (!player || player.getAttribute('data-player-story') !== storyId) return;
    var story = get(storyId);
    if (!story) return;
    var ratio = U.clamp(seconds / Math.max(1, story.durationSec), 0, 1);
    var fill = player.querySelector('[data-role="fill"]');
    var now = player.querySelector('[data-role="now"]');
    var track = player.querySelector('[data-role="track"]');
    if (fill) fill.style.width = (ratio * 100).toFixed(2) + '%';
    if (now) now.textContent = U.fmtTime(seconds);
    if (track) {
      track.setAttribute('aria-valuenow', String(Math.round(seconds)));
      track.style.setProperty('--played', (ratio * 100).toFixed(2) + '%');
    }
  }

  function renderDetail() {
    var host = document.getElementById('storyDetail');
    if (!host) return;
    var story = state.selectedId ? get(state.selectedId) : null;
    if (!story || isWithdrawn(story) || !VTN.store.authorizedFor(story, VTN.store.role(), VTN.store.ownerId())) {
      host.hidden = true;
      host.textContent = '';
      if (VTN.sheet && VTN.sheet.isOpen()) VTN.sheet.close('empty');
      return;
    }

    host.hidden = false;
    host.textContent = '';

    var type = storyTypeOf(story);

    /* 標題區：類型色塊 + 故事名 + 村落／年代／時長 */
    var hero = U.node('div', { class: 'sheet-hero' });
    hero.appendChild(U.node('span', {
      class: 'sheet-hero__icon vtn-bg--' + type,
      html: '<i class="fa-solid ' + typeIcon(type) + '" aria-hidden="true"></i>'
    }));
    var body = U.node('div', { class: 'sheet-hero__body' });
    var kicker = U.node('p', { class: 'sheet-hero__kicker' });
    kicker.appendChild(U.node('span', { text: typeLabel(type) }));
    kicker.appendChild(U.node('span', { class: 'dot', text: '・' }));
    kicker.appendChild(U.node('span', {
      text: story.year ? t('atlas.yearLabel', { y: story.year }) : eraLabel(story.eraKey)
    }));
    body.appendChild(kicker);
    body.appendChild(U.node('h2', { class: 'sheet-hero__title', text: story.title }));
    body.appendChild(U.node('p', {
      class: 'sheet-hero__sub',
      text: villageLabel(story.villageKey) + ' ・ ' + durationLabel(story) + ' ・ ' +
        t('atlas.teller', { name: story.teller })
    }));
    hero.appendChild(body);
    host.appendChild(hero);

    var tags = U.node('div', { class: 'sheet-tags' });
    var mood = moodTagOf(story.mood);
    if (mood) tags.appendChild(mood);
    if (story.rolePlayed) tags.appendChild(badge(t('story.rolePlayed'), 'gold'));
    if (!story.audio) tags.appendChild(badge(t('story.noAudioTag'), 'line'));
    tags.appendChild(badge(t('scope.label', {
      scope: t(VTN.SCOPE_META[VTN.store.scopeOf(story)].labelKey)
    }), 'line'));
    host.appendChild(tags);

    host.appendChild(playerNode(story));

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

    /* 錄音資訊：用逐字稿時間戳做真實刻度，不做假波形 */
    var section = U.node('div', { class: 'story-sheet__section' });
    var head = U.node('div', { class: 'story-sheet__section-head' });
    head.appendChild(U.node('h3', {
      class: 'story-sheet__section-title',
      text: t('story.transcriptHint')
    }));
    var segments = story.segments || [];
    var expanded = false;
    var toggle = null;
    if (segments.length > 2) {
      toggle = U.node('button', {
        class: 'story-sheet__toggle', type: 'button', text: t('atlas.expandAll')
      });
      head.appendChild(toggle);
    }
    section.appendChild(head);

    var list = U.node('div', { class: 'segments' });
    segments.forEach(function (seg, index) {
      var btn = U.node('button', { class: 'segment', type: 'button' });
      if (index >= 2) btn.classList.add('is-collapsed');
      btn.appendChild(U.node('span', { class: 'segment__t', text: U.fmtTime(seg.start) }));
      btn.appendChild(U.node('span', { class: 'segment__text', text: seg.text }));
      btn.setAttribute('data-start', seg.start);
      btn.addEventListener('click', function () {
        state.playingSegment = index;
        highlightSegment(seg.start);
        if (story.audio) {
          VTN.audio.playStory(story.id, seg.start);
          setTimeout(refreshPlayerUI, 120);
        } else {
          VTN.ui.toast(t('story.noAudio'), 'error');
        }
      });
      list.appendChild(btn);
    });
    section.appendChild(list);
    host.appendChild(section);

    if (toggle) {
      toggle.addEventListener('click', function () {
        expanded = !expanded;
        Array.prototype.forEach.call(list.querySelectorAll('.segment'), function (el, index) {
          if (index < 2) return;
          el.classList.toggle('is-collapsed', !expanded);
        });
        toggle.textContent = expanded ? t('atlas.collapseAll') : t('atlas.expandAll');
      });
    }

    var actions = U.node('div', { class: 'story-detail__actions' });

    var shareBtn = U.node('button', { class: 'vtn-btn vtn-btn--solid', type: 'button' });
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
      class: 'story-detail__note',
      html: '<i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>' +
        U.escapeHtml(t('story.demoDisclosure')) + '</span>'
    }));
    host.appendChild(U.node('p', {
      class: 'story-sheet__note',
      text: t('atlas.sheetNote', { r: (story.location && story.location.radiusM) || 800 })
    }));
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
      select(story.id, { updateUrl: false, source: 'featured' });
    });
    card.appendChild(main);
    host.appendChild(card);
  }

  /* =========================================================================
   * 10. 地圖 UI：模式、年代軸、圖例、附近故事
   * ======================================================================= */
  function setMode(next) {
    state.mode = next === 'list' ? 'list' : 'map';
    U.emit('vtn:stories-mode', { mode: state.mode });
    if (state.mode === 'list' && VTN.sheet && VTN.sheet.isOpen()) VTN.sheet.close('mode');
    syncUrl();
    render();
    if (state.mode === 'map' && VTN.map) VTN.map.ensureVisible();
  }

  function renderEraTicks(ticks) {
    if (!ticks) return;
    ticks.textContent = '';
    ERA_STOPS.forEach(function (year, index) {
      ticks.appendChild(U.node('span', {
        text: index === ERA_STOPS.length - 1 ? t('atlas.eraAll') : String(year)
      }));
    });
  }

  function updateEraUI() {
    var label = document.getElementById('atlasEraLabel');
    if (label) label.textContent = eraLabelText();
    var ticks = document.getElementById('atlasTicks');
    if (ticks) {
      renderEraTicks(ticks); /* 每次重建，語言切換時「全部」也會跟著翻譯 */
      Array.prototype.forEach.call(ticks.children, function (node, index) {
        node.classList.toggle('is-active', index === state.eraIndex);
      });
    }
    var input = document.getElementById('atlasEra');
    if (input) {
      input.max = String(ERA_STOPS.length - 1);
      if (input.value !== String(state.eraIndex)) input.value = String(state.eraIndex);
    }
  }

  function setEra(index, options) {
    state.eraIndex = U.clamp(Number(index), 0, ERA_STOPS.length - 1);
    if (state.selectedId) {
      var selected = get(state.selectedId);
      var year = selected ? yearOf(selected) : null;
      if (year !== null && year > eraCutoff()) state.selectedId = null;
    }
    syncUrl();
    render();
    updateEraUI();
    if (options && options.fit && VTN.map) VTN.map.fitAll();
  }

  function toggleType(type) {
    var list = state.filters.type;
    var index = list.indexOf(type);
    if (index === -1) list.push(type);
    else list.splice(index, 1);
    syncUrl();
    render();
    if (VTN.map) VTN.map.fitAll();
  }

  function renderLegend() {
    var host = document.getElementById('atlasLegend');
    if (!host) return;
    host.textContent = '';

    /* 圖例計數只受其他篩選影響，讓使用者知道「點下去還剩幾則」 */
    var counts = {};
    visible().filter(matchesExceptType).forEach(function (story) {
      var type = storyTypeOf(story);
      counts[type] = (counts[type] || 0) + 1;
    });

    STORY_TYPE_ORDER.forEach(function (type) {
      if (!counts[type] && state.filters.type.indexOf(type) === -1) return;
      var pressed = state.filters.type.indexOf(type) !== -1;
      var btn = U.node('button', {
        class: 'legend-chip',
        type: 'button',
        'aria-pressed': pressed ? 'true' : 'false'
      });
      btn.appendChild(U.node('span', {
        class: 'legend-chip__icon vtn-bg--' + type,
        html: '<i class="fa-solid ' + typeIcon(type) + '" aria-hidden="true"></i>'
      }));
      btn.appendChild(U.node('span', { text: typeLabel(type) }));
      btn.appendChild(U.node('span', {
        class: 'legend-chip__count',
        text: String(counts[type] || 0)
      }));
      btn.addEventListener('click', function () { toggleType(type); });
      host.appendChild(btn);
    });
  }

  function renderPeek(list) {
    var host = document.getElementById('atlasPeek');
    if (!host) return;
    host.textContent = '';
    list.slice(0, 6).forEach(function (story) {
      var type = storyTypeOf(story);
      var card = U.node('button', { class: 'peek-card', type: 'button', role: 'listitem' });
      card.appendChild(U.node('span', {
        class: 'peek-card__icon vtn-bg--' + type,
        html: '<i class="fa-solid ' + typeIcon(type) + '" aria-hidden="true"></i>'
      }));
      var body = U.node('span', { class: 'peek-card__body' });
      body.appendChild(U.node('span', { class: 'peek-card__title', text: story.title }));
      body.appendChild(U.node('span', {
        class: 'peek-card__meta',
        text: villageLabel(story.villageKey) + ' ・ ' + durationLabel(story)
      }));
      card.appendChild(body);
      card.addEventListener('click', function () { select(story.id, { source: 'peek' }); });
      host.appendChild(card);
    });
  }

  function updateChrome(list) {
    var atlas = document.getElementById('storyAtlas');
    var listView = document.getElementById('atlasList');
    if (atlas) atlas.hidden = state.mode === 'list';
    if (listView) listView.hidden = state.mode !== 'list';

    var page = document.querySelector('.page--stories');
    if (page) page.classList.toggle('is-map', state.mode === 'map');

    var viewBtn = document.getElementById('atlasViewBtn');
    if (viewBtn) viewBtn.setAttribute('aria-pressed', state.mode === 'list' ? 'true' : 'false');

    var listCount = document.getElementById('atlasListCount');
    if (listCount) {
      listCount.textContent = t('atlas.listSub', {
        n: list.length,
        villages: Object.keys(list.reduce(function (acc, story) {
          acc[story.villageKey] = 1;
          return acc;
        }, {})).length
      });
    }
    updateEraUI();
  }

  function handleSheetClosed() {
    if (!state.selectedId) return;
    state.selectedId = null;
    syncUrl();
    render();
  }

  /* =========================================================================
   * 11. 主渲染
   * ======================================================================= */
  function render() {
    var list = filtered();
    state.lastList = list;

    if (state.selectedId) {
      var selectedAlive = list.some(function (s) { return s.id === state.selectedId; });
      if (!selectedAlive) {
        state.selectedId = null;
        syncUrl();
      }
    }

    renderFilterChips();
    renderSummary();
    renderLegend();
    renderPeek(list);
    renderCount(list);
    renderList(list);
    renderDetail();
    renderFeatured();
    updateChrome(list);

    if (VTN.map) {
      VTN.map.update({
        stories: list,
        selectedId: state.selectedId,
        mode: state.mode,
        eraYear: eraCutoff(),
        empty: list.length === 0
      });
    }
  }

  function toggleOverview(force) {
    setMode(typeof force === 'boolean' ? (force ? 'map' : 'list') : (state.mode === 'list' ? 'map' : 'list'));
  }

  function init() {
    var search = document.getElementById('storySearch');
    if (search) {
      var onInput = U.debounce(function () { setKeyword(search.value, { locate: true }); }, 260);
      search.addEventListener('input', onInput);
      search.addEventListener('search', function () { setKeyword(search.value, { locate: true }); });
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
    function closePanel(refocus) {
      if (!panel || panel.hidden) return;
      panel.hidden = true;
      if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
      if (refocus && toggleBtn) toggleBtn.focus();
      if (VTN.map) VTN.map.fitAll();
    }

    var doneBtn = document.getElementById('filterDone');
    if (doneBtn) doneBtn.addEventListener('click', function () { closePanel(true); });
    var filterClose = document.getElementById('filterClose');
    if (filterClose) filterClose.addEventListener('click', function () { closePanel(true); });
    var clearBtn = document.getElementById('filterClear');
    if (clearBtn) clearBtn.addEventListener('click', clearFilters);
    var emptyClear = document.getElementById('storiesEmptyClear');
    if (emptyClear) emptyClear.addEventListener('click', clearFilters);

    var sortSelect = document.getElementById('filterSort');
    if (sortSelect) {
      sortSelect.addEventListener('change', function () { setSort(sortSelect.value); });
    }

    /* 地圖／列表切換 */
    var viewBtn = document.getElementById('atlasViewBtn');
    if (viewBtn) viewBtn.addEventListener('click', function () {
      setMode(state.mode === 'list' ? 'map' : 'list');
    });
    var backBtn = document.getElementById('atlasListBack');
    if (backBtn) backBtn.addEventListener('click', function () { setMode('map'); });

    /* 年代軸 */
    var eraInput = document.getElementById('atlasEra');
    if (eraInput) {
      eraInput.addEventListener('input', function () { setEra(eraInput.value, { fit: false }); });
      eraInput.addEventListener('change', function () { setEra(eraInput.value, { fit: true }); });
    }

    /* 音訊：進度、段落高亮、播放鍵狀態 */
    VTN.audio.onTime(function (seconds, storyId) {
      if (!storyId) return;
      updatePlayerProgress(seconds, storyId);
      var story = get(storyId);
      if (!story) return;
      (story.segments || []).forEach(function (seg) {
        if (seconds >= seg.start && seconds < seg.end) highlightSegment(seg.start);
      });
    });
    document.addEventListener('play', function (event) {
      if (event.target && event.target.tagName === 'AUDIO') refreshPlayerUI();
    }, true);
    document.addEventListener('pause', function (event) {
      if (event.target && event.target.tagName === 'AUDIO') refreshPlayerUI();
    }, true);
    U.on('vtn:audio-ended', function () { refreshPlayerUI(); });

    if (VTN.sheet) VTN.sheet.init();

    render();
  }

  VTN.stories = {
    init: init,
    render: render,
    all: all,
    get: get,
    visible: visible,
    filtered: filtered,
    inBbox: inBbox,
    fuzzGroups: fuzzGroups,
    select: select,
    applyParams: applyParams,
    currentParams: currentParams,
    openSource: openSource,
    openScopeDialog: openScopeDialog,
    shareUrl: shareUrl,
    setMode: setMode,
    setEra: setEra,
    eraStops: function () { return ERA_STOPS.slice(); },
    toggleType: toggleType,
    toggleOverview: toggleOverview,
    durationLabel: durationLabel,
    villageLabel: villageLabel,
    topicLabel: topicLabel,
    eraLabel: eraLabel,
    languageLabel: languageLabel,
    storyTypeOf: storyTypeOf,
    typeLabel: typeLabel,
    moodLabel: moodLabel,
    typeIcon: typeIcon,
    lastList: function () { return state.lastList; },
    selectedId: function () { return state.selectedId; },
    mode: function () { return state.mode; },
    isOverview: function () { return state.mode === 'list'; },
    meta: function () { return DATA; },
    clearFilters: clearFilters
  };
})();
