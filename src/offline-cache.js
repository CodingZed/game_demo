let initialized = false;

/** Start optional offline saving after the first game frame, never in file/dev builds. */
export function initOfflineCache() {
  if (initialized || document.documentElement.dataset.online !== 'true'
    || !['https:', 'http:'].includes(location.protocol)) return;
  initialized = true;
  const status = document.getElementById('offline-status');
  const updateButton = document.getElementById('update-game');
  const hangar = document.getElementById('hangar-ui');
  const inMenu = () => !document.body.classList.contains('is-flying') && hangar?.hidden !== true;
  const showStatus = (text) => {
    if (!status) return;
    status.textContent = text;
    status.hidden = !text;
  };
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    showStatus('当前可联网游玩');
    return;
  }

  let registration;
  let waiting;
  let requestedUpdate = false;
  let controllerChanged = false;
  let reloaded = false;
  let statusCheck = 0;
  let repairingWorker;
  const repairAttempts = new WeakSet();

  function reloadIfSafe() {
    if (!requestedUpdate || !controllerChanged || !inMenu() || reloaded) return;
    reloaded = true;
    location.reload();
  }
  function updateMenu() {
    if (updateButton) {
      updateButton.hidden = !inMenu() || !waiting || requestedUpdate;
      updateButton.disabled = requestedUpdate;
      updateButton.textContent = '更新游戏';
    }
    reloadIfSafe();
  }
  function refreshWaiting() {
    waiting = registration?.waiting ?? null;
    if (waiting && !requestedUpdate) showStatus('新版已准备好');
    updateMenu();
  }
  function askCache(worker, type, timeout = 4000) {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, timeout);
      channel.port1.onmessage = ({ data }) => {
        clearTimeout(timer); channel.port1.close(); resolve(data);
      };
      try { worker.postMessage({ type }, [channel.port2]); }
      catch { clearTimeout(timer); channel.port1.close(); resolve(null); }
    });
  }
  async function verifyCurrentCache() {
    const worker = navigator.serviceWorker.controller;
    if (!worker) return;
    const check = ++statusCheck;
    try {
      const result = await askCache(worker, 'CACHE_STATUS');
      if (check !== statusCheck || worker !== navigator.serviceWorker.controller || waiting || requestedUpdate) return;
      if (result?.type === 'CACHE_STATUS' && result.ready) {
        showStatus('可离线玩，下次打开更快');
        return;
      }
      if (repairingWorker === worker) return;
      // One bounded attempt per page/online transition, only after the current
      // worker positively reports missing entries. No background retry loop.
      if (result?.type !== 'CACHE_STATUS' || result.ready !== false
        || navigator.onLine === false || repairAttempts.has(worker)) {
        showStatus('离线保存未完成，当前仍可玩');
        return;
      }
      repairAttempts.add(worker);
      repairingWorker = worker;
      showStatus('正在恢复离线游玩…');
      const repaired = await askCache(worker, 'CACHE_REPAIR', 30000);
      if (repairingWorker === worker) repairingWorker = null;
      if (worker !== navigator.serviceWorker.controller || waiting || requestedUpdate) return;
      showStatus(repaired?.type === 'CACHE_STATUS' && repaired.ready
        ? '可离线玩，下次打开更快' : '离线保存未完成，当前仍可玩');
    } catch {
      if (repairingWorker === worker) repairingWorker = null;
      if (!waiting && !requestedUpdate) showStatus('离线保存未完成，当前仍可玩');
    }
  }
  window.addEventListener('online', () => {
    if (navigator.serviceWorker.controller) repairAttempts.delete(navigator.serviceWorker.controller);
    void verifyCurrentCache();
  });
  updateButton?.addEventListener('click', () => {
    if (!inMenu() || !waiting || requestedUpdate) return;
    requestedUpdate = true;
    showStatus('正在更新游戏…');
    updateMenu();
    try { waiting.postMessage({ type: 'SKIP_WAITING' }); }
    catch {
      requestedUpdate = false;
      showStatus('暂时未能更新，稍后再试');
      updateMenu();
    }
  });
  const observer = new MutationObserver(updateMenu);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  if (hangar) observer.observe(hangar, { attributes: true, attributeFilter: ['hidden'] });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Other tabs and first activation never reload. If this tab began flying
    // after pressing Update, wait until it returns to the menu to apply it.
    if (requestedUpdate) {
      controllerChanged = true;
      reloadIfSafe();
    } else {
      refreshWaiting();
      void verifyCurrentCache();
    }
  });

  async function register() {
    try {
      if (!navigator.serviceWorker.controller) showStatus('正在准备离线游玩…');
      const base = new URL('./', document.baseURI);
      registration = await navigator.serviceWorker.register(new URL('sw.js', base), {
        scope: base.href,
        updateViaCache: 'none',
      });
      refreshWaiting();
      void verifyCurrentCache();
      function watch(worker) {
        if (!worker) return;
        const changed = () => {
          if (worker.state === 'installed') {
            // registration.waiting is populated as the state transition settles.
            setTimeout(() => { refreshWaiting(); void verifyCurrentCache(); }, 0);
          } else if (worker.state === 'activated') {
            refreshWaiting();
            void verifyCurrentCache();
          } else if (worker.state === 'redundant' && !waiting) {
            if (navigator.serviceWorker.controller) void verifyCurrentCache();
            else showStatus('离线保存未完成，当前仍可玩');
          }
        };
        worker.addEventListener('statechange', changed);
        changed();
      }
      registration.addEventListener('updatefound', () => watch(registration.installing));
      watch(registration.installing);
    } catch {
      if (navigator.serviceWorker.controller) void verifyCurrentCache();
      else showStatus('离线保存未完成，当前仍可玩');
    }
  }
  if ('requestIdleCallback' in window) window.requestIdleCallback(() => { void register(); }, { timeout: 5000 });
  else setTimeout(() => { void register(); }, 1200);
}
