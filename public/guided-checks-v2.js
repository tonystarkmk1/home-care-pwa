(function () {
  'use strict';

  let config = null;
  let user = null;
  let overlay = null;
  let enhancementTimer = null;
  const app = document.getElementById('app');

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  function cssEscape(value) {
    const raw = String(value || '');
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(raw);
    return raw.replace(/[^a-zA-Z0-9_-]/g, '');
  }

  function dateTimeIT(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? String(value)
      : date.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
  }

  function toast(message, kind = '') {
    const region = document.getElementById('toastRegion');
    if (!region) return;
    const node = document.createElement('div');
    node.className = `toast ${kind}`.trim();
    node.textContent = message;
    region.appendChild(node);
    window.setTimeout(() => node.remove(), 4500);
  }

  async function request(url, options = {}) {
    if (!config) {
      const response = await fetch('/api/config', { credentials: 'same-origin', cache: 'no-store' });
      config = await response.json();
    }
    const method = String(options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    let body = options.body;
    if (body && !(body instanceof FormData) && typeof body !== 'string') {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(body);
    }
    if (!['GET', 'HEAD'].includes(method)) headers.set('X-CSRF-Token', config.csrfToken || '');
    const response = await fetch(url, {
      ...options,
      method,
      headers,
      body,
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json() : await response.text();
    if (data?.csrfToken) config.csrfToken = data.csrfToken;
    if (!response.ok) {
      const error = new Error(data?.error || data || 'Operazione non riuscita');
      error.status = response.status;
      error.code = data?.code || 'REQUEST_ERROR';
      throw error;
    }
    return data;
  }

  function currentTab() {
    return new URLSearchParams(window.location.search).get('tab') || '';
  }

  function refreshCurrentTab() {
    const tab = currentTab();
    const button = document.querySelector(`[data-action="set-tab"][data-tab="${cssEscape(tab)}"]`);
    if (button) button.click();
    else window.location.reload();
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    const node = document.createElement('div');
    node.className = 'hc-guided-overlay';
    node.hidden = true;
    node.innerHTML = '<section class="hc-guided-dialog" role="dialog" aria-modal="true"><div data-guided-content></div></section>';
    node.addEventListener('click', (event) => {
      if (event.target === node) closeOverlay();
    });
    document.body.appendChild(node);
    overlay = node;
    return overlay;
  }

  function openOverlay(html) {
    const node = ensureOverlay();
    node.querySelector('[data-guided-content]').innerHTML = html;
    node.hidden = false;
    document.body.classList.add('hc-guided-open');
    node.querySelector('button, input, textarea, select')?.focus({ preventScroll: true });
  }

  function closeOverlay() {
    if (overlay) overlay.hidden = true;
    document.body.classList.remove('hc-guided-open');
  }

  function overlayHeader(title, subtitle) {
    return `<header class="hc-guided-header"><div><span class="eyebrow">Controllo guidato</span><h2>${esc(title)}</h2><p>${esc(subtitle || '')}</p></div><button class="button light icon compact" type="button" data-guided-action="close-overlay" aria-label="Chiudi">×</button></header>`;
  }

  async function openChecklistTemplate(propertyId, propertyName) {
    const response = await request(`/api/admin/properties/${encodeURIComponent(propertyId)}/checklist-template`);
    const items = Array.isArray(response.items) ? response.items : [];
    openOverlay(`${overlayHeader(`Checklist di ${propertyName}`, response.source === 'property' ? 'Lista personalizzata per questo immobile.' : 'Al momento usa le voci previste dal piano.')}
      <form class="hc-guided-body form-grid" data-guided-form="save-template" data-property-id="${esc(propertyId)}" data-property-name="${esc(propertyName)}">
        <div class="notice"><strong>Una voce per riga</strong><p>Questa lista verrà caricata ogni volta che premi “Inizia controllo”. Puoi modificarla quando necessario.</p></div>
        <div class="field"><label for="guidedTemplateItems">Cose da fare durante il controllo</label><textarea id="guidedTemplateItems" name="items_text" maxlength="30000" required>${esc(items.join('\n'))}</textarea></div>
        <div class="form-actions"><button class="button success" type="submit">Salva checklist</button><button class="button light" type="button" data-guided-action="close-overlay">Annulla</button></div>
      </form>`);
  }

  function photoMarkup(photo, editable) {
    return `<div class="hc-guided-photo"><a href="${esc(photo.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(photo.url)}" alt="Fotografia della verifica" loading="lazy"></a>${editable ? `<button type="button" data-guided-action="delete-item-photo" data-id="${esc(photo.id)}" aria-label="Elimina fotografia">×</button>` : ''}</div>`;
  }

  function itemMarkup(session, item) {
    const editable = ['in_progress', 'draft'].includes(session.status);
    return `<article class="hc-guided-item ${item.checked ? 'is-complete' : ''}" data-guided-item data-session-id="${esc(session.id)}" data-item-id="${esc(item.id)}">
      <label class="hc-guided-checkline"><input type="checkbox" data-guided-item-check ${item.checked ? 'checked' : ''} ${editable ? '' : 'disabled'}><span><strong>${esc(item.label)}</strong><small>${item.checked_at ? `Completata ${dateTimeIT(item.checked_at)}` : 'Da completare'}</small></span></label>
      <div class="field"><label>Nota su questa verifica</label><textarea data-guided-item-notes maxlength="2000" ${editable ? '' : 'disabled'} placeholder="Scrivi eventuali anomalie o dettagli…">${esc(item.notes || '')}</textarea></div>
      <div class="hc-guided-photo-list">${(item.photos || []).map((photo) => photoMarkup(photo, editable)).join('')}</div>
      ${editable ? `<form class="hc-guided-upload" data-guided-form="item-photos" data-session-id="${esc(session.id)}" data-item-id="${esc(item.id)}"><label class="button light compact"><span>＋ Foto</span><input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden></label><button class="button teal compact" type="submit" hidden data-guided-upload-submit>Carica</button></form>` : ''}
    </article>`;
  }

  function statusLabel(status) {
    return {
      in_progress: 'Controllo in corso',
      draft: 'Report in bozza',
      approved: 'Report inviato',
      canceled: 'Annullato',
    }[status] || status;
  }

  function sessionMarkup(session) {
    const total = Number(session.items_total || session.items?.length || 0);
    const checked = Number(session.items_checked ?? (session.items || []).filter((item) => item.checked).length);
    const percent = total ? Math.round(checked * 100 / total) : 0;
    const admin = user?.role === 'admin';
    const inProgress = session.status === 'in_progress';
    const draft = session.status === 'draft';
    return `${overlayHeader(session.property_name, `${session.customer_name} · ${statusLabel(session.status)}`)}
      <div class="hc-guided-body">
        <section class="hc-guided-progress-card">
          <div><strong>${checked} di ${total} completate</strong><span>${percent}%</span></div>
          <progress max="${Math.max(total, 1)}" value="${checked}"></progress>
        </section>
        <section class="hc-guided-items">${(session.items || []).map((item) => itemMarkup(session, item)).join('')}</section>
        <div class="field"><label for="guidedOverallNotes">Note generali del controllo</label><textarea id="guidedOverallNotes" data-guided-overall-notes data-session-id="${esc(session.id)}" maxlength="5000" ${['in_progress', 'draft'].includes(session.status) ? '' : 'disabled'} placeholder="Aggiungi osservazioni generali, interventi consigliati o informazioni per il cliente…">${esc(session.overall_notes || '')}</textarea></div>
        <div class="notice ${draft ? 'warning' : ''}"><strong>${draft ? 'Bozza non ancora visibile al cliente' : 'Salvataggio continuo'}</strong><p>${draft ? 'Controlla note e fotografie. Il cliente riceverà il report soltanto dopo la tua approvazione.' : 'Ogni spunta, nota e fotografia viene salvata subito.'}</p></div>
        <div class="hc-guided-actions">
          ${inProgress ? '<button class="button success" type="button" data-guided-action="finish-session" data-id="' + esc(session.id) + '">Termina controllo e crea bozza</button>' : ''}
          ${draft && admin ? '<button class="button success" type="button" data-guided-action="approve-session" data-id="' + esc(session.id) + '">Approva e invia report</button><button class="button light" type="button" data-guided-action="reopen-session" data-id="' + esc(session.id) + '">Riapri controllo</button>' : ''}
          ${['in_progress', 'draft'].includes(session.status) && admin ? '<button class="button danger" type="button" data-guided-action="delete-session" data-id="' + esc(session.id) + '">Elimina bozza</button>' : ''}
          <button class="button light" type="button" data-guided-action="close-overlay">Chiudi</button>
        </div>
      </div>`;
  }

  async function openSession(sessionId) {
    const response = await request(`/api/admin/guided-checks/${encodeURIComponent(sessionId)}`);
    openOverlay(sessionMarkup(response.guided_check));
  }

  async function startSession(propertyId) {
    const response = await request('/api/admin/guided-checks/start', {
      method: 'POST',
      body: { property_id: propertyId },
    });
    if (response.resumed) toast('Controllo già iniziato: riprendo dal punto salvato.', 'success');
    openOverlay(sessionMarkup(response.session));
  }

  function openSessionCard(session) {
    const total = Number(session.items_total || 0);
    const checked = Number(session.items_checked || 0);
    return `<article class="data-card hc-guided-session-card"><div class="data-card-head"><div class="data-card-title"><strong>${esc(session.property_name)}</strong><small>${esc(session.customer_name)} · ${esc(statusLabel(session.status))}</small></div><span class="badge ${session.status === 'draft' ? 'warning' : 'success'}">${checked}/${total}</span></div><div class="data-meta"><div class="meta-row"><span>Avviato</span><span>${dateTimeIT(session.started_at)}</span></div><div class="meta-row"><span>Foto</span><span>${Number(session.photos_count || 0)}</span></div></div><div class="data-actions"><button class="button ${session.status === 'draft' ? 'gold' : 'teal'} compact" type="button" data-guided-action="open-session" data-id="${esc(session.id)}">${session.status === 'draft' ? 'Rivedi bozza' : 'Riprendi controllo'}</button></div></article>`;
  }

  async function enhanceProperties() {
    if (user?.role !== 'admin' || currentTab() !== 'properties') return;
    const main = document.getElementById('main');
    if (!main) return;
    const cards = Array.from(main.querySelectorAll('.data-card')).filter((card) => card.querySelector('[data-action="save-gps"]'));
    if (!cards.length || cards.every((card) => card.dataset.guidedTemplateEnhanced === '1')) return;
    const response = await request('/api/admin/properties');
    const properties = response.properties || [];
    cards.forEach((card, index) => {
      const property = properties[index];
      if (!property || card.dataset.guidedTemplateEnhanced === '1') return;
      card.dataset.guidedTemplateEnhanced = '1';
      const actions = card.querySelector('.data-actions') || card;
      actions.insertAdjacentHTML('beforeend', `<button class="button primary compact" type="button" data-guided-action="edit-template" data-id="${esc(property.id)}" data-name="${esc(property.name)}">Checklist controllo</button>`);
    });
  }

  async function enhanceChecks() {
    if (!['admin', 'helper'].includes(user?.role) || currentTab() !== 'checks') return;
    const main = document.getElementById('main');
    if (!main) return;
    const response = await request('/api/admin/guided-checks');
    const sessions = response.guided_checks || [];
    const byProperty = new Map(sessions.map((session) => [session.property_id, session]));

    if (!main.querySelector('[data-guided-open-sessions]') && sessions.length) {
      const firstSection = main.querySelector('section.card');
      const html = `<section class="card hc-guided-open-section" data-guided-open-sessions><div class="card-header"><div><h2 class="card-title">Controlli aperti e bozze</h2><p class="card-subtitle">Riprendi il lavoro o approva il report prima di inviarlo al cliente.</p></div><span class="badge gold">${sessions.length}</span></div><div class="data-list desktop-grid">${sessions.map(openSessionCard).join('')}</div></section>`;
      if (firstSection) firstSection.insertAdjacentHTML('beforebegin', html);
      else main.insertAdjacentHTML('beforeend', html);
    }

    const buttons = Array.from(main.querySelectorAll('[data-action="open-check"]'));
    buttons.forEach((button) => {
      if (button.dataset.guidedEnhanced === '1') return;
      button.dataset.guidedEnhanced = '1';
      const propertyId = button.dataset.id;
      const session = byProperty.get(propertyId);
      button.removeAttribute('data-action');
      if (session) {
        button.dataset.guidedAction = 'open-session';
        button.dataset.id = session.id;
        button.textContent = session.status === 'draft' ? 'Rivedi bozza' : 'Riprendi controllo';
        button.className = `button ${session.status === 'draft' ? 'gold' : 'teal'} compact`;
      } else {
        button.dataset.guidedAction = 'start-session';
        button.dataset.propertyId = propertyId;
        button.textContent = 'Inizia controllo';
        button.className = 'button success compact';
      }
    });
  }

  async function enhanceReports() {
    if (user?.role !== 'admin' || currentTab() !== 'reports') return;
    const main = document.getElementById('main');
    if (!main || main.querySelector('[data-guided-drafts]')) return;
    const response = await request('/api/admin/guided-checks?status=draft');
    const drafts = response.guided_checks || [];
    if (!drafts.length) return;
    const header = main.querySelector('.page-header');
    const html = `<section class="card hc-guided-drafts" data-guided-drafts><div class="card-header"><div><h2 class="card-title">Report da approvare</h2><p class="card-subtitle">Queste bozze non sono ancora visibili al cliente.</p></div><span class="badge warning">${drafts.length}</span></div><div class="data-list desktop-grid">${drafts.map(openSessionCard).join('')}</div></section>`;
    if (header) header.insertAdjacentHTML('afterend', html);
    else main.insertAdjacentHTML('afterbegin', html);
  }

  function updateProgressFromDom() {
    const rows = Array.from(overlay?.querySelectorAll('[data-guided-item]') || []);
    const total = rows.length;
    const checked = rows.filter((row) => row.querySelector('[data-guided-item-check]')?.checked).length;
    const card = overlay?.querySelector('.hc-guided-progress-card');
    if (!card) return;
    const strong = card.querySelector('strong');
    const span = card.querySelector('span');
    const progress = card.querySelector('progress');
    if (strong) strong.textContent = `${checked} di ${total} completate`;
    if (span) span.textContent = `${total ? Math.round(checked * 100 / total) : 0}%`;
    if (progress) {
      progress.max = Math.max(total, 1);
      progress.value = checked;
    }
  }

  async function saveItem(itemNode) {
    const checkbox = itemNode.querySelector('[data-guided-item-check]');
    const notes = itemNode.querySelector('[data-guided-item-notes]');
    const sessionId = itemNode.dataset.sessionId;
    const itemId = itemNode.dataset.itemId;
    itemNode.classList.add('is-saving');
    try {
      const response = await request(`/api/admin/guided-checks/${encodeURIComponent(sessionId)}/items/${encodeURIComponent(itemId)}`, {
        method: 'PATCH',
        body: { checked: checkbox.checked, notes: notes.value },
      });
      itemNode.classList.toggle('is-complete', Boolean(response.item.checked));
      const small = itemNode.querySelector('.hc-guided-checkline small');
      if (small) small.textContent = response.item.checked ? 'Completata e salvata' : 'Da completare';
      updateProgressFromDom();
      return response.item;
    } finally {
      itemNode.classList.remove('is-saving');
    }
  }

  async function saveOverallNotes() {
    const input = overlay?.querySelector('[data-guided-overall-notes]');
    if (!input) return;
    await request(`/api/admin/guided-checks/${encodeURIComponent(input.dataset.sessionId)}`, {
      method: 'PATCH',
      body: { overall_notes: input.value },
    });
  }

  async function saveAllVisibleItems() {
    const rows = Array.from(overlay?.querySelectorAll('[data-guided-item]') || []);
    for (const row of rows) await saveItem(row);
    await saveOverallNotes();
  }

  async function handleAction(button) {
    const action = button.dataset.guidedAction;
    if (!action) return;
    if (action === 'close-overlay') return closeOverlay();
    if (action === 'edit-template') return openChecklistTemplate(button.dataset.id, button.dataset.name || 'immobile');
    if (action === 'start-session') return startSession(button.dataset.propertyId);
    if (action === 'open-session') return openSession(button.dataset.id);
    if (action === 'delete-item-photo') {
      if (!window.confirm('Eliminare questa fotografia?')) return;
      await request(`/api/admin/guided-check-photos/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE', body: {} });
      const sessionId = overlay?.querySelector('[data-guided-overall-notes]')?.dataset.sessionId;
      toast('Fotografia eliminata.', 'success');
      if (sessionId) return openSession(sessionId);
      return;
    }
    if (action === 'finish-session') {
      button.disabled = true;
      try {
        await saveAllVisibleItems();
        await request(`/api/admin/guided-checks/${encodeURIComponent(button.dataset.id)}/finish`, { method: 'POST', body: {} });
        toast('Controllo terminato. Il report è in bozza e attende approvazione.', 'success');
        closeOverlay();
        refreshCurrentTab();
      } finally { button.disabled = false; }
      return;
    }
    if (action === 'approve-session') {
      if (!window.confirm('Approvi il report e lo rendi visibile al cliente?')) return;
      button.disabled = true;
      try {
        await saveAllVisibleItems();
        await request(`/api/admin/guided-checks/${encodeURIComponent(button.dataset.id)}/approve`, { method: 'POST', body: {} });
        toast('Report approvato e inviato al cliente.', 'success');
        closeOverlay();
        document.querySelector('[data-action="set-tab"][data-tab="reports"]')?.click();
      } finally { button.disabled = false; }
      return;
    }
    if (action === 'reopen-session') {
      await request(`/api/admin/guided-checks/${encodeURIComponent(button.dataset.id)}/reopen`, { method: 'POST', body: {} });
      toast('Controllo riaperto.', 'success');
      return openSession(button.dataset.id);
    }
    if (action === 'delete-session') {
      if (!window.confirm('Eliminare questa bozza e tutte le fotografie non ancora inviate?')) return;
      const confirmation = window.prompt('Scrivi ELIMINA BOZZA per confermare.');
      if (confirmation !== 'ELIMINA BOZZA') return toast('Eliminazione annullata.', 'danger');
      await request(`/api/admin/guided-checks/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE', body: {} });
      toast('Bozza eliminata.', 'success');
      closeOverlay();
      refreshCurrentTab();
    }
  }

  async function handleForm(form) {
    const kind = form.dataset.guidedForm;
    if (!kind) return;
    const buttons = form.querySelectorAll('button,input[type="submit"]');
    buttons.forEach((button) => { button.disabled = true; });
    try {
      if (kind === 'save-template') {
        const items = String(form.elements.items_text.value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        await request(`/api/admin/properties/${encodeURIComponent(form.dataset.propertyId)}/checklist-template`, {
          method: 'PUT',
          body: { items_json: items },
        });
        toast('Checklist dell’immobile salvata.', 'success');
        closeOverlay();
        return;
      }
      if (kind === 'item-photos') {
        const input = form.querySelector('input[type="file"]');
        const files = Array.from(input?.files || []);
        if (!files.length) throw new Error('Seleziona almeno una fotografia.');
        if (files.length > 4) throw new Error('Puoi caricare al massimo 4 fotografie per volta.');
        const multipart = new FormData();
        files.forEach((file) => multipart.append('photos', file));
        await request(`/api/admin/guided-checks/${encodeURIComponent(form.dataset.sessionId)}/items/${encodeURIComponent(form.dataset.itemId)}/photos`, {
          method: 'POST',
          body: multipart,
        });
        toast('Fotografie salvate.', 'success');
        return openSession(form.dataset.sessionId);
      }
    } finally {
      if (form.isConnected) buttons.forEach((button) => { button.disabled = false; });
    }
  }

  async function enhance() {
    if (!user) return;
    try {
      await Promise.all([enhanceProperties(), enhanceChecks(), enhanceReports()]);
    } catch (error) {
      if (error.status !== 401) console.warn('Controlli guidati non caricati:', error);
    }
  }

  function scheduleEnhance() {
    window.clearTimeout(enhancementTimer);
    enhancementTimer = window.setTimeout(enhance, 140);
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-guided-action]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    Promise.resolve(handleAction(button)).catch((error) => toast(error.message || 'Operazione non riuscita.', 'danger'));
  }, true);

  document.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-guided-form]');
    if (!form) return;
    event.preventDefault();
    event.stopPropagation();
    handleForm(form).catch((error) => toast(error.message || 'Operazione non riuscita.', 'danger'));
  }, true);

  document.addEventListener('change', (event) => {
    const item = event.target.closest('[data-guided-item]');
    if (item && (event.target.matches('[data-guided-item-check]') || event.target.matches('[data-guided-item-notes]'))) {
      saveItem(item)
        .then(() => toast('Voce salvata.', 'success'))
        .catch((error) => toast(error.message || 'Voce non salvata.', 'danger'));
      return;
    }
    if (event.target.matches('.hc-guided-upload input[type="file"]')) {
      const form = event.target.closest('form');
      const submit = form?.querySelector('[data-guided-upload-submit]');
      if (submit) submit.hidden = !(event.target.files && event.target.files.length);
    }
  });

  document.addEventListener('change', (event) => {
    if (!event.target.matches('[data-guided-overall-notes]')) return;
    saveOverallNotes().then(() => toast('Note generali salvate.', 'success')).catch((error) => toast(error.message, 'danger'));
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay && !overlay.hidden) closeOverlay();
  });

  async function boot() {
    try {
      const configResponse = await fetch('/api/config', { credentials: 'same-origin', cache: 'no-store' });
      config = await configResponse.json();
      const authResponse = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
      if (!authResponse.ok) return;
      user = (await authResponse.json()).user;
      if (!['admin', 'helper'].includes(user.role)) return;
      const observer = new MutationObserver(scheduleEnhance);
      observer.observe(app || document.body, { childList: true, subtree: true });
      scheduleEnhance();
    } catch (error) {
      console.warn('Guided Checks V2 non inizializzato:', error);
    }
  }

  boot();
}());
