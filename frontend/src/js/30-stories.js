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

  /* 任務 1/2/4：純前端 Mock 注入（不改 data/stories.json）。
     - 任務 1：前 2 則影片、第 3 則圖片；其餘仍走 resolveMedia 的 audio 降級。
     - 任務 2：標記指定 ID 為 author='me'，供「我的故事」篩選。
     - 任務 4：注入整體與逐段轉錄置信度（演示用，確定性分佈）。 */
  function augmentMockData(data) {
    var stories = (data && data.stories) || [];
    var VIDEO = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
    var IMG = 'https://picsum.photos/800/450';
    var MINE = ['YL-001', 'FL-003', 'STN-009'];
    var confLevels = [0.95, 0.72, 0.34, null, 0.9, 0.58, 0.2, 0.88, 0.46, null, 0.83, 0.3, 0.91];
    stories.forEach(function (s, i) {
      /* 相容性：資料若已含 mediaType/mediaUrl（未來正式錄入）則保留，不覆蓋 */
      if (!Object.prototype.hasOwnProperty.call(s, 'mediaType')) {
        if (i === 0 || i === 1) { s.mediaType = 'video'; s.mediaUrl = s.mediaUrl || VIDEO; }
        else if (i === 2) { s.mediaType = 'image'; s.mediaUrl = s.mediaUrl || IMG; }
      }
      if (MINE.indexOf(s.id) !== -1 && s.author == null) s.author = 'me';
      /* null 是合法的「無數據」狀態，不可被 Mock 覆蓋 */
      if (!Object.prototype.hasOwnProperty.call(s, 'confidence')) s.confidence = confLevels[i % confLevels.length];
      (s.segments || []).forEach(function (seg, j) {
        if (!Object.prototype.hasOwnProperty.call(seg, 'confidence')) seg.confidence = (j % 3 === 2) ? 0.35 : 0.92;
      });
    });
  }
  augmentMockData(DATA);

  /* 五個固定年代區間；「全部」是獨立狀態，不佔用滑軸刻度。
     只篩選故事，不假裝切換歷史底圖。 */
  var ERA_STOPS = [1950, 1960, 1970, 1980, 1990];
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
    filters: { type: [], location: [], topic: [], era: [], language: [], keyword: '', sort: 'newest', media: 'all' },
    mode: 'map',              // map | list
    eraIndex: null,           // null = 全部年代；0–4 = 指定年代
    selectedId: null,
    overview: false,
    playingSegment: null,
    onlyMine: false,
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
  function inBbox(bounds, stories) {
    var list = stories || visible();
    if (!bounds || bounds.length !== 2) return list;
    var sw = bounds[0], ne = bounds[1];
    if (!sw || !ne || sw.length !== 2 || ne.length !== 2) return list;
    return list.filter(function (story) {
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

  /* 英文介面優先顯示 titleEn；沒有英文標題時回退中文，不空白。 */
  function storyTitle(story) {
    if (!story) return '';
    if (VTN.i18n.lang() === 'en' && story.titleEn) return story.titleEn;
    return story.title || '';
  }

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
    if (typeof story.year === 'number' && isFinite(story.year)) return story.year;
    var era = String(story.eraKey || '').replace(/s$/, '');
    var parsed = parseInt(era, 10);
    return isFinite(parsed) ? parsed + 5 : null;
  }

  function selectedEra() {
    return state.eraIndex === null ? null : ERA_STOPS[state.eraIndex];
  }

  function matchesEra(story) {
    if (state.eraIndex === null) return true;
    var year = yearOf(story);
    if (year === null) return false;
    var era = selectedEra();
    return state.eraIndex === 0 ? year < 1960 :
      year >= era && (state.eraIndex === ERA_STOPS.length - 1 || year < era + 10);
  }

  function eraTickLabel(index) {
    return String(ERA_STOPS[index]) + (index === ERA_STOPS.length - 1 ? '+' : '');
  }

  function eraLabelText() {
    return state.eraIndex === null ? t('atlas.eraAll') :
      t(state.eraIndex === 0 ? 'atlas.era1950' :
        state.eraIndex === ERA_STOPS.length - 1 ? 'atlas.era1990' : 'atlas.eraDecade',
      { y: selectedEra() });
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

  /* 媒體類型篩選：'all' | 'video' | 'image'（與其他條件在 matches 取交集） */
  function setMediaFilter(value) {
    state.filters.media = (value === 'video' || value === 'image') ? value : 'all';
    syncUrl();
    render();
  }

  function clearFilters() {
    state.filters = { type: [], location: [], topic: [], era: [], language: [], keyword: '', sort: state.filters.sort, media: 'all' };
    state.eraIndex = null;
    state.onlyMine = false;
    var search = document.getElementById('storySearch');
    if (search) search.value = '';
    var era = document.getElementById('atlasEra');
    if (era) era.value = '0';
    syncUrl();
    render();
  }

  function activeCount() {
    var f = state.filters;
    var count = f.type.length + f.location.length + f.topic.length + f.era.length +
      f.language.length + (f.keyword ? 1 : 0);
    if (f.media && f.media !== 'all') count++;
    if (state.eraIndex !== null) count++;
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
    return matchesEra(story);
  }

  function matches(story) {
    var f = state.filters;
    if (state.onlyMine && story.author !== 'me') return false;
    /* 媒體類型與地點／年代／主題／關鍵詞同屬 AND 鏈，天然取交集 */
    if (f.media && f.media !== 'all' && story.mediaType !== f.media) return false;
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

  /* 問題送出時擷取同一份集合，API 與離線檢索沿用；非地圖頁不帶隱藏視口。 */
  function queryContext(options) {
    var opts = options || {};
    var onStories = document.body.getAttribute('data-view') === 'stories';
    var list = onStories ? filtered() : visible();
    var bounds = Object.prototype.hasOwnProperty.call(opts, 'bbox') ? opts.bbox :
      (onStories && state.mode === 'map' && VTN.map && VTN.map.bbox ? VTN.map.bbox() : null);
    if (!Array.isArray(bounds) || bounds.length !== 2 ||
        !Array.isArray(bounds[0]) || !Array.isArray(bounds[1]) ||
        bounds[0].length !== 2 || bounds[1].length !== 2 ||
        !bounds[0].concat(bounds[1]).every(function (n) { return typeof n === 'number' && isFinite(n); })) {
      bounds = null;
    }
    list = inBbox(bounds, list);
    return {
      storyIds: list.map(function (story) { return story.id; }),
      bbox: bounds ? [bounds[0].slice(), bounds[1].slice()] : null,
      includeRecords: !onStories
    };
  }

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
    if (f.media && f.media !== 'all') params.media = f.media;
    if (f.sort && f.sort !== 'newest') params.sort = f.sort;
    if (state.selectedId) params.story = state.selectedId;
    if (state.mode === 'list') params.view = 'list';
    if (state.eraIndex !== null) params.decade = selectedEra();
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
    f.media = (params.media === 'video' || params.media === 'image') ? params.media : 'all';
    f.sort = params.sort || 'newest';
    state.mode = params.view === 'list' ? 'list' : 'map';
    state.overview = false;
    state.selectedId = params.story || null;

    /* decade 明確表示新的區間語義；舊 since 連結映射到對應年代，
       舊版最後一格（1990 或以後）仍視為全部。 */
    var decade = Number(params.decade);
    var since = Number(params.since);
    state.eraIndex = null;
    if (params.decade !== undefined) {
      if (ERA_STOPS.indexOf(decade) !== -1) state.eraIndex = ERA_STOPS.indexOf(decade);
    } else if (since && isFinite(since) && since < 1990) {
      var mapped = 0;
      ERA_STOPS.forEach(function (year, index) {
        if (year <= since) mapped = index;
      });
      state.eraIndex = mapped;
    }

    var search = document.getElementById('storySearch');
    if (search && search.value !== f.keyword) search.value = f.keyword;
    var sortSelect = document.getElementById('filterSort');
    if (sortSelect) sortSelect.value = f.sort;
    var era = document.getElementById('atlasEra');
    if (era && state.eraIndex !== null) era.value = String(state.eraIndex);
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
      var pm = resolveMedia(story);
      if (pm.type === 'audio') {
        VTN.audio.playStory(story.id, opts.playAt);
        highlightSegment(opts.playAt);
      } else if (VTN.media && VTN.media.open) {
        VTN.media.open(story, opts.playAt);
      }
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

  /* 同步媒體 chip 的選中態（含 URL 參數載入後的回填） */
  function syncMediaChips() {
    var row = document.getElementById('filterMedia');
    if (!row) return;
    Array.prototype.forEach.call(row.querySelectorAll('[data-media]'), function (btn) {
      var active = btn.getAttribute('data-media') === state.filters.media;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  /* 依需求：頂部不再列出已選條件的小標籤（filter-summary__chip）。
     篩選狀態改由漏斗按鈕角標數字與篩選面板內的選中態呈現。 */
  function renderSummary() {
    var host = document.getElementById('filterSummary');
    var badge = document.getElementById('filterBadge');
    var toggle = document.getElementById('filterToggle');
    if (host) host.textContent = '';

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
    body.appendChild(U.node('span', { class: 'story-item__title', text: storyTitle(story) }));
    body.appendChild(confidenceBadge(story));
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

    /* 空狀態：僅在「媒體篩選生效且結果為 0」時換成專屬文案，其餘維持既有「沒有符合的故事」 */
    var title = document.getElementById('storiesEmptyTitle');
    var mediaTitle = document.getElementById('storiesEmptyMedia');
    var media = state.filters.media;
    var mediaEmpty = list.length === 0 && (media === 'video' || media === 'image');
    if (title) title.hidden = mediaEmpty;
    if (mediaTitle) {
      if (mediaEmpty) {
        var key = media === 'video' ? 'stories.emptyVideo' : 'stories.emptyImage';
        mediaTitle.setAttribute('data-i18n', key);
        mediaTitle.textContent = t(key);
        mediaTitle.hidden = false;
      } else {
        mediaTitle.hidden = true;
        mediaTitle.removeAttribute('data-i18n');
      }
    }
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

  /* 萬能媒體區塊（二級入口 + 三級全屏 Overlay）的資料解析與降級邏輯。
     - mediaType: 'video' | 'image'（未來由錄入寫入 data/stories.json；現由 augmentMockData 演示注入）
     - mediaUrl: 對應媒體連結（缺省則回退 Mock 源）
     - 無 mediaType 時回退為 audio（null 降級）
     - 片源容錯：影片回退公開測試影片；圖片回退 cover / 內嵌佔位（均非真實長者影像） */
  var MOCK_VIDEO = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

  function resolveMedia(story) {
    var ty = story && story.mediaType;
    if (ty !== 'video' && ty !== 'image') return { type: 'audio', url: null };
    return { type: ty, url: mediaUrlOf(story, ty) };
  }

  function mockImageDataUri(story) {
    var title = U.escapeHtml(storyTitle(story) || '示範圖片');
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450">' +
      '<rect width="100%" height="100%" fill="#1f3329"/>' +
      '<text x="50%" y="48%" fill="#cfe8d8" font-size="34" font-family="sans-serif" ' +
      'text-anchor="middle" dominant-baseline="middle">' + title + '</text>' +
      '<text x="50%" y="60%" fill="#9bbfab" font-size="18" font-family="sans-serif" ' +
      'text-anchor="middle" dominant-baseline="middle">示範圖片（非真實長者影像）</text>' +
      '</svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  function mediaUrlOf(story, type) {
    var u = story && story.mediaUrl;
    if (typeof u === 'string' && u.trim()) return u.trim();
    if (type === 'image') return (story && story.cover) ? story.cover : mockImageDataUri(story);
    return MOCK_VIDEO;
  }

  /* 三級頁的影片跳秒、圖片高亮與音頻降級邏輯請見 33-media.js（renderUniversalMedia） */

  function pauseStoryVideo() {
    var video = document.getElementById('storyVideo');
    if (video && !video.paused) { try { video.pause(); } catch (e) { /* ignore */ } }
  }

  /* 二級頁（半拉抽屜）：有媒體時顯示「查看多媒體故事」入口，點擊進入三級頁 */
  function mediaLaunchNode(story, media) {
    var node = U.node('div', { class: 'story-media-launch' });
    var btn = U.node('button', {
      class: 'story-media-launch__btn', type: 'button', 'aria-label': t('media.launch')
    });
    var thumb = U.node('div', { class: 'story-media-launch__thumb story-media-launch__thumb--' + media.type });
    if (media.type === 'image') {
      thumb.appendChild(U.node('img', {
        class: 'story-media-launch__img', src: media.url,
        alt: t('atlas.imageAlt', { title: storyTitle(story) }), loading: 'lazy'
      }));
    } else {
      thumb.appendChild(U.node('span', {
        class: 'story-media-launch__play', html: '<i class="fa-solid fa-play" aria-hidden="true"></i>'
      }));
    }
    var txt = U.node('div', { class: 'story-media-launch__text' });
    txt.appendChild(U.node('span', { class: 'story-media-launch__title', text: t('media.launch') }));
    txt.appendChild(U.node('span', { class: 'story-media-launch__hint', text: t('media.launchHint') }));
    btn.appendChild(thumb);
    btn.appendChild(txt);
    btn.addEventListener('click', function () {
      if (VTN.media && VTN.media.open) VTN.media.open(story);
    });
    node.appendChild(btn);
    return node;
  }

  /* 二級頁（null 媒體）與三級頁降級共用的精簡音頻播放器 */
  function audioPlayerNode(story) {
    var wrap = U.node('div', { class: 'player player--audio', 'data-player-story': story.id });
    var btn = U.node('button', {
      class: 'player__btn', type: 'button', 'data-role': 'play',
      'aria-label': t('atlas.playAria', { title: storyTitle(story) })
    });
    btn.innerHTML = '<i class="fa-solid fa-play" aria-hidden="true"></i>';

    var main = U.node('div', { class: 'player__main' });
    var track = U.node('div', {
      class: 'player__track', 'data-role': 'track', role: 'slider',
      'aria-label': t('atlas.seekAria'), 'aria-valuemin': '0',
      'aria-valuemax': String(Math.round(story.durationSec || 0)), 'aria-valuenow': '0', tabindex: '0'
    });
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

    function updateAudioUI() {
      var playing = VTN.audio.playingStoryId() === story.id;
      btn.classList.toggle('is-playing', playing);
      btn.innerHTML = '<i class="fa-solid ' + (playing ? 'fa-pause' : 'fa-play') + '" aria-hidden="true"></i>';
      btn.setAttribute('aria-label', playing ? t('atlas.pauseAria') : t('atlas.playAria', { title: storyTitle(story) }));
    }
    btn.addEventListener('click', function () {
      if (VTN.audio.playingStoryId() === story.id) { VTN.audio.pauseStory(); updateAudioUI(); }
      else VTN.audio.playStory(story.id, 0);
      setTimeout(updateAudioUI, 120);
    });
    track.addEventListener('click', function (event) {
      var rect = track.getBoundingClientRect();
      var ratio = U.clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      VTN.audio.playStory(story.id, ratio * (story.durationSec || 0));
      setTimeout(updateAudioUI, 120);
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
      setTimeout(updateAudioUI, 120);
    });

    /* 自行接線進度（二級由全局 onTime 處理；三級音頻降級時需此處更新） */
    if (VTN.audio.onTime) {
      VTN.audio.onTime(function (sec, sid) {
        if (sid !== story.id || !wrap.isConnected) return;
        var ratio = U.clamp(sec / Math.max(1, story.durationSec), 0, 1);
        var fill = wrap.querySelector('[data-role="fill"]');
        var now = wrap.querySelector('[data-role="now"]');
        var tk = wrap.querySelector('[data-role="track"]');
        if (fill) fill.style.width = (ratio * 100).toFixed(2) + '%';
        if (now) now.textContent = U.fmtTime(sec);
        if (tk) {
          tk.setAttribute('aria-valuenow', String(Math.round(sec)));
          tk.style.setProperty('--played', (ratio * 100).toFixed(2) + '%');
        }
        var playing = VTN.audio.playingStoryId() === story.id;
        btn.classList.toggle('is-playing', playing);
        btn.innerHTML = '<i class="fa-solid ' + (playing ? 'fa-pause' : 'fa-play') + '" aria-hidden="true"></i>';
      });
    }
    return wrap;
  }

  /* 逐字稿區塊（二級與三級頁共用）；seek 回調由呼叫方決定（音頻或影片） */
  function buildTranscript(story, seek) {
    var section = U.node('div', { class: 'story-sheet__section' });
    var head = U.node('div', { class: 'story-sheet__section-head' });
    head.appendChild(U.node('h3', { class: 'story-sheet__section-title', text: t('story.transcriptHint') }));
    var segments = story.segments || [];
    var expanded = false;
    var toggle = null;
    if (segments.length > 2) {
      toggle = U.node('button', { class: 'story-sheet__toggle', type: 'button', text: t('atlas.expandAll') });
      head.appendChild(toggle);
    }
    section.appendChild(head);

    var list = U.node('div', { class: 'segments' });
    segments.forEach(function (seg, index) {
      var btn = U.node('button', { class: 'segment', type: 'button' });
      if (index >= 2) btn.classList.add('is-collapsed');
      btn.appendChild(U.node('span', { class: 'segment__t', text: U.fmtTime(seg.start) }));
      var low = typeof seg.confidence === 'number' && seg.confidence < 0.5;
      var textNode = U.node('span', { class: 'segment__text', text: seg.text });
      if (low) {
        textNode.classList.add('segment__text--low');
        textNode.setAttribute('title', t('conf.tooltip'));
        textNode.setAttribute('data-conf-tip', t('conf.tooltip'));
        textNode.setAttribute('data-i18n-title', 'conf.tooltip');
      }
      btn.appendChild(textNode);
      btn.setAttribute('data-start', seg.start);
      btn.addEventListener('click', function () {
        state.playingSegment = index;
        Array.prototype.forEach.call(list.querySelectorAll('.segment'), function (el) {
          el.classList.toggle('is-playing', Math.abs(Number(el.getAttribute('data-start')) - Number(seg.start)) < 0.6);
        });
        seek(seg.start);
        if (low) VTN.ui.toast(t('conf.tooltip'), 'info');
      });
      list.appendChild(btn);
    });
    section.appendChild(list);

    if (toggle) {
      toggle.addEventListener('click', function () {
        expanded = !expanded;
        Array.prototype.forEach.call(list.querySelectorAll('.segment'), function (el, idx) {
          if (idx < 2) return;
          el.classList.toggle('is-collapsed', !expanded);
        });
        toggle.textContent = expanded ? t('atlas.collapseAll') : t('atlas.expandAll');
      });
    }
    return section;
  }

  /* 任務 4：整體轉錄置信度彩色徽章（高/中/低/無數據） */
  function confidenceBadge(story) {
    var c = (story && typeof story.confidence === 'number') ? story.confidence : null;
    var level = c == null ? 'none' : (c >= 0.8 ? 'high' : (c >= 0.5 ? 'mid' : 'low'));
    var key = 'conf.' + level;
    var b = U.node('span', { class: 'confidence-badge confidence-badge--' + level, text: t(key) });
    b.setAttribute('data-i18n', key);
    b.setAttribute('title', t('conf.ariaPrefix') + t(key));
    b.setAttribute('aria-label', t('conf.ariaPrefix') + t(key));
    return b;
  }

  /* 任務 2：「我的故事」切換按鈕（篩選列） */
  function syncMineBtn(btn) {
    if (!btn) return;
    btn.classList.toggle('is-active', !!state.onlyMine);
    btn.setAttribute('aria-pressed', state.onlyMine ? 'true' : 'false');
  }

  function onMineClick() {
    var role = (VTN.store && VTN.store.role) ? VTN.store.role() : 'visitor';
    if (role === 'visitor') {
      VTN.ui.toast(t('stories.mineLogin'), 'info');
      if (VTN.account && VTN.account.openLogin) VTN.account.openLogin();
      return;
    }
    state.onlyMine = !state.onlyMine;
    syncMineBtn(document.getElementById('filterMine'));
    render();
  }

  function renderMineToggle() {
    var btn = document.getElementById('filterMine');
    if (!btn) {
      btn = U.node('button', { class: 'chip chip--toggle', type: 'button', id: 'filterMine' });
      btn.innerHTML = '<i class="fa-solid fa-user" aria-hidden="true"></i>';
      var label = U.node('span', { text: t('stories.mine') });
      label.setAttribute('data-i18n', 'stories.mine');
      btn.appendChild(label);
      var anchor = document.getElementById('filterToggle');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor.nextSibling);
      btn.addEventListener('click', onMineClick);
    }
    syncMineBtn(btn);
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
      btn.setAttribute('aria-label', playing ? t('atlas.pauseAria') : t('atlas.playAria', { title: storyTitle(story) }));
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
    body.appendChild(U.node('h2', { class: 'sheet-hero__title', text: storyTitle(story) }));
    body.appendChild(confidenceBadge(story));
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

    var media = resolveMedia(story);
    if (media.type === 'audio') {
      host.appendChild(audioPlayerNode(story));
    } else {
      host.appendChild(mediaLaunchNode(story, media));
    }

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

    /* 逐字稿：二級頁點時間戳 → 音頻跳播；三級頁由 VTN.media 自行接線 */
    var audioSeek = function (sec) { VTN.audio.playStory(story.id, sec); };
    host.appendChild(buildTranscript(story, audioSeek));

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
    var chosen = VTN.store.scopeOf(item);
    var body = U.node('div');
    var cards = {};

    function renderScopeBody() {
      body.textContent = '';
      cards = {};
      body.appendChild(U.node('p', {
        text: t('scope.intro', { title: item.title || '' })
      }));

      VTN.SCOPES.forEach(function (scope) {
        var meta = VTN.SCOPE_META[scope];
        var label = U.node('label', { class: 'radio-card' + (scope === chosen ? ' is-active' : '') });
        var input = U.node('input', { type: 'radio', name: 'vtn-scope', value: scope });
        input.checked = scope === chosen;
        var text = U.node('span');
        text.appendChild(U.node('span', {
          class: 'radio-card__title', 'data-i18n': meta.labelKey, text: t(meta.labelKey)
        }));
        text.appendChild(U.node('span', {
          class: 'radio-card__hint', 'data-i18n': meta.hintKey, text: t(meta.hintKey)
        }));
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
    }
    renderScopeBody();

    var dlg = VTN.ui.dialog({
      titleKey: 'scope.title',
      body: body,
      i18nRefresh: renderScopeBody,
      actions: [
        { labelKey: 'common.cancel', kind: 'quiet' },
        {
          labelKey: 'common.save',
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
    body.appendChild(U.node('span', { class: 'story-item__title', text: storyTitle(story) }));
    body.appendChild(confidenceBadge(story));
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
    /* 保留按鈕節點，拖動重繪與語言切換時不丟失鍵盤焦點。 */
    if (ticks.children.length === ERA_STOPS.length) return;
    ticks.textContent = '';
    ERA_STOPS.forEach(function (year, index) {
      ticks.appendChild(U.node('button', {
        type: 'button',
        'class': 'atlas__tick',
        'data-era-index': index,
        text: eraTickLabel(index),
        onclick: function () { filterStoriesByEra(year); }
      }));
    });
  }

  function updateEraUI() {
    var allEras = state.eraIndex === null;
    var timeline = document.getElementById('atlasTimeline');
    if (timeline) timeline.classList.toggle('is-all', allEras);
    var allButton = document.getElementById('atlasEraAll');
    if (allButton) allButton.setAttribute('aria-pressed', allEras ? 'true' : 'false');
    var ticks = document.getElementById('atlasTicks');
    if (ticks) {
      renderEraTicks(ticks);
      Array.prototype.forEach.call(ticks.children, function (node, index) {
        var active = !allEras && index === state.eraIndex;
        node.classList.toggle('is-active', active);
        node.setAttribute('aria-pressed', active ? 'true' : 'false');
        node.setAttribute('aria-label', t(index === 0 ? 'atlas.era1950' :
          index === ERA_STOPS.length - 1 ? 'atlas.era1990' : 'atlas.eraDecade',
        { y: ERA_STOPS[index] }));
      });
    }
    var input = document.getElementById('atlasEra');
    if (input) {
      input.max = String(ERA_STOPS.length - 1);
      if (!allEras && input.value !== String(state.eraIndex)) input.value = String(state.eraIndex);
      input.setAttribute('aria-valuetext', eraLabelText());
    }
  }

  /* 年代只改故事集合；視角由使用者縮放、拖動及重新置中控制。 */
  function setEra(index) {
    var value = Number(index);
    state.eraIndex = index === 'all' || index === null || !isFinite(value) ? null :
      U.clamp(Math.round(value), 0, ERA_STOPS.length - 1);
    syncUrl();
    render();
  }

  function filterStoriesByEra(era) {
    var index = ERA_STOPS.indexOf(Number(String(era).replace(/\+$/, '')));
    setEra(era === 'all' || index === -1 ? 'all' : index);
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
      body.appendChild(U.node('span', { class: 'peek-card__title', text: storyTitle(story) }));
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
    syncMediaChips();
    renderMineToggle();
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
        eraYear: selectedEra(),
        empty: list.length === 0
      });
    }
  }

  function refreshFromServer() {
    if (!VTN.api || !VTN.api.stories) return Promise.resolve(false);
    return VTN.api.stories().then(function (stories) {
      if (!Array.isArray(stories) || !stories.length) return false;
      DATA.stories = stories;
      render();
      return true;
    }).catch(function () {
      return false;
    });
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

    /* 媒體類型 chip：事件委托，點選後與其他篩選條件取交集 */
    var mediaRow = document.getElementById('filterMedia');
    if (mediaRow) mediaRow.addEventListener('click', function (event) {
      var btn = event.target.closest ? event.target.closest('[data-media]') : null;
      if (btn && mediaRow.contains(btn)) setMediaFilter(btn.getAttribute('data-media'));
    });

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
    var eraAll = document.getElementById('atlasEraAll');
    if (eraAll) eraAll.addEventListener('click', function () {
      filterStoriesByEra('all');
    });
    var eraInput = document.getElementById('atlasEra');
    if (eraInput) {
      eraInput.addEventListener('input', function () { setEra(eraInput.value); });
      eraInput.addEventListener('change', function () { setEra(eraInput.value); });
      /* 點擊目前滑塊位置、或在端點按 Home/End，也能從「全部」進入年代。 */
      eraInput.addEventListener('pointerup', function () {
        if (state.eraIndex === null) setEra(eraInput.value);
      });
      eraInput.addEventListener('keyup', function (event) {
        if (state.eraIndex === null && /^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown)$/.test(event.key)) {
          setEra(eraInput.value);
        }
      });
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
    refreshFromServer();
  }

  VTN.stories = {
    init: init,
    render: render,
    all: all,
    get: get,
    visible: visible,
    refreshFromServer: refreshFromServer,
    filtered: filtered,
    inBbox: inBbox,
    queryContext: queryContext,
    fuzzGroups: fuzzGroups,
    select: select,
    applyParams: applyParams,
    pauseVideo: pauseStoryVideo,
    resolveMedia: resolveMedia,
    audioPlayerNode: audioPlayerNode,
    buildTranscript: buildTranscript,
    currentParams: currentParams,
    openSource: openSource,
    openScopeDialog: openScopeDialog,
    shareUrl: shareUrl,
    setMode: setMode,
    setEra: setEra,
    filterStoriesByEra: filterStoriesByEra,
    setMediaFilter: setMediaFilter,
    eraStops: function () { return ERA_STOPS.slice(); },
    toggleType: toggleType,
    toggleOverview: toggleOverview,
    durationLabel: durationLabel,
    villageLabel: villageLabel,
    topicLabel: topicLabel,
    eraLabel: eraLabel,
    languageLabel: languageLabel,
    storyTitle: storyTitle,
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
