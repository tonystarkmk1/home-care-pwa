(function () {
  'use strict';

  const APP_VERSION = 'home-care-v42';
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
  let reloading = false;
  let installInProgress = false;
  let installHelp = null;

  function isStandalone() {
    return standaloneQuery.matches || navigator.standalone === true;
  }

  function installButtons() {
    return Array.from(document.querySelectorAll('[data-install-app]'));
  }

  function setButtonLabel(button, nativePrompt) {
    if (!button) return;
    const desktopCopy = button.querySelector('.desktop-copy');
    const label = nativePrompt ? 'Installa app' : 'Come installare';
    if (desktopCopy) desktopCopy.textContent = nativePrompt ? 'Installa' : 'Installazione';
    else button.innerHTML = `<span aria-hidden="true">⇩</span> ${label}`;
    button.dataset.installReady = nativePrompt ? '1' : '0';
  }

  function syncInstallButtons() {
    const visible = !isStandalone();
    installButtons().forEach((button) => {
      button.hidden = !visible;
      button.setAttribute('aria-hidden', visible ? 'false' : 'true');
      setButtonLabel(button, Boolean(deferredPrompt));
    });
  }

  function instructions() {
    if (isEmbedded) {
      return {
        title: 'Apri Home Care nel browser del telefono',
        steps: [
          'Apri il menu di questa schermata.',
          'Scegli “Apri in Chrome”, “Apri in Safari” oppure “Apri nel browser”.',
          'Torna su Home Care e premi nuovamente “Installa app”.',
        ],
        note: 'I browser interni di Instagram, Facebook e altre app possono creare soltanto un collegamento e non una vera PWA.',
      };
    }
    if (isIos) {
      return {
        title: 'Installa Home Care su iPhone o iPad',
        steps: [
          'Apri questa pagina direttamente con Safari.',
          'Tocca Condividi, il quadrato con la freccia verso l’alto.',
          'Scorri e scegli “Aggiungi alla schermata Home”.',
          'Attiva “Apri come app”, se Safari mostra questa opzione, quindi conferma con “Aggiungi”.',
          'Apri Home Care dalla nuova icona, non dalla scheda di Safari.',
        ],
        note: 'Su iPhone “Aggiungi alla schermata Home” è il metodo ufficiale di installazione. La PWA si apre senza barra del browser quando viene avviata dalla sua icona.',
      };
    }
    if (isSamsung) {
      return {
        title: 'Installa Home Care con Samsung Internet',
        steps: [
          'Attendi che Home Care abbia terminato il caricamento e aggiorna la pagina una volta.',
          'Cerca l’icona di installazione nella barra degli indirizzi.',
          'In alternativa apri il menu e scegli “Aggiungi pagina a”, poi “Schermata Home”.',
          'Conferma quando Samsung Internet indica che verrà installata l’app.',
        ],
        note: 'Se compare soltanto “Crea collegamento”, usa il pulsante “Ripristina installazione” qui sotto e riprova dopo il riavvio della pagina.',
      };
    }
    if (isAndroid && (isChrome || isEdge)) {
      return {
        title: 'Installa Home Care come app su Android',
        steps: [
          'Attendi che la pagina sia completamente caricata.',
          'Premi di nuovo il pulsante Home Care: quando disponibile si aprirà la conferma nativa “Installa app”.',
          'Puoi anche aprire il menu del browser e scegliere “Installa app”.',
          'Evita “Crea collegamento” quando è presente anche il comando “Installa app”.',
        ],
        note: 'Dopo l’installazione Home Care compare nell’elenco delle app e si apre in modalità autonoma, senza la normale barra del browser.',
      };
    }
    if (isAndroid) {
      return {
        title: 'Installa Home Care su Android',
        steps: [
          'Apri questa pagina con Google Chrome, Microsoft Edge o Samsung Internet.',
          'Aggiorna la pagina e attendi il caricamento completo.',
          'Premi “Installa app” e conferma il messaggio nativo.',
        ],
        note: 'Alcuni browser Android non supportano l’installazione PWA completa e creano soltanto collegamenti.',
      };
    }
    if (isSafari) {
      return {
        title: 'Installa Home Care con Safari',
        steps: [
          'Apri il menu File di Safari.',
          'Scegli “Aggiungi al Dock”, quando disponibile.',
          'Conferma il nome Home Care.',
        ],
        note: 'Home Care verrà avviata in una finestra separata.',
      };
    }
    if (isEdge || isChrome) {
      return {
        title: 'Installa Home Care sul computer',
        steps: [
          'Cerca l’icona di installazione nella barra degli indirizzi.',
          'Oppure apri il menu, scegli App e poi “Installa Home Care”.',
          'Conferma l’installazione.',
        ],
        note: 'La versione installata si apre in una finestra separata e si aggiorna automaticamente.',
      };
    }
    return {
      title: 'Installa Home Care',
      steps: [
        'Apri Home Care con Safari su iPhone oppure Chrome, Edge o Samsung Internet su Android.',
        'Ricarica la pagina e cerca il comando “Installa app”.',
        'Conferma l’installazione nativa.',
      ],
      note: 'Il browser in uso potrebbe supportare soltanto la creazione di un collegamento.',
    };
  }

  function ensureInstallHelp() {
    if (installHelp) return installHelp;
    const guide = instructions();
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
        <div class="form-actions">
          <button class="button light" type="button" data-pwa-repair>Ripristina installazione</button>
          <button class="button primary" type="button" data-install-help-close>Ho capito</button>
        </div>
      </section>`;
    overlay.querySelector('h2').textContent = guide.title;
    const list = overlay.querySelector('[data-install-help-steps]');
    guide.steps.forEach((step) => {
      const item = document.createElement('li');
      item.textContent = step;
      list.appendChild(item);
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

  async function repairInstallation() {
    const registrations = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistrations() : [];
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith('home-care-')).map((key) => caches.delete(key)));
    }
    const url = new URL('/', window.location.origin);
    url.searchParams.set('pwa_reset', '42');
    window.location.replace(url.href);
  }

  async function requestInstallation() {
    if (installInProgress || isStandalone()) return;
    if (!deferredPrompt) {
      openInstallHelp();
      return;
    }
    installInProgress = true;
    try {
      await deferredPrompt.prompt();
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

  document.addEventListener('click', (event) => {
    const repair = event.target.closest('[data-pwa-repair]');
    if (repair) {
      event.preventDefault();
      repair.disabled = true;
      repairInstallation().catch(() => window.location.reload());
      return;
    }
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
    else window.location.reload();
  });

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
        .catch(() => openInstallHelp());
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  }
}());
