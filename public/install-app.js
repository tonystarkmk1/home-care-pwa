(function () {
  var APP_VERSION = 'home-care-pwa-v18';
  var DISMISS_KEY = 'homecare:pwa-install-dismissed';
  var deferredPrompt = window.__homeCarePwaPrompt || null;
  var mutationObserver = null;
  var rescueShown = false;
  var syncTimer = null;
  var controllerReloadBound = false;

  function safeRead(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  function safeWrite(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) {}
  }

  function safeRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) {}
  }

  function safeSessionRead(key) {
    try { return window.sessionStorage.getItem(key); } catch (e) { return null; }
  }

  function safeSessionWrite(key, value) {
    try { window.sessionStorage.setItem(key, value); } catch (e) {}
  }

  function getApp() {
    return document.getElementById('app');
  }

  function appHasContent() {
    var app = getApp();
    if (!app) return true;
    return Boolean(app.children.length || String(app.textContent || '').trim());
  }

  function getDeferredPrompt() {
    if (!deferredPrompt && window.__homeCarePwaPrompt) deferredPrompt = window.__homeCarePwaPrompt;
    return deferredPrompt;
  }

  function isStandalone() {
    var standaloneMode = false;
    try {
      standaloneMode = Boolean(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    } catch (e) {}
    return standaloneMode || window.navigator.standalone === true || /HomeCareAndroid/i.test(window.navigator.userAgent || '');
  }

  function isIosDevice() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent || '')
      || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
  }

  function canOfferInstall() {
    return Boolean(getDeferredPrompt()) || isIosDevice();
  }

  function shouldHideInstall() {
    return isStandalone() || safeRead(DISMISS_KEY) === APP_VERSION;
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

  function renderFallbackHome(message) {
    var app = getApp();
    if (!app) return false;

    if (typeof window.publicHome === 'function') {
      try {
        window.publicHome(message || '');
        return true;
      } catch (e) {}
    }

    app.innerHTML = '<div class="top"><div class="brand">⌂ Home <span>Care</span></div><div><button class="btn light small" id="homecare-rescue-login" type="button">Accedi</button> <button class="btn gold small" id="homecare-rescue-reload" type="button">Ricarica</button></div></div><main class="wrap"><section class="hero"><div><span class="pill">Badesi e località limitrofe</span><h1>Ci prendiamo cura della <span>tua casa</span></h1><p>Controlli periodici, manutenzioni e report fotografici per seconde case, appartamenti e ville. Anche quando sei lontano, hai un referente di fiducia.</p>' + (message ? '<div class="notice">' + String(message).replace(/[&<>]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]; }) + '</div>' : '') + '</div><div class="card"><h2>Come funziona</h2><p>1. Scegli il servizio più adatto.<br>2. Registrati e conferma la mail.<br>3. Inserisci l’immobile da affidare a Home Care.<br>4. Valutiamo la richiesta e pianifichiamo i controlli.</p></div></section></main>';

    var login = document.getElementById('homecare-rescue-login');
    var reload = document.getElementById('homecare-rescue-reload');
    if (login) login.addEventListener('click', function () {
      if (typeof window.authView === 'function') {
        try { window.authView('login'); return; } catch (e) {}
      }
      window.location.href = '/?login=1&v=' + Date.now();
    });
    if (reload) reload.addEventListener('click', function () {
      window.location.href = '/?v=' + Date.now();
    });
    return true;
  }

  function rescueBlankApp(reason) {
    if (appHasContent()) return;
    rescueShown = true;
    renderFallbackHome(reason || 'Home Care era rimasta in caricamento: ho riaperto la pagina iniziale.');
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
    var scope = root || document;
    var buttons = scope.querySelectorAll('.hc-install-direct,[data-pwa-manual-install],[data-install-app]');
    Array.prototype.forEach.call(buttons, function (button) {
      if (button.getAttribute('data-pwa-bound') !== 'true') {
        button.removeAttribute('onclick');
        button.setAttribute('data-pwa-bound', 'true');
        button.addEventListener('click', requestInstall);
      }
      if (!String(button.textContent || '').trim()) button.textContent = 'Installa app';
      button.hidden = shouldHideInstall() || !canOfferInstall();
    });
  }

  function ensureHeaderButton() {
    var top = document.querySelector('.top');
    if (!top || shouldHideInstall() || !canOfferInstall()) return;
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
    var closers = modal.querySelectorAll('[data-pwa-close]');
    Array.prototype.forEach.call(closers, function (element) {
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
    var buttons = document.querySelectorAll('#homecare-install-header,#homecare-install-floating,.hc-install-direct,[data-pwa-manual-install]');
    Array.prototype.forEach.call(buttons, function (button) { button.hidden = true; });
    var banner = document.getElementById('homecare-install-banner');
    if (banner) banner.hidden = true;
  }

  function syncInstallUi() {
    if (!document.body) return;
    ensureStyles();

    // Prima garantiamo che la pagina abbia contenuto; poi mostriamo l'installazione.
    if (!appHasContent()) rescueBlankApp();

    bindExistingInstallButtons(document);
    if (shouldHideInstall() || !canOfferInstall()) {
      hideInstallUi();
      return;
    }

    ensureHeaderButton();
    ensureBanner();
    ensureIosModal();
    bindExistingInstallButtons(document);

    var buttons = document.querySelectorAll('#homecare-install-header,.hc-install-direct,[data-pwa-manual-install]');
    Array.prototype.forEach.call(buttons, function (button) {
      button.hidden = false;
      if (button.id === 'homecare-install-header') button.textContent = 'Installa app';
    });

    var banner = document.getElementById('homecare-install-banner');
    var message = document.getElementById('homecare-install-message');
    var action = document.getElementById('homecare-install-action');
    var ios = isIosDevice();
    var canPrompt = Boolean(getDeferredPrompt());

    if (banner) banner.hidden = !(canPrompt || ios);
    if (message) {
      message.textContent = ios && !canPrompt
        ? 'Su iPhone si installa da Safari: Condividi → Aggiungi alla schermata Home.'
        : 'Aggiungila al dispositivo e aprila come una vera app.';
    }
    if (action) action.textContent = ios && !canPrompt ? 'Mostra istruzioni' : 'Installa';
  }

  function scheduleSync() {
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(syncInstallUi, 80);
  }

  function requestInstall() {
    safeRemove(DISMISS_KEY);

    if (isStandalone()) {
      toast('Home Care è già installata su questo dispositivo.');
      syncInstallUi();
      return;
    }

    var promptEvent = getDeferredPrompt();
    if (promptEvent) {
      deferredPrompt = null;
      window.__homeCarePwaPrompt = null;
      try {
        Promise.resolve(promptEvent.prompt()).then(function () {
          return promptEvent.userChoice ? promptEvent.userChoice : { outcome: 'unknown' };
        }).then(function (choice) {
          if (choice && choice.outcome === 'accepted') {
            toast('Installazione Home Care avviata.');
            hideInstallUi();
          } else {
            toast('Installazione annullata. Puoi riprovarla dal pulsante Installa app.');
          }
          syncInstallUi();
        }).catch(function () {
          toast('Apri il menu del browser e scegli “Installa app” o “Aggiungi alla schermata Home”.');
          syncInstallUi();
        });
      } catch (e) {
        toast('Apri il menu del browser e scegli “Installa app” o “Aggiungi alla schermata Home”.');
        syncInstallUi();
      }
      return;
    }

    if (isIosDevice()) {
      setIosModal(true);
      return;
    }

    hideInstallUi();
  }

  function resetSessionAndReload() {
    safeRemove('hc_token');
    window.location.href = '/?v=pwa-repair-' + Date.now();
  }

  function bindControllerReload() {
    if (controllerReloadBound || !('serviceWorker' in navigator)) return;
    controllerReloadBound = true;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (safeSessionRead('homecare:sw-controller-reload') === APP_VERSION) return;
      safeSessionWrite('homecare:sw-controller-reload', APP_VERSION);
      window.location.reload();
    });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (window.location.protocol !== 'https:' && ['localhost', '127.0.0.1', '[::1]'].indexOf(window.location.hostname) === -1) return;
    bindControllerReload();
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(function (registration) {
      if (registration && registration.update) registration.update().catch(function () {});
    }).catch(function () {});
  }

  function startObserver() {
    if (mutationObserver || !document.body || !('MutationObserver' in window)) return;
    mutationObserver = new MutationObserver(scheduleSync);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    ensureStyles();
    // Se l'app principale è ferma, la riapriamo subito: niente più pagina bianca dietro al banner.
    window.setTimeout(function () { if (!appHasContent()) rescueBlankApp(); }, 250);
    window.setTimeout(function () { if (!appHasContent()) rescueBlankApp(); }, 900);
    window.setTimeout(function () { if (!appHasContent()) rescueBlankApp(); }, 2200);
    registerServiceWorker();
    syncInstallUi();
    startObserver();
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredPrompt = event;
    window.__homeCarePwaPrompt = event;
    syncInstallUi();
  });

  window.addEventListener('homecarebeforeinstallprompt', function () {
    if (window.__homeCarePwaPrompt) deferredPrompt = window.__homeCarePwaPrompt;
    syncInstallUi();
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    window.__homeCarePwaPrompt = null;
    safeRemove(DISMISS_KEY);
    hideInstallUi();
    toast('Home Care è stata installata.');
  });

  window.addEventListener('error', function () {
    window.setTimeout(function () { if (!appHasContent()) rescueBlankApp('Ho corretto un caricamento incompleto della pagina.'); }, 100);
  });

  window.addEventListener('unhandledrejection', function () {
    window.setTimeout(function () { if (!appHasContent()) rescueBlankApp('Ho corretto un caricamento incompleto della pagina.'); }, 100);
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
    rescueBlankApp: rescueBlankApp,
    resetSessionAndReload: resetSessionAndReload
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
