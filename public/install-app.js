(function () {
  var APP_VERSION = 'home-care-pwa-v15';
  var DISMISS_KEY = 'homecare:pwa-install-dismissed';
  var deferredPrompt = null;
  var mutationObserver = null;
  var rescueShown = false;

  function safeRead(key) {
    try { return window.localStorage.getItem(key); } catch (_) { return null; }
  }

  function safeWrite(key, value) {
    try { window.localStorage.setItem(key, value); } catch (_) {}
  }

  function safeRemove(key) {
    try { window.localStorage.removeItem(key); } catch (_) {}
  }

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || window.navigator.standalone === true
      || /HomeCareAndroid/i.test(window.navigator.userAgent || '');
  }

  function isIosDevice() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent || '')
      || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
  }

  function isSmallScreen() {
    return window.matchMedia && window.matchMedia('(max-width: 860px)').matches;
  }

  function shouldHideInstall() {
    return isStandalone() || safeRead(DISMISS_KEY) === APP_VERSION;
  }

  function appHasContent() {
    var app = document.getElementById('app');
    if (!app) return true;
    return Boolean(app.children.length || app.textContent.trim());
  }

  function toast(message) {
    var box = document.getElementById('homecare-pwa-toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'homecare-pwa-toast';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    box.textContent = message;
    box.classList.add('visible');
    window.clearTimeout(box._timer);
    box._timer = window.setTimeout(function () { box.classList.remove('visible'); }, 4200);
  }

  function ensureStyles() {
    if (document.getElementById('homecare-pwa-install-styles')) return;
    var style = document.createElement('style');
    style.id = 'homecare-pwa-install-styles';
    style.textContent = [
      '#homecare-install-banner{position:fixed;left:14px;right:14px;bottom:14px;z-index:999998;display:flex;gap:12px;align-items:center;justify-content:space-between;background:#fffdf7;color:#06243a;border:1px solid #e2d7c8;border-radius:20px;padding:12px;box-shadow:0 18px 46px rgba(6,36,58,.24);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}',
      '#homecare-install-banner[hidden]{display:none!important}',
      '#homecare-install-banner .hc-pwa-copy{display:flex;gap:10px;align-items:center;min-width:0}',
      '#homecare-install-banner img{width:44px;height:44px;border-radius:13px;flex:0 0 auto}',
      '#homecare-install-banner strong{display:block;font-weight:1000}',
      '#homecare-install-banner small{display:block;color:#64748b;line-height:1.25}',
      '#homecare-install-banner .hc-pwa-actions{display:flex;gap:8px;align-items:center;flex:0 0 auto}',
      '#homecare-install-banner .hc-pwa-dismiss{border:0;background:transparent;color:#64748b;font-size:24px;line-height:1;cursor:pointer;padding:6px}',
      '#homecare-pwa-ios-modal[hidden]{display:none!important}',
      '#homecare-pwa-ios-modal{position:fixed;inset:0;z-index:999999;display:grid;place-items:center;padding:20px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}',
      '#homecare-pwa-ios-modal .hc-pwa-backdrop{position:absolute;inset:0;background:rgba(6,36,58,.48)}',
      '#homecare-pwa-ios-modal .hc-pwa-card{position:relative;max-width:430px;width:100%;background:#fffdf7;color:#06243a;border-radius:26px;padding:24px;border:1px solid #e2d7c8;box-shadow:0 24px 70px rgba(0,0,0,.32)}',
      '#homecare-pwa-ios-modal img{width:66px;height:66px;border-radius:18px}',
      '#homecare-pwa-ios-modal h2{margin:12px 0 8px}',
      '#homecare-pwa-ios-modal ol{line-height:1.65;padding-left:22px}',
      '#homecare-pwa-ios-modal .hc-pwa-close{position:absolute;right:12px;top:10px;border:0;background:transparent;font-size:28px;cursor:pointer;color:#64748b}',
      '#homecare-pwa-toast{position:fixed;left:50%;bottom:92px;transform:translateX(-50%) translateY(14px);z-index:1000000;background:#06243a;color:white;border-radius:999px;padding:11px 15px;font-weight:900;box-shadow:0 14px 32px rgba(6,36,58,.28);opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease;max-width:min(92vw,520px);text-align:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}',
      '#homecare-pwa-toast.visible{opacity:1;transform:translateX(-50%) translateY(0)}',
      '@media(max-width:560px){#homecare-install-banner{align-items:flex-start;flex-direction:column}.hc-pwa-actions{width:100%}#homecare-install-banner .btn{flex:1}}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function makeButton(label) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn light small hc-install-direct';
    button.textContent = label || 'Installa app';
    button.setAttribute('data-pwa-manual-install', 'true');
    button.addEventListener('click', requestInstall);
    return button;
  }

  function bindExistingInstallButtons(root) {
    (root || document).querySelectorAll('.hc-install-direct,[data-pwa-manual-install],[data-install-app]').forEach(function (button) {
      if (button.getAttribute('data-pwa-bound') !== 'true') {
        button.removeAttribute('onclick');
        button.setAttribute('data-pwa-bound', 'true');
        button.addEventListener('click', requestInstall);
      }
      if (!button.textContent.trim()) button.textContent = 'Installa app';
      button.hidden = shouldHideInstall();
    });
  }

  function ensureHeaderButton() {
    var top = document.querySelector('.top');
    if (!top || shouldHideInstall()) return;
    bindExistingInstallButtons(top);
    if (top.querySelector('#homecare-install-header,.hc-install-direct,[data-pwa-manual-install]')) return;
    var target = top.children && top.children.length ? top.children[top.children.length - 1] : top;
    if (!target) return;
    var button = makeButton('Installa app');
    button.id = 'homecare-install-header';
    button.style.marginRight = '8px';
    target.insertBefore(button, target.firstChild || null);
  }

  function ensureBanner() {
    if (document.getElementById('homecare-install-banner')) return;
    var banner = document.createElement('aside');
    banner.id = 'homecare-install-banner';
    banner.setAttribute('aria-live', 'polite');
    banner.hidden = true;
    banner.innerHTML = '<div class="hc-pwa-copy"><img src="/icon-192.png" alt=""><span><strong>Installa Home Care</strong><small id="homecare-install-message">Aggiungila al dispositivo e aprila come una vera app.</small></span></div><div class="hc-pwa-actions"><button id="homecare-install-action" class="btn gold small" type="button">Installa</button><button id="homecare-install-dismiss" class="hc-pwa-dismiss" type="button" aria-label="Chiudi suggerimento installazione">×</button></div>';
    document.body.appendChild(banner);
    document.getElementById('homecare-install-action').addEventListener('click', requestInstall);
    document.getElementById('homecare-install-dismiss').addEventListener('click', function () {
      safeWrite(DISMISS_KEY, APP_VERSION);
      syncInstallUi();
    });
  }

  function ensureIosModal() {
    if (document.getElementById('homecare-pwa-ios-modal')) return;
    var modal = document.createElement('div');
    modal.id = 'homecare-pwa-ios-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'homecare-pwa-ios-title');
    modal.hidden = true;
    modal.innerHTML = '<div class="hc-pwa-backdrop" data-pwa-close></div><section class="hc-pwa-card"><button class="hc-pwa-close" type="button" data-pwa-close aria-label="Chiudi">×</button><img src="/icon-192.png" alt="Home Care"><h2 id="homecare-pwa-ios-title">Aggiungi Home Care alla schermata Home</h2><ol><li>Tocca il pulsante <strong>Condividi</strong> di Safari.</li><li>Seleziona <strong>Aggiungi alla schermata Home</strong>.</li><li>Conferma con <strong>Aggiungi</strong>.</li></ol><button class="btn full" type="button" data-pwa-close>Ho capito</button></section>';
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-pwa-close]').forEach(function (element) {
      element.addEventListener('click', function () { setIosModal(false); });
    });
  }

  function setIosModal(open) {
    ensureIosModal();
    var modal = document.getElementById('homecare-pwa-ios-modal');
    if (!modal) return;
    modal.hidden = !open;
    document.body.style.overflow = open ? 'hidden' : '';
  }

  function hideInstallUi() {
    document.querySelectorAll('#homecare-install-header,#homecare-install-floating,.hc-install-direct,[data-pwa-manual-install]').forEach(function (button) {
      button.hidden = true;
    });
    var banner = document.getElementById('homecare-install-banner');
    if (banner) banner.hidden = true;
  }

  function syncInstallUi() {
    if (!document.body) return;
    ensureStyles();
    bindExistingInstallButtons(document);

    if (shouldHideInstall()) {
      hideInstallUi();
      return;
    }

    ensureHeaderButton();
    ensureBanner();
    ensureIosModal();
    bindExistingInstallButtons(document);

    document.querySelectorAll('#homecare-install-header,.hc-install-direct,[data-pwa-manual-install]').forEach(function (button) {
      button.hidden = false;
      if (button.id === 'homecare-install-header') button.textContent = 'Installa app';
    });

    var banner = document.getElementById('homecare-install-banner');
    var message = document.getElementById('homecare-install-message');
    var action = document.getElementById('homecare-install-action');
    var ios = isIosDevice();
    var canPrompt = Boolean(deferredPrompt);
    var showBanner = canPrompt || ios || isSmallScreen();

    if (banner) banner.hidden = !showBanner;
    if (message) {
      message.textContent = ios && !canPrompt
        ? 'Su iPhone si installa da Safari: Condividi → Aggiungi alla schermata Home.'
        : 'Aggiungila al dispositivo e aprila come una vera app.';
    }
    if (action) action.textContent = ios && !canPrompt ? 'Mostra istruzioni' : 'Installa';
  }

  async function requestInstall() {
    safeRemove(DISMISS_KEY);

    if (isStandalone()) {
      toast('Home Care è già installata su questo dispositivo.');
      syncInstallUi();
      return;
    }

    if (deferredPrompt) {
      var promptEvent = deferredPrompt;
      deferredPrompt = null;
      try {
        await promptEvent.prompt();
        var choice = promptEvent.userChoice ? await promptEvent.userChoice.catch(function () { return { outcome: 'dismissed' }; }) : { outcome: 'unknown' };
        if (choice.outcome === 'accepted') {
          toast('Installazione Home Care avviata.');
          hideInstallUi();
        } else {
          toast('Installazione annullata. Puoi riprovarla dal pulsante Installa app.');
        }
      } catch (_) {
        toast('Apri il menu del browser e scegli “Installa app” o “Aggiungi alla schermata Home”.');
      }
      syncInstallUi();
      return;
    }

    if (isIosDevice()) {
      setIosModal(true);
      return;
    }

    toast('Apri il menu del browser e scegli “Installa app” o “Aggiungi alla schermata Home”.');
  }

  function resetSessionAndReload() {
    safeRemove('hc_token');
    window.location.href = '/?v=pwa-repair-' + Date.now();
  }

  function rescueBlankApp() {
    var app = document.getElementById('app');
    if (!app || appHasContent() || rescueShown) return;
    rescueShown = true;
    app.innerHTML = '<div class="top"><div class="brand">⌂ Home <span>Care</span></div><div><button class="btn light small" id="homecare-rescue-reload" type="button">Ricarica</button></div></div><main class="wrap"><div class="card"><h1>Home Care si sta caricando</h1><p class="muted">Ho rilevato un caricamento incompleto. Riprova oppure riapri senza la vecchia sessione salvata.</p><button class="btn" id="homecare-rescue-reset" type="button">Riapri Home Care</button></div></main>';
    document.getElementById('homecare-rescue-reload')?.addEventListener('click', function () { window.location.reload(); });
    document.getElementById('homecare-rescue-reset')?.addEventListener('click', resetSessionAndReload);
    syncInstallUi();
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (window.location.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {});
  }

  function startObserver() {
    if (mutationObserver || !document.body || !('MutationObserver' in window)) return;
    mutationObserver = new MutationObserver(function () { syncInstallUi(); });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    ensureStyles();
    registerServiceWorker();
    syncInstallUi();
    startObserver();
    window.setTimeout(syncInstallUi, 700);
    window.setTimeout(syncInstallUi, 1600);
    window.setTimeout(syncInstallUi, 3200);
    window.setTimeout(rescueBlankApp, 4500);
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredPrompt = event;
    syncInstallUi();
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    safeRemove(DISMISS_KEY);
    hideInstallUi();
    toast('Home Care è stata installata.');
  });

  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') setIosModal(false);
  });

  window.addEventListener('focus', syncInstallUi);
  window.addEventListener('resize', syncInstallUi);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') syncInstallUi();
  });

  window.HomeCarePwaInstall = {
    request: requestInstall,
    sync: syncInstallUi,
    resetSessionAndReload: resetSessionAndReload
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
