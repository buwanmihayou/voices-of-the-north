/* =============================================================================
 * 33-media — 萬能媒體區塊（三級頁 Overlay）
 * -----------------------------------------------------------------------------
 * * 三級頁：全屏 Overlay，封裝 renderUniversalMedia（影片 / 圖片 / 音頻降級）
 * * 二級頁（半拉抽屜）有媒體時由 30-stories.js 顯示「查看多媒體故事」入口，點擊呼叫 open()
 * * 防呆（fail-closed）：媒體載入失敗（404）自動降級為音頻；關閉 Overlay 強制暫停影片與音頻
 * ========================================================================== */

(function () {
  'use strict';

  var VTN = window.VTN;
  var U = VTN.util;
  var t = (VTN.i18n && VTN.i18n.t) ? VTN.i18n.t : function (k) { return k; };

  var overlayEl = null;
  var currentStory = null;

  function storyTitleSafe(story) {
    if (VTN.stories && VTN.stories.storyTitle) return VTN.stories.storyTitle(story);
    return (story && (story.title || story.id)) || '';
  }

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = U.node('div', {
      class: 'media-overlay', id: 'mediaOverlay', hidden: true,
      role: 'dialog', 'aria-modal': 'true'
    });
    overlayEl.setAttribute('aria-label', t('media.overlayAria'));

    var scrim = U.node('div', { class: 'media-overlay__scrim', 'data-close': '' });
    var panel = U.node('div', { class: 'media-overlay__panel' });

    var header = U.node('div', { class: 'media-overlay__header' });
    var closeBtn = U.node('button', {
      class: 'media-overlay__close', type: 'button', 'data-close': '', 'aria-label': t('media.close')
    });
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    var kicker = U.node('p', { class: 'media-overlay__kicker', text: t('media.overlayKicker') });
    var title = U.node('h2', { class: 'media-overlay__title' });
    header.appendChild(closeBtn);
    header.appendChild(kicker);
    header.appendChild(title);

    var mediaHost = U.node('div', { class: 'media-overlay__media', id: 'universalMedia' });
    var transcriptHost = U.node('div', { class: 'media-overlay__transcript' });

    panel.appendChild(header);
    panel.appendChild(mediaHost);
    panel.appendChild(transcriptHost);
    overlayEl.appendChild(scrim);
    overlayEl.appendChild(panel);
    document.body.appendChild(overlayEl);

    overlayEl.addEventListener('click', function (event) {
      if (event.target.closest('[data-close]')) close();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && overlayEl && !overlayEl.hidden) close();
    });
    return overlayEl;
  }

  function pauseAll() {
    var v = document.getElementById('storyVideo');
    if (v && !v.paused) { try { v.pause(); } catch (e) { /* ignore */ } }
    if (VTN.audio && VTN.audio.pauseStory) VTN.audio.pauseStory();
  }

  function close() {
    if (!overlayEl || overlayEl.hidden) return;
    pauseAll();
    overlayEl.hidden = true;
    document.body.classList.remove('media-overlay-open');
    var m = overlayEl.querySelector('.media-overlay__media');
    var tr = overlayEl.querySelector('.media-overlay__transcript');
    if (m) m.textContent = '';
    if (tr) tr.textContent = '';
    currentStory = null;
  }

  function open(story, playAt) {
    if (!story || !VTN.stories || !VTN.stories.resolveMedia) return;
    ensureOverlay();
    currentStory = story;

    var media = VTN.stories.resolveMedia(story);
    var mediaHost = overlayEl.querySelector('.media-overlay__media');
    var transcriptHost = overlayEl.querySelector('.media-overlay__transcript');
    mediaHost.textContent = '';
    transcriptHost.textContent = '';
    overlayEl.querySelector('.media-overlay__title').textContent = storyTitleSafe(story);

    /* seekRef 讓降級（影片/圖片 404）能改寫活躍 seek，逐字稿回調始終有效 */
    var seekRef = { fn: function () {} };
    var activeSeek = function (sec) { if (seekRef.fn) seekRef.fn(sec); };

    if (media.type === 'audio') {
      seekRef.fn = renderAudioFallback(story, mediaHost, seekRef, false);
    } else {
      seekRef.fn = renderRichMedia(story, media, mediaHost, seekRef);
    }

    if (VTN.stories.buildTranscript) {
      transcriptHost.appendChild(VTN.stories.buildTranscript(story, activeSeek));
    }

    overlayEl.hidden = false;
    document.body.classList.add('media-overlay-open');

    if (playAt !== undefined && playAt !== null) {
      setTimeout(function () { activeSeek(Number(playAt) || 0); }, 80);
    }
  }

  function appendMediaFooter(box, story, type) {
    var hint = U.node('p', { class: 'universal-media__hint' });
    hint.innerHTML = '<i class="fa-solid ' + (type === 'image' ? 'fa-image' : 'fa-video') +
      '" aria-hidden="true"></i><span>' +
      U.escapeHtml(t(type === 'image' ? 'atlas.imageHint' : 'atlas.videoHint')) + '</span>';
    box.appendChild(hint);

    var disclosure = U.node('p', { class: 'universal-media__disclosure', text: t('atlas.mediaDisclosure') });
    box.appendChild(disclosure);

    var btn3d = U.node('button', { class: 'universal-media__3d vtn-btn vtn-btn--sm', type: 'button' });
    btn3d.innerHTML = '<i class="fa-solid fa-map-location-dot" aria-hidden="true"></i><span>' +
      U.escapeHtml(t('atlas.video3d')) + '</span>';
    btn3d.addEventListener('click', function () {
      if (VTN.sheet) VTN.sheet.close('media-3d');
      if (VTN.map) {
        if (VTN.map.set3D) VTN.map.set3D(true);
        if (VTN.map.focusStory) VTN.map.focusStory(story.id);
      }
    });
    box.appendChild(btn3d);
  }

  function renderRichMedia(story, media, host, seekRef) {
    host.textContent = '';
    var box = U.node('div', { class: 'universal-media' });
    var frame = U.node('div', { class: 'universal-media__frame' });
    var initialFn;

    if (media.type === 'video') {
      var video = U.node('video', {
        id: 'storyVideo', class: 'universal-media__video',
        controls: true, playsinline: true, preload: 'metadata',
        src: media.url, 'aria-label': t('atlas.videoAria')
      });
      frame.appendChild(video);
      box.appendChild(frame);
      appendMediaFooter(box, story, 'video');

      var degraded = false;
      video.addEventListener('error', function () {
        if (degraded) return;
        degraded = true;
        renderAudioFallback(story, host, seekRef, true);
      });
      initialFn = function (sec) {
        if (video.error) { VTN.ui.toast(t('atlas.videoError'), 'error'); return; }
        if (VTN.audio && VTN.audio.pauseStory) VTN.audio.pauseStory();
        var dur = video.duration;
        if (!(typeof dur === 'number' && isFinite(dur))) dur = story.durationSec || 0;
        var s = Math.max(0, Math.min(dur, Number(sec) || 0));
        function start() {
          try { video.currentTime = s; } catch (e) { /* ignore */ }
          var p = video.play();
          if (p && p.catch) p.catch(function () {
            VTN.ui.toast(t('atlas.videoSeekHint', { t: U.fmtTime(s) }), 'info');
          });
        }
        if (video.readyState >= 1) start();
        else video.addEventListener('loadedmetadata', start, { once: true });
      };
    } else {
      var img = U.node('img', {
        class: 'universal-media__img', src: media.url,
        alt: t('atlas.imageAlt', { title: storyTitleSafe(story) }), loading: 'lazy'
      });
      frame.appendChild(img);
      box.appendChild(frame);
      appendMediaFooter(box, story, 'image');

      var degraded2 = false;
      img.addEventListener('error', function () {
        if (degraded2) return;
        degraded2 = true;
        renderAudioFallback(story, host, seekRef, true);
      });
      initialFn = function () {
        VTN.ui.toast(t('atlas.imageSeekNote'), 'info');
      };
    }

    host.appendChild(box);
    return initialFn;
  }

  function renderAudioFallback(story, host, seekRef, isDegrade) {
    host.textContent = '';
    var box = U.node('div', { class: 'universal-media universal-media--audio' });
    var fallback = U.node('div', { class: 'universal-media__fallback' });
    fallback.appendChild(U.node('span', {
      class: 'universal-media__fallbackIcon', html: '<i class="fa-solid fa-photo-film" aria-hidden="true"></i>'
    }));
    fallback.appendChild(U.node('p', {
      class: 'universal-media__fallbackText',
      text: t(isDegrade ? 'media.fallback' : 'media.noMedia')
    }));
    box.appendChild(fallback);

    if (VTN.stories.audioPlayerNode) box.appendChild(VTN.stories.audioPlayerNode(story));
    host.appendChild(box);

    var audioSeek = function (sec) {
      if (VTN.audio && VTN.audio.playStory) VTN.audio.playStory(story.id, sec);
    };
    if (seekRef) seekRef.fn = audioSeek;
    if (isDegrade && VTN.ui && VTN.ui.toast) VTN.ui.toast(t('media.fallback'), 'info');
    return audioSeek;
  }

  VTN.media = {
    open: open,
    close: close,
    pauseAll: pauseAll,
    isOpen: function () { return !!overlayEl && !overlayEl.hidden; }
  };
})();
