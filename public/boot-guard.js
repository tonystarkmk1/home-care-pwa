(function () {
  'use strict';

  const VERSION = '42';
  const BOOT_TIMEOUT_MS = 12_000;
  const REPAIR_KEY = `hc-auto-repair-v${VERSION}`;
  const app = document.getElementById('app');
  let timer = null;
  let finished = false;
  let capturedError = '';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  function isInitialBootVisible() {
    return Boolean(app?.firstElementChild?.classList.contains('boot-screen'));
  }

  function errorText(value) {
    if (!value) return '';
    if (value instanceof Error) return value.message || value.name;
    return String(value.reason?.message || value.message || value.reason || value);
  }

  function setFinished() {
    finished = true;
    if (timer) window.clearTimeout(timer);
    timer = null;
    try { sessionStorage.removeItem(REPAIR_KEY); } catch (_) {}
  }

  window.__HOME_CARE_BOOT_OK__ = setFinished;

  function renderFailure(message, detail = '') {
    if (!app || finished) return;
    finished = true;
    if (timer) window.clearTimeout(timer);
    timer = null;
    document.body.classList.remove('has-mobile-nav', 'sheet-open', 'install-help-open');
    app.innerHTML = `<main class="confirmation-page"><section class="confirmation-card"><div class="brand-lockup"><span class="brand-mark">HC</span><span>Home Care</span></div><h1>Avvio non completato</h1><p>${escapeHtml(message)}</p>${detail ? `<p class="help prewrap">${escapeHtml(detail)}</p>` : ''}<div class="form-actions"><button class="button primary" type="button" data-boot-action="repair">Ripristina e riapri</button><button class="button light" type="button" data-boot-action="reload">Riprova</button></div></section></main>`;
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

  async function repairAndReload(auto = false) {
    try {
      await clearPwaState();
    } catch (_) {}
    const url = new URL('/', window.location.origin);
    url.searchParams.set('boot_repair', VERSION);
    url.searchParams.set('t', String(Date.now()));
    if (auto) url.searchParams.set('auto', '1');
    window.location.replace(url.href);
  }

  window.addEventListener('error', (event) => {
    capturedError = errorText(event.error || event.message);
    if (isInitialBootVisible()) renderFailure('Si è verificato un errore durante l’avvio.', capturedError);
  });

  window.addEventListener('unhandledrejection', (event) => {
    capturedError = errorText(event);
    if (isInitialBootVisible()) renderFailure('Si è verificato un errore durante l’avvio.', capturedError);
  });

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-boot-action]');
    if (!button) return;
    event.preventDefault();
    if (button.dataset.bootAction === 'repair') {
      button.disabled = true;
      repairAndReload(false);
    } else {
      window.location.reload();
    }
  });

  timer = window.setTimeout(() => {
    if (finished || !isInitialBootVisible()) return setFinished();

    let alreadyRepaired = false;
    try {
      alreadyRepaired = sessionStorage.getItem(REPAIR_KEY) === '1';
      if (!alreadyRepaired) sessionStorage.setItem(REPAIR_KEY, '1');
    } catch (_) {}

    if (!alreadyRepaired) {
      repairAndReload(true);
      return;
    }

    renderFailure(
      'Home Care non è riuscita a terminare il caricamento.',
      capturedError || 'Il server risponde, ma il browser non ha completato l’avvio. Premi “Ripristina e riapri”.'
    );
  }, BOOT_TIMEOUT_MS);
}());
