/* =============================================================================
 * Voices of the North — 真實地圖（故事頁專用）
 *
 * 私隱設計（FR-B5 不變）：
 *  - 真實底圖：Leaflet + CARTO Voyager / OpenStreetMap 圖磚
 *  - 唔放精確定位標記，只畫「約 800 米模糊範圍」圓圈，中心唔係講者 GPS
 *  - 離線／圖磚載入失敗 → 自動降級 OSM → 再失敗顯示原手繪示意圖
 *
 * 故事地點統一由 lib/storyCorpus.js 嘅 location 欄位驅動。
 * ========================================================================== */

import { RECORDED_STORIES } from '/lib/storyCorpus.js';

(function () {
  'use strict';

  var LEAFLET_VERSION = '1.9.4';
  var CDN = 'https://cdn.jsdelivr.net/npm/leaflet@' + LEAFLET_VERSION + '/dist/';
  var LOAD_TIMEOUT_MS = 12000;
  var TILE_TIMEOUT_MS = 6500;

  /* 兩級均為無需 API key 嘅公開圖磚（demo／輕量使用，附歸屬聲明）：
     1. OSM 官方標準圖磚　2. Esri 街道圖後備 */
  var TILE_SETS = [
    {
      name: 'osm',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      options: {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
      }
    },
    {
      name: 'esri',
      url:
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      options: {
        maxZoom: 19,
        attribution:
          'Tiles &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> ' +
          '&mdash; &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
      }
    }
  ];

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

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

      var s = document.createElement('script');
      s.src = CDN + 'leaflet.min.js';
      s.async = true;
      s.dataset.vtnLeafletJs = '1';
      var timer = setTimeout(function () {
        reject(new Error('leaflet-load-timeout'));
      }, LOAD_TIMEOUT_MS);
      s.onload = function () { clearTimeout(timer); resolve(window.L); };
      s.onerror = function () { clearTimeout(timer); reject(new Error('leaflet-load-error')); };
      document.head.appendChild(s);
    });
  }

  /** 逐級降級試圖源；第一塊圖成功即視為可用 */
  function addTileLayerWithFallback(map, sets, onFirstTile) {
    var idx = 0;
    var revealed = false;
    var current = null;
    var timer = null;

    function tryNext(reason) {
      if (revealed) return;
      if (current) { map.removeLayer(current); current = null; }
      if (timer) { clearTimeout(timer); timer = null; }
      if (idx >= sets.length) { onFirstTile(false); return; }

      var set = sets[idx++];
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
      // CARTO 部份地區會回 404 再由 OSM 補：連續錯誤視為該源不可用
      var errCount = 0;
      current.on('tileerror', function () {
        if (gotTile || revealed) return;
        errCount++;
        if (errCount >= 6) tryNext('tile-errors');
      });

      current.addTo(map);
      timer = setTimeout(function () { tryNext('tile-timeout:' + reason); }, TILE_TIMEOUT_MS);
    }

    tryNext('start');
  }

  function initMap(L) {
    var frame = document.getElementById('mapFrame');
    var el = document.getElementById('vtnMap');
    var loading = document.getElementById('mapLoading');
    var note = document.getElementById('mapTilesNote');
    if (!frame || !el) return;

    var stories = (RECORDED_STORIES || []).filter(function (s) {
      return s.location && typeof s.location.lat === 'number' && typeof s.location.lng === 'number';
    });
    if (!stories.length) { fail('no-location'); return; }

    var reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var first = stories[0].location;
    var map = L.map(el, {
      center: [first.lat, first.lng],
      zoom: 15,
      zoomControl: true,
      attributionControl: true,
      zoomAnimation: !reduceMotion,
      fadeAnimation: !reduceMotion,
      markerZoomAnimation: !reduceMotion,
      scrollWheelZoom: false,   // 避免喺手頁滑動時搶滾動；雙擊／＋−仍可縮放
      tap: true
    });
    // 輕觸後先允許捲動縮放（手機常見模式）
    map.once('focus click', function () { map.scrollWheelZoom.enable(); });

    L.control.scale({ imperial: false, maxWidth: 110 }).addTo(map);

    stories.forEach(function (story) {
      var loc = story.location;
      var circle = L.circle([loc.lat, loc.lng], {
        radius: loc.radiusM || 800,
        color: '#2C5742',
        weight: 2.5,
        dashArray: '6 8',
        lineCap: 'round',
        fillColor: '#5E8C70',
        fillOpacity: 0.14
      }).addTo(map);

      circle.bindPopup(
        '<strong>' + story.title + '</strong><br>' +
        '故事地點大概喺呢一帶（方圓約 ' + (loc.radiusM || 800) +
        ' 米嘅模糊範圍，唔係 GPS 定位）。',
        { className: 'leaflet-vtn-popup', closeButton: true, offset: [0, -4] }
      );
      circle.bindTooltip(loc.area + '・約 ' + Math.round((loc.radiusM || 800) / 100) / 10 +
        ' 公里模糊範圍', {
        direction: 'top',
        offset: [0, -6],
        opacity: 0.96,
        className: 'leaflet-vtn-popup'
      });
    });

    // 視圖剛好包住第一個故事嘅模糊圈
    var firstCircle = L.circle([first.lat, first.lng], { radius: first.radiusM || 800 });
    function fitCircle() {
      try {
        map.fitBounds(firstCircle.getBounds(), { padding: [30, 30], animate: false });
      } catch (e) {
        map.setView([first.lat, first.lng], 14, { animate: false });
      }
    }
    fitCircle();

    addTileLayerWithFallback(map, TILE_SETS, function (ok) {
      if (ok) {
        // 等首批圖磚實際渲染先淡入；容器此時先有最終尺寸，要重新校正＋fit
        requestAnimationFrame(function () {
          map.invalidateSize();
          fitCircle();
          el.classList.add('is-ready');
          if (loading) loading.classList.add('is-hidden');
        });
      } else {
        fail('tiles-unavailable');
      }
    });

    // 容器尺寸可能被 webfont／卡片動作改變，延遲再校正一次
    setTimeout(function () { try { map.invalidateSize(); } catch (e) { /* ignore */ } }, 900);

    function fail(reason) {
      el.classList.add('is-failed');
      if (loading) loading.classList.add('is-hidden');
      if (note) {
        note.textContent = reason === 'tiles-unavailable'
          ? '未能連接真實地圖，顯示手繪示意圖・範圍只作示意，並非 GPS 定位。'
          : '真實地圖暫不可用，顯示手繪示意圖・範圍只作示意，並非 GPS 定位。';
      }
      try { map.remove(); } catch (e) { /* ignore */ }
    }
  }

  ready(function () {
    var el = document.getElementById('vtnMap');
    var loading = document.getElementById('mapLoading');
    var note = document.getElementById('mapTilesNote');
    if (!el) return;

    loadLeaflet()
      .then(function (L) {
        try { initMap(L); }
        catch (e) { showFallback('init-error'); }
      })
      .catch(function () { showFallback('leaflet-unavailable'); });

    function showFallback() {
      el.classList.add('is-failed');
      if (loading) loading.classList.add('is-hidden');
      if (note) note.textContent = '未能連接真實地圖，顯示手繪示意圖・範圍只作示意，並非 GPS 定位。';
    }
  });
})();
