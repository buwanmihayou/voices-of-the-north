/* =============================================================================
 * 35-map — 地圖：所選故事一對一，另設「總覽」可點圈切回故事
 * -----------------------------------------------------------------------------
 * 修復：
 *   1. 以前把所有故事的圈都畫出來，圆心固定取第一則 → 現在所選故事只畫一個圈；
 *   2. 新增總覽模式，點圈可切回對應故事；
 *   3. 篩選無結果時地圖顯示「沒有符合的故事」，不再畫舊資料；
 *   4. 圖磚失敗一律降級手繪示意圖，並如實更新說明文字。
 * 私隱：只畫約 800 米模糊圈，永不顯示 GPS 精確位置。
 * ========================================================================== */

(function () {
  'use strict';

  var VTN = window.VTN;
  var U = VTN.util;

  var LEAFLET_VERSION = '1.9.4';
  var CDN = 'https://cdn.jsdelivr.net/npm/leaflet@' + LEAFLET_VERSION + '/dist/';
  var LOAD_TIMEOUT_MS = 12000;
  var TILE_TIMEOUT_MS = 6500;

  var TILE_SETS = [
    {
      name: 'osm',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      options: {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
      }
    },
    {
      name: 'esri',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      options: {
        maxZoom: 19,
        attribution: 'Tiles &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> &mdash; &copy; OpenStreetMap contributors'
      }
    }
  ];

  var map = null;
  var layerGroup = null;
  var leafletState = 'idle';   // idle | loading | ready | failed
  var lastState = { stories: [], selectedId: null, overview: false, empty: false, titleStory: null };
  var hasFit = false;

  function t(key, vars) { return VTN.i18n.t(key, vars); }

  function loadLeaflet() {
    return new Promise(function (resolve, reject) {
      if (window.L) { resolve(window.L); return; }
      if (!document.querySelector('link[data-vtn-leaflet-css]')) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = CDN + 'leaflet.min.css';
        link.dataset.vtnLeafletCss = '1';
        document.head.appendChild(link);
      }
      var existing = document.querySelector('script[data-vtn-leaflet-js]');
      if (existing) {
        existing.addEventListener('load', function () { resolve(window.L); });
        existing.addEventListener('error', reject);
        return;
      }
      var script = document.createElement('script');
      script.src = CDN + 'leaflet.min.js';
      script.async = true;
      script.dataset.vtnLeafletJs = '1';
      var timer = setTimeout(function () { reject(new Error('leaflet-timeout')); }, LOAD_TIMEOUT_MS);
      script.onload = function () { clearTimeout(timer); resolve(window.L); };
      script.onerror = function () { clearTimeout(timer); reject(new Error('leaflet-error')); };
      document.head.appendChild(script);
    });
  }

  function addTileLayerWithFallback(theMap, onFirstTile) {
    var index = 0;
    var revealed = false;
    var current = null;
    var timer = null;

    function tryNext() {
      if (revealed) return;
      if (current) { theMap.removeLayer(current); current = null; }
      if (timer) { clearTimeout(timer); timer = null; }
      if (index >= TILE_SETS.length) { onFirstTile(false); return; }

      var set = TILE_SETS[index++];
      var gotTile = false;
      current = window.L.tileLayer(set.url, Object.assign({}, set.options, {
        detectRetina: true,
        className: 'vtn-tiles-' + set.name
      }));
      current.on('tileload', function () {
        if (gotTile || revealed) return;
        gotTile = true;
        revealed = true;
        if (timer) { clearTimeout(timer); timer = null; }
        onFirstTile(true);
      });
      var errors = 0;
      current.on('tileerror', function () {
        if (gotTile || revealed) return;
        errors++;
        if (errors >= 6) tryNext();
      });
      current.addTo(theMap);
      timer = setTimeout(tryNext, TILE_TIMEOUT_MS);
    }
    tryNext();
  }

  function noteText(key) {
    var note = document.getElementById('mapTilesNote');
    if (note) note.textContent = t(key);
  }

  function setTitle(story, empty) {
    var title = document.getElementById('mapTitle');
    if (!title) return;
    if (empty) {
      title.textContent = t('map.empty');
      return;
    }
    if (!story) {
      title.textContent = t('map.overviewTitle', { n: lastState.stories.length });
      return;
    }
    var radius = (story.location && story.location.radiusM) || 800;
    title.textContent = VTN.stories.villageLabel(story.villageKey) + ' ・ ' +
      t('map.radius', { r: radius });
  }

  function updateModeButton() {
    var btn = document.getElementById('mapModeBtn');
    if (!btn) return;
    btn.textContent = lastState.overview ? t('map.backToStory') : t('map.overview');
    btn.setAttribute('aria-pressed', lastState.overview ? 'true' : 'false');
    btn.disabled = lastState.empty;
  }

  function toggleEmpty(empty) {
    var el = document.getElementById('mapEmpty');
    if (el) el.hidden = !empty;
    var mapEl = document.getElementById('vtnMap');
    if (mapEl) mapEl.style.opacity = empty ? '0' : '';
  }

  function popupNode(story) {
    var wrap = document.createElement('div');
    var title = document.createElement('strong');
    title.textContent = story.title;
    wrap.appendChild(title);
    var p = document.createElement('p');
    p.style.margin = '4px 0 0';
    p.textContent = t('map.popupBody', { r: (story.location && story.location.radiusM) || 800 });
    wrap.appendChild(p);
    return wrap;
  }

  function draw() {
    if (!map) return;
    var state = lastState;
    layerGroup.clearLayers();

    setTitle(state.empty ? null : (state.overview ? null : state.titleStory), state.empty);
    toggleEmpty(state.empty);
    updateModeButton();

    if (state.empty) {
      if (hasFit) {
        try { map.setView([22.45, 114.08], 12, { animate: false }); } catch (e) { /* ignore */ }
      }
      return;
    }

    var list = state.stories.filter(function (s) {
      return s.location && typeof s.location.lat === 'number';
    });
    if (!list.length) return;

    var drawList = state.overview ? list :
      list.filter(function (s) { return s.id === state.selectedId; });
    if (!drawList.length) drawList = [list[0]];

    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    drawList.forEach(function (story) {
      var loc = story.location;
      var radius = loc.radiusM || 800;
      var selected = story.id === state.selectedId;

      var circle = window.L.circle([loc.lat, loc.lng], {
        radius: radius,
        color: selected ? '#2C5742' : '#5E8C70',
        weight: selected ? 3.2 : 2.2,
        dashArray: '6 8',
        lineCap: 'round',
        fillColor: '#5E8C70',
        fillOpacity: selected ? 0.16 : 0.09,
        className: state.overview ? 'leaflet-vtn-circle-overview' : ''
      });

      circle.bindTooltip(
        VTN.stories.villageLabel(story.villageKey) + '・' + t('map.radius', { r: radius }),
        { direction: 'top', offset: [0, -6], opacity: 0.96, className: 'leaflet-vtn-popup' }
      );
      circle.bindPopup(popupNode(story), { className: 'leaflet-vtn-popup', closeButton: true, offset: [0, -4] });

      circle.on('click', function () {
        if (state.overview) {
          VTN.stories.select(story.id);
        }
      });

      circle.addTo(layerGroup);
    });

    try {
      var bounds = layerGroup.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, {
          padding: [28, 28],
          animate: false,
          maxZoom: drawList.length === 1 ? 15 : 13
        });
        hasFit = true;
      }
    } catch (e) { /* ignore */ }

    if (reduceMotion) map.options.zoomAnimation = false;
  }

  function init() {
    if (leafletState === 'loading' || leafletState === 'ready') return;
    var el = document.getElementById('vtnMap');
    var loading = document.getElementById('mapLoading');
    if (!el) return;

    leafletState = 'loading';
    loadLeaflet().then(function (L) {
      if (map) return;
      map = L.map(el, {
        center: [22.45, 114.08],
        zoom: 13,
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: false,
        tap: true
      });
      map.once('focus click', function () { map.scrollWheelZoom.enable(); });
      L.control.scale({ imperial: false, maxWidth: 110 }).addTo(map);
      layerGroup = L.featureGroup().addTo(map);

      addTileLayerWithFallback(map, function (ok) {
        if (ok) {
          requestAnimationFrame(function () {
            map.invalidateSize();
            draw();
            el.classList.add('is-ready');
            el.classList.remove('is-failed');
            if (loading) loading.classList.add('is-hidden');
            noteText('map.tilesNote');
          });
        } else {
          fail('tiles');
        }
      });
      leafletState = 'ready';
      draw();
    }).catch(function () {
      fail('leaflet');
    });

    function fail(reason) {
      leafletState = 'failed';
      el.classList.add('is-failed');
      if (loading) loading.classList.add('is-hidden');
      noteText(reason === 'tiles' ? 'map.fallbackTiles' : 'map.fallback');
    }
  }

  function update(state) {
    lastState = {
      stories: state.stories || [],
      selectedId: state.selectedId || null,
      overview: !!state.overview,
      empty: !!state.empty,
      titleStory: state.titleStory || null
    };
    if (leafletState === 'failed') {
      setTitle(lastState.empty ? null : lastState.titleStory, lastState.empty);
      toggleEmpty(lastState.empty);
      updateModeButton();
      return;
    }
    if (!map) {
      /* Leaflet 未載入時：至少更新標題、空狀態與模式按鈕 */
      setTitle(lastState.empty ? null : lastState.titleStory, lastState.empty);
      toggleEmpty(lastState.empty);
      updateModeButton();
      return;
    }
    draw();
  }

  function ensureVisible() {
    if (!map) { init(); return; }
    try { map.invalidateSize(); } catch (e) { /* ignore */ }
    draw();
  }

  function reset() {
    if (map) { try { map.remove(); } catch (e) { /* ignore */ } }
    map = null;
    layerGroup = null;
    leafletState = 'idle';
    hasFit = false;
  }

  VTN.map = {
    init: init,
    update: update,
    ensureVisible: ensureVisible,
    reset: reset,
    status: function () { return leafletState; }
  };
})();
