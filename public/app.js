(function () {
  'use strict';

  const app = document.getElementById('app');
  const toastRegion = document.getElementById('toastRegion');
  const state = {
    config: null,
    csrfToken: '',
    user: null,
    tab: null,
    clientData: null,
    customers: [],
    properties: [],
    sheetOpen: false,
  };

  const ICONS = {
    home: '⌂', properties: '⌂', reports: '▤', payments: '€', chat: '✉', contacts: '☎',
    dashboard: '▦', requests: '⌛', customers: '♙', checks: '✓', tasks: '☑', route: '➜',
    messages: '✉', custom_plans: '◇', plan_settings: '≡', helpers: '♟', more: '•••', install: '⇩',
  };

  const CUSTOM_SERVICE_CATALOG = [
    { id: 'controllo_extra', label: 'Controllo aggiuntivo mensile', price: 20 },
    { id: 'aerazione', label: 'Aerazione ambienti', price: 10 },
    { id: 'posta', label: 'Ritiro posta o piccole consegne', price: 15 },
    { id: 'contatori', label: 'Lettura contatori', price: 5 },
    { id: 'report_dettagliato', label: 'Report fotografico dettagliato', price: 10 },
    { id: 'priorita', label: 'Priorità nella pianificazione degli interventi', price: 20 },
    { id: 'esterni', label: 'Verifica aree esterne, cancelli e recinzioni', price: 15 },
    { id: 'irrigazione', label: 'Verifica irrigazione ove accessibile', price: 25 },
    { id: 'giardino', label: 'Cura ordinaria giardino', price: 80 },
    { id: 'preparazione_arrivo', label: 'Preparazione casa prima dell’arrivo', price: 35 },
  ];

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  function money(cents) {
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(cents || 0) / 100);
  }

  function dateIT(value) {
    if (!value) return '—';
    const raw = String(value);
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString('it-IT');
  }

  function dateTimeIT(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
  }

  function todayISO() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
  }

  function planById(id) {
    return state.config?.plans?.find((plan) => plan.id === id) || state.clientData?.plans?.find((plan) => plan.id === id) || null;
  }

  function planLabel(id) {
    return planById(id)?.label || (id ? String(id) : 'Non impostato');
  }

  function statusBadge(status, labels = {}) {
    const value = String(status || '');
    const className = ['paid', 'approved', 'active', 'done'].includes(value)
      ? 'success'
      : ['pending', 'todo', 'draft'].includes(value)
        ? 'warning'
        : ['unpaid', 'past_due', 'canceled', 'rejected', 'blocked', 'archived'].includes(value)
          ? 'danger'
          : '';
    return `<span class="badge ${className}">${esc(labels[value] || value || '—')}</span>`;
  }

  function paymentBadge(customer) {
    return customer?.payment_valid
      ? '<span class="badge success">Pagamento regolare</span>'
      : '<span class="badge danger">Pagamento da regolarizzare</span>';
  }

  function toast(message, kind = '') {
    if (!toastRegion) return;
    const node = document.createElement('div');
    node.className = `toast ${kind}`.trim();
    node.textContent = message;
    toastRegion.appendChild(node);
    window.setTimeout(() => node.remove(), 4200);
  }

  function setBusy(form, busy) {
    const buttons = form?.querySelectorAll('button, input[type="submit"]') || [];
    buttons.forEach((button) => { button.disabled = busy; });
    form?.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  async function api(url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    let body = options.body;
    if (body && !(body instanceof FormData) && typeof body !== 'string') {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(body);
    }
    if (!['GET', 'HEAD'].includes(method)) headers.set('X-CSRF-Token', state.csrfToken || state.config?.csrfToken || '');
    const response = await fetch(url, { ...options, method, headers, body, credentials: 'same-origin', cache: 'no-store' });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json() : await response.text();
    if (data?.csrfToken) {
      state.csrfToken = data.csrfToken;
      if (state.config) state.config.csrfToken = data.csrfToken;
    }
    if (!response.ok) {
      const error = new Error(data?.error || data || 'Operazione non riuscita');
      error.status = response.status;
      error.code = data?.code || 'REQUEST_ERROR';
      if (response.status === 401 && !url.startsWith('/api/auth/login')) {
        state.user = null;
        state.clientData = null;
      }
      throw error;
    }
    return data;
  }

  function formObject(form) {
    const data = {};
    new FormData(form).forEach((value, key) => {
      if (value instanceof File) return;
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        if (!Array.isArray(data[key])) data[key] = [data[key]];
        data[key].push(value);
      } else data[key] = value;
    });
    return data;
  }

  function pageHeader(title, subtitle, actions = '') {
    return `<header class="page-header"><div><span class="eyebrow">Home Care</span><h1>${esc(title)}</h1><p>${esc(subtitle || '')}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</header>`;
  }

  function emptyState(title, text) {
    return `<div class="empty-state"><strong>${esc(title)}</strong><span>${esc(text)}</span></div>`;
  }

  function optionList(rows, selected, label) {
    return rows.map((row) => `<option value="${esc(row.id)}" ${row.id === selected ? 'selected' : ''}>${esc(label(row))}</option>`).join('');
  }

  function renderLoading(label = 'Caricamento dati…') {
    const main = document.getElementById('main');
    if (main) main.innerHTML = `<div class="boot-screen compact-boot"><div class="spinner" aria-hidden="true"></div><p>${esc(label)}</p></div>`;
  }

  function publicHeader() {
    return `<header class="public-header"><button class="brand-lockup inverse brand-button" type="button" data-action="public-home"><span class="brand-mark">HC</span><span>Home Care</span></button><div class="public-header-actions"><button class="button light compact" type="button" data-action="show-auth" data-mode="login">Accedi</button>${state.config?.registrationEnabled ? '<button class="button gold compact" type="button" data-action="show-auth" data-mode="register">Registrati</button>' : ''}</div></header>`;
  }

  function planCards() {
    const plans = state.config?.plans || [];
    return `<div class="plan-grid">${plans.map((plan) => `<article class="card plan-card ${plan.id === 'comfort' ? 'featured' : ''}">${plan.id === 'comfort' ? '<span class="plan-ribbon">Più scelto</span>' : ''}<h3>${esc(plan.label)}</h3><div class="plan-price">${esc(plan.price_label || money(plan.price_cents))}</div><ul class="clean-list">${(plan.features || []).map((feature) => `<li>${esc(feature)}</li>`).join('')}</ul><button class="button ${plan.id === 'comfort' ? 'gold' : 'teal'} block" type="button" data-action="select-plan" data-plan="${esc(plan.id)}">Richiedi questo servizio</button></article>`).join('')}</div>`;
  }

  function renderPublicHome() {
    document.body.classList.remove('has-mobile-nav');
    const query = new URLSearchParams(window.location.search);
    const payment = query.get('payment');
    const extra = query.get('extra');
    let resultNotice = '';
    if (payment === 'success') resultNotice = '<div class="notice success"><strong>Pagamento completato.</strong> Lo stato verrà aggiornato automaticamente dopo la conferma di Stripe.</div>';
    if (payment === 'cancel') resultNotice = '<div class="notice warning">Pagamento annullato. Non è stato effettuato alcun addebito.</div>';
    if (extra === 'success') resultNotice = '<div class="notice success"><strong>Pagamento del preventivo completato.</strong> Riceverai la conferma nell’area personale.</div>';
    if (extra === 'cancel') resultNotice = '<div class="notice warning">Pagamento del preventivo annullato.</div>';
    app.innerHTML = `${publicHeader()}<main class="public-main">${resultNotice}<section class="hero"><div class="hero-copy"><span class="eyebrow">Badesi e località vicine</span><h1>La tua casa, <span>sempre sotto controllo.</span></h1><p>Controlli periodici, report fotografici, contatti diretti e pagamenti in un’unica app pensata prima di tutto per il telefono.</p><div class="hero-actions"><button class="button gold" type="button" data-action="scroll-plans">Scopri i servizi</button><button class="button primary" type="button" data-action="show-auth" data-mode="register" ${state.config?.registrationEnabled ? '' : 'hidden'}>Inizia ora</button><button class="button light install-button" type="button" data-install-app hidden><span aria-hidden="true">⇩</span> Installa app</button></div></div><aside class="card hero-panel"><h2>Come funziona</h2><div class="steps"><div class="step"><span class="step-number">1</span><div><strong>Scegli il servizio</strong><p>Trova il livello di assistenza più adatto all’immobile.</p></div></div><div class="step"><span class="step-number">2</span><div><strong>Inserisci la casa</strong><p>Invia indirizzo e richieste direttamente dall’area cliente.</p></div></div><div class="step"><span class="step-number">3</span><div><strong>Ricevi i report</strong><p>Consulta controlli, note e fotografie in modo riservato.</p></div></div></div></aside></section><section id="plans" class="public-section"><div class="section-heading"><h2>Servizi chiari, gestione semplice</h2><p>I prezzi e i servizi sono aggiornati direttamente da Home Care. Il piano personalizzato viene sempre confermato prima del pagamento.</p></div>${planCards()}</section><section class="public-section"><div class="trust-grid"><article class="card trust-card"><span class="trust-icon">✓</span><h3>Report riservati</h3><p>Le fotografie sono protette e visibili soltanto agli utenti autorizzati.</p></article><article class="card trust-card"><span class="trust-icon">⌖</span><h3>Giri ottimizzati</h3><p>Home Care organizza i controlli in base alle posizioni degli immobili.</p></article><article class="card trust-card"><span class="trust-icon">✉</span><h3>Contatto diretto</h3><p>Chat, recapiti e preventivi sono raccolti nella stessa area personale.</p></article></div></section></main>`;
  }

  function renderAuth(mode = 'login', selectedPlan = '') {
    document.body.classList.remove('has-mobile-nav');
    const registrationAvailable = Boolean(state.config?.registrationEnabled);
    if (mode === 'register' && !registrationAvailable) mode = 'login';
    const title = mode === 'login' ? 'Bentornato' : mode === 'register' ? 'Crea il tuo account' : mode === 'forgot' ? 'Recupera la password' : 'Conferma di nuovo la tua email';
    const subtitle = mode === 'login' ? 'Accedi alla tua area Home Care.' : mode === 'register' ? 'Inserisci i tuoi dati; confermerai l’email prima del primo accesso.' : mode === 'forgot' ? 'Riceverai un collegamento valido per 60 minuti.' : 'Ti invieremo un nuovo collegamento di conferma.';
    let form;
    if (mode === 'register') {
      form = `<form class="form-grid" data-form="register"><input type="hidden" name="selected_plan" value="${esc(selectedPlan)}"><div class="field"><label for="registerName">Nome e cognome</label><input id="registerName" name="name" autocomplete="name" required minlength="2" maxlength="120"></div><div class="field"><label for="registerEmail">Email</label><input id="registerEmail" name="email" type="email" autocomplete="email" required maxlength="254"></div><div class="field"><label for="registerPhone">Telefono</label><input id="registerPhone" name="phone" type="tel" autocomplete="tel" maxlength="40"></div><div class="field"><label for="registerPassword">Password</label><input id="registerPassword" name="password" type="password" autocomplete="new-password" required minlength="10"><small>Almeno 10 caratteri.</small></div><button class="button teal block" type="submit">Registrati</button></form>`;
    } else if (mode === 'forgot') {
      form = `<form class="form-grid" data-form="forgot-password"><div class="field"><label for="forgotEmail">Email</label><input id="forgotEmail" name="email" type="email" autocomplete="email" required></div><button class="button primary block" type="submit">Invia istruzioni</button></form>`;
    } else if (mode === 'resend') {
      form = `<form class="form-grid" data-form="resend-confirmation"><div class="field"><label for="resendEmail">Email</label><input id="resendEmail" name="email" type="email" autocomplete="email" required></div><button class="button primary block" type="submit">Invia nuovo link</button></form>`;
    } else {
      form = `<form class="form-grid" data-form="login"><div class="field"><label for="loginEmail">Email</label><input id="loginEmail" name="email" type="email" autocomplete="username" required></div><div class="field"><label for="loginPassword">Password</label><input id="loginPassword" name="password" type="password" autocomplete="current-password" required></div><button class="button primary block" type="submit">Accedi</button></form>`;
    }
    app.innerHTML = `${publicHeader()}<main class="auth-shell"><section class="auth-card"><div class="auth-copy"><div class="brand-lockup"><span class="brand-mark">HC</span><span>Home Care</span></div><span class="eyebrow">Area riservata</span><h1 class="auth-title">${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="auth-tabs"><button class="auth-tab ${mode === 'login' ? 'active' : ''}" type="button" data-action="show-auth" data-mode="login">Accedi</button>${registrationAvailable ? `<button class="auth-tab ${mode === 'register' ? 'active' : ''}" type="button" data-action="show-auth" data-mode="register">Registrati</button>` : ''}</div>${form}<div class="auth-links">${mode === 'login' ? '<button type="button" data-action="show-auth" data-mode="forgot">Password dimenticata?</button><button type="button" data-action="show-auth" data-mode="resend">Email non confermata?</button>' : '<button type="button" data-action="show-auth" data-mode="login">Torna all’accesso</button>'}</div><button class="button light block install-button" type="button" data-install-app hidden><span aria-hidden="true">⇩</span> Installa Home Care</button></section></main>`;
  }

  function renderResetPassword(code) {
    document.body.classList.remove('has-mobile-nav');
    app.innerHTML = `${publicHeader()}<main class="auth-shell"><section class="auth-card"><div class="auth-copy"><span class="eyebrow">Sicurezza</span><h1 class="auth-title">Scegli una nuova password</h1><p>Il collegamento può essere usato una sola volta.</p></div><form class="form-grid" data-form="reset-password"><input type="hidden" name="code" value="${esc(code)}"><div class="field"><label for="resetPassword">Nuova password</label><input id="resetPassword" name="password" type="password" autocomplete="new-password" required minlength="10"></div><div class="field"><label for="resetConfirm">Ripeti la password</label><input id="resetConfirm" name="confirm_password" type="password" autocomplete="new-password" required minlength="10"></div><button class="button primary block" type="submit">Aggiorna password</button></form></section></main>`;
  }

  function menuItems() {
    if (state.user?.role === 'client') {
      return [
        { id: 'home', label: 'Home' },
        { id: 'properties', label: 'Immobili' },
        { id: 'reports', label: 'Report' },
        { id: 'payments', label: 'Pagamenti' },
        { id: 'chat', label: 'Chat' },
        { id: 'contacts', label: 'Contatti' },
      ];
    }
    const items = [
      { id: 'dashboard', label: 'Dashboard' },
      ...(state.user?.role === 'admin' ? [{ id: 'requests', label: 'Richieste' }] : []),
      { id: 'customers', label: 'Clienti' },
      { id: 'properties', label: 'Immobili' },
      { id: 'checks', label: 'Controlli' },
      { id: 'reports', label: 'Report' },
      { id: 'tasks', label: 'Attività' },
      { id: 'route', label: 'Giro' },
    ];
    if (state.user?.role === 'admin') {
      items.push(
        { id: 'payments', label: 'Pagamenti' },
        { id: 'messages', label: 'Messaggi' },
        { id: 'contacts', label: 'Contatti' },
        { id: 'custom_plans', label: 'Piani cliente' },
        { id: 'plan_settings', label: 'Piani / Listino' },
        { id: 'helpers', label: 'Aiutanti' }
      );
    }
    return items;
  }

  function navButton(item, extraClass = '') {
    return `<button class="nav-button ${state.tab === item.id ? 'active' : ''} ${extraClass}" type="button" data-action="set-tab" data-tab="${esc(item.id)}"><span class="nav-icon" aria-hidden="true">${esc(ICONS[item.id] || '•')}</span><span class="nav-label">${esc(item.label)}</span></button>`;
  }

  function renderShell() {
    document.body.classList.add('has-mobile-nav');
    const items = menuItems();
    const primaryCount = state.user?.role === 'client' ? 4 : 4;
    const primary = items.slice(0, primaryCount);
    const secondary = items.slice(primaryCount);
    app.innerHTML = `<header class="app-topbar"><div class="topbar-left"><button class="brand-lockup inverse brand-button" type="button" data-action="set-tab" data-tab="${state.user.role === 'client' ? 'home' : 'dashboard'}"><span class="brand-mark">HC</span><span>Home Care</span></button></div><div class="topbar-user"><strong>${esc(state.user.name)}</strong><small>${state.user.role === 'admin' ? 'Amministratore' : state.user.role === 'helper' ? 'Aiutante' : 'Cliente'}</small></div><button class="button ghost compact install-button" type="button" data-install-app hidden aria-label="Installa Home Care"><span aria-hidden="true">⇩</span><span class="desktop-copy">Installa</span></button><button class="button ghost icon compact" type="button" data-action="open-sheet" aria-label="Apri menu">•••</button></header><div class="app-layout"><aside class="desktop-sidebar" aria-label="Navigazione principale">${items.map((item) => navButton(item)).join('')}<div class="sidebar-spacer"></div><button class="nav-button" type="button" data-install-app hidden><span class="nav-icon" aria-hidden="true">⇩</span><span class="nav-label">Installa app</span></button><button class="nav-button danger-nav" type="button" data-action="logout"><span class="nav-icon" aria-hidden="true">↪</span><span class="nav-label">Esci</span></button></aside><main id="main" class="app-main" tabindex="-1"></main></div><nav class="mobile-nav" aria-label="Navigazione mobile">${primary.map((item) => navButton(item)).join('')}<button class="nav-button" type="button" data-action="open-sheet"><span class="nav-icon" aria-hidden="true">${ICONS.more}</span><span class="nav-label">Altro</span></button></nav><div class="sheet-backdrop" data-action="close-sheet" hidden></div><aside class="action-sheet" aria-label="Altre sezioni" aria-hidden="true"><div class="sheet-handle" aria-hidden="true"></div><header class="sheet-header"><div><strong>Menu</strong><small>${esc(state.user.email || '')}</small></div><button class="button light icon compact" type="button" data-action="close-sheet" aria-label="Chiudi">×</button></header><div class="sheet-menu">${secondary.map((item) => navButton(item)).join('')}<button class="nav-button" type="button" data-install-app hidden><span class="nav-icon" aria-hidden="true">⇩</span><span class="nav-label">Installa app</span></button><button class="nav-button danger-nav" type="button" data-action="logout"><span class="nav-icon" aria-hidden="true">↪</span><span class="nav-label">Esci</span></button></div></aside>`;
    renderCurrentTab();
  }

  function openSheet() {
    const backdrop = document.querySelector('.sheet-backdrop');
    const sheet = document.querySelector('.action-sheet');
    if (!backdrop || !sheet) return;
    backdrop.hidden = false;
    sheet.setAttribute('aria-hidden', 'false');
    document.body.classList.add('sheet-open');
    window.requestAnimationFrame(() => {
      backdrop.classList.add('open');
      sheet.classList.add('open');
    });
    state.sheetOpen = true;
  }

  function closeSheet() {
    const backdrop = document.querySelector('.sheet-backdrop');
    const sheet = document.querySelector('.action-sheet');
    if (!backdrop || !sheet) return;
    backdrop.classList.remove('open');
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('sheet-open');
    window.setTimeout(() => { backdrop.hidden = true; }, 200);
    state.sheetOpen = false;
  }

  async function setTab(tab, options = {}) {
    if (!menuItems().some((item) => item.id === tab)) tab = state.user?.role === 'client' ? 'home' : 'dashboard';
    state.tab = tab;
    if (!options.skipHistory) {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      ['reset', 'payment', 'extra'].forEach((key) => url.searchParams.delete(key));
      history.replaceState({}, '', url);
    }
    closeSheet();
    document.querySelectorAll('[data-action="set-tab"]').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
    await renderCurrentTab();
  }

  async function loadClientData(force = false) {
    if (!state.clientData || force) state.clientData = await api('/api/client/dashboard');
    return state.clientData;
  }

  async function loadAdminBase(force = false) {
    if ((!state.customers.length && !state.properties.length) || force) {
      const [customers, properties] = await Promise.all([api('/api/admin/customers'), api('/api/admin/properties')]);
      state.customers = customers.customers || [];
      state.properties = properties.properties || [];
    }
  }

  async function renderCurrentTab() {
    const main = document.getElementById('main');
    if (!main || !state.user) return;
    renderLoading();
    try {
      if (state.user.role === 'client') {
        const routes = { home: clientHome, properties: clientProperties, reports: clientReports, payments: clientPayments, chat: clientChat, contacts: clientContacts };
        await (routes[state.tab] || clientHome)();
      } else {
        await loadAdminBase();
        const routes = {
          dashboard: adminDashboard, requests: adminRequests, customers: adminCustomers, properties: adminProperties,
          checks: adminChecks, reports: adminReports, tasks: adminTasks, route: adminRoute, payments: adminPayments,
          messages: adminMessages, contacts: adminContacts, custom_plans: adminCustomPlans,
          plan_settings: adminPlanSettings, helpers: adminHelpers,
        };
        await (routes[state.tab] || adminDashboard)();
      }
      document.getElementById('main')?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'auto' });
    } catch (error) {
      if (error.status === 401) {
        toast('La sessione è scaduta. Accedi di nuovo.', 'danger');
        renderAuth('login');
        return;
      }
      main.innerHTML = `${pageHeader('Si è verificato un problema', 'Non è stato possibile caricare questa sezione.')}<div class="notice danger"><strong>${esc(error.message)}</strong><p>Controlla la connessione e riprova.</p></div><button class="button primary" type="button" data-action="retry-tab">Riprova</button>`;
    }
  }

  function reportCard(report) {
    const checklist = Array.isArray(report.checklist_json) ? report.checklist_json : [];
    const photos = Array.isArray(report.photos) ? report.photos : [];
    return `<article class="card report-card"><div class="report-head"><div><h3 class="card-title">${esc(report.property_name)}</h3><span class="badge gold">${esc(planLabel(report.package_type))}</span></div><time class="report-date">${esc(dateTimeIT(report.completed_at))}</time></div>${report.notes ? `<p class="report-notes">${esc(report.notes)}</p>` : ''}${checklist.length ? `<ul class="clean-list">${checklist.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}${photos.length ? `<div class="photo-grid">${photos.map((photo) => `<a class="photo-link" href="${esc(photo.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(photo.url)}" alt="Foto del controllo di ${esc(report.property_name)}" loading="lazy"></a>`).join('')}</div>` : ''}</article>`;
  }

  function approvedClientPlanIds(data) {
    const ids = new Set((data.properties || []).filter((property) => property.active && property.request_status === 'approved').map((property) => property.package_type));
    if (data.customPlan?.status === 'active') ids.add('personalizzato');
    return Array.from(ids);
  }

  function clientPlanPayment(data) {
    const allowed = approvedClientPlanIds(data);
    if (!allowed.length) return `<section class="card plan-payment"><div class="card-header"><div><h2 class="card-title">Pagamento del piano</h2><p class="card-subtitle">Disponibile dopo l’approvazione di un immobile.</p></div></div>${emptyState('Nessun piano pagabile', 'Home Care deve prima approvare almeno una richiesta immobiliare.')}</section>`;
    const current = allowed.includes(data.customer.current_package_type) ? data.customer.current_package_type : allowed[0];
    const options = allowed.map((id) => `<option value="${esc(id)}" ${id === current ? 'selected' : ''}>${esc(planLabel(id))}</option>`).join('');
    const custom = current === 'personalizzato' && data.customPlan ? `<div class="notice success"><strong>${esc(data.customPlan.title)}</strong><p>Prezzo mensile confermato: <strong>${money(data.customPlan.final_price_cents)}</strong></p></div>` : '';
    return `<section class="card plan-payment"><div class="card-header"><div><h2 class="card-title">${data.customer.payment_valid ? 'Gestisci il piano' : 'Riattiva il servizio'}</h2><p class="card-subtitle">L’importo viene calcolato esclusivamente dal prezzo approvato da Home Care.</p></div>${paymentBadge(data.customer)}</div>${custom}<div class="field"><label for="clientPaymentPlan">Piano da pagare</label><select id="clientPaymentPlan" data-payment-plan>${options}</select></div><div class="payment-buttons"><button class="button gold" type="button" data-action="pay-plan" data-billing="monthly" ${state.config.stripeEnabled ? '' : 'disabled'}>Paga mensile</button><button class="button teal" type="button" data-action="pay-plan" data-billing="annual" ${state.config.stripeEnabled ? '' : 'disabled'}>Paga annuale</button></div>${state.config.stripeEnabled ? '' : '<p class="help">I pagamenti online non sono ancora configurati. Contatta Home Care per un pagamento manuale.</p>'}</section>`;
  }

  async function clientHome() {
    const data = await loadClientData(true);
    const activeProperties = data.properties.filter((property) => property.active && property.request_status === 'approved');
    const upcoming = data.customer.payment_valid ? activeProperties.slice(0, 4) : [];
    const pendingPayments = data.payments.filter((payment) => payment.status === 'pending');
    document.getElementById('main').innerHTML = `${pageHeader(`Ciao ${state.user.name.split(' ')[0]}`, 'Da qui controlli casa, report, messaggi e pagamenti.')}<section class="stat-grid"><article class="stat-card"><span class="stat-label">Stato servizio</span><strong class="stat-value small-value">${data.customer.payment_valid ? 'Attivo' : 'Sospeso'}</strong>${paymentBadge(data.customer)}</article><article class="stat-card"><span class="stat-label">Piano</span><strong class="stat-value small-value">${esc(planLabel(data.customer.current_package_type))}</strong><span class="help">${data.customer.paid_until ? `Pagato fino al ${dateIT(data.customer.paid_until)}` : data.customer.payment_valid ? 'Abbonamento attivo' : 'Da attivare'}</span></article><article class="stat-card"><span class="stat-label">Immobili</span><strong class="stat-value">${data.properties.length}</strong><span class="help">${activeProperties.length} attivi</span></article><article class="stat-card"><span class="stat-label">Preventivi</span><strong class="stat-value">${pendingPayments.length}</strong><span class="help">da pagare</span></article></section><section class="quick-grid"><button class="quick-action" type="button" data-action="set-tab" data-tab="properties"><span aria-hidden="true">⌂</span><strong>Aggiungi immobile</strong><small>Invia una nuova richiesta</small></button><button class="quick-action" type="button" data-action="set-tab" data-tab="chat"><span aria-hidden="true">✉</span><strong>Scrivi a Home Care</strong><small>Apri la chat riservata</small></button><button class="quick-action" type="button" data-action="set-tab" data-tab="reports"><span aria-hidden="true">▤</span><strong>Vedi i report</strong><small>Note e foto dei controlli</small></button></section>${clientPlanPayment(data)}<section class="card"><div class="card-header"><div><h2 class="card-title">Prossimi controlli</h2><p class="card-subtitle">Le date sono visibili quando il servizio è regolare.</p></div></div>${data.customer.payment_valid ? (upcoming.length ? `<div class="data-list">${upcoming.map((property) => `<article class="data-card"><div class="data-card-head"><div class="data-card-title"><strong>${esc(property.name)}</strong><small>${esc(property.address || '')}</small></div><span class="badge gold">${esc(dateIT(property.next_check_date))}</span></div></article>`).join('')}</div>` : emptyState('Nessun controllo pianificato', 'Non ci sono immobili attivi con una scadenza disponibile.')) : '<div class="notice danger">I controlli sono sospesi finché il pagamento non viene riattivato.</div>'}</section><section class="section-stack"><div class="card-header"><div><h2 class="card-title">Ultimi report</h2><p class="card-subtitle">Le attività più recenti sui tuoi immobili.</p></div><button class="button light compact" type="button" data-action="set-tab" data-tab="reports">Tutti</button></div>${data.reports.length ? data.reports.slice(0, 3).map(reportCard).join('') : emptyState('Ancora nessun report', 'Qui compariranno i controlli completati da Home Care.')}</section>`;
  }

  async function clientProperties() {
    const data = await loadClientData(true);
    const selected = localStorage.getItem('hc_selected_plan') || 'base';
    const planOptions = (data.plans || state.config.plans).map((plan) => `<option value="${esc(plan.id)}" ${plan.id === selected ? 'selected' : ''}>${esc(plan.label)} · ${esc(plan.price_label)}</option>`).join('');
    document.getElementById('main').innerHTML = `${pageHeader('I tuoi immobili', 'Invia una richiesta e segui lo stato di approvazione.')}<section class="card"><div class="card-header"><div><h2 class="card-title">Nuova richiesta</h2><p class="card-subtitle">Il prezzo definitivo, soprattutto per il piano personalizzato, viene confermato da Home Care.</p></div></div><form class="form-grid two" data-form="client-property"><div class="field"><label for="clientPropertyName">Nome immobile</label><input id="clientPropertyName" name="name" required maxlength="160" placeholder="Casa al mare"></div><div class="field"><label for="clientPropertyType">Tipo immobile</label><select id="clientPropertyType" name="property_type"><option>Appartamento</option><option>Villetta</option><option>Villa con giardino</option><option>Altro</option></select></div><div class="field span-all"><label for="clientPropertyAddress">Indirizzo completo</label><input id="clientPropertyAddress" name="address" required maxlength="300" autocomplete="street-address"></div><div class="field"><label for="clientPropertyCity">Comune</label><input id="clientPropertyCity" name="city" value="Badesi" required maxlength="120"></div><div class="field"><label for="clientPropertyZone">Zona / località</label><input id="clientPropertyZone" name="zone" maxlength="120"></div><div class="field span-all"><label for="clientPropertyPlan">Servizio richiesto</label><select id="clientPropertyPlan" name="package_type">${planOptions}</select></div><div class="field span-all"><label for="clientPropertyNotes">Note e richieste</label><textarea id="clientPropertyNotes" name="notes" maxlength="4000" placeholder="Accessi, esigenze particolari, servizi desiderati…"></textarea></div><div class="form-actions span-all"><button class="button teal" type="submit">Invia richiesta</button></div></form></section><section class="card"><div class="card-header"><div><h2 class="card-title">Elenco immobili</h2><p class="card-subtitle">Stato, piano e prossima visita.</p></div></div>${data.properties.length ? `<div class="data-list desktop-grid">${data.properties.map((property) => `<article class="data-card"><div class="data-card-head"><div class="data-card-title"><strong>${esc(property.name)}</strong><small>${esc(property.address)}, ${esc(property.city)}</small></div>${statusBadge(property.request_status, { pending: 'In verifica', approved: 'Approvato', rejected: 'Non approvato' })}</div><div class="data-meta"><div class="meta-row"><span>Piano</span><span>${esc(planLabel(property.package_type))}</span></div><div class="meta-row"><span>Prezzo</span><span>${money(property.monthly_price_cents)}/mese</span></div><div class="meta-row"><span>Prossimo controllo</span><span>${property.active ? dateIT(property.next_check_date) : 'Dopo approvazione'}</span></div>${property.client_notes ? `<div class="meta-row"><span>Note</span><span>${esc(property.client_notes)}</span></div>` : ''}</div></article>`).join('')}</div>` : emptyState('Nessun immobile', 'Usa il modulo sopra per inviare la prima richiesta.')}</section>`;
  }

  async function clientReports() {
    const data = await loadClientData(true);
    document.getElementById('main').innerHTML = `${pageHeader('Report dei controlli', 'Note, checklist e fotografie protette dei tuoi immobili.')}<section class="section-stack">${data.reports.length ? data.reports.map(reportCard).join('') : emptyState('Nessun report disponibile', 'I report compariranno dopo il primo controllo completato.')}</section>`;
  }

  function paymentCard(payment) {
    return `<article class="data-card"><div class="data-card-head"><div class="data-card-title"><strong>${esc(payment.description)}</strong><small>Creato il ${esc(dateIT(payment.created_at))}</small></div><strong>${money(payment.amount_cents)}</strong></div><div class="data-actions">${statusBadge(payment.status, { pending: 'Da pagare', paid: 'Pagato', canceled: 'Annullato' })}${payment.status === 'pending' && state.config.stripeEnabled ? `<button class="button gold compact" type="button" data-action="pay-extra" data-id="${esc(payment.id)}">Paga ora</button>` : ''}</div></article>`;
  }

  async function clientPayments() {
    const data = await loadClientData(true);
    document.getElementById('main').innerHTML = `${pageHeader('Pagamenti e preventivi', 'Gestisci il piano e i servizi extra in modo sicuro.')} ${clientPlanPayment(data)}<section class="card"><div class="card-header"><div><h2 class="card-title">Preventivi e servizi extra</h2><p class="card-subtitle">Gli importi provengono direttamente da Home Care.</p></div></div>${data.payments.length ? `<div class="data-list">${data.payments.map(paymentCard).join('')}</div>` : emptyState('Nessun preventivo', 'Non ci sono servizi extra o pagamenti una tantum.')}</section>`;
  }

  async function clientChat() {
    const response = await api('/api/client/messages');
    const messages = response.messages || [];
    document.getElementById('main').innerHTML = `${pageHeader('Chat Home Care', 'Scrivi direttamente al referente che segue i tuoi immobili.')}<section class="card"><div class="chat-window" data-chat-window>${messages.length ? messages.map((message) => `<article class="chat-message ${message.sender_role === 'client' ? 'mine' : ''}"><strong>${message.sender_role === 'client' ? 'Tu' : 'Home Care'}</strong><p>${esc(message.body)}</p><time>${esc(dateTimeIT(message.created_at))}</time></article>`).join('') : emptyState('Nessun messaggio', 'Scrivi il primo messaggio a Home Care.')}</div><form class="chat-form" data-form="client-message"><label class="sr-only" for="clientMessageBody">Messaggio</label><textarea id="clientMessageBody" name="body" required maxlength="3000" placeholder="Scrivi un messaggio…"></textarea><button class="button primary" type="submit">Invia</button></form></section>`;
    const windowNode = document.querySelector('[data-chat-window]');
    if (windowNode) windowNode.scrollTop = windowNode.scrollHeight;
  }

  function contactHref(contact) {
    const value = String(contact.value || '').trim();
    if (contact.kind === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? `mailto:${value}` : null;
    if (contact.kind === 'telefono') return `tel:${value.replace(/[^+\d]/g, '')}`;
    if (contact.kind === 'whatsapp') return `https://wa.me/${value.replace(/\D/g, '')}`;
    if (contact.kind === 'sito') {
      try {
        const url = new URL(value.startsWith('http') ? value : `https://${value}`);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
      } catch (_) { return null; }
    }
    return null;
  }

  async function clientContacts() {
    const response = await api('/api/client/contacts');
    const contacts = response.contacts || [];
    document.getElementById('main').innerHTML = `${pageHeader('Contatti Home Care', 'Recapiti ufficiali e canali disponibili.')}<section class="data-list desktop-grid">${contacts.length ? contacts.map((contact) => { const href = contactHref(contact); return `<article class="card trust-card"><span class="trust-icon">${esc(contact.kind === 'telefono' ? '☎' : contact.kind === 'whatsapp' ? '◉' : contact.kind === 'email' ? '✉' : '↗')}</span><h3>${esc(contact.label)}</h3>${href ? `<a class="contact-value" href="${esc(href)}" ${contact.kind === 'sito' || contact.kind === 'whatsapp' ? 'target="_blank" rel="noopener noreferrer"' : ''}>${esc(contact.value)}</a>` : `<strong class="contact-value">${esc(contact.value)}</strong>`}${contact.note ? `<p>${esc(contact.note)}</p>` : ''}</article>`; }).join('') : emptyState('Nessun contatto disponibile', 'Home Care non ha ancora pubblicato recapiti.')}</section>`;
  }

  function customerOptions(selected = '') {
    return `<option value="">Seleziona cliente</option>${optionList(state.customers, selected, (customer) => `${customer.name}${customer.email ? ` · ${customer.email}` : ''}`)}`;
  }

  function propertyOptions(customerId = '', selected = '') {
    const rows = state.properties.filter((property) => !customerId || property.customer_id === customerId);
    return `<option value="">Nessun immobile specifico</option>${optionList(rows, selected, (property) => `${property.customer_name || ''} · ${property.name}`)}`;
  }

  function activePlanOptions(selected = '') {
    return (state.config?.plans || []).map((plan) => `<option value="${esc(plan.id)}" ${plan.id === selected ? 'selected' : ''}>${esc(plan.label)} · ${esc(plan.price_label)}</option>`).join('');
  }

  async function adminDashboard() {
    const summary = await api('/api/admin/summary');
    const main = document.getElementById('main');
    main.innerHTML = `${pageHeader('Dashboard operativa', 'Le priorità di oggi in un colpo d’occhio.', '<button class="button light install-button" type="button" data-install-app hidden><span aria-hidden="true">⇩</span> Installa app</button>')}<section class="stat-grid"><article class="stat-card"><span class="stat-label">Clienti</span><strong class="stat-value">${summary.customers}</strong></article><article class="stat-card"><span class="stat-label">Immobili attivi</span><strong class="stat-value">${summary.properties}</strong></article><article class="stat-card"><span class="stat-label">Controlli da fare</span><strong class="stat-value">${summary.dueChecks}</strong><button class="button light compact" type="button" data-action="set-tab" data-tab="checks">Apri</button></article><article class="stat-card"><span class="stat-label">Sospesi pagamento</span><strong class="stat-value">${summary.blockedChecks}</strong></article><article class="stat-card"><span class="stat-label">Attività scadute</span><strong class="stat-value">${summary.todoTasks}</strong><button class="button light compact" type="button" data-action="set-tab" data-tab="tasks">Apri</button></article>${state.user.role === 'admin' ? `<article class="stat-card"><span class="stat-label">Richieste immobili</span><strong class="stat-value">${summary.pendingProperties}</strong><button class="button gold compact" type="button" data-action="set-tab" data-tab="requests">Verifica</button></article>` : ''}</section><section class="quick-grid"><button class="quick-action" type="button" data-action="set-tab" data-tab="checks"><span aria-hidden="true">✓</span><strong>Completa un controllo</strong><small>Checklist, note e fotografie</small></button><button class="quick-action" type="button" data-action="set-tab" data-tab="route"><span aria-hidden="true">➜</span><strong>Organizza il giro</strong><small>Ordina le visite dal GPS</small></button><button class="quick-action" type="button" data-action="set-tab" data-tab="reports"><span aria-hidden="true">▤</span><strong>Consulta i report</strong><small>Ultime attività completate</small></button></section><section class="card"><div class="card-header"><div><h2 class="card-title">Stato del sistema</h2><p class="card-subtitle">Versione ${esc(state.config.version)}</p></div><span class="badge success">Database collegato</span></div><p class="help">Pagamenti Stripe: ${state.config.stripeEnabled ? 'attivi' : 'non configurati'} · Email: ${state.config.emailEnabled ? 'attive' : 'modalità di sviluppo'}.</p></section>`;
  }

  function requestCard(property) {
    const suggestedPrice = Number(property.monthly_price_cents || planById(property.package_type)?.price_cents || 0) / 100;
    return `<article class="card"><div class="card-header"><div><h2 class="card-title">${esc(property.name)}</h2><p class="card-subtitle">${esc(property.customer_name)} · ${esc(property.address)}, ${esc(property.city)}</p></div><span class="badge warning">In verifica</span></div><div class="data-meta"><div class="meta-row"><span>Contatto</span><span>${esc(property.customer_phone || property.customer_email || '—')}</span></div><div class="meta-row"><span>Richiesta</span><span>${esc(planLabel(property.package_type))}</span></div><div class="meta-row"><span>Tipo</span><span>${esc(property.property_type || '—')}</span></div></div>${property.client_notes ? `<div class="notice"><strong>Note del cliente</strong><p class="prewrap">${esc(property.client_notes)}</p></div>` : ''}<form class="form-grid two" data-form="approve-property"><input type="hidden" name="property_id" value="${esc(property.id)}"><div class="field"><label>Piano approvato</label><select name="package_type" required>${activePlanOptions(property.package_type)}</select></div><div class="field"><label>Prezzo mensile definitivo</label><input name="monthly_price_euro" type="number" min="0.01" step="0.01" value="${esc(suggestedPrice.toFixed(2))}" required></div><div class="form-actions span-all"><button class="button success" type="submit">Approva richiesta</button></div></form><form class="form-grid" data-form="reject-property"><input type="hidden" name="property_id" value="${esc(property.id)}"><div class="field"><label>Motivo del rifiuto</label><input name="reason" maxlength="1000" value="Richiesta non compatibile con il servizio disponibile" required></div><button class="button danger" type="submit">Non approvare</button></form></article>`;
  }

  async function adminRequests() {
    if (state.user.role !== 'admin') return setTab('dashboard');
    const response = await api('/api/admin/property-requests');
    const requests = response.requests || [];
    document.getElementById('main').innerHTML = `${pageHeader('Richieste immobili', 'Verifica dati, piano e prezzo prima dell’attivazione.')}<section class="section-stack">${requests.length ? requests.map(requestCard).join('') : emptyState('Nessuna richiesta in attesa', 'Le nuove richieste dei clienti compariranno qui.')}</section>`;
  }

  function customerCard(customer) {
    const admin = state.user.role === 'admin';
    return `<article class="data-card"><div class="data-card-head"><div class="data-card-title"><strong>${esc(customer.name)}</strong><small>${esc(customer.email || '')}${customer.phone ? ` · ${esc(customer.phone)}` : ''}</small></div>${admin && customer.payment_valid !== undefined ? (customer.payment_valid ? '<span class="badge success">Regolare</span>' : '<span class="badge danger">Sospeso</span>') : '<span class="badge">Operativo</span>'}</div><div class="data-meta"><div class="meta-row"><span>Piano</span><span>${esc(planLabel(customer.current_package_type))}</span></div><div class="meta-row"><span>Immobili</span><span>${Number(customer.properties_count || 0)}</span></div>${admin ? `<div class="meta-row"><span>Pagato fino al</span><span>${dateIT(customer.paid_until)}</span></div>` : ''}${customer.notes ? `<div class="meta-row"><span>Note</span><span>${esc(customer.notes)}</span></div>` : ''}</div>${admin ? `<div class="data-actions"><button class="button danger compact" type="button" data-action="delete-customer" data-id="${esc(customer.id)}" data-name="${esc(customer.name)}">Elimina</button></div>` : ''}</article>`;
  }

  async function adminCustomers() {
    await loadAdminBase(true);
    const admin = state.user.role === 'admin';
    const forms = admin ? `<section class="split-grid"><article class="card"><div class="card-header"><div><h2 class="card-title">Nuovo cliente</h2><p class="card-subtitle">Inserimento manuale senza account cliente.</p></div></div><form class="form-grid" data-form="admin-customer"><div class="field"><label>Nome</label><input name="name" required maxlength="120"></div><div class="form-grid two"><div class="field"><label>Email</label><input name="email" type="email" maxlength="254"></div><div class="field"><label>Telefono</label><input name="phone" type="tel" maxlength="40"></div></div><div class="field"><label>Piano iniziale</label><select name="current_package_type"><option value="">Nessuno</option>${activePlanOptions()}</select></div><div class="field"><label>Note</label><textarea name="notes" maxlength="3000"></textarea></div><button class="button primary" type="submit">Salva cliente</button></form></article><article class="card"><div class="card-header"><div><h2 class="card-title">Pagamento manuale</h2><p class="card-subtitle">Registra contanti, bonifico o altro metodo.</p></div></div><form class="form-grid" data-form="manual-payment"><div class="field"><label>Cliente</label><select name="customer_id" required>${customerOptions()}</select></div><div class="field"><label>Piano pagato</label><select name="package_type" required>${activePlanOptions('base')}</select></div><div class="form-grid two"><div class="field"><label>Importo in euro</label><input name="amount_euro" type="number" min="0.01" step="0.01"></div><div class="field"><label>Pagato fino al</label><input name="paid_until" type="date" min="${todayISO()}" required></div></div><div class="field"><label>Metodo</label><select name="method"><option value="contanti">Contanti</option><option value="bonifico">Bonifico</option><option value="assegno">Assegno</option><option value="carta">Carta</option><option value="altro">Altro</option></select></div><div class="field"><label>Descrizione</label><input name="description" value="Pagamento piano Home Care" maxlength="500"></div><button class="button success" type="submit">Registra pagamento</button></form></article></section>` : '';
    document.getElementById('main').innerHTML = `${pageHeader('Clienti', admin ? 'Anagrafiche, piani e stato dei pagamenti.' : 'Recapiti operativi, senza informazioni economiche.')} ${forms}<section class="card"><div class="card-header"><div><h2 class="card-title">Elenco clienti</h2><p class="card-subtitle">${state.customers.length} anagrafiche</p></div></div>${state.customers.length ? `<div class="data-list desktop-grid">${state.customers.map(customerCard).join('')}</div>` : emptyState('Nessun cliente', 'Aggiungi la prima anagrafica.')}</section>`;
  }

  function mapLink(property) {
    const lat = Number(property.latitude);
    const lng = Number(property.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
    return `<a class="button light compact" href="https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}" target="_blank" rel="noopener noreferrer">Apri Maps</a>`;
  }

  function propertyCard(property) {
    const admin = state.user.role === 'admin';
    return `<article class="data-card"><div class="data-card-head"><div class="data-card-title"><strong>${esc(property.name)}</strong><small>${esc(property.customer_name)} · ${esc(property.address || '')}</small></div>${statusBadge(property.request_status, { pending: 'Da approvare', approved: 'Attivo', rejected: 'Rifiutato' })}</div><div class="data-meta"><div class="meta-row"><span>Piano</span><span>${esc(planLabel(property.package_type))}</span></div>${admin ? `<div class="meta-row"><span>Prezzo</span><span>${money(property.monthly_price_cents)}/mese</span></div><div class="meta-row"><span>Pagamento</span><span>${property.payment_valid ? 'Regolare' : 'Non regolare'}</span></div>` : ''}<div class="meta-row"><span>Prossimo controllo</span><span>${dateIT(property.next_check_date)}</span></div><div class="meta-row"><span>GPS</span><span>${property.latitude && property.longitude ? `${esc(property.latitude)}, ${esc(property.longitude)}` : 'Non salvato'}</span></div></div><div class="data-actions">${mapLink(property)}<button class="button teal compact" type="button" data-action="save-gps" data-id="${esc(property.id)}">Salva GPS attuale</button></div></article>`;
  }

  async function adminProperties() {
    await loadAdminBase(true);
    const admin = state.user.role === 'admin';
    const createForm = admin ? `<section class="card"><div class="card-header"><div><h2 class="card-title">Aggiungi immobile</h2><p class="card-subtitle">Inserimento diretto già approvato.</p></div></div><form class="form-grid three" data-form="admin-property"><div class="field"><label>Cliente</label><select name="customer_id" required>${customerOptions()}</select></div><div class="field"><label>Nome immobile</label><input name="name" required maxlength="160"></div><div class="field"><label>Piano</label><select name="package_type" required>${activePlanOptions('base')}</select></div><div class="field span-all"><label>Indirizzo</label><input name="address" maxlength="300"></div><div class="field"><label>Comune</label><input name="city" value="Badesi" required maxlength="120"></div><div class="field"><label>Zona</label><input name="zone" maxlength="120"></div><div class="field"><label>Prezzo mensile</label><input name="monthly_price_euro" type="number" min="0.01" step="0.01" placeholder="Usa prezzo del listino"></div><div class="field span-all"><label>Note</label><textarea name="notes" maxlength="3000"></textarea></div><button class="button primary" type="submit">Aggiungi immobile</button></form></section>` : '';
    document.getElementById('main').innerHTML = `${pageHeader('Immobili e GPS', 'Posizioni, piani, scadenze e stato operativo.')} ${createForm}<section class="card"><div class="card-header"><div><h2 class="card-title">Tutti gli immobili</h2><p class="card-subtitle">${state.properties.length} elementi</p></div></div>${state.properties.length ? `<div class="data-list desktop-grid">${state.properties.map(propertyCard).join('')}</div>` : emptyState('Nessun immobile', 'Non sono presenti immobili nel gestionale.')}</section>`;
  }

  async function adminChecks() {
    const response = await api('/api/admin/due-checks');
    const checks = response.checks || [];
    document.getElementById('main').innerHTML = `${pageHeader('Controlli da fare', 'Completa checklist, note e foto direttamente dal telefono.')}<div id="checkCompletionPanel"></div><section class="card"><div class="card-header"><div><h2 class="card-title">Scadenze</h2><p class="card-subtitle">${checks.length} controlli da gestire</p></div></div>${checks.length ? `<div class="data-list desktop-grid">${checks.map((property) => `<article class="data-card"><div class="data-card-head"><div class="data-card-title"><strong>${esc(property.name)}</strong><small>${esc(property.customer_name)} · ${esc(property.address || '')}</small></div>${property.blocked ? '<span class="badge danger">Pagamento sospeso</span>' : '<span class="badge success">Eseguibile</span>'}</div><div class="data-meta"><div class="meta-row"><span>Piano</span><span>${esc(planLabel(property.package_type))}</span></div><div class="meta-row"><span>Scadenza</span><span>${dateIT(property.next_check_date)}</span></div></div><div class="data-actions">${mapLink(property)}${property.blocked ? '' : `<button class="button success compact" type="button" data-action="open-check" data-id="${esc(property.id)}" data-plan="${esc(property.package_type)}" data-name="${esc(property.name)}">Completa</button>`}</div></article>`).join('')}</div>` : emptyState('Nessun controllo da fare', 'Le scadenze sono tutte aggiornate.')}</section>`;
  }

  function openCheckForm(propertyId, packageType, propertyName) {
    const panel = document.getElementById('checkCompletionPanel');
    if (!panel) return;
    const plan = planById(packageType);
    const checklist = plan?.features || [];
    panel.innerHTML = `<section class="card focus-card"><div class="card-header"><div><h2 class="card-title">Completa: ${esc(propertyName)}</h2><p class="card-subtitle">Piano ${esc(planLabel(packageType))}</p></div><button class="button light icon compact" type="button" data-action="close-check" aria-label="Chiudi">×</button></div><form class="form-grid" data-form="complete-check" enctype="multipart/form-data"><input type="hidden" name="property_id" value="${esc(propertyId)}"><fieldset class="fieldset-reset"><legend class="field-label">Checklist</legend>${checklist.length ? checklist.map((item, index) => `<div class="check-row"><input id="checkItem${index}" type="checkbox" name="checklist_item" value="${esc(item)}" checked><label for="checkItem${index}">${esc(item)}</label></div>`).join('') : '<p class="help">Nessuna checklist configurata per questo piano.</p>'}</fieldset><div class="field"><label>Note del controllo</label><textarea name="notes" maxlength="5000" placeholder="Anomalie, interventi consigliati, dettagli utili…"></textarea></div><div class="field"><label>Fotografie</label><input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple><small>Massimo ${state.config.maxUploadFiles} foto, ${Math.round(state.config.maxUploadBytes / 1024 / 1024)} MB ciascuna. JPEG, PNG o WebP.</small></div><div class="form-actions"><button class="button success" type="submit">Salva report</button><button class="button light" type="button" data-action="close-check">Annulla</button></div></form></section>`;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function adminReports() {
    const response = await api('/api/admin/reports');
    const reports = response.reports || [];
    document.getElementById('main').innerHTML = `${pageHeader('Report completati', 'Storico controlli con note, checklist e fotografie.')}<section class="section-stack">${reports.length ? reports.map(reportCard).join('') : emptyState('Nessun report', 'Completa un controllo per creare il primo report.')}</section>`;
  }

  async function adminTasks(status = 'todo') {
    const response = await api(`/api/admin/tasks?status=${encodeURIComponent(status)}`);
    const tasks = response.tasks || [];
    document.getElementById('main').innerHTML = `${pageHeader('Attività', 'Promemoria operativi collegabili a clienti e immobili.')}<section class="card"><div class="card-header"><div><h2 class="card-title">Nuova attività</h2><p class="card-subtitle">Usa una scadenza e una priorità chiare.</p></div></div><form class="form-grid three" data-form="task"><div class="field span-all"><label>Titolo</label><input name="title" required maxlength="200"></div><div class="field"><label>Tipo</label><input name="type" value="controllo" maxlength="80"></div><div class="field"><label>Priorità</label><select name="priority"><option value="bassa">Bassa</option><option value="normale" selected>Normale</option><option value="alta">Alta</option></select></div><div class="field"><label>Scadenza</label><input name="due_date" type="date" value="${todayISO()}"></div><div class="field"><label>Cliente</label><select name="customer_id" data-task-customer>${customerOptions()}</select></div><div class="field"><label>Immobile</label><select name="property_id" data-task-property>${propertyOptions()}</select></div><div class="field span-all"><label>Descrizione</label><textarea name="description" maxlength="3000"></textarea></div><button class="button primary" type="submit">Aggiungi attività</button></form></section><section class="card"><div class="card-header"><div><h2 class="card-title">Elenco attività</h2><p class="card-subtitle">Filtra per stato.</p></div><div class="page-actions"><button class="button ${status === 'todo' ? 'primary' : 'light'} compact" type="button" data-action="task-status" data-status="todo">Da fare</button><button class="button ${status === 'done' ? 'primary' : 'light'} compact" type="button" data-action="task-status" data-status="done">Completate</button><button class="button ${status === 'blocked' ? 'primary' : 'light'} compact" type="button" data-action="task-status" data-status="blocked">Bloccate</button></div></div>${tasks.length ? `<div class="data-list desktop-grid">${tasks.map((task) => `<article class="data-card"><div class="data-card-head"><div class="data-card-title"><strong>${esc(task.title)}</strong><small>${esc(task.type)} · ${dateIT(task.due_date)}</small></div>${statusBadge(task.status, { todo: 'Da fare', done: 'Completata', blocked: 'Bloccata' })}</div><div class="data-meta"><div class="meta-row"><span>Priorità</span><span>${esc(task.priority)}</span></div>${task.customer_name ? `<div class="meta-row"><span>Cliente</span><span>${esc(task.customer_name)}</span></div>` : ''}${task.property_name ? `<div class="meta-row"><span>Immobile</span><span>${esc(task.property_name)}</span></div>` : ''}${task.description ? `<div class="meta-row"><span>Dettagli</span><span>${esc(task.description)}</span></div>` : ''}</div>${task.status === 'todo' ? `<div class="data-actions"><button class="button success compact" type="button" data-action="complete-task" data-id="${esc(task.id)}">Segna completata</button></div>` : ''}</article>`).join('')}</div>` : emptyState('Nessuna attività', 'Non ci sono elementi con questo stato.')}</section>`;
  }

  async function adminRoute() {
    document.getElementById('main').innerHTML = `${pageHeader('Organizza il giro', 'Calcola l’ordine indicativo delle visite partendo dalla posizione attuale.')}<section class="card"><div class="notice"><strong>Privacy e sicurezza</strong><p>La posizione viene usata soltanto per calcolare il percorso in questa richiesta e non viene salvata.</p></div><div class="form-actions"><button class="button teal" type="button" data-action="calculate-route" data-due="1">Calcola controlli da fare</button><button class="button light" type="button" data-action="calculate-route" data-due="0">Tutti gli immobili attivi</button></div><div id="routeResult"></div></section>`;
  }

  function renderRouteResult(result) {
    const node = document.getElementById('routeResult');
    if (!node) return;
    const properties = result.properties || [];
    node.innerHTML = `<div class="total-box"><span>Distanza stimata tra le tappe</span><strong>${Number(result.totalKm || 0).toLocaleString('it-IT')} km</strong></div>${properties.length ? `<div class="data-list route-list">${properties.map((property, index) => `<article class="data-card"><div class="data-card-head"><div class="data-card-title"><strong>${index + 1}. ${esc(property.name)}</strong><small>${esc(property.customer_name)} · ${esc(property.address || '')}</small></div><span class="badge gold">${Number(property.distance_from_previous_km || 0).toLocaleString('it-IT')} km</span></div><div class="data-actions"><a class="button teal compact" href="https://www.google.com/maps?q=${encodeURIComponent(`${property.latitude},${property.longitude}`)}" target="_blank" rel="noopener noreferrer">Apri Maps</a></div></article>`).join('')}</div>` : emptyState('Nessuna tappa disponibile', 'Salva il GPS degli immobili e verifica che i pagamenti siano regolari.')}`;
  }

  function extraPaymentAdminCard(payment) {
    return `<article class="data-card"><div class="data-card-head"><div class="data-card-title"><strong>${esc(payment.customer_name)}</strong><small>${esc(payment.description)}</small></div><strong>${money(payment.amount_cents)}</strong></div><div class="data-meta"><div class="meta-row"><span>Creato</span><span>${dateIT(payment.created_at)}</span></div><div class="meta-row"><span>Stato</span><span>${statusBadge(payment.status, { pending: 'Da pagare', paid: 'Pagato', canceled: 'Annullato' })}</span></div></div>${payment.status === 'pending' ? `<div class="data-actions"><button class="button danger compact" type="button" data-action="cancel-extra" data-id="${esc(payment.id)}">Annulla</button></div>` : ''}</article>`;
  }

  async function adminPayments() {
    if (state.user.role !== 'admin') return setTab('dashboard');
    const [extraResponse, manualResponse] = await Promise.all([api('/api/admin/extra-payments'), api('/api/admin/manual-payments')]);
    const extras = extraResponse.payments || [];
    const manuals = manualResponse.payments || [];
    document.getElementById('main').innerHTML = `${pageHeader('Pagamenti', 'Preventivi extra e registrazioni manuali.')}<section class="card"><div class="card-header"><div><h2 class="card-title">Nuovo preventivo / extra</h2><p class="card-subtitle">Il cliente potrà pagarlo dalla propria area.</p></div></div><form class="form-grid two" data-form="extra-payment"><div class="field"><label>Cliente</label><select name="customer_id" required>${customerOptions()}</select></div><div class="field"><label>Importo in euro</label><input name="amount_euro" type="number" min="0.01" step="0.01" required></div><div class="field span-all"><label>Descrizione</label><textarea name="description" required maxlength="1000"></textarea></div><button class="button gold" type="submit">Crea preventivo</button></form></section><section class="split-grid"><article class="card"><div class="card-header"><div><h2 class="card-title">Preventivi e extra</h2><p class="card-subtitle">${extras.length} elementi</p></div></div>${extras.length ? `<div class="data-list">${extras.map(extraPaymentAdminCard).join('')}</div>` : emptyState('Nessun preventivo', 'Crea un nuovo importo dal modulo sopra.')}</article><article class="card"><div class="card-header"><div><h2 class="card-title">Pagamenti manuali</h2><p class="card-subtitle">Ultime registrazioni</p></div></div>${manuals.length ? `<div class="data-list">${manuals.map((payment) => `<article class="data-card"><div class="data-card-head"><div class="data-card-title"><strong>${esc(payment.customer_name)}</strong><small>${esc(payment.method)} · ${dateIT(payment.created_at)}</small></div><strong>${payment.amount_cents ? money(payment.amount_cents) : '—'}</strong></div><div class="data-meta"><div class="meta-row"><span>Piano</span><span>${esc(planLabel(payment.package_type))}</span></div><div class="meta-row"><span>Pagato fino al</span><span>${dateIT(payment.paid_until)}</span></div></div></article>`).join('')}</div>` : emptyState('Nessun pagamento manuale', 'Le registrazioni effettuate dalla sezione Clienti compariranno qui.')}</article></section>`;
  }

  async function adminMessages() {
    if (state.user.role !== 'admin') return setTab('dashboard');
    const response = await api('/api/admin/messages');
    const messages = (response.messages || []).slice().reverse();
    document.getElementById('main').innerHTML = `${pageHeader('Messaggi', 'Conversazioni recenti con tutti i clienti.')}<section class="split-grid"><article class="card"><div class="card-header"><div><h2 class="card-title">Nuovo messaggio</h2><p class="card-subtitle">Verrà inviato come Home Care.</p></div></div><form class="form-grid" data-form="admin-message"><div class="field"><label>Cliente</label><select name="customer_id" required>${customerOptions()}</select></div><div class="field"><label>Messaggio</label><textarea name="body" required maxlength="3000"></textarea></div><button class="button primary" type="submit">Invia messaggio</button></form></article><article class="card"><div class="card-header"><div><h2 class="card-title">Cronologia recente</h2><p class="card-subtitle">Ultimi ${messages.length} messaggi</p></div></div><div class="chat-window">${messages.length ? messages.map((message) => `<article class="chat-message ${message.sender_role === 'admin' ? 'mine' : ''}"><strong>${message.sender_role === 'admin' ? 'Home Care' : esc(message.customer_name)}</strong><p>${esc(message.body)}</p><time>${dateTimeIT(message.created_at)}</time></article>`).join('') : emptyState('Nessun messaggio', 'Le conversazioni appariranno qui.')}</div></article></section>`;
  }

  function contactAdminCard(contact) {
    return `<article class="data-card"><div class="data-card-head"><div class="data-card-title"><strong>${esc(contact.label)}</strong><small>${esc(contact.kind)}</small></div>${contact.active ? '<span class="badge success">Visibile</span>' : '<span class="badge danger">Archiviato</span>'}</div><div class="data-meta"><div class="meta-row"><span>Valore</span><span>${esc(contact.value)}</span></div>${contact.note ? `<div class="meta-row"><span>Nota</span><span>${esc(contact.note)}</span></div>` : ''}<div class="meta-row"><span>Ordine</span><span>${Number(contact.sort_order || 0)}</span></div></div><div class="data-actions"><button class="button ${contact.active ? 'danger' : 'success'} compact" type="button" data-action="toggle-contact" data-id="${esc(contact.id)}" data-active="${contact.active ? '0' : '1'}">${contact.active ? 'Archivia' : 'Ripristina'}</button></div></article>`;
  }

  async function adminContacts() {
    if (state.user.role !== 'admin') return setTab('dashboard');
    const response = await api('/api/admin/contacts');
    const contacts = response.contacts || [];
    document.getElementById('main').innerHTML = `${pageHeader('Contatti pubblicati', 'Recapiti mostrati nell’area cliente.')}<section class="card"><div class="card-header"><div><h2 class="card-title">Nuovo contatto</h2><p class="card-subtitle">Telefono, WhatsApp, email o sito.</p></div></div><form class="form-grid three" data-form="contact"><div class="field"><label>Nome</label><input name="label" required maxlength="120"></div><div class="field"><label>Tipo</label><select name="kind"><option value="telefono">Telefono</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="sito">Sito</option><option value="altro">Altro</option></select></div><div class="field"><label>Ordine</label><input name="sort_order" type="number" value="0" step="1"></div><div class="field span-all"><label>Valore</label><input name="value" required maxlength="300"></div><div class="field span-all"><label>Nota</label><input name="note" maxlength="500"></div><button class="button primary" type="submit">Pubblica contatto</button></form></section><section class="card"><div class="card-header"><div><h2 class="card-title">Elenco contatti</h2><p class="card-subtitle">${contacts.length} elementi</p></div></div>${contacts.length ? `<div class="data-list desktop-grid">${contacts.map(contactAdminCard).join('')}</div>` : emptyState('Nessun contatto', 'Aggiungi il primo recapito per i clienti.')}</section>`;
  }

  function customPlanForm() {
    const firstCustomer = state.customers[0]?.id || '';
    return `<section class="card"><div class="card-header"><div><h2 class="card-title">Crea piano personalizzato</h2><p class="card-subtitle">Prezzi e servizi sono definiti dall’amministratore e poi mostrati al cliente.</p></div></div><form class="form-grid" data-form="custom-plan" data-custom-plan-form><div class="field"><label>Cliente</label><select name="customer_id" data-custom-customer required>${customerOptions(firstCustomer)}</select></div><div class="field"><label>Immobile collegato</label><select name="property_id" data-custom-property>${propertyOptions(firstCustomer)}</select></div><div class="field"><label>Nome piano</label><input name="title" value="Piano personalizzato Home Care" required maxlength="180"></div><div class="form-grid two"><div class="field"><label>Base mensile</label><input name="base_price_euro" type="number" min="0" step="0.01" value="39"></div><div class="field"><label>Prezzo finale manuale</label><input name="final_price_euro" type="number" min="0.01" step="0.01" placeholder="Calcolo automatico"></div></div><fieldset class="fieldset-reset"><legend class="field-label">Servizi mensili</legend><div class="service-builder">${CUSTOM_SERVICE_CATALOG.map((service) => `<div class="service-row"><label><input type="checkbox" name="service_${esc(service.id)}" data-service-id="${esc(service.id)}" data-service-label="${esc(service.label)}"> <span>${esc(service.label)}</span></label><input name="price_${esc(service.id)}" type="number" min="0" step="0.01" value="${service.price}" aria-label="Prezzo ${esc(service.label)}"></div>`).join('')}</div></fieldset><div class="form-grid two"><div class="field"><label>Tipo sconto</label><select name="discount_type"><option value="none">Nessuno</option><option value="amount">Importo in euro</option><option value="percent">Percentuale</option></select></div><div class="field"><label>Valore sconto</label><input name="discount_value" type="number" min="0" step="0.01" value="0"></div></div><div class="field"><label>Note per il cliente</label><textarea name="notes" maxlength="4000"></textarea></div><div class="total-box" data-custom-total><span>Prezzo mensile calcolato</span><strong>39,00 €</strong></div><div class="form-actions"><button class="button primary" type="submit" name="submit_action" value="draft">Salva bozza</button><button class="button success" type="submit" name="submit_action" value="activate">Salva e attiva</button></div></form></section>`;
  }

  function parseServices(plan) {
    if (Array.isArray(plan.services_json)) return plan.services_json;
    try { return JSON.parse(plan.services_json || '[]'); } catch (_) { return []; }
  }

  function customPlanCard(plan) {
    const services = parseServices(plan);
    return `<article class="data-card"><div class="data-card-head"><div class="data-card-title"><strong>${esc(plan.title)}</strong><small>${esc(plan.customer_name)}${plan.property_name ? ` · ${esc(plan.property_name)}` : ''}</small></div>${statusBadge(plan.status, { draft: 'Bozza', active: 'Attivo', archived: 'Archiviato' })}</div><div class="data-meta"><div class="meta-row"><span>Prezzo finale</span><span><strong>${money(plan.final_price_cents)}/mese</strong></span></div><div class="meta-row"><span>Subtotale</span><span>${money(plan.subtotal_cents)}</span></div><div class="meta-row"><span>Servizi</span><span>${services.length}</span></div>${plan.notes ? `<div class="meta-row"><span>Note</span><span>${esc(plan.notes)}</span></div>` : ''}</div><div class="data-actions">${plan.status === 'draft' ? `<button class="button success compact" type="button" data-action="activate-custom-plan" data-id="${esc(plan.id)}">Attiva</button>` : ''}${plan.status !== 'archived' ? `<button class="button danger compact" type="button" data-action="archive-custom-plan" data-id="${esc(plan.id)}">Archivia</button>` : ''}</div></article>`;
  }

  async function adminCustomPlans() {
    if (state.user.role !== 'admin') return setTab('dashboard');
    await loadAdminBase(true);
    const response = await api('/api/admin/customer-custom-plans');
    const plans = response.plans || [];
    document.getElementById('main').innerHTML = `${pageHeader('Piani cliente', 'Crea preventivi mensili su misura e attivali in modo atomico.')}<section class="split-grid custom-plan-layout">${customPlanForm()}<article class="card"><div class="card-header"><div><h2 class="card-title">Piani creati</h2><p class="card-subtitle">${plans.length} elementi</p></div></div>${plans.length ? `<div class="data-list">${plans.map(customPlanCard).join('')}</div>` : emptyState('Nessun piano personalizzato', 'Compila il modulo per creare il primo piano.')}</article></section>`;
    updateCustomPlanTotal();
  }

  function updateCustomPlanTotal() {
    const form = document.querySelector('[data-custom-plan-form]');
    const output = form?.querySelector('[data-custom-total] strong');
    if (!form || !output) return;
    const base = Number(String(form.elements.base_price_euro?.value || 0).replace(',', '.')) || 0;
    let subtotal = base;
    form.querySelectorAll('[data-service-id]:checked').forEach((checkbox) => {
      const input = form.elements[`price_${checkbox.dataset.serviceId}`];
      subtotal += Number(String(input?.value || 0).replace(',', '.')) || 0;
    });
    const discountType = form.elements.discount_type?.value || 'none';
    const discountValue = Number(String(form.elements.discount_value?.value || 0).replace(',', '.')) || 0;
    let total = subtotal;
    if (discountType === 'amount') total -= discountValue;
    if (discountType === 'percent') total -= subtotal * Math.min(discountValue, 100) / 100;
    const override = Number(String(form.elements.final_price_euro?.value || 0).replace(',', '.')) || 0;
    if (override > 0) total = override;
    output.textContent = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Math.max(0, total));
  }

  function planSettingsCard(plan) {
    return `<article class="card"><div class="card-header"><div><h2 class="card-title">${esc(plan.label)}</h2><p class="card-subtitle">Codice: ${esc(plan.id)}</p></div>${plan.active ? '<span class="badge success">Visibile</span>' : '<span class="badge danger">Nascosto</span>'}</div><form class="form-grid three" data-form="plan-settings" data-plan-id="${esc(plan.id)}"><div class="field"><label>Nome piano</label><input name="label" value="${esc(plan.label)}" required maxlength="120"></div><div class="field"><label>Prezzo mensile</label><input name="price_euro" type="number" min="0.01" step="0.01" value="${esc((Number(plan.price_cents || 0) / 100).toFixed(2))}" required></div><div class="field"><label>Etichetta pubblica</label><input name="price_label" value="${esc(plan.price_label || '')}" maxlength="120" required></div><div class="field"><label>Giorni tra controlli</label><input name="days" type="number" min="1" max="365" step="1" value="${Number(plan.days || 30)}" required></div><div class="field"><label>Ordine</label><input name="sort_order" type="number" step="1" value="${Number(plan.sort_order || 0)}"></div><div class="field"><label>Prezzo “da”</label><select name="from_price"><option value="false" ${plan.from_price ? '' : 'selected'}>No</option><option value="true" ${plan.from_price ? 'selected' : ''}>Sì</option></select></div><div class="field"><label>Visibile</label><select name="active"><option value="true" ${plan.active ? 'selected' : ''}>Sì</option><option value="false" ${plan.active ? '' : 'selected'}>No</option></select></div><div class="field span-all"><label>Servizi inclusi, uno per riga</label><textarea name="features_text" maxlength="8000">${esc((plan.features || []).join('\n'))}</textarea></div><button class="button success" type="submit">Salva piano</button></form></article>`;
  }

  async function adminPlanSettings() {
    if (state.user.role !== 'admin') return setTab('dashboard');
    const response = await api('/api/admin/plan-settings');
    const plans = response.plans || [];
    document.getElementById('main').innerHTML = `${pageHeader('Piani e listino', 'Modifica prezzi, frequenza e descrizioni usate anche nei checkout.')}<div class="notice warning"><strong>Attenzione</strong><p>Le modifiche ai prezzi valgono per le nuove approvazioni e i checkout successivi. I prezzi già confermati sugli immobili restano invariati.</p></div><section class="section-stack">${plans.map(planSettingsCard).join('')}</section>`;
  }

  async function adminHelpers() {
    if (state.user.role !== 'admin') return setTab('dashboard');
    const response = await api('/api/admin/helpers');
    const helpers = response.helpers || [];
    document.getElementById('main').innerHTML = `${pageHeader('Aiutanti', 'Account operativi senza accesso a importi e pagamenti.')}<section class="card"><div class="card-header"><div><h2 class="card-title">Nuovo aiutante</h2><p class="card-subtitle">La password deve avere almeno 10 caratteri.</p></div></div><form class="form-grid three" data-form="helper"><div class="field"><label>Nome</label><input name="name" required maxlength="120"></div><div class="field"><label>Email</label><input name="email" type="email" required maxlength="254"></div><div class="field"><label>Telefono</label><input name="phone" type="tel" maxlength="40"></div><div class="field span-all"><label>Password iniziale</label><input name="password" type="password" autocomplete="new-password" minlength="10" required></div><button class="button primary" type="submit">Crea aiutante</button></form></section><section class="card"><div class="card-header"><div><h2 class="card-title">Account attivi</h2><p class="card-subtitle">${helpers.length} aiutanti</p></div></div>${helpers.length ? `<div class="data-list desktop-grid">${helpers.map((helper) => `<article class="data-card"><div class="data-card-head"><div class="data-card-title"><strong>${esc(helper.name)}</strong><small>${esc(helper.email)}</small></div><span class="badge success">Operativo</span></div><div class="data-meta"><div class="meta-row"><span>Telefono</span><span>${esc(helper.phone || '—')}</span></div><div class="meta-row"><span>Creato</span><span>${dateIT(helper.created_at)}</span></div></div></article>`).join('')}</div>` : emptyState('Nessun aiutante', 'Crea il primo account operativo.')}</section>`;
  }

  function insertAuthNotice(message, kind = 'success', href = '') {
    const card = document.querySelector('.auth-card');
    if (!card) return;
    const notice = document.createElement('div');
    notice.className = `notice ${kind}`;
    const textNode = document.createElement('p');
    textNode.textContent = message;
    notice.appendChild(textNode);
    if (href) {
      const link = document.createElement('a');
      link.className = 'button light compact';
      link.href = href;
      link.textContent = 'Apri il collegamento di test';
      notice.appendChild(link);
    }
    card.insertBefore(notice, card.querySelector('form'));
  }

  async function handleAction(button) {
    const action = button.dataset.action;
    if (!action) return;
    if (action === 'public-home') return renderPublicHome();
    if (action === 'show-auth') return renderAuth(button.dataset.mode || 'login');
    if (action === 'scroll-plans') return document.getElementById('plans')?.scrollIntoView({ behavior: 'smooth' });
    if (action === 'select-plan') {
      localStorage.setItem('hc_selected_plan', button.dataset.plan || 'base');
      if (state.user?.role === 'client') return setTab('properties');
      return renderAuth('register', button.dataset.plan || 'base');
    }
    if (action === 'set-tab') return setTab(button.dataset.tab);
    if (action === 'open-sheet') return openSheet();
    if (action === 'close-sheet') return closeSheet();
    if (action === 'retry-tab') return renderCurrentTab();
    if (action === 'logout') {
      await api('/api/auth/logout', { method: 'POST', body: {} });
      state.user = null;
      state.clientData = null;
      state.customers = [];
      state.properties = [];
      history.replaceState({}, '', '/');
      renderPublicHome();
      toast('Sessione chiusa.', 'success');
      return;
    }
    if (action === 'pay-plan') {
      const packageType = document.querySelector('[data-payment-plan]')?.value;
      if (!packageType) return toast('Scegli un piano approvato.', 'danger');
      button.disabled = true;
      try {
        const result = await api('/api/client/plan-checkout', { method: 'POST', body: { billing: button.dataset.billing, package_type: packageType } });
        if (result.url) window.location.assign(result.url);
      } finally { button.disabled = false; }
      return;
    }
    if (action === 'pay-extra') {
      button.disabled = true;
      try {
        const result = await api(`/api/client/extra-payments/${encodeURIComponent(button.dataset.id)}/pay`, { method: 'POST', body: {} });
        if (result.url) window.location.assign(result.url);
      } finally { button.disabled = false; }
      return;
    }
    if (action === 'delete-customer') {
      const name = button.dataset.name || '';
      if (!window.confirm(`Eliminare definitivamente ${name} e tutti i dati collegati?`)) return;
      const typedName = window.prompt(`Scrivi esattamente il nome del cliente:\n${name}`);
      if (typedName !== name) return toast('Nome di conferma non corretto.', 'danger');
      const confirmation = window.prompt('Scrivi ELIMINA per confermare.');
      if (confirmation !== 'ELIMINA') return toast('Eliminazione annullata.', 'danger');
      await api(`/api/admin/customers/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE', body: { confirmName: typedName, confirmation } });
      toast('Cliente eliminato.', 'success');
      state.customers = [];
      state.properties = [];
      return adminCustomers();
    }
    if (action === 'save-gps') {
      if (!navigator.geolocation) return toast('Geolocalizzazione non supportata.', 'danger');
      button.disabled = true;
      navigator.geolocation.getCurrentPosition(async (position) => {
        try {
          await api(`/api/admin/properties/${encodeURIComponent(button.dataset.id)}/location`, {
            method: 'POST',
            body: { latitude: position.coords.latitude, longitude: position.coords.longitude },
          });
          toast('Posizione GPS salvata.', 'success');
          state.properties = [];
          await adminProperties();
        } catch (error) { toast(error.message, 'danger'); }
        finally { button.disabled = false; }
      }, (error) => { button.disabled = false; toast(error.message || 'Posizione non disponibile.', 'danger'); }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
      return;
    }
    if (action === 'open-check') return openCheckForm(button.dataset.id, button.dataset.plan, button.dataset.name);
    if (action === 'close-check') {
      const panel = document.getElementById('checkCompletionPanel');
      if (panel) panel.innerHTML = '';
      return;
    }
    if (action === 'task-status') return adminTasks(button.dataset.status || 'todo');
    if (action === 'complete-task') {
      await api(`/api/admin/tasks/${encodeURIComponent(button.dataset.id)}/done`, { method: 'POST', body: {} });
      toast('Attività completata.', 'success');
      return adminTasks('todo');
    }
    if (action === 'calculate-route') {
      if (!navigator.geolocation) return toast('Geolocalizzazione non supportata.', 'danger');
      button.disabled = true;
      navigator.geolocation.getCurrentPosition(async (position) => {
        try {
          const query = new URLSearchParams({ lat: position.coords.latitude, lng: position.coords.longitude, onlyDue: button.dataset.due || '1' });
          const result = await api(`/api/admin/route-plan?${query}`);
          renderRouteResult(result);
        } catch (error) { toast(error.message, 'danger'); }
        finally { button.disabled = false; }
      }, (error) => { button.disabled = false; toast(error.message || 'Posizione non disponibile.', 'danger'); }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
      return;
    }
    if (action === 'cancel-extra') {
      if (!window.confirm('Annullare questo preventivo?')) return;
      await api(`/api/admin/extra-payments/${encodeURIComponent(button.dataset.id)}/cancel`, { method: 'POST', body: {} });
      toast('Preventivo annullato.', 'success');
      return adminPayments();
    }
    if (action === 'toggle-contact') {
      await api(`/api/admin/contacts/${encodeURIComponent(button.dataset.id)}`, { method: 'PATCH', body: { active: button.dataset.active === '1' } });
      toast('Contatto aggiornato.', 'success');
      return adminContacts();
    }
    if (action === 'activate-custom-plan') {
      if (!window.confirm('Attivare questo piano al cliente? Lo stato del pagamento tornerà “da regolarizzare”.')) return;
      await api(`/api/admin/customer-custom-plans/${encodeURIComponent(button.dataset.id)}/activate`, { method: 'POST', body: {} });
      toast('Piano personalizzato attivato.', 'success');
      state.customers = [];
      state.properties = [];
      return adminCustomPlans();
    }
    if (action === 'archive-custom-plan') {
      if (!window.confirm('Archiviare questo piano? Se è attivo verrà scollegato dal cliente.')) return;
      await api(`/api/admin/customer-custom-plans/${encodeURIComponent(button.dataset.id)}/archive`, { method: 'POST', body: {} });
      toast('Piano archiviato.', 'success');
      state.customers = [];
      state.properties = [];
      return adminCustomPlans();
    }
  }

  async function handleForm(form, event) {
    const kind = form.dataset.form;
    if (!kind) return;
    setBusy(form, true);
    try {
      const data = formObject(form);
      if (kind === 'login') {
        const response = await api('/api/auth/login', { method: 'POST', body: data });
        state.user = response.user;
        state.clientData = null;
        state.customers = [];
        state.properties = [];
        const selected = localStorage.getItem('hc_selected_plan');
        state.tab = state.user.role === 'client' ? (selected ? 'properties' : 'home') : 'dashboard';
        history.replaceState({}, '', `/?tab=${encodeURIComponent(state.tab)}`);
        renderShell();
        toast(`Benvenuto, ${state.user.name}.`, 'success');
        return;
      }
      if (kind === 'register') {
        const selected = data.selected_plan || '';
        delete data.selected_plan;
        const response = await api('/api/auth/register', { method: 'POST', body: data });
        if (selected) localStorage.setItem('hc_selected_plan', selected);
        renderAuth('login');
        insertAuthNotice(response.message, response.emailSent ? 'success' : 'warning', response.confirmationUrl || '');
        return;
      }
      if (kind === 'forgot-password') {
        const response = await api('/api/auth/forgot-password', { method: 'POST', body: data });
        renderAuth('login');
        insertAuthNotice(response.message, 'success', response.resetUrl || '');
        return;
      }
      if (kind === 'resend-confirmation') {
        const response = await api('/api/auth/resend-confirmation', { method: 'POST', body: data });
        renderAuth('login');
        insertAuthNotice(response.message, 'success', response.confirmationUrl || '');
        return;
      }
      if (kind === 'reset-password') {
        if (data.password !== data.confirm_password) throw new Error('Le password non coincidono.');
        delete data.confirm_password;
        const response = await api('/api/auth/reset-password', { method: 'POST', body: data });
        history.replaceState({}, '', '/');
        renderAuth('login');
        insertAuthNotice(response.message, 'success');
        return;
      }
      if (kind === 'client-property') {
        await api('/api/client/properties', { method: 'POST', body: data });
        localStorage.removeItem('hc_selected_plan');
        state.clientData = null;
        toast('Richiesta inviata a Home Care.', 'success');
        return clientProperties();
      }
      if (kind === 'client-message') {
        await api('/api/client/messages', { method: 'POST', body: data });
        form.reset();
        return clientChat();
      }
      if (kind === 'approve-property') {
        const id = data.property_id;
        delete data.property_id;
        await api(`/api/admin/properties/${encodeURIComponent(id)}/approve`, { method: 'POST', body: data });
        state.customers = [];
        state.properties = [];
        toast('Immobile approvato e cliente avvisato.', 'success');
        return adminRequests();
      }
      if (kind === 'reject-property') {
        const id = data.property_id;
        delete data.property_id;
        await api(`/api/admin/properties/${encodeURIComponent(id)}/reject`, { method: 'POST', body: data });
        state.properties = [];
        toast('Richiesta non approvata; il cliente è stato avvisato.', 'success');
        return adminRequests();
      }
      if (kind === 'admin-customer') {
        await api('/api/admin/customers', { method: 'POST', body: data });
        state.customers = [];
        toast('Cliente aggiunto.', 'success');
        return adminCustomers();
      }
      if (kind === 'manual-payment') {
        const id = data.customer_id;
        delete data.customer_id;
        await api(`/api/admin/customers/${encodeURIComponent(id)}/manual-payment`, { method: 'POST', body: data });
        state.customers = [];
        toast('Pagamento manuale registrato.', 'success');
        return adminCustomers();
      }
      if (kind === 'admin-property') {
        await api('/api/admin/properties', { method: 'POST', body: data });
        state.customers = [];
        state.properties = [];
        toast('Immobile aggiunto.', 'success');
        return adminProperties();
      }
      if (kind === 'complete-check') {
        const multipart = new FormData(form);
        multipart.delete('checklist_item');
        const checklist = Array.from(form.querySelectorAll('[name="checklist_item"]:checked')).map((input) => input.value);
        multipart.append('checklist_json', JSON.stringify(checklist));
        const files = Array.from(form.querySelector('[name="photos"]')?.files || []);
        if (files.length > state.config.maxUploadFiles) throw new Error(`Puoi caricare al massimo ${state.config.maxUploadFiles} fotografie.`);
        if (files.some((file) => file.size > state.config.maxUploadBytes)) throw new Error(`Ogni fotografia può pesare al massimo ${Math.round(state.config.maxUploadBytes / 1024 / 1024)} MB.`);
        await api('/api/admin/checks/complete', { method: 'POST', body: multipart });
        state.properties = [];
        toast('Controllo completato e report salvato.', 'success');
        return setTab('reports');
      }
      if (kind === 'task') {
        await api('/api/admin/tasks', { method: 'POST', body: data });
        toast('Attività aggiunta.', 'success');
        return adminTasks('todo');
      }
      if (kind === 'extra-payment') {
        await api('/api/admin/extra-payments', { method: 'POST', body: data });
        toast('Preventivo creato.', 'success');
        return adminPayments();
      }
      if (kind === 'admin-message') {
        await api('/api/admin/messages', { method: 'POST', body: data });
        form.reset();
        toast('Messaggio inviato.', 'success');
        return adminMessages();
      }
      if (kind === 'contact') {
        await api('/api/admin/contacts', { method: 'POST', body: data });
        toast('Contatto pubblicato.', 'success');
        return adminContacts();
      }
      if (kind === 'custom-plan') {
        const services = Array.from(form.querySelectorAll('[data-service-id]:checked')).map((checkbox) => ({
          id: checkbox.dataset.serviceId,
          label: checkbox.dataset.serviceLabel,
          price_euro: form.elements[`price_${checkbox.dataset.serviceId}`]?.value || '0',
        }));
        const payload = {
          customer_id: data.customer_id,
          property_id: data.property_id || null,
          title: data.title,
          base_price_euro: data.base_price_euro,
          final_price_euro: data.final_price_euro || null,
          discount_type: data.discount_type,
          discount_value: data.discount_value,
          notes: data.notes,
          services,
          activate: event.submitter?.value === 'activate',
        };
        await api('/api/admin/customer-custom-plans', { method: 'POST', body: payload });
        state.customers = [];
        state.properties = [];
        toast(payload.activate ? 'Piano creato e attivato.' : 'Bozza salvata.', 'success');
        return adminCustomPlans();
      }
      if (kind === 'plan-settings') {
        const planId = form.dataset.planId;
        data.active = data.active === 'true';
        data.from_price = data.from_price === 'true';
        await api(`/api/admin/plan-settings/${encodeURIComponent(planId)}`, { method: 'PATCH', body: data });
        state.config = await api('/api/config');
        state.csrfToken = state.config.csrfToken;
        toast('Piano aggiornato.', 'success');
        return adminPlanSettings();
      }
      if (kind === 'helper') {
        await api('/api/admin/helpers', { method: 'POST', body: data });
        toast('Aiutante creato.', 'success');
        return adminHelpers();
      }
    } finally {
      if (form.isConnected) setBusy(form, false);
    }
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    event.preventDefault();
    Promise.resolve(handleAction(button)).catch((error) => {
      toast(error.message || 'Operazione non riuscita.', 'danger');
      if (error.status === 401) renderAuth('login');
    });
  });

  document.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-form]');
    if (!form) return;
    event.preventDefault();
    handleForm(form, event).catch((error) => {
      toast(error.message || 'Operazione non riuscita.', 'danger');
      if (error.status === 401) renderAuth('login');
      if (form.isConnected) setBusy(form, false);
    });
  });

  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-custom-customer]')) {
      const select = document.querySelector('[data-custom-property]');
      if (select) select.innerHTML = propertyOptions(event.target.value);
    }
    if (event.target.matches('[data-task-customer]')) {
      const select = document.querySelector('[data-task-property]');
      if (select) select.innerHTML = propertyOptions(event.target.value);
    }
    if (event.target.closest('[data-custom-plan-form]')) updateCustomPlanTotal();
  });

  document.addEventListener('input', (event) => {
    if (event.target.closest('[data-custom-plan-form]')) updateCustomPlanTotal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.sheetOpen) closeSheet();
  });

  window.addEventListener('popstate', () => {
    if (!state.user) return;
    const tab = new URLSearchParams(window.location.search).get('tab');
    setTab(tab || (state.user.role === 'client' ? 'home' : 'dashboard'), { skipHistory: true });
  });

  async function boot() {
    try {
      state.config = await api('/api/config');
      state.csrfToken = state.config.csrfToken;
      const query = new URLSearchParams(window.location.search);
      const resetCode = query.get('reset');
      if (resetCode) return renderResetPassword(resetCode);
      try {
        const response = await api('/api/auth/me');
        state.user = response.user;
      } catch (error) {
        if (error.status !== 401) throw error;
      }
      if (!state.user) return renderPublicHome();
      const requestedTab = query.get('tab');
      state.tab = menuItems().some((item) => item.id === requestedTab)
        ? requestedTab
        : state.user.role === 'client' ? 'home' : 'dashboard';
      renderShell();
    } catch (error) {
      document.body.classList.remove('has-mobile-nav');
      app.innerHTML = `<main class="confirmation-page"><section class="confirmation-card"><div class="brand-lockup"><span class="brand-mark">HC</span><span>Home Care</span></div><h1>Servizio non disponibile</h1><p>${esc(error.message || 'Impossibile collegarsi al server.')}</p><button class="button primary" type="button" data-action="reload-app">Riprova</button></section></main>`;
    }
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="reload-app"]')) window.location.reload();
  });

  boot();
}());
