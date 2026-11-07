/* =============================================================================
 * 35-map — 故事地圖（MapLibre GL JS 3D 主引擎 + Leaflet 2D 兜底）
 * -----------------------------------------------------------------------------
 * 為什麼是 MapLibre 而不是 Mapbox：
 *   * 同樣做到 2D/3D、pitch、建築擠出，但不需要 access token；
 *   * 底圖用 OpenFreeMap（免費、無 key），Mapbox 免費額度用完會即場斷圖；
 *   * 失敗時自動退回 Leaflet + OSM，再失敗才用手繪示意圖，路演不會開天窗。
 *
 * 私隱：
 *   * 只畫約 800 米模糊圈，永不顯示精確 GPS；
 *   * private 故事由 store / 伺服器過濾，地圖永遠收不到座標。
 *
 * 一級資訊：
 *   * 顏色＋圖標＝故事類型；小圓點＝講者心情（人工標註，非 AI 推斷）；
 *   * 低縮放用數字聚合，放大後展開為單一圖標。
 * ========================================================================== */

(function () {
  'use strict';

  var VTN = window.VTN;
  var U = VTN.util;

  var MAPLIBRE_VERSION = '4.7.1';
  var MAPLIBRE_CDN = 'https://cdn.jsdelivr.net/npm/maplibre-gl@' + MAPLIBRE_VERSION + '/dist/';
  var DEFAULT_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
  var LEAFLET_VERSION = '1.9.4';
  var LEAFLET_CDN = 'https://cdn.jsdelivr.net/npm/leaflet@' + LEAFLET_VERSION + '/dist/';
  var HK_CENTER = [114.085, 22.468];
  var STYLE_TIMEOUT_MS = 11000;
  var LOAD_TIMEOUT_MS = 12000;
  var PIN_MIN_ZOOM = 9.4;

  var el = null;
  var ml = null;                 // MapLibre 實例
  var leaflet = null;            // Leaflet 實例（兜底）
  var leafletLayer = null;
  var engine = 'idle';           // idle | loading | maplibre | leaflet | failed
  var markers = {};
  var is3D = false;
  var booted = false;

  var state = {
    stories: [],
    selectedId: null,
    empty: false,
    mode: 'map',
    eraYear: null
  };

  function t(key, vars) { return VTN.i18n.t(key, vars); }
  function byId(id) { return document.getElementById(id); }

  /* =========================================================================
   * 1. 圖標與色板（一級資訊）
   * ======================================================================= */
  var TYPE_ICON = {
    festival: 'fa-fire',
    farming: 'fa-wheat-awn',
    migration: 'fa-route',
    architecture: 'fa-building-columns',
    oral: 'fa-microphone-lines',
    market: 'fa-basket-shopping',
    other: 'fa-feather-pointed'
  };

  function typeOf(story) {
    return story && story.storyType && TYPE_ICON[story.storyType] ? story.storyType : 'other';
  }

  function iconOf(story) {
    return TYPE_ICON[typeOf(story)];
  }

  /* =========================================================================
   * 2. 載入外部腳本
   * ======================================================================= */
  function loadScript(src, marker, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-vtn-' + marker + ']');
      if (existing) {
        existing.addEventListener('load', function () { resolve(); });
        existing.addEventListener('error', function () { reject(new Error(marker + '-error')); });
        return;
      }
      var script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.setAttribute('data-vtn-' + marker, '1');
      var timer = setTimeout(function () { reject(new Error(marker + '-timeout')); }, timeoutMs || LOAD_TIMEOUT_MS);
      script.onload = function () { clearTimeout(timer); resolve(); };
      script.onerror = function () { clearTimeout(timer); reject(new Error(marker + '-error')); };
      document.head.appendChild(script);
    });
  }

  function loadCss(href, marker) {
    if (document.querySelector('link[data-vtn-' + marker + ']')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-vtn-' + marker, '1');
    document.head.appendChild(link);
  }

  /* =========================================================================
   * 3. 幾何：800 米模糊圈
   * ======================================================================= */
  function circlePolygon(lng, lat, radiusM) {
    var points = [];
    var earth = 6378137;
    var d = radiusM / earth;
    var lat1 = lat * Math.PI / 180;
    var lng1 = lng * Math.PI / 180;
    for (var i = 0; i <= 64; i++) {
      var bearing = i * 2 * Math.PI / 64;
      var lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) +
        Math.cos(lat1) * Math.sin(d) * Math.cos(bearing));
      var lng2 = lng1 + Math.atan2(
        Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
        Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
      );
      points.push([lng2 * 180 / Math.PI, lat2 * 180 / Math.PI]);
    }
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [points] }
    };
  }

  function located() {
    return state.stories.filter(function (story) {
      return story.location && typeof story.location.lat === 'number' &&
        typeof story.location.lng === 'number';
    });
  }

  function boundsOf(list) {
    if (!list.length) return null;
    var west = 180, south = 90, east = -180, north = -90;
    list.forEach(function (story) {
      var loc = story.location;
      west = Math.min(west, loc.lng);
      east = Math.max(east, loc.lng);
      south = Math.min(south, loc.lat);
      north = Math.max(north, loc.lat);
    });
    /* 單一故事時給一點呼吸空間（不是精確定位，仍以模糊圈為中心） */
    var padLng = Math.max((east - west) * 0.15, 0.012);
    var padLat = Math.max((north - south) * 0.15, 0.012);
    return [[west - padLng, south - padLat], [east + padLng, north + padLat]];
  }

  /* =========================================================================
   * 4. MapLibre：建立與圖層
   * ======================================================================= */
  function setNote(key) {
    var note = byId('mapTilesNote');
    if (note) note.textContent = t(key);
  }

  function hideLoading() {
    var loading = byId('mapLoading');
    if (loading) loading.classList.add('is-hidden');
  }

  function createMapLibre() {
    engine = 'loading';
    var styleUrl = window.VTN_MAP_STYLE || DEFAULT_STYLE;
    loadCss(MAPLIBRE_CDN + 'maplibre-gl.css', 'maplibre-css');

    loadScript(MAPLIBRE_CDN + 'maplibre-gl.js', 'maplibre-js').then(function () {
      if (!window.maplibregl) throw new Error('maplibre-missing');
      if (window.maplibregl.supported && !window.maplibregl.supported({ failIfMajorPerformanceCaveat: false })) {
        throw new Error('webgl-unsupported');
      }
      var loaded = false;
      ml = new window.maplibregl.Map({
        container: el,
        style: styleUrl,
        center: HK_CENTER,
        zoom: 12,
        pitch: 0,
        bearing: 0,
        maxPitch: 70,
        attributionControl: false,
        dragRotate: true,
        antialias: true
      });

      /* 署名放在自訂的 #mapTilesNote 內，避免與底部年代軸打架 */
      var styleTimer = setTimeout(function () {
        if (!loaded) fallbackToLeaflet('style-timeout');
      }, STYLE_TIMEOUT_MS);

      ml.on('load', function () {
        loaded = true;
        clearTimeout(styleTimer);
        engine = 'maplibre';
        el.classList.add('is-ready');
        el.classList.remove('is-failed');
        hideLoading();
        setNote('atlas.tiles.maplibre');
        addStorySources();
        render(true);
        fitAll();
      });

      ml.on('error', function (event) {
        var message = event && event.error ? String(event.error.message || '') : '';
        if (!loaded && /style|sprite|glyphs|source|network|fetch/i.test(message)) {
          /* 只記錄；真正降級交由 styleTimer 決定，避免個別 tile 404 就全盤放棄 */
          if (window.console) console.warn('[VTN] map style warning', message);
        }
      });

      ml.on('click', function (event) {
        var features = [];
        try {
          features = ml.queryRenderedFeatures(event.point, { layers: ['vtn-cluster'] });
        } catch (e) { features = []; }
        if (features.length) {
          var clusterId = features[0].properties.cluster_id;
          var source = ml.getSource('vtn-stories');
          if (source && source.getClusterExpansionZoom) {
            source.getClusterExpansionZoom(clusterId).then(function (zoom) {
              ml.easeTo({
                center: features[0].geometry.coordinates,
                zoom: zoom + 0.2,
                duration: 620
              });
            }).catch(function () { /* ignore */ });
          }
          return;
        }
        if (VTN.sheet && VTN.sheet.isOpen()) VTN.sheet.close('map');
      });

      ml.on('zoom', syncPinVisibility);
    }).catch(function (error) {
      if (window.console) console.warn('[VTN] maplibre unavailable', error && error.message);
      fallbackToLeaflet('maplibre');
    });
  }

  function addStorySources() {
    if (!ml || ml.getSource('vtn-stories')) return;

    ml.addSource('vtn-stories', {
      type: 'geojson',
      data: storiesGeoJson(),
      cluster: true,
      clusterRadius: 54,
      clusterMaxZoom: 9
    });

    /* 密度熱力：只在低縮放、淡淡的，當作「這裡有很多聲音」的底層提示 */
    ml.addLayer({
      id: 'vtn-heat',
      type: 'heatmap',
      source: 'vtn-stories',
      maxzoom: 12.4,
      paint: {
        'heatmap-weight': 1,
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 12, 1.1],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 8, 16, 12, 34],
        'heatmap-opacity': 0.42,
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(126,166,140,0)',
          0.35, 'rgba(126,166,140,0.55)',
          0.7, 'rgba(168,131,44,0.6)',
          1, 'rgba(180,85,47,0.72)'
        ]
      }
    }, firstLabelLayerId());

    ml.addLayer({
      id: 'vtn-cluster',
      type: 'circle',
      source: 'vtn-stories',
      maxzoom: 9.4,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': [
          'step', ['get', 'point_count'],
          '#5E8C70', 3,
          '#A8832C', 5,
          '#B4552F'
        ],
        'circle-radius': ['step', ['get', 'point_count'], 17, 3, 21, 5, 26],
        'circle-opacity': 0.94,
        'circle-stroke-width': 3,
        'circle-stroke-color': 'rgba(253,251,244,0.92)',
        'circle-stroke-opacity': 0.9
      }
    });

    ml.addLayer({
      id: 'vtn-cluster-count',
      type: 'symbol',
      source: 'vtn-stories',
      maxzoom: 11,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
        'text-allow-overlap': true
      },
      paint: { 'text-color': '#FDFBF4' }
    });

    /* 所選故事的模糊圈 */
    ml.addSource('vtn-fuzz', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    ml.addLayer({
      id: 'vtn-fuzz-fill',
      type: 'fill',
      source: 'vtn-fuzz',
      paint: { 'fill-color': '#2C5742', 'fill-opacity': 0.13 }
    });
    ml.addLayer({
      id: 'vtn-fuzz-line',
      type: 'line',
      source: 'vtn-fuzz',
      paint: {
        'line-color': '#2C5742',
        'line-width': 2,
        'line-opacity': 0.65,
        'line-dasharray': [2, 2]
      }
    });
  }

  function firstLabelLayerId() {
    var style = ml.getStyle();
    if (!style || !style.layers) return undefined;
    for (var i = 0; i < style.layers.length; i++) {
      var layer = style.layers[i];
      if (layer.type === 'symbol') return layer.id;
    }
    return undefined;
  }

  function add3DBuildings() {
    if (!ml || ml.getLayer('vtn-buildings-3d')) return;
    var style = ml.getStyle();
    if (!style || !style.sources) return;
    var sourceId = null;
    Object.keys(style.sources).some(function (key) {
      if (style.sources[key] && style.sources[key].type === 'vector') {
        sourceId = key;
        return true;
      }
      return false;
    });
    if (!sourceId) return;
    try {
      ml.addLayer({
        id: 'vtn-buildings-3d',
        type: 'fill-extrusion',
        source: sourceId,
        'source-layer': 'building',
        minzoom: 13.2,
        paint: {
          'fill-extrusion-color': [
            'interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 8],
            0, '#E6DEC9', 30, '#DBD0B6', 90, '#C8BCA0'
          ],
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.82,
          'fill-extrusion-vertical-gradient': true
        }
      }, firstLabelLayerId());
    } catch (e) {
      if (window.console) console.warn('[VTN] 3D buildings unavailable', e);
    }
  }

  function storiesGeoJson() {
    return {
      type: 'FeatureCollection',
      features: located().map(function (story) {
        return {
          type: 'Feature',
          properties: {
            id: story.id,
            type: typeOf(story),
            mood: story.mood || '',
            year: story.year || 0
          },
          geometry: { type: 'Point', coordinates: [story.location.lng, story.location.lat] }
        };
      })
    };
  }

  /* =========================================================================
   * 5. MapLibre：標記與同步
   * ======================================================================= */
  function pinElement(story) {
    var type = typeOf(story);
    var mood = story.mood || 'wistful';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vtn-pin vtn-type--' + type;
    btn.setAttribute('data-story', story.id);
    btn.setAttribute('aria-label', story.title + '・' + VTN.stories.typeLabel(type));
    btn.innerHTML =
      '<span class="vtn-pin__ring" aria-hidden="true"></span>' +
      '<span class="vtn-pin__disc"><i class="fa-solid ' + iconOf(story) + '" aria-hidden="true"></i></span>' +
      '<span class="vtn-pin__mood vtn-mood--' + U.escapeHtml(mood) + '" aria-hidden="true"></span>' +
      '<span class="vtn-pin__label">' + U.escapeHtml(story.title) + '</span>';
    btn.addEventListener('click', function (event) {
      event.stopPropagation();
      VTN.stories.select(story.id);
    });
    return btn;
  }

  function syncMarkers() {
    if (!ml) return;
    var alive = {};
    located().forEach(function (story) {
      alive[story.id] = true;
      var marker = markers[story.id];
      if (!marker) {
        var node = pinElement(story);
        marker = new window.maplibregl.Marker({ element: node, anchor: 'bottom' })
          .setLngLat([story.location.lng, story.location.lat])
          .addTo(ml);
        markers[story.id] = marker;
      }
      var element = marker.getElement();
      element.classList.toggle('is-selected', story.id === state.selectedId);
    });

    Object.keys(markers).forEach(function (id) {
      if (!alive[id]) {
        try { markers[id].remove(); } catch (e) { /* ignore */ }
        delete markers[id];
      }
    });
    syncPinVisibility();
  }

  function syncPinVisibility() {
    if (!ml) return;
    var zoom = ml.getZoom();
    var show = zoom >= PIN_MIN_ZOOM;
    el.classList.toggle('atlas--far', zoom < 11);
    Object.keys(markers).forEach(function (id) {
      var node = markers[id].getElement();
      node.style.display = show ? '' : 'none';
      node.style.pointerEvents = show ? '' : 'none';
    });
  }

  function syncFuzz() {
    if (!ml || !ml.getSource('vtn-fuzz')) return;
    var story = state.selectedId ? VTN.stories.get(state.selectedId) : null;
    var features = [];
    if (story && story.location) {
      features.push(circlePolygon(story.location.lng, story.location.lat,
        story.location.radiusM || 800));
    }
    ml.getSource('vtn-fuzz').setData({ type: 'FeatureCollection', features: features });
  }

  function render(forceFit) {
    if (engine !== 'maplibre' || !ml) return;
    if (ml.getSource('vtn-stories')) {
      ml.getSource('vtn-stories').setData(storiesGeoJson());
    }
    syncMarkers();
    syncFuzz();
    if (forceFit) fitAll();
    toggleEmpty();
  }

  function toggleEmpty() {
    var empty = byId('mapEmpty');
    if (!empty) return;
    empty.hidden = !state.empty;
  }

  function fitAll(options) {
    if (!ml) return;
    var bounds = boundsOf(located());
    if (!bounds) {
      ml.easeTo({ center: HK_CENTER, zoom: 11.6, pitch: is3D ? 45 : 0, duration: 600 });
      return;
    }
    ml.fitBounds(bounds, {
      padding: { top: 210, bottom: state.mode === 'map' ? 152 : 80, left: 42, right: 42 },
      pitch: is3D ? 42 : 0,
      bearing: is3D ? -14 : 0,
      duration: (options && options.immediate) ? 0 : 760,
      maxZoom: 13.6
    });
  }

  function focusStory(storyId) {
    var story = VTN.stories.get(storyId);
    if (!story || !story.location) return;
    if (engine === 'maplibre' && ml) {
      var sheetOpen = VTN.sheet && VTN.sheet.isOpen();
      ml.flyTo({
        center: [story.location.lng, story.location.lat],
        zoom: Math.max(ml.getZoom(), 14),
        pitch: is3D ? 52 : 0,
        bearing: is3D ? -16 : 0,
        padding: {
          top: 150,
          bottom: sheetOpen ? Math.round(el.clientHeight * 0.5) : 210,
          left: 40,
          right: 40
        },
        duration: 900
      });
      return;
    }
    if (engine === 'leaflet' && leaflet) {
      leaflet.setView([story.location.lat, story.location.lng], 14, { animate: true });
    }
  }

  function fitStories(ids) {
    var list = (ids || []).map(function (id) { return VTN.stories.get(id); })
      .filter(function (story) { return story && story.location; });
    if (!list.length) return;
    if (engine === 'maplibre' && ml) {
      ml.fitBounds(boundsOf(list), {
        padding: { top: 168, bottom: 236, left: 54, right: 54 },
        duration: 700,
        maxZoom: 14
      });
    } else if (engine === 'leaflet' && leaflet) {
      var latlngs = list.map(function (story) {
        return [story.location.lat, story.location.lng];
      });
      try { leaflet.fitBounds(latlngs, { padding: [40, 40], maxZoom: 14 }); } catch (e) { /* ignore */ }
    }
  }

  /* 3D 展示優先選「故事最密」的聚落：附近故事越多，越有機會看到市鎮樓群 */
  function densestStory() {
    var list = located();
    if (!list.length) return null;
    var cos = Math.cos(22.5 * Math.PI / 180);
    var best = null;
    var bestScore = -1;
    list.forEach(function (a) {
      var score = 0;
      list.forEach(function (b) {
        if (a === b) return;
        var dx = (a.location.lng - b.location.lng) * cos;
        var dy = a.location.lat - b.location.lat;
        score += 1 / Math.max(Math.sqrt(dx * dx + dy * dy), 0.004);
      });
      if (score > bestScore) { bestScore = score; best = a; }
    });
    return best;
  }

  function set3D(next) {
    is3D = !!next;
    if (engine === 'maplibre' && ml) {
      if (is3D) {
        add3DBuildings();
        /* 3D 要有樓宇才成立：聚焦到最接近市鎮的故事，俯仰 55° 展示山形與樓群 */
        var focus = state.selectedId ? VTN.stories.get(state.selectedId) : densestStory();
        var sheetOpen = VTN.sheet && VTN.sheet.isOpen();
        if (focus && focus.location) {
          ml.flyTo({
            center: [focus.location.lng, focus.location.lat],
            zoom: Math.max(ml.getZoom(), 14.2),
            pitch: 55,
            bearing: -18,
            padding: { top: 130, bottom: sheetOpen ? 320 : 150 },
            duration: 1100
          });
        } else {
          ml.easeTo({ pitch: 55, bearing: -18, duration: 950 });
        }
      } else {
        ml.easeTo({ pitch: 0, bearing: 0, duration: 750 });
      }
      el.classList.toggle('is-at-3d', is3D);
    }
    var btn = byId('atlas3dBtn');
    if (btn) btn.setAttribute('aria-pressed', is3D ? 'true' : 'false');
  }

  /* =========================================================================
   * 6. Leaflet 兜底
   * ======================================================================= */
  function disable3D() {
    var btn = byId('atlas3dBtn');
    if (!btn) return;
    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
    btn.setAttribute('title', t('atlas.3dUnavailable'));
    btn.setAttribute('aria-label', t('atlas.3dUnavailable'));
  }

  function fallbackToLeaflet(reason) {
    if (engine === 'leaflet' || engine === 'failed') return;
    if (ml) {
      try { ml.remove(); } catch (e) { /* ignore */ }
      ml = null;
    }
    markers = {};
    disable3D();
    engine = 'loading';
    loadCss(LEAFLET_CDN + 'leaflet.min.css', 'leaflet-css');
    loadScript(LEAFLET_CDN + 'leaflet.min.js', 'leaflet-js').then(function () {
      if (!window.L) throw new Error('leaflet-missing');
      engine = 'leaflet';
      leaflet = window.L.map(el, {
        center: [HK_CENTER[1], HK_CENTER[0]],
        zoom: 12,
        zoomControl: false,
        attributionControl: true,
        scrollWheelZoom: true
      });
      window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
      }).addTo(leaflet);
      leafletLayer = window.L.featureGroup().addTo(leaflet);
      el.classList.add('is-ready');
      el.classList.remove('is-failed');
      hideLoading();
      setNote('atlas.tiles.leaflet');
      renderLeaflet(true);
    }).catch(function () {
      engine = 'failed';
      disable3D();
      el.classList.add('is-failed');
      hideLoading();
      setNote('atlas.tiles.fallback');
    });
    if (window.console) console.warn('[VTN] map fallback:', reason);
  }

  function renderLeaflet(fit) {
    if (!leaflet || !leafletLayer) return;
    leafletLayer.clearLayers();
    var list = located();
    list.forEach(function (story) {
      var selected = story.id === state.selectedId;
      var radius = story.location.radiusM || 800;
      var circle = window.L.circle([story.location.lat, story.location.lng], {
        radius: radius,
        color: selected ? '#2C5742' : '#5E8C70',
        weight: selected ? 3 : 2,
        dashArray: '6 8',
        fillColor: '#5E8C70',
        fillOpacity: selected ? 0.18 : 0.08
      });
      circle.bindTooltip(story.title + '・' + t('atlas.fuzz', { r: radius }), {
        direction: 'top', opacity: 0.96
      });
      circle.on('click', function () { VTN.stories.select(story.id); });
      circle.addTo(leafletLayer);
    });
    if (fit) {
      try {
        var bounds = leafletLayer.getBounds();
        if (bounds.isValid()) leaflet.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
      } catch (e) { /* ignore */ }
    }
    toggleEmpty();
  }

  /* =========================================================================
   * 7. 對外 API（與 30-stories.js 相容）
   * ======================================================================= */
  function init() {
    el = byId('vtnMap');
    if (!el || booted) return;
    booted = true;

    var view = document.querySelector('.vtn-view[data-view="stories"]');
    if (view && view.classList.contains('is-active')) ensureVisible();

    var zoomIn = byId('atlasZoomIn');
    var zoomOut = byId('atlasZoomOut');
    var reset = byId('atlasRecenter');
    var btn3d = byId('atlas3dBtn');

    if (zoomIn) zoomIn.addEventListener('click', function () {
      if (engine === 'maplibre' && ml) ml.zoomIn({ duration: 380 });
      else if (engine === 'leaflet' && leaflet) leaflet.zoomIn();
    });
    if (zoomOut) zoomOut.addEventListener('click', function () {
      if (engine === 'maplibre' && ml) ml.zoomOut({ duration: 380 });
      else if (engine === 'leaflet' && leaflet) leaflet.zoomOut();
    });
    if (reset) reset.addEventListener('click', function () {
      if (engine === 'maplibre' && ml) {
        ml.easeTo({ pitch: is3D ? 48 : 0, bearing: is3D ? -14 : 0, duration: 600 });
        fitAll();
      } else if (engine === 'leaflet' && leaflet) {
        renderLeaflet(true);
      }
    });
    if (btn3d) btn3d.addEventListener('click', function () { set3D(!is3D); });
  }

  function ensureVisible() {
    el = el || byId('vtnMap');
    if (!el) return;
    if (engine === 'idle') { createMapLibre(); return; }
    if (engine === 'maplibre' && ml) {
      setTimeout(function () { try { ml.resize(); } catch (e) { /* ignore */ } }, 30);
    } else if (engine === 'leaflet' && leaflet) {
      setTimeout(function () { try { leaflet.invalidateSize(); } catch (e) { /* ignore */ } }, 30);
    }
  }

  function update(next) {
    var previousMode = state.mode;
    state.stories = (next && next.stories) || [];
    state.selectedId = (next && next.selectedId) || null;
    state.empty = !!(next && next.empty);
    state.mode = (next && next.mode) || 'map';
    state.eraYear = next && next.eraYear !== undefined ? next.eraYear : null;

    if (engine === 'maplibre' && ml) {
      if (previousMode !== state.mode) {
        setTimeout(function () { try { ml.resize(); } catch (e) { /* ignore */ } }, 30);
      }
      render(false);
    } else if (engine === 'leaflet') {
      renderLeaflet(false);
    } else if (state.empty) {
      toggleEmpty();
    }
  }

  function reset() {
    if (ml) { try { ml.remove(); } catch (e) { /* ignore */ } }
    if (leaflet) { try { leaflet.remove(); } catch (e) { /* ignore */ } }
    ml = null;
    leaflet = null;
    markers = {};
    engine = 'idle';
  }

  VTN.map = {
    init: init,
    update: update,
    ensureVisible: ensureVisible,
    focusStory: focusStory,
    fitAll: fitAll,
    fitStories: fitStories,
    set3D: set3D,
    is3D: function () { return is3D; },
    reset: reset,
    status: function () { return engine; },
    debug: function () {
      if (engine !== 'maplibre' || !ml) return { engine: engine };
      var c = ml.getCenter();
      var b = ml.getBounds();
      return {
        engine: engine,
        zoom: Number(ml.getZoom().toFixed(2)),
        center: [Number(c.lng.toFixed(4)), Number(c.lat.toFixed(4))],
        bounds: [
          [Number(b.getWest().toFixed(4)), Number(b.getSouth().toFixed(4))],
          [Number(b.getEast().toFixed(4)), Number(b.getNorth().toFixed(4))]
        ],
        pitch: ml.getPitch(),
        located: located().length,
        container: [ml.getContainer().clientWidth, ml.getContainer().clientHeight]
      };
    }
  };
})();
