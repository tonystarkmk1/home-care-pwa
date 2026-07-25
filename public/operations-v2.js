(function () {
  'use strict';

  let config = null;
  let user = null;
  let notificationPanel = null;
  let enhancementTimer = null;
  let notificationTimer = null;

  const app = document.getElementById('app');

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  function dateIT(value) {
    if (!value) return '—';
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('it-IT');
  }

  function dateTimeIT(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
  }

  function dateTimeLocal(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  }

  function todayISO() {
    const date = new Date();
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
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
    if (!config) config = await fetch('/api/config', { credentials: 'same-origin', cache: 'no-store' }).then((response) => response.json());
    const method = String(options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    let body = options.body;
    if (body && !(body instanceof FormData) && typeof body !== 'string') {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(body);
    }
    if (!['GET', 'HEAD'].includes(method)) headers.set('X-CSRF-Token', config.csrfToken || '');
    const response = await fetch(url, { ...options, method, headers, body, credentials: 'same-origin', cache: 'no-store' });
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
    const button = document.querySelector(`[data-action="set-tab"][data-tab="${CSS.escape(tab)}"]`);
    if (button) button.click();
    else window.location.reload();
  }

  function formDataObject(form) {
    const output = {};
    new FormData(form).forEach((value, key) => {
      if (!(value instanceof File)) output[key] = value;
    });
    return output;
  }

  function propertyOptionRows(properties, selected = '') {
    return properties.map((property) => `<option value="${esc(property.id)}" ${property.id === selected ? 'selected' : ''}>${esc(property.customer_name ? `${property.customer_name} · ${property.name}` : property.name)}</option>`).join('');
  }

  function occupancyItem(period, adminMode) {
    const active = String(period.start_date).slice(0, 10) <= todayISO() && String(period.end_date).slice(0, 10) >= todayISO();
    return `<article class="hc-occupancy-item ${active ? 'active-period' : ''}">
      <div class="data-card-head"><div class="data-card-title"><strong>${esc(period.property_name)}</strong><small>${adminMode ? `${esc(period.customer_name)} · ` : ''}${dateIT(period.start_date)} – ${dateIT(period.end_date)}</small></div>${active ? '<span class="badge warning">Casa occupata</span>' : '<span class="badge">Periodo registrato</span>'}</div>
      ${period.note ? `<p class="prewrap">${esc(period.note)}</p>` : ''}
      <details class="hc-report-editor"><summary>Modifica periodo</summary><form class="form-grid" data-hc-form="${adminMode ? 'admin-occupancy-edit' : 'client-occupancy-edit'}" data-id="${esc(period.id)}"><div class="form-grid two"><div class="field"><label>Dal</label><input name="start_date" type="date" value="${esc(String(period.start_date).slice(0, 10))}" required></div><div class="field"><label>Al</label><input name="end_date" type="date" value="${esc(String(period.end_date).slice(0, 10))}" required></div></div><div class="field"><label>Nota</label><textarea name="note" maxlength="1000">${esc(period.note || '')}</textarea></div><button class="button success" type="submit">Salva periodo</button></form></details>
      <div class="data-actions"><button class="button danger compact" type="button" data-hc-action="delete-occupancy" data-mode="${adminMode ? 'admin' : 'client'}" data-id="${esc(period.id)}">Elimina periodo</button></div>
    </article>`;
  }

  function occupancyManager(properties, occupancies, adminMode) {
    const endpointMode = adminMode ? 'admin' : 'client';
    return `<section class="card hc-operation-card" data-hc-occupancy-manager>
      <div class="hc-operation-heading"><div><h2>Periodi in cui la casa è occupata</h2><p class="card-subtitle">In queste date i controlli vengono sospesi e la prossima visita viene spostata automaticamente.</p></div><span class="badge gold">${occupancies.length}</span></div>
      <form class="form-grid hc-operation-grid two" data-hc-form="${endpointMode}-occupancy-create">
        <div class="field span-all"><label>Immobile</label><select name="property_id" required><option value="">Seleziona immobile</option>${propertyOptionRows(properties)}</select></div>
        <div class="field"><label>Casa occupata dal</label><input name="start_date" type="date" min="${todayISO()}" required></div>
        <div class="field"><label>Fino al</label><input name="end_date" type="date" min="${todayISO()}" required></div>
        <div class="field span-all"><label>Nota facoltativa</label><textarea name="note" maxlength="1000" placeholder="Esempio: soggiorno della famiglia, ospiti presenti…"></textarea></div>
        <button class="button teal span-all" type="submit">Registra periodo</button>
      </form>
      <div class="hc-occupancy-list">${occupancies.length ? occupancies.map((period) => occupancyItem(period, adminMode)).join('') : '<div class="empty-state"><strong>Nessun periodo registrato</strong><span>I controlli seguono normalmente il calendario previsto.</span></div>'}</div>
    </section>`;
  }

  async function enhanceOccupancies() {
    const main = document.getElementById('main');
    if (!main || main.querySelector('[data-hc-occupancy-manager]') || currentTab() !== 'properties') return;
    if (user?.role === 'client') {
      const [dashboard, response] = await Promise.all([request('/api/client/dashboard'), request('/api/client/occupancies')]);
      if (!document.getElementById('main') || currentTab() !== 'properties') return;
      main.insertAdjacentHTML('beforeend', occupancyManager(dashboard.properties || [], response.occupancies || [], false));
      return;
    }
    if (user?.role === 'admin') {
      const [propertiesResponse, periodsResponse] = await Promise.all([request('/api/admin/properties'), request('/api/admin/occupancies')]);
      if (!document.getElementById('main') || currentTab() !== 'properties') return;
      main.insertAdjacentHTML('beforeend', occupancyManager(propertiesResponse.properties || [], periodsResponse.occupancies || [], true));
    }
  }

  async function enhancePropertyDelete() {
    if (user?.role !== 'admin' || currentTab() !== 'properties') return;
    const main = document.getElementById('main');
    if (!main) return;
    const cards = Array.from(main.querySelectorAll('.data-card')).filter((card) => card.querySelector('[data-action="save-gps"]'));
    if (!cards.length || cards.every((card) => card.dataset.hcPropertyEnhanced === '1')) return;
    const response = await request('/api/admin/properties');
    const properties = response.properties || [];
    cards.forEach((card, index) => {
      const property = properties[index];
      if (!property || card.dataset.hcPropertyEnhanced === '1') return;
      card.dataset.hcPropertyEnhanced = '1';
      const actions = card.querySelector('.data-actions') || card;
      actions.insertAdjacentHTML('beforeend', `<button class="button danger compact" type="button" data-hc-action="delete-property" data-id="${esc(property.id)}" data-name="${esc(property.name)}">Elimina immobile</button>`);
    });
  }

  function reportEditor(report) {
    const checklist = Array.isArray(report.checklist_json) ? report.checklist_json : [];
    return `<div class="hc-report-controls">
      <details class="hc-report-editor"><summary>Modifica report</summary>
        <form class="form-grid" data-hc-form="edit-report" data-id="${esc(report.id)}">
          <div class="field"><label>Data e ora del controllo</label><input name="completed_at" type="datetime-local" value="${esc(dateTimeLocal(report.completed_at))}" required></div>
          <div class="field"><label>Note del report</label><textarea name="notes" maxlength="5000">${esc(report.notes || '')}</textarea></div>
          <div class="field"><label>Checklist, una voce per riga</label><textarea name="checklist_text" maxlength="12000">${esc(checklist.join('\n'))}</textarea></div>
          <button class="button success" type="submit">Salva modifiche</button>
        </form>
      </details>
      <details class="hc-report-editor"><summary>Aggiungi fotografie</summary>
        <form class="form-grid" data-hc-form="add-report-photos" data-id="${esc(report.id)}">
          <div class="field"><label>Nuove foto</label><input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple required><small>Massimo 8 immagini, 8 MB ciascuna.</small></div>
          <button class="button teal" type="submit">Carica fotografie</button>
        </form>
      </details>
      <button class="button danger" type="button" data-hc-action="delete-report" data-id="${esc(report.id)}" data-name="${esc(report.property_name)}">Elimina report</button>
    </div>`;
  }

  async function enhanceReports() {
    if (user?.role !== 'admin' || currentTab() !== 'reports') return;
    const main = document.getElementById('main');
    if (!main) return;
    const cards = Array.from(main.querySelectorAll('.report-card'));
    if (!cards.length || cards.every((card) => card.dataset.hcReportEnhanced === '1')) return;
    const response = await request('/api/admin/reports');
    const reports = response.reports || [];
    cards.forEach((card, index) => {
      const report = reports[index];
      if (!report || card.dataset.hcReportEnhanced === '1') return;
      card.dataset.hcReportEnhanced = '1';
      card.dataset.reportId = report.id;
      const links = Array.from(card.querySelectorAll('.photo-link'));
      (report.photos || []).forEach((photo, photoIndex) => {
        const link = links[photoIndex];
        if (!link || link.closest('.hc-photo-wrap')) return;
        const wrapper = document.createElement('div');
        wrapper.className = 'hc-photo-wrap';
        link.parentNode.insertBefore(wrapper, link);
        wrapper.appendChild(link);
        wrapper.insertAdjacentHTML('beforeend', `<button class="hc-photo-delete" type="button" data-hc-action="delete-report-photo" data-id="${esc(photo.id)}" aria-label="Elimina fotografia">×</button>`);
      });
      card.insertAdjacentHTML('beforeend', reportEditor(report));
    });
  }

  function ensureNotificationPanel() {
    if (notificationPanel) return notificationPanel;
    const panel = document.createElement('div');
    panel.className = 'hc-notification-panel';
    panel.hidden = true;
    panel.innerHTML = `<section class="hc-notification-card" role="dialog" aria-modal="true" aria-labelledby="hcNotificationTitle"><div class="hc-notification-header"><div><h2 id="hcNotificationTitle">Notifiche</h2><small>Messaggi, report, pagamenti e occupazione della casa</small></div><button class="button light icon compact" type="button" data-hc-action="close-notifications" aria-label="Chiudi">×</button></div><div data-hc-notification-content><div class="empty-state">Caricamento…</div></div></section>`;
    panel.addEventListener('click', (event) => {
      if (event.target === panel) closeNotifications();
    });
    document.body.appendChild(panel);
    notificationPanel = panel;
    return panel;
  }

  function closeNotifications() {
    if (notificationPanel) notificationPanel.hidden = true;
    document.body.classList.remove('sheet-open');
  }

  async function renderNotifications(openPanel = false) {
    if (!user) return;
    const response = await request('/api/notifications');
    const topbar = document.querySelector('.app-topbar');
    if (topbar && !topbar.querySelector('[data-hc-action="open-notifications"]')) {
      const menuButton = topbar.querySelector('[data-action="open-sheet"]');
      const bell = document.createElement('button');
      bell.className = 'button ghost icon compact hc-notification-button';
      bell.type = 'button';
      bell.dataset.hcAction = 'open-notifications';
      bell.setAttribute('aria-label', 'Apri notifiche');
      bell.innerHTML = '♢<span class="hc-notification-count" hidden></span>';
      topbar.insertBefore(bell, menuButton || null);
    }
    const count = document.querySelector('.hc-notification-count');
    if (count) {
      count.textContent = response.unread > 99 ? '99+' : String(response.unread || 0);
      count.hidden = !response.unread;
    }
    if (!openPanel && (!notificationPanel || notificationPanel.hidden)) return;
    const panel = ensureNotificationPanel();
    const content = panel.querySelector('[data-hc-notification-content]');
    const rows = response.notifications || [];
    content.innerHTML = `<div class="hc-notification-list">${rows.length ? rows.map((item) => `<button class="hc-notification-item ${item.read_at ? '' : 'unread'}" type="button" data-hc-action="open-notification" data-id="${esc(item.id)}" data-tab="${esc(item.link_tab || '')}"><strong>${esc(item.title)}</strong><span>${esc(item.body)}</span><small>${dateTimeIT(item.created_at)}${item.email_status === 'failed' ? ' · Email non inviata' : ''}</small></button>`).join('') : '<div class="empty-state"><strong>Nessuna notifica</strong><span>Le novità importanti compariranno qui.</span></div>'}</div><div class="hc-notification-preferences"><button class="button light" type="button" data-hc-action="read-all-notifications">Segna tutte come lette</button><label class="hc-toggle-row"><span><strong>Notifiche via email</strong><small>${response.email_enabled ? 'Invio tramite Brevo attivo' : 'Brevo non è configurato'}</small></span><input type="checkbox" data-hc-email-preference ${response.email_notifications ? 'checked' : ''}></label>${user.role === 'admin' ? `<button class="button teal" type="button" data-hc-action="test-notification-email" ${response.email_enabled ? '' : 'disabled'}>Invia email di prova</button>` : ''}</div>`;
  }

  async function openNotifications() {
    const panel = ensureNotificationPanel();
    panel.hidden = false;
    document.body.classList.add('sheet-open');
    await renderNotifications(true);
  }

  async function enhance() {
    if (!user) return;
    try {
      await Promise.all([enhanceReports(), enhancePropertyDelete(), enhanceOccupancies(), renderNotifications(false)]);
    } catch (error) {
      if (error.status !== 401) console.warn('Migliorie operative non caricate:', error);
    }
  }

  function scheduleEnhance() {
    window.clearTimeout(enhancementTimer);
    enhancementTimer = window.setTimeout(enhance, 120);
  }

  async function handleAction(button) {
    const action = button.dataset.hcAction;
    if (!action) return;
    if (action === 'open-notifications') return openNotifications();
    if (action === 'close-notifications') return closeNotifications();
    if (action === 'read-all-notifications') {
      await request('/api/notifications/read-all', { method: 'POST', body: {} });
      return renderNotifications(true);
    }
    if (action === 'open-notification') {
      await request(`/api/notifications/${encodeURIComponent(button.dataset.id)}/read`, { method: 'PATCH', body: {} });
      closeNotifications();
      const tab = button.dataset.tab;
      if (tab) document.querySelector(`[data-action="set-tab"][data-tab="${CSS.escape(tab)}"]`)?.click();
      return renderNotifications(false);
    }
    if (action === 'test-notification-email') {
      button.disabled = true;
      try {
        await request('/api/admin/notifications/test-email', { method: 'POST', body: {} });
        toast('Email di prova inviata.', 'success');
      } finally { button.disabled = false; }
      return;
    }
    if (action === 'delete-occupancy') {
      if (!window.confirm('Eliminare questo periodo di occupazione?')) return;
      await request(`/api/${button.dataset.mode}/occupancies/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE', body: {} });
      toast('Periodo eliminato.', 'success');
      return refreshCurrentTab();
    }
    if (action === 'delete-property') {
      const name = button.dataset.name || '';
      if (!window.confirm(`Eliminare definitivamente l’immobile “${name}”? Verranno eliminati anche controlli, report e fotografie collegati.`)) return;
      const typed = window.prompt(`Scrivi esattamente il nome dell’immobile:\n${name}`);
      if (typed !== name) return toast('Nome di conferma non corretto.', 'danger');
      const confirmation = window.prompt('Scrivi ELIMINA per confermare.');
      if (confirmation !== 'ELIMINA') return toast('Eliminazione annullata.', 'danger');
      await request(`/api/admin/properties/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE', body: { confirm_name: typed, confirmation } });
      toast('Immobile eliminato definitivamente.', 'success');
      return refreshCurrentTab();
    }
    if (action === 'delete-report') {
      if (!window.confirm(`Eliminare definitivamente il report di ${button.dataset.name || 'questo immobile'} e tutte le fotografie collegate?`)) return;
      const confirmation = window.prompt('Scrivi ELIMINA REPORT per confermare.');
      if (confirmation !== 'ELIMINA REPORT') return toast('Eliminazione annullata.', 'danger');
      await request(`/api/admin/reports/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE', body: {} });
      toast('Report eliminato.', 'success');
      return refreshCurrentTab();
    }
    if (action === 'delete-report-photo') {
      if (!window.confirm('Eliminare questa fotografia dal report?')) return;
      await request(`/api/admin/photos/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE', body: {} });
      toast('Fotografia eliminata.', 'success');
      return refreshCurrentTab();
    }
  }

  async function handleForm(form) {
    const kind = form.dataset.hcForm;
    if (!kind) return;
    const buttons = form.querySelectorAll('button,input[type="submit"]');
    buttons.forEach((button) => { button.disabled = true; });
    try {
      if (kind === 'client-occupancy-create' || kind === 'admin-occupancy-create') {
        const mode = kind.startsWith('admin') ? 'admin' : 'client';
        await request(`/api/${mode}/occupancies`, { method: 'POST', body: formDataObject(form) });
        toast('Periodo di occupazione registrato.', 'success');
        return refreshCurrentTab();
      }
      if (kind === 'client-occupancy-edit' || kind === 'admin-occupancy-edit') {
        const mode = kind.startsWith('admin') ? 'admin' : 'client';
        await request(`/api/${mode}/occupancies/${encodeURIComponent(form.dataset.id)}`, { method: 'PATCH', body: formDataObject(form) });
        toast('Periodo aggiornato.', 'success');
        return refreshCurrentTab();
      }
      if (kind === 'edit-report') {
        const data = formDataObject(form);
        data.checklist_json = String(data.checklist_text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        delete data.checklist_text;
        await request(`/api/admin/reports/${encodeURIComponent(form.dataset.id)}`, { method: 'PATCH', body: data });
        toast('Report aggiornato.', 'success');
        return refreshCurrentTab();
      }
      if (kind === 'add-report-photos') {
        const multipart = new FormData(form);
        await request(`/api/admin/reports/${encodeURIComponent(form.dataset.id)}/photos`, { method: 'POST', body: multipart });
        toast('Fotografie aggiunte.', 'success');
        return refreshCurrentTab();
      }
    } finally {
      if (form.isConnected) buttons.forEach((button) => { button.disabled = false; });
    }
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-hc-action]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    Promise.resolve(handleAction(button)).catch((error) => toast(error.message || 'Operazione non riuscita.', 'danger'));
  }, true);

  document.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-hc-form]');
    if (!form) return;
    event.preventDefault();
    event.stopPropagation();
    handleForm(form).catch((error) => toast(error.message || 'Operazione non riuscita.', 'danger'));
  }, true);

  document.addEventListener('change', (event) => {
    if (!event.target.matches('[data-hc-email-preference]')) return;
    request('/api/notifications/preferences', { method: 'PATCH', body: { email_notifications: event.target.checked } })
      .then(() => toast('Preferenza email aggiornata.', 'success'))
      .catch((error) => toast(error.message || 'Preferenza non aggiornata.', 'danger'));
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && notificationPanel && !notificationPanel.hidden) closeNotifications();
  });

  async function boot() {
    try {
      config = await fetch('/api/config', { credentials: 'same-origin', cache: 'no-store' }).then((response) => response.json());
      const response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return;
      user = (await response.json()).user;
      const observer = new MutationObserver(scheduleEnhance);
      observer.observe(app || document.body, { childList: true, subtree: true });
      scheduleEnhance();
      notificationTimer = window.setInterval(() => renderNotifications(false).catch(() => {}), 45_000);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) renderNotifications(false).catch(() => {});
      });
    } catch (error) {
      console.warn('Operations V2 non inizializzato:', error);
    }
  }

  window.addEventListener('beforeunload', () => { if (notificationTimer) clearInterval(notificationTimer); });
  boot();
}());
