/* =============================================================================
 * 32-sheet — 二級故事頁：半拉抽屜
 * -----------------------------------------------------------------------------
 * 行為：
 *   * 預設露出 55dvh（相對視口，小屏不會把標題區截掉），可上拉全開、下拉收起；
 *   * 點遮罩、按 Esc、按關閉鍵都會收起，並暫停播放；
 *   * 收起後把焦點交回原本的故事點／列表項；
 *   * 只負責「殼」，內容由 30-stories.js 渲染入 #storyDetail。
 * ========================================================================== */

(function () {
  'use strict';

  var VTN = window.VTN;

  var el = null;
  var scrim = null;
  var grab = null;
  var closeBtn = null;
  var opened = false;
  var expanded = false;
  var dragging = null;
  var suppressGrabClick = 0;
  var hideTimer = null;
  var previousFocus = null;
  var onClose = null;

  function byId(id) { return document.getElementById(id); }

  function ensure() {
    if (el) return true;
    el = byId('storySheet');
    scrim = byId('sheetScrim');
    grab = byId('sheetGrab');
    closeBtn = byId('sheetClose');
    return !!(el && scrim);
  }

  function isOpen() { return opened; }
  function isExpanded() { return expanded; }

  function setExpanded(next) {
    expanded = !!next;
    if (!el) return;
    el.classList.toggle('is-expanded', expanded);
    el.classList.remove('is-dragging');
    el.style.transform = '';
  }

  function open(options) {
    if (!ensure()) return;
    var opts = options || {};
    onClose = opts.onClose || null;
    previousFocus = document.activeElement;
    clearTimeout(hideTimer);

    if (!opened) {
      el.hidden = false;
      scrim.hidden = false;
      el.style.transform = '';
      /* 先讓 display 生效，再加 class 觸發動畫 */
      requestAnimationFrame(function () {
        el.classList.add('is-open');
        scrim.classList.add('is-open');
      });
    } else {
      el.classList.add('is-open');
      scrim.classList.add('is-open');
    }
    opened = true;
    setExpanded(!!opts.expanded);
    if (closeBtn && opts.focus !== false) {
      setTimeout(function () { try { closeBtn.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 120);
    }
  }

  function close(reason) {
    if (!ensure() || !opened) return;
    opened = false;
    expanded = false;
    el.classList.remove('is-open', 'is-expanded', 'is-dragging');
    el.style.transform = '';
    scrim.classList.remove('is-open');
    if (VTN.audio && VTN.audio.pauseStory) VTN.audio.pauseStory();
    hideTimer = setTimeout(function () {
      el.hidden = true;
      scrim.hidden = true;
    }, 430);
    if (previousFocus && previousFocus.focus) {
      setTimeout(function () { try { previousFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 60);
    }
    if (onClose) onClose(reason || 'close');
  }

  function onKeydown(event) {
    if (!opened) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close('escape');
    }
  }

  function bindDrag() {
    if (!grab || grab.dataset.bound) return;
    grab.dataset.bound = '1';

    grab.addEventListener('pointerdown', function (event) {
      if (!opened) return;
      dragging = {
        y: event.clientY,
        height: el.getBoundingClientRect().height,
        expanded: expanded
      };
      el.classList.add('is-dragging');
      try { grab.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
    });

    grab.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      var dy = event.clientY - dragging.y;
      /* 與 CSS 的 55dvh 半開高度一致：用視口換算，不寫死抽屜自身百分比 */
      var viewport = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      var peek = viewport * 0.55;
      var base = dragging.expanded ? 0 : Math.max(0, dragging.height - peek);
      var next = base + dy;
      var max = dragging.height;
      next = Math.max(0, Math.min(max, next));
      el.style.transform = 'translateY(' + Math.round(next) + 'px)';
    });

    function end(event) {
      if (!dragging) return;
      var dy = event.clientY - dragging.y;
      var wasExpanded = dragging.expanded;
      if (Math.abs(dy) > 6) suppressGrabClick = Date.now() + 450;
      dragging = null;
      el.classList.remove('is-dragging');
      el.style.transform = '';
      if (dy < -50) setExpanded(true);
      else if (dy > 70) {
        if (wasExpanded) setExpanded(false);
        else close('swipe');
      } else {
        setExpanded(wasExpanded);
      }
    }

    grab.addEventListener('pointerup', end);
    grab.addEventListener('pointercancel', function () {
      if (!dragging) return;
      dragging = null;
      el.classList.remove('is-dragging');
      el.style.transform = '';
    });

    grab.addEventListener('click', function (event) {
      /* 抓手自行切換狀態，不能再冒泡觸發內容區的「點擊展開」。 */
      event.stopPropagation();
      /* 拖拽後的 click 不應再次切換，否則會「拖上又彈回」 */
      if (Date.now() < suppressGrabClick) return;
      setExpanded(!expanded);
    });
  }

  function init() {
    if (!ensure()) return;
    closeBtn.addEventListener('click', function () { close('button'); });
    scrim.addEventListener('click', function () { close('scrim'); });
    document.addEventListener('keydown', onKeydown, true);
    bindDrag();
    el.addEventListener('click', function (event) {
      /* 半開時，點抽屜內容任何位置都展開（不影響按鈕本身） */
      if (!expanded && event.target.closest('button, a, input, .player, .segment')) return;
      if (!expanded) setExpanded(true);
    });
  }

  VTN.sheet = {
    init: init,
    open: open,
    close: close,
    isOpen: isOpen,
    isExpanded: isExpanded,
    expand: function (v) { setExpanded(v !== false); }
  };
})();
