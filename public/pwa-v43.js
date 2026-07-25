(function () {
  'use strict';

  const APP_VERSION = 'home-care-v43';
  const standaloneQuery = window.matchMedia('(display-mode: standalone)');
  const userAgent = navigator.userAgent || '';
  const isIos = /iphone|ipad|ipod/i.test(userAgent);
  const isAndroid = /android/i.test(userAgent);
  const isSamsung = /samsungbrowser/i.test(userAgent);
  const isEdge = /edg\//i.test(userAgent);
  const isChrome = /chrome|crios/i.test(userAgent) && !isEdge && !isSamsung;
  const isSafari = /safari/i.test(userAgent) && !/chrome|crios|android|edg\//i.test(userAgent);
  const isEmbedded = /FBAN|FBAV|Instagram|Line\/|wv\)/i.test(userAgent);

  let deferredPrompt = null;
  let waitingWorker = null;
  let installHelp = null;
  let installInProgress = false;
  let reloadForUpdate = false;

  function isStandalone() {
    return standaloneQuery.matches || navigator.standalone === true;
  }

  function installButtons() {
    return Array.from(document.querySelectorAll('[data-install-app]'));
  }

  function setButtonLabel(button, nativePrompt) {
    const state = nativePrompt ? 'native' : 'guide';
    if (button.dataset.installLabelState === state) return;
    button.dataset.installLabelState = state;
    button.dataset.installReady = nativePrompt ? '1' : '0';
    const desktopCopy = button.querySelector('.desktop-copy');
    if (desktopCopy) {
      const label = nativePrompt ? 'Installa' : 'Installazione';
      if (desktopCopy.textContent !== label) desktopCopy.textContent = label;
      return;
    }
    const label = nativePrompt ? 'Installa app' : 'Come installare';
    button.replaceChildren();
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '⇩';
    button.append(icon, document.createTextNode(` ${label}`));
  }

  function syncInstallButtons() {
    const visible = !isStandalone();
    installButtons().forEach((button) => {
      if (button.hidden === visible) button.hidden = !visible;
      const ariaHidden = visible ? 'false' : 'true';
      if (button.getAttribute('aria-hidden') !== ariaHidden) button.setAttribute('aria-hidden', ariaHidden);
      setButtonLabel(button, Boolean(deferredPrompt));
    });
  }

  function instructions() {
    if (isEmbedded) return {
      title: 'Apri Home Care nel browser del telefono',
      steps: ['Apri il menu della schermata.', 'Scegli “Apri in Chrome”, “Apri in Safari” oppure “Apri nel browser”.', 'Da Home Care premi nuovamente “Installa app”.'],
      note: 'I browser interni di Instagram e Facebook possono creare soltanto un collegamento.',
    };
    if (isIos) return {
      title: 'Installa Home Care su iPhone o iPad',
      steps: ['Apri questa pagina direttamente con Safari.', 'Tocca Condividi.', 'Scegli “Aggiungi alla schermata Home”.', 'Attiva “Apri come app”, se disponibile, e conferma.'],
      note: 'Apri poi Home Care dalla nuova icona, non dalla scheda di Safari.',
    };
    if (isSamsung) return {
      title: 'Installa Home Care con Samsung Internet',
      steps: ['Ricarica la pagina e attendi il caricamento.', 'Tocca l’icona di installazione nella barra degli indirizzi.', 'In alternativa: menu → Aggiungi pagina a → Schermata Home.', 'Conferma l’installazione dell’app.'],
      note: 'Se compare soltanto “Crea collegamento”, usa “Ripristina installazione”.',
    };
    if (isAndroid && (isChrome || isEdge)) return {
      title: 'Installa Home Care come app su Android',
      steps: ['Attendi il caricamento completo.', 'Premi “Installa app” e conferma il messaggio nativo.', 'In alternativa usa il menu del browser → Installa app.'],
      note: 'L’app installata si apre senza la normale barra del browser.',
    };
    if (isSafari) return {
      title: 'Installa Home Care con Safari',
      steps: ['Apri il menu File.', 'Scegli “Aggiungi al Dock”, se disponibile.', 'Conferma il nome Home Care.'],
      note: 'Home Care verrà avviata in una finestra separata.',
    };
    return {
      title: 'Installa Home Care',
      steps: ['Usa Safari su iPhone oppure Chrome, Edge o Samsung Internet su Android.', 'Ricarica la pagina.', 'Scegli “Installa app” e conferma.'],
      note: 'Il browser in uso potrebbe supportare soltanto un collegamento.',
    };
  }

  function ensureInstallHelp() {
    if (installHelp) return installHelp;
    const guide = instructions();
    const overlay = document.createElement('div');
    overlay.className = 'install-help';
    overlay.hidden = true;
    overlay.innerHTML = `<section class="install-help-card" role="dialog" aria-modal="true" aria-labelledby="installHelpTitle"><button class="button light icon compact install-help-close" type="button" data-install-help-close aria-label="Chiudi">×</button><div class="install-help-logo" aria-hidden="true">HC</div><h2 id="installHelpTitle"></h2><ol data-install-help-steps></ol><p class="install-help-note" data-install-help-note></p><div class="form-actions"><button class="button light" type="button" data-pwa-repair>Ripristina installazione</button><button class="button primary" type="button" data-install-help-close>Ho capito</button></div></section>`;
    overlay.querySelector('h2').textContent = guide.title;
    guide.steps.forEach((step) => {
      const item = document.createElement('li');
      item.textContent = step;
      overlay.querySelector('[data-install-help-steps]').appendChild(item);
    });
    overlay.querySelector('[data-install-help-note]').textContent = guide.note;

    function close() {
      overlay.classList.remove('open');
      document.body.classList.remove('install-help-open');
      window.setTimeout(() => { overlay.hidden = true; }, 220);
    }

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay || event.target.closest('[data-install-help-close]')) close();
    });
    document.body.appendChild(overlay);
    installHelp = { overlay, close };
    return installHelp;
  }

  function openInstallHelp() {
    const help = ensureInstallHelp();
    help.overlay.hidden = false;
    document.body.classList.add('install-help-open');
    window.requestAnimationFrame(() => help.overlay.classList.add('open'));
  }

  async function clearPwaState() {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith('home-care-')).map((key) => caches.delete(key)));
    }
  }

  async function repairInstallation() {
    await clearPwaState();
    const url = new URL('/', window.location.origin);
    url.searchParams.set('pwa_reset', '43');
    url.searchParams.set('cache_bust', String(Date.now()));
    window.location.replace(url.href);
  }

  async function requestInstallation() {
    if (installInProgress || isStandalone()) return;
    if (!deferredPrompt) return openInstallHelp();
    installInProgress = true;
    try {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (choice?.outcome !== 'accepted') openInstallHelp();
      syncInstallButtons();
    } catch (_) {
      deferredPrompt = null;
      openInstallHelp();
    } finally {
      installInProgress = false;
    }
  }

  function showUpdate(worker) {
    waitingWorker = worker;
    const card = document.getElementById('updateCard');
    if (card) card.hidden = false;
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-pwa-repair]')) {
      event.preventDefault();
      repairInstallation().catch(() => window.location.reload());
      return;
    }
    if (event.target.closest('[data-install-app]')) {
      event.preventDefault();
      requestInstallation();
      return;
    }
    if (event.target.closest('[data-apply-update]')) {
      event.preventDefault();
      if (waitingWorker) {
        reloadForUpdate = true;
        waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      } else window.location.reload();
    }
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    syncInstallButtons();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    syncInstallButtons();
    installHelp?.close();
  });

  const appRoot = document.getElementById('app') || document.body;
  const observer = new MutationObserver((records) => {
    const addedInstallButton = records.some((record) => Array.from(record.addedNodes || []).some((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return false;
      return node.matches?.('[data-install-app]') || node.querySelector?.('[data-install-app]');
    }));
    if (addedInstallButton) syncInstallButtons();
  });
  observer.observe(appRoot, { childList: true, subtree: true });
  syncInstallButtons();

  function updateConnectionState() {
    const banner = document.getElementById('offlineBanner');
    if (banner) banner.hidden = navigator.onLine;
  }
  window.addEventListener('online', updateConnectionState);
  window.addEventListener('offline', updateConnectionState);
  updateConnectionState();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(APP_VERSION)}`, { scope: '/', updateViaCache: 'none' })
        .then((registration) => {
          registration.update().catch(() => {});
          if (registration.waiting && navigator.serviceWorker.controller) showUpdate(registration.waiting);
          registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            if (!worker) return;
            worker.addEventListener('statechange', () => {
              if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate(worker);
            });
          });
        })
        .catch(() => {});
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!reloadForUpdate) return;
      reloadForUpdate = false;
      window.location.reload();
    });
  }

  if (typeof standaloneQuery.addEventListener === 'function') standaloneQuery.addEventListener('change', syncInstallButtons);
  else if (typeof standaloneQuery.addListener === 'function') standaloneQuery.addListener(syncInstallButtons);
}());
