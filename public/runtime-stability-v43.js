(function () {
  'use strict';

  const RECOVERY_VERSION = '43';
  const NativeMutationObserver = window.MutationObserver;
  let lastBootError = '';

  function elementFromRecord(record) {
    if (!record) return null;
    if (record.target?.nodeType === Node.ELEMENT_NODE) return record.target;
    return record.target?.parentElement || null;
  }

  function isKnownSelfMutation(record) {
    const element = elementFromRecord(record);
    if (!element) return false;
    return Boolean(element.closest(
      '[data-install-app], .desktop-copy, .hc-notification-button, .hc-notification-count, .hc-notification-panel'
    ));
  }

  if (typeof NativeMutationObserver === 'function') {
    class StableMutationObserver {
      constructor(callback) {
        this.callback = callback;
        this.nativeObserver = new NativeMutationObserver((records) => {
          const meaningful = records.filter((record) => !isKnownSelfMutation(record));
          if (meaningful.length) callback(meaningful, this);
        });
      }

      observe(target, options) {
        return this.nativeObserver.observe(target, options);
      }

      disconnect() {
        return this.nativeObserver.disconnect();
      }

      takeRecords() {
        return this.nativeObserver.takeRecords();
      }
    }

    window.MutationObserver = StableMutationObserver;
  }

  function captureError(message) {
    const clean = String(message || '').trim();
    if (clean) lastBootError = clean.slice(0, 500);
  }

  window.addEventListener('error', (event) => {
    captureError(event.error?.message || event.message || 'Errore JavaScript durante l’avvio');
  });

  window.addEventListener('unhandledrejection', (event) => {
    captureError(event.reason?.message || event.reason || 'Errore asincrono durante l’avvio');
  });

  function initialBootVisible() {
    const root = document.getElementById('app');
    if (!root) return false;
    return Boolean(root.querySelector(':scope > .boot-screen'));
  }

  function clearRecoveryQuery() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('hc_recovery') && !url.searchParams.has('hc_cache_bust')) return;
    url.searchParams.delete('hc_recovery');
    url.searchParams.delete('hc_cache_bust');
    history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function showBootFailure() {
    const root = document.getElementById('app');
    if (!root) return;
    const detail = lastBootError
      ? `Dettaglio tecnico: ${lastBootError}`
      : 'Il browser non ha completato il caricamento dei file dell’app.';
    root.innerHTML = `<main class="confirmation-page"><section class="confirmation-card"><div class="brand-lockup"><span class="brand-mark">HC</span><span>Home Care</span></div><h1>Caricamento non riuscito</h1><p>${detail.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))}</p><div class="form-actions"><button class="button primary" type="button" data-runtime-retry>Riprova</button><button class="button light" type="button" data-runtime-reset>Ripristina app</button></div></section></main>`;
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

  async function recoverBoot() {
    const url = new URL(window.location.href);
    if (url.searchParams.get('hc_recovery') === RECOVERY_VERSION) {
      showBootFailure();
      return;
    }
    try {
      await clearPwaState();
    } catch (_) {
      // Anche se la pulizia fallisce, forza comunque un caricamento senza cache.
    }
    url.searchParams.set('hc_recovery', RECOVERY_VERSION);
    url.searchParams.set('hc_cache_bust', String(Date.now()));
    window.location.replace(url.href);
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-runtime-retry]')) {
      window.location.reload();
      return;
    }
    if (event.target.closest('[data-runtime-reset]')) {
      event.preventDefault();
      clearPwaState().finally(() => {
        const url = new URL('/', window.location.origin);
        url.searchParams.set('hc_recovery', RECOVERY_VERSION);
        url.searchParams.set('hc_cache_bust', String(Date.now()));
        window.location.replace(url.href);
      });
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('app');
    if (root && typeof NativeMutationObserver === 'function') {
      const readyObserver = new NativeMutationObserver(() => {
        if (!initialBootVisible()) {
          readyObserver.disconnect();
          clearRecoveryQuery();
        }
      });
      readyObserver.observe(root, { childList: true, subtree: false });
    }

    window.setTimeout(() => {
      if (initialBootVisible()) recoverBoot();
    }, 12_000);
  });
}());
