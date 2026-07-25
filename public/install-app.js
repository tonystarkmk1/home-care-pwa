(function () {
  'use strict';

  const APP_VERSION = 'home-care-v40';
  const standaloneQuery = window.matchMedia('(display-mode: standalone)');
  const userAgent = navigator.userAgent || '';
  const isIos = /iphone|ipad|ipod/i.test(userAgent);
  const isAndroid = /android/i.test(userAgent);
  const isSamsung = /samsungbrowser/i.test(userAgent);
  const isEdge = /edg\//i.test(userAgent);
  const isChrome = /chrome|crios/i.test(userAgent) && !isEdge && !isSamsung;
  const isSafari = /safari/i.test(userAgent) && !/chrome|crios|android|edg\//i.test(userAgent);

  let deferredPrompt = null;
  let waitingWorker = null;
  let reloading = false;
  let installInProgress = false;
  let installHelp = null;

  function isStandalone() {
    return standaloneQuery.matches || navigator.standalone === true;
  }

  function installButtons() {
    return Array.from(document.querySelectorAll('[data-install-app]'));
  }

  function syncInstallButtons() {
    const visible = !isStandalone();
    installButtons().forEach((button) => {
      button.hidden = !visible;
      button.setAttribute('aria-hidden', visible ? 'false' : 'true');
    });
  }

  function installationInstructions() {
    if (isIos) {
      return {
        title: 'Installa Home Care su iPhone o iPad',
        steps: [
          'Apri Home Care con Safari.',
          'Tocca Condividi, il quadrato con la freccia verso l’alto.',
          'Scorri e scegli “Aggiungi alla schermata Home”.',
          'Conferma con “Aggiungi”.',
        ],
        note: 'iOS non consente al sito di aprire automaticamente il comando. Dopo l’installazione Home Care si avvierà come un’app.',
      };
    }
    if (isSamsung) {
      return {
        title: 'Installa con Samsung Internet',
        steps: [
          'Apri il menu del browser.',
          'Scegli “Aggiungi pagina a”.',
          'Seleziona “Schermata Home” e conferma.',
        ],
        note: 'Il nome del comando può cambiare leggermente in base alla versione del telefono.',
      };
    }
    if (isAndroid) {
      return {
        title: 'Installa Home Care su Android',
        steps: [
          'Apri il menu del browser con i tre puntini.',
          'Scegli “Installa app” oppure “Aggiungi alla schermata Home”.',
          'Conferma l’installazione.',
        ],
        note: 'In Chrome può comparire anche l’icona di installazione nella barra degli indirizzi.',
      };
    }
    if (isSafari) {
      return {
        title: 'Installa Home Care con Safari',
        steps: [
          'Apri il menu File di Safari.',
          'Scegli “Aggiungi al Dock”, quando disponibile.',
          'Conferma il nome dell’app.',
        ],
        note: 'Nelle versioni precedenti di macOS puoi creare un collegamento dal menu Condividi.',
      };
    }
    if (isEdge) {
      return {
        title: 'Installa Home Care con Microsoft Edge',
        steps: [
          'Apri il menu con i tre puntini.',
          'Scegli App, quindi “Installa Home Care”.',
          'Conferma l’installazione.',
        ],
        note: 'Può comparire anche l’icona App disponibile nella barra degli indirizzi.',
      };
    }
    if (isChrome) {
      return {
        title: 'Installa Home Care con Chrome',
        steps: [
          'Cerca l’icona di installazione nella barra degli indirizzi.',
          'Oppure apri il menu con i tre puntini e scegli “Installa app”.',
          'Conferma l’installazione.',
        ],
        note: 'Dopo l’installazione Home Care si aprirà in una finestra separata.',
      };
    }
    return {
      title: 'Installa Home Care',
      steps: [
        'Apri il menu del browser.',
        'Cerca “Installa app” oppure “Aggiungi alla schermata Home”.',
        'Conferma l’installazione.',
      ],
      note: 'Quando il browser supporta il prompt nativo, il pulsante apre direttamente la conferma.',
    };
  }

  function ensureInstallHelp() {
    if (installHelp) return installHelp;
    const instructions = installationInstructions();
    const overlay = document.createElement('div');
    overlay.className = 'install-help';
    overlay.hidden = true;
    overlay.innerHTML = `
      <section class="install-help-card" role="dialog" aria-modal="true" aria-labelledby="installHelpTitle">
        <button class="button light icon compact install-help-close" type="button" data-install-help-close aria-label="Chiudi">×</button>
        <div class="install-help-logo" aria-hidden="true">HC</div>
        <h2 id="installHelpTitle"></h2>
        <ol data-install-help-steps></ol>
        <p class="install-help-note" data-install-help-note></p>
        <button class="button primary block" type="button" data-install-help-close>Ho capito</button>
      </section>`;
    overlay.querySelector('h2').textContent = instructions.title;
    const list = overlay.querySelector('[data-install-help-steps]');
    instructions.steps.forEach((step) => {
      const item = document.createElement('li');
      item.textContent = step;
      list.appendChild(item);
    });
    overlay.querySelector('[data-install-help-note]').textContent = instructions.note;

    function close() {
      overlay.classList.remove('open');
      document.body.classList.remove('install-help-open');
      window.setTimeout(() => { overlay.hidden = true; }, 220);
    }

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay || event.target.closest('[data-install-help-close]')) close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !overlay.hidden) close();
    });
    document.body.appendChild(overlay);
    installHelp = { overlay, close };
    return installHelp;
  }

  function openInstallHelp() {
    const help = ensureInstallHelp();
    help.overlay.hidden = false;
    document.body.classList.add('install-help-open');
    window.requestAnimationFrame(() => {
      help.overlay.classList.add('open');
      help.overlay.querySelector('[data-install-help-close]')?.focus({ preventScroll: true });
    });
  }

  async function requestInstallation() {
    if (installInProgress || isStandalone()) return;
    if (!deferredPrompt) {
      openInstallHelp();
      return;
    }
    installInProgress = true;
    try {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (choice?.outcome === 'accepted') syncInstallButtons();
    } catch (_) {
      deferredPrompt = null;
      openInstallHelp();
    } finally {
      installInProgress = false;
    }
  }

  document.addEventListener('click', (event) => {
    const installButton = event.target.closest('[data-install-app]');
    if (!installButton) return;
    event.preventDefault();
    requestInstallation();
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

  if (typeof standaloneQuery.addEventListener === 'function') standaloneQuery.addEventListener('change', syncInstallButtons);
  else if (typeof standaloneQuery.addListener === 'function') standaloneQuery.addListener(syncInstallButtons);

  const observer = new MutationObserver(syncInstallButtons);
  observer.observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
  syncInstallButtons();

  function updateConnectionState() {
    const banner = document.getElementById('offlineBanner');
    if (banner) banner.hidden = navigator.onLine;
  }
  window.addEventListener('online', updateConnectionState);
  window.addEventListener('offline', updateConnectionState);
  updateConnectionState();

  function showUpdate(worker) {
    waitingWorker = worker;
    const card = document.getElementById('updateCard');
    if (card) card.hidden = false;
  }

  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-apply-update]')) return;
    if (waitingWorker) waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(APP_VERSION)}`, { scope: '/' })
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
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  }
}());
