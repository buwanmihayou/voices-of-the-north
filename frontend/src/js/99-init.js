/* =============================================================================
 * 99-init — 啟動順序與連線狀態
 * ========================================================================== */

(function () {
  'use strict';

  var VTN = window.VTN;
  var U = VTN.util;
  var healthTimer = null;

  function syncPendingRecords() {
    var pending = VTN.store.records.all().filter(function (rec) {
      return rec.sync === 'failed' && rec.status === 'done' && rec.audioDataURL;
    }).slice(0, 2);
    pending.forEach(function (rec) {
      VTN.api.records.sync(rec).then(function () {
        VTN.ui.toast(VTN.i18n.t('sync.recovered'), 'success');
      }).catch(function () { /* 仍然離線，保持本機 */ });
    });
  }

  function checkHealth(force) {
    return VTN.api.health(force).then(function (data) {
      VTN.ui.renderStatus();
      if (VTN.assistant) VTN.assistant.refresh();
      if (data && data.storage_ready) syncPendingRecords();
      return data;
    }).catch(function () {
      VTN.ui.renderStatus();
      if (VTN.assistant) VTN.assistant.refresh();
      return null;
    });
  }

  function startHealthLoop() {
    clearInterval(healthTimer);
    healthTimer = setInterval(function () {
      if (document.hidden) return;
      checkHealth(true);
    }, 60000);
  }

  function boot() {
    try {
      VTN.i18n.init();
      VTN.settings.init();
      VTN.ui.bindStatus();

      VTN.stories.init();
      VTN.recordings.init();
      VTN.account.init();
      VTN.about.init();
      VTN.assistant.mount();
      VTN.router.init();
      VTN.map.init();
      if (VTN.onboard) VTN.onboard.init();

      checkHealth(true);
      startHealthLoop();

      window.addEventListener('online', function () {
        VTN.ui.toast(VTN.i18n.t('net.online'), 'success');
        checkHealth(true);
      });
      window.addEventListener('offline', function () {
        VTN.ui.toast(VTN.i18n.t('net.offline'), 'error');
        checkHealth(true);
      });
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) checkHealth(false);
      });
      U.on('vtn:lang-changed', function () {
        VTN.router.updateGreeting();
        VTN.stories.render();
        VTN.recordings.renderAll();
        VTN.about.render();
        VTN.ui.renderStatus();
      });

      window.VTN_READY = true;
      U.emit('vtn:ready', { version: VTN.config.version, apiBase: VTN.api.base() });
      if (window.console) {
        console.info('[VTN] ready', VTN.config.version, 'API:', VTN.api.base());
      }
    } catch (error) {
      if (window.console) console.error('[VTN] boot failed', error);
      VTN.ui.toast('啟動失敗：' + (error && error.message ? error.message : error), 'error');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  VTN.boot = boot;
  VTN.refreshHealth = checkHealth;
})();
