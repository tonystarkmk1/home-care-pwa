(function () {
  var APP_VERSION = 'home-care-pwa-v20';
  var ICON_URL = '/icon-192.png?v=32';
  var DISMISS_KEY = 'homecare:pwa-install-dismissed';
  var RELOAD_KEY = 'homecare:sw-controller-reload';
  var deferredPrompt = window.__homeCarePwaPrompt || null;
  var mutationObserver = null;
  var syncTimer = null;

  function readLocal(key) { try { return window.localStorage.getItem(key); } catch (_) { return null; } }
  function writeLocal(key, value) { try { window.localStorage.setItem(key, value); } catch (_) {} }
  function removeLocal(key) { try { window.localStorage.removeItem(key); } catch (_) {} }
  function readSession(key) { try { return window.sessionStorage.getItem(key); } catch (_) { return null; } }
  function writeSession(key, value) { try { window.sessionStorage.setItem(key, value); } catch (_) {} }

  function getPrompt() {
    if (!deferredPrompt && window.__homeCarePwaPrompt) deferredPrompt = window.__homeCarePwaPrompt;
    return deferredPrompt;
  }

  function isStandalone() {
    var displayStandalone = false;
    try { displayStandalone = Boolean(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches); } catch (_) {}
    return displayStandalone || window.navigator.standalone === true || /HomeCareAndroid/i.test(window.navigator.userAgent || '');
  }

  function isIosDevice() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent || '')
      || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
  }

  function isSamsungBrowser() {
    return /SamsungBrowser/i.test(window.navigator.userAgent || '');
  }

  function isMobileWidth() {
    try { return Boolean(window.matchMedia && window.matchMedia('(max-width: 860px)').matches); }
    catch (_) { return false; }
  }

  function shouldShowInstall() {
    if (isStandalone() || readLocal(DISMISS_KEY) === APP_VERSION) return false;
    return Boolean(getPrompt()) || isIosDevice() || isMobileWidth();
  }

  function appHasContent() {
    var app = document.getElementById('app');
    if (!app) return true;
    return Boolean(app.children.length || String(app.textContent || '').trim());
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>]/g, function (match) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[match];
    });
  }

  function rescueBlankApp(message) {
    var app = document.getElementById('app');
    if (!app || appHasContent()) return;
    if (typeof window.publicHome === 'function') {
      try { window.publicHome(message || ''); return; } catch (_) {}
    }
    app.innerHTML = '<div class="top"><div class="brand">⌂ Home <span>Care</span></div><div><button class="btn light small" id="homecare-rescue-login" type="button">Accedi</button> <button class="btn gold small" id="homecare-rescue-reload" type="button">Ricarica</button></div></div><main class="wrap"><section class="hero"><div><span class="pill">Badesi e località limitrofe</span><h1>Ci prendiamo cura della <span>tua casa</span></h1><p>Controlli periodici, manutenzioni e report fotografici per seconde case, appartamenti e ville. Anche quando sei lontano, hai un referente di fiducia.</p>' + (message ? '<div class="notice">' + escapeHtml(message) + '</div>' : '') + '</div><div class="card"><h2>Come funziona</h2><p>1. Scegli il servizio più adatto.<br>2. Registrati e conferma la mail.<br>3. Inserisci l’immobile da affidare a Home Care.<br>4. Valutiamo la richiesta e pianifichiamo i controlli.</p></div></section></main>';
    var login = document.getElementById('homecare-rescue-login');
    var reload = document.getElementById('homecare-rescue-reload');
    if (login) login.addEventListener('click', function () {
      if (typeof window.authView === 'function') {
        try { window.authView('login'); return; } catch (_) {}
      }
      window.location.href = '/?login=1&v=' + Date.now();
    });
    if (reload) reload.addEventListener('click', function () { window.location.href = '/?v=' + Date.now(); });
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
      '#homecare-pwa-ios-modal[hidden],#homecare-pwa-android-modal[hidden]{display:none!important}',
      '#homecare-pwa-ios-modal,#homecare-pwa-android-modal{position:fixed;inset:0;z-index:999999;display:grid;place-items:center;padding:20px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}',
      '#homecare-pwa-ios-modal .hc-pwa-backdrop,#homecare-pwa-android-modal .hc-pwa-backdrop{position:absolute;inset:0;background:rgba(6,36,58,.48)}',
      '#homecare-pwa-ios-modal .hc-pwa-card,#homecare-pwa-android-modal .hc-pwa-card{position:relative;max-width:430px;width:100%;background:#fffdf7;color:#06243a;border-radius:26px;padding:24px;border:1px solid #e2d7c8;box-shadow:0 24px 70px rgba(0,0,0,.32)}',
      '#homecare-pwa-ios-modal img,#homecare-pwa-android-modal img{width:66px;height:66px;border-radius:18px}',
      '#homecare-pwa-ios-modal h2,#homecare-pwa-android-modal h2{margin:12px 0 8px}',
      '#homecare-pwa-ios-modal ol,#homecare-pwa-android-modal ol{line-height:1.65;padding-left:22px}',
      '#homecare-pwa-ios-modal .hc-pwa-close,#homecare-pwa-android-modal .hc-pwa-close{position:absolute;right:12px;top:10px;border:0;background:transparent;font-size:28px;cursor:pointer;color:#64748b}',
      '#homecare-pwa-android-modal .hc-pwa-note{background:#fff8e8;border-left:5px solid #c7952d;border-radius:14px;padding:10px 12px;margin:12px 0;color:#06243a}',
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
    var buttons = (root || document).querySelectorAll('.hc-install-direct,[data-pwa-manual-install],[data-install-app]');
    Array.prototype.forEach.call(buttons, function (button) {
      if (button.getAttribute('data-pwa-bound') !== 'true') {
        button.removeAttribute('onclick');
        button.setAttribute('data-pwa-bound', 'true');
        button.addEventListener('click', requestInstall);
      }
      if (!String(button.textContent || '').trim()) button.textContent = 'Installa app';
      button.hidden = !shouldShowInstall();
    });
  }

  function ensureHeaderButton() {
    var top = document.querySelector('.top');
    if (!top || !shouldShowInstall()) return;
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
    banner.innerHTML = '<div class="hc-pwa-copy"><img src="' + ICON_URL + '" alt=""><span><strong>Installa Home Care</strong><small id="homecare-install-message">Aggiungila al dispositivo e aprila come una vera app.</small></span></div><div class="hc-pwa-actions"><button id="homecare-install-action" class="btn gold small" type="button">Installa</button><button id="homecare-install-dismiss" class="hc-pwa-dismiss" type="button" aria-label="Chiudi suggerimento installazione">×</button></div>';
    document.body.appendChild(banner);
    document.getElementById('homecare-install-action').addEventListener('click', requestInstall);
    document.getElementById('homecare-install-dismiss').addEventListener('click', function () {
      writeLocal(DISMISS_KEY, APP_VERSION);
      syncInstallUi();
    });
  }

  function bindModalClose(modal, setter) {
    var closers = modal.querySelectorAll('[data-pwa-close]');
    Array.prototype.forEach.call(closers, function (element) {
      element.addEventListener('click', function () { setter(false); });
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
    modal.innerHTML = '<div class="hc-pwa-backdrop" data-pwa-close></div><section class="hc-pwa-card"><button class="hc-pwa-close" type="button" data-pwa-close aria-label="Chiudi">×</button><img src="' + ICON_URL + '" alt="Home Care"><h2 id="homecare-pwa-ios-title">Aggiungi Home Care alla schermata Home</h2><ol><li>Tocca il pulsante <strong>Condividi</strong> di Safari.</li><li>Seleziona <strong>Aggiungi alla schermata Home</strong>.</li><li>Conferma con <strong>Aggiungi</strong>.</li></ol><button class="btn full" type="button" data-pwa-close>Ho capito</button></section>';
    document.body.appendChild(modal);
    bindModalClose(modal, setIosModal);
  }

  function ensureAndroidModal() {
    if (document.getElementById('homecare-pwa-android-modal')) return;
    var samsung = isSamsungBrowser();
    var title = samsung ? 'Installa Home Care da Samsung Internet' : 'Installa Home Care';
    var note = samsung
      ? 'Samsung Internet non sempre permette al sito di aprire il popup nativo. Se non parte automaticamente, completa l’installazione dal menu del browser.'
      : 'Se il popup nativo non compare, completa l’installazione dal menu del browser.';
    var steps = samsung
      ? '<li>Tocca il menu <strong>⋮</strong> in basso a destra.</li><li>Scegli <strong>Aggiungi pagina a</strong> oppure <strong>Aggiungi a schermata Home</strong>.</li><li>Seleziona <strong>Schermata Home</strong> e conferma con <strong>Aggiungi</strong>.</li>'
      : '<li>Tocca il menu <strong>⋮</strong> del browser.</li><li>Scegli <strong>Installa app</strong> oppure <strong>Aggiungi alla schermata Home</strong>.</li><li>Conferma con <strong>Installa</strong> o <strong>Aggiungi</strong>.</li>';
    var modal = document.createElement('div');
    modal.id = 'homecare-pwa-android-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'homecare-pwa-android-title');
    modal.hidden = true;
    modal.innerHTML = '<div class="hc-pwa-backdrop" data-pwa-close></div><section class="hc-pwa-card"><button class="hc-pwa-close" type="button" data-pwa-close aria-label="Chiudi">×</button><img src="' + ICON_URL + '" alt="Home Care"><h2 id="homecare-pwa-android-title">' + title + '</h2><div class="hc-pwa-note">' + note + '</div><ol>' + steps + '</ol><button class="btn full" type="button" data-pwa-close>Ho capito</button></section>';
    document.body.appendChild(modal);
    bindModalClose(modal, setAndroidModal);
  }

  function setIosModal(open) {
    ensureIosModal();
    var modal = document.getElementById('homecare-pwa-ios-modal');
    if (!modal) return;
    modal.hidden = !open;
    document.body.style.overflow = open ? 'hidden' : '';
  }

  function setAndroidModal(open) {
    ensureAndroidModal();
    var modal = document.getElementById('homecare-pwa-android-modal');
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
    if (!appHasContent()) rescueBlankApp();
    bindExistingInstallButtons(document);
    if (!shouldShowInstall()) {
      hideInstallUi();
      return;
    }

    ensureHeaderButton();
    ensureBanner();
    ensureIosModal();
    ensureAndroidModal();
    bindExistingInstallButtons(document);

    var buttons = document.querySelectorAll('#homecare-install-header,.hc-install-direct,[data-pwa-manual-install]');
    Array.prototype.forEach.call(buttons, function (button) {
      button.hidden = false;
      if (button.id === 'homecare-install-header') button.textContent = 'Installa app';
    });

    var banner = document.getElementById('homecare-install-banner');
    var message = document.getElementById('homecare-install-message');
    var action = document.getElementById('homecare-install-action');
    var canPrompt = Boolean(getPrompt());

    if (banner) banner.hidden = false;
    if (message) {
      if (canPrompt) message.textContent = 'Aggiungila al dispositivo e aprila come una vera app.';
      else if (isIosDevice()) message.textContent = 'Su iPhone si installa da Safari: Condividi → Aggiungi alla schermata Home.';
      else if (isSamsungBrowser()) message.textContent = 'Su Samsung Internet il pulsante prova il prompt nativo; se non parte, usa il menu ⋮.';
      else message.textContent = 'Se il popup non parte, usa il menu del browser → Installa app.';
    }
    if (action) action.textContent = 'Installa';
  }

  function scheduleSync() {
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(syncInstallUi, 80);
  }

  function requestInstall() {
    removeLocal(DISMISS_KEY);
    if (isStandalone()) {
      toast('Home Care è già installata su questo dispositivo.');
      syncInstallUi();
      return;
    }

    var promptEvent = getPrompt();
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
            toast('Installazione annullata. Puoi riprovare dal pulsante Installa app.');
          }
          syncInstallUi();
        }).catch(function () {
          setAndroidModal(true);
          syncInstallUi();
        });
      } catch (_) {
        setAndroidModal(true);
        syncInstallUi();
      }
      return;
    }

    if (isIosDevice()) {
      setIosModal(true);
      return;
    }
    setAndroidModal(true);
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (window.location.protocol !== 'https:' && ['localhost', '127.0.0.1', '[::1]'].indexOf(window.location.hostname) === -1) return;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (readSession(RELOAD_KEY) === APP_VERSION) return;
      writeSession(RELOAD_KEY, APP_VERSION);
      window.location.reload();
    });
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
    removeLocal(DISMISS_KEY);
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
    if (event.key === 'Escape') {
      setIosModal(false);
      setAndroidModal(false);
    }
  });

  window.addEventListener('focus', syncInstallUi);
  window.addEventListener('resize', syncInstallUi);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') syncInstallUi();
  });

  window.HomeCarePwaInstall = {
    request: requestInstall,
    sync: syncInstallUi,
    rescueBlankApp: rescueBlankApp
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
