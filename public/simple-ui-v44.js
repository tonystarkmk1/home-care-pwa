(function () {
  'use strict';

  const root = document.getElementById('app');
  const VERSION = '44';
  const state = {
    config: null,
    csrfToken: '',
    user: null,
    clientData: null,
    observer: null,
    timer: null,
    enhancing: false,
    moreOverlay: null,
    planOverlay: null,
  };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  function money(cents) {
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })
      .format(Number(cents || 0) / 100);
  }

  function currentTab() {
    return new URLSearchParams(window.location.search).get('tab')
      || (state.user?.role === 'client' ? 'home' : 'dashboard');
  }

  function toast(message, kind = '') {
    const region = document.getElementById('toastRegion');
    if (!region) return;
    const node = document.createElement('div');
    node.className = `toast ${kind}`.trim();
    node.textContent = message;
    region.appendChild(node);
    window.setTimeout(() => node.remove(), 4400);
  }

  async function request(url, options = {}) {
    if (!state.config) {
      const response = await fetch('/api/config', { credentials: 'same-origin', cache: 'no-store' });
      state.config = await response.json();
      state.csrfToken = state.config.csrfToken || '';
    }
    const method = String(options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    let body = options.body;
    if (body && !(body instanceof FormData) && typeof body !== 'string') {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(body);
    }
    if (!['GET', 'HEAD'].includes(method)) headers.set('X-CSRF-Token', state.csrfToken || '');
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
    if (data?.csrfToken) {
      state.csrfToken = data.csrfToken;
      if (state.config) state.config.csrfToken = data.csrfToken;
    }
    if (!response.ok) {
      const error = new Error(data?.error || data || 'Operazione non riuscita');
      error.status = response.status;
      error.code = data?.code || 'REQUEST_ERROR';
      if (response.status === 401) {
        state.user = null;
        state.clientData = null;
      }
      throw error;
    }
    return data;
  }

  async function ensureUser() {
    if (state.user) return state.user;
    try {
      state.user = (await request('/api/auth/me')).user;
    } catch (error) {
      if (error.status !== 401) throw error;
      return null;
    }
    return state.user;
  }

  async function clientData(force = false) {
    if (!state.clientData || force) state.clientData = await request('/api/client/dashboard');
    return state.clientData;
  }

  function primaryItems() {
    if (state.user?.role === 'client') {
      return [
        { id: 'home', tab: 'home', label: 'Home', icon: '⌂', active: ['home'] },
        { id: 'homes', tab: 'properties', label: 'Le mie case', icon: '⌂', active: ['properties'] },
        { id: 'reports', tab: 'reports', label: 'Report', icon: '▤', active: ['reports'] },
        { id: 'chat', tab: 'chat', label: 'Messaggi', icon: '✉', active: ['chat'] },
        { id: 'more', label: 'Altro', icon: '•••', more: true, active: ['payments', 'contacts'] },
      ];
    }
    if (state.user?.role === 'helper') {
      return [
        { id: 'home', tab: 'dashboard', label: 'Home', icon: '⌂', active: ['dashboard'] },
        { id: 'today', tab: 'checks', label: 'Oggi', icon: '✓', active: ['checks', 'tasks', 'route'] },
        { id: 'clients', tab: 'customers', label: 'Clienti', icon: '♙', active: ['customers', 'properties'] },
        { id: 'reports', tab: 'reports', label: 'Report', icon: '▤', active: ['reports'] },
        { id: 'more', label: 'Altro', icon: '•••', more: true, active: [] },
      ];
    }
    return [
      { id: 'home', tab: 'dashboard', label: 'Home', icon: '⌂', active: ['dashboard'] },
      { id: 'today', tab: 'checks', label: 'Oggi', icon: '✓', active: ['checks', 'tasks', 'route', 'reports'] },
      { id: 'clients', tab: 'customers', label: 'Clienti', icon: '♙', active: ['customers', 'properties', 'requests', 'custom_plans', 'payments'] },
      { id: 'messages', tab: 'messages', label: 'Messaggi', icon: '✉', active: ['messages'] },
      { id: 'more', label: 'Altro', icon: '•••', more: true, active: ['contacts', 'plan_settings', 'helpers'] },
    ];
  }

  function navButton(item, compact = false) {
    if (item.more) {
      return `<button class="hc-simple-nav-button ${compact ? 'compact' : ''}" type="button" data-simple-action="open-more" data-simple-nav="${esc(item.id)}"><span aria-hidden="true">${esc(item.icon)}</span><strong>${esc(item.label)}</strong></button>`;
    }
    return `<button class="hc-simple-nav-button ${compact ? 'compact' : ''}" type="button" data-action="set-tab" data-tab="${esc(item.tab)}" data-simple-nav="${esc(item.id)}"><span aria-hidden="true">${esc(item.icon)}</span><strong>${esc(item.label)}</strong></button>`;
  }

  function removeSimpleChrome() {
    document.body.classList.remove('hc-simple-ready');
    document.querySelector('.hc-simple-mobile-nav')?.remove();
    document.querySelector('.hc-simple-sidebar')?.remove();
    state.moreOverlay?.remove();
    state.moreOverlay = null;
    state.planOverlay?.remove();
    state.planOverlay = null;
    const topButton = document.querySelector('.app-topbar [data-simple-action="open-more"]');
    if (topButton) {
      topButton.removeAttribute('data-simple-action');
      topButton.setAttribute('data-action', 'open-sheet');
    }
  }

  function installNavigation() {
    const layout = document.querySelector('.app-layout');
    const topbar = document.querySelector('.app-topbar');
    if (!layout || !topbar || !state.user) return;
    document.body.classList.add('hc-simple-ready');

    const items = primaryItems();
    let mobile = document.querySelector('.hc-simple-mobile-nav');
    if (!mobile || mobile.dataset.role !== state.user.role) {
      mobile?.remove();
      mobile = document.createElement('nav');
      mobile.className = 'hc-simple-mobile-nav';
      mobile.dataset.role = state.user.role;
      mobile.setAttribute('aria-label', 'Navigazione principale semplificata');
      mobile.innerHTML = items.map((item) => navButton(item, true)).join('');
      document.body.appendChild(mobile);
    }

    let sidebar = layout.querySelector('.hc-simple-sidebar');
    if (!sidebar || sidebar.dataset.role !== state.user.role) {
      sidebar?.remove();
      sidebar = document.createElement('aside');
      sidebar.className = 'hc-simple-sidebar';
      sidebar.dataset.role = state.user.role;
      sidebar.innerHTML = `<div class="hc-simple-sidebar-title"><span class="eyebrow">Navigazione</span><strong>${state.user.role === 'client' ? 'La tua area' : 'Gestione Home Care'}</strong></div><div class="hc-simple-sidebar-menu">${items.map((item) => navButton(item)).join('')}</div><div class="hc-simple-sidebar-spacer"></div><button class="hc-simple-nav-button" type="button" data-install-app hidden><span aria-hidden="true">⇩</span><strong>Installa app</strong></button><button class="hc-simple-nav-button danger" type="button" data-action="logout"><span aria-hidden="true">↪</span><strong>Esci</strong></button>`;
      layout.insertBefore(sidebar, layout.firstChild);
    }

    const oldMore = topbar.querySelector('[data-action="open-sheet"]');
    if (oldMore) {
      oldMore.removeAttribute('data-action');
      oldMore.setAttribute('data-simple-action', 'open-more');
      oldMore.setAttribute('aria-label', 'Apri altre funzioni');
    }
    syncNavActive();
  }

  function syncNavActive() {
    const tab = currentTab();
    const items = primaryItems();
    const activeItem = items.find((item) => item.active.includes(tab)) || items.find((item) => item.tab === tab);
    document.querySelectorAll('[data-simple-nav]').forEach((button) => {
      button.classList.toggle('active', button.dataset.simpleNav === activeItem?.id);
    });
  }

  function groupButton(tab, label, icon = '') {
    return `<button class="hc-simple-more-link" type="button" data-action="set-tab" data-tab="${esc(tab)}"><span aria-hidden="true">${esc(icon || '›')}</span><strong>${esc(label)}</strong></button>`;
  }

  function moreGroups() {
    if (state.user?.role === 'client') {
      return [
        { title: 'Servizio', links: [
          groupButton('payments', 'Piano, pagamenti e preventivi', '€'),
          groupButton('contacts', 'Contatti Home Care', '☎'),
        ] },
      ];
    }
    if (state.user?.role === 'helper') {
      return [
        { title: 'Lavoro di oggi', links: [groupButton('tasks', 'Attività', '☑'), groupButton('route', 'Organizza il giro', '➜')] },
        { title: 'Archivio', links: [groupButton('properties', 'Tutti gli immobili', '⌂'), groupButton('reports', 'Report completati', '▤')] },
      ];
    }
    return [
      { title: 'Operatività', links: [groupButton('reports', 'Report e bozze', '▤'), groupButton('tasks', 'Attività', '☑'), groupButton('route', 'Organizza il giro', '➜')] },
      { title: 'Gestione clienti', links: [groupButton('requests', 'Richieste immobili', '⌛'), groupButton('properties', 'Tutti gli immobili', '⌂'), groupButton('payments', 'Pagamenti e preventivi', '€'), groupButton('custom_plans', 'Piani personalizzati', '◇')] },
      { title: 'Impostazioni', links: [groupButton('contacts', 'Contatti', '☎'), groupButton('plan_settings', 'Piani e listino', '≡'), groupButton('helpers', 'Aiutanti', '♟')] },
    ];
  }

  function ensureMoreOverlay() {
    if (state.moreOverlay) return state.moreOverlay;
    const overlay = document.createElement('div');
    overlay.className = 'hc-simple-overlay hc-simple-more-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `<aside class="hc-simple-sheet" role="dialog" aria-modal="true" aria-label="Altre funzioni"><div class="hc-simple-sheet-handle" aria-hidden="true"></div><header><div><span class="eyebrow">Home Care</span><h2>Altre funzioni</h2><p>${esc(state.user?.email || '')}</p></div><button class="button light icon compact" type="button" data-simple-action="close-more" aria-label="Chiudi">×</button></header><div class="hc-simple-more-groups">${moreGroups().map((group) => `<section><h3>${esc(group.title)}</h3><div>${group.links.join('')}</div></section>`).join('')}</div><div class="hc-simple-sheet-footer"><button class="button light block" type="button" data-install-app hidden>⇩ Installa app</button><button class="button danger block" type="button" data-action="logout">Esci</button></div></aside>`;
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay || event.target.closest('[data-simple-action="close-more"]')) closeMore();
      if (event.target.closest('[data-action="set-tab"], [data-action="logout"]')) closeMore();
    });
    document.body.appendChild(overlay);
    state.moreOverlay = overlay;
    return overlay;
  }

  function openMore() {
    const overlay = ensureMoreOverlay();
    overlay.hidden = false;
    document.body.classList.add('hc-simple-overlay-open');
    window.requestAnimationFrame(() => overlay.classList.add('open'));
  }

  function closeMore() {
    if (!state.moreOverlay) return;
    state.moreOverlay.classList.remove('open');
    document.body.classList.remove('hc-simple-overlay-open');
    window.setTimeout(() => { if (state.moreOverlay) state.moreOverlay.hidden = true; }, 190);
  }

  function planCard(plan, selected) {
    const featured = plan.id === 'comfort';
    return `<label class="hc-simple-plan-card ${featured ? 'featured' : ''} ${selected === plan.id ? 'selected' : ''}"><input type="radio" name="simple_plan" value="${esc(plan.id)}" ${selected === plan.id ? 'checked' : ''}><span class="hc-simple-plan-head"><strong>${esc(plan.label)}</strong>${featured ? '<em>Più scelto</em>' : ''}</span><span class="hc-simple-plan-price">${esc(plan.price_label || money(plan.price_cents))}</span><ul>${(plan.features || []).slice(0, 5).map((feature) => `<li>${esc(feature)}</li>`).join('')}</ul></label>`;
  }

  async function openPlanGate() {
    if (state.user?.role !== 'client') return;
    const data = await clientData();
    if (data.customer.current_package_type) {
      state.planOverlay?.remove();
      state.planOverlay = null;
      return;
    }
    const selected = localStorage.getItem('hc_selected_plan') || (data.properties?.[0]?.package_type || 'comfort');
    const overlay = document.createElement('div');
    overlay.className = 'hc-simple-overlay hc-simple-plan-overlay open';
    overlay.innerHTML = `<section class="hc-simple-plan-gate" role="dialog" aria-modal="true" aria-labelledby="hcPlanGateTitle"><div class="brand-lockup"><span class="brand-mark">HC</span><span>Home Care</span></div><span class="eyebrow">Primo passo</span><h1 id="hcPlanGateTitle">Scegli il servizio per la tua casa</h1><p class="hc-simple-lead">Prima di entrare nell’area personale scegli il piano più adatto. Subito dopo potrai inserire l’immobile e inviare la richiesta.</p><form data-simple-form="plan-selection"><div class="hc-simple-plan-grid">${(data.plans || state.config?.plans || []).map((plan) => planCard(plan, selected)).join('')}</div><div class="hc-simple-plan-actions"><button class="button gold block" type="submit">Conferma il piano e continua</button><button class="button light block" type="button" data-action="logout">Esci dall’account</button></div></form><p class="help">Il piano personalizzato e gli importi definitivi vengono sempre confermati da Home Care prima del pagamento.</p></section>`;
    state.planOverlay?.remove();
    state.planOverlay = overlay;
    document.body.appendChild(overlay);
    document.body.classList.add('hc-simple-plan-required', 'hc-simple-overlay-open');
  }

  function closePlanGate() {
    state.planOverlay?.remove();
    state.planOverlay = null;
    document.body.classList.remove('hc-simple-plan-required', 'hc-simple-overlay-open');
  }

  function clickTab(tab) {
    const button = document.querySelector(`[data-action="set-tab"][data-tab="${CSS.escape(tab)}"]`);
    if (button) button.click();
    else {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      window.location.assign(url.href);
    }
  }

  function insertAfterHeader(node) {
    const main = document.getElementById('main');
    const header = main?.querySelector('.page-header');
    if (!main || !node) return;
    if (header) header.insertAdjacentElement('afterend', node);
    else main.prepend(node);
  }

  function groupTabs(kind) {
    const tab = currentTab();
    const groups = {
      today: [
        ['checks', 'Controlli'], ['tasks', 'Attività'], ['route', 'Giro'], ['reports', 'Report'],
      ],
      clients: state.user?.role === 'admin'
        ? [['customers', 'Clienti'], ['properties', 'Immobili'], ['requests', 'Richieste'], ['custom_plans', 'Piani'], ['payments', 'Pagamenti']]
        : [['customers', 'Clienti'], ['properties', 'Immobili']],
    };
    const rows = groups[kind] || [];
    const nav = document.createElement('nav');
    nav.className = 'hc-simple-segmented';
    nav.dataset.simplePageMarker = `segments-${kind}`;
    nav.setAttribute('aria-label', kind === 'today' ? 'Operatività' : 'Gestione clienti');
    nav.innerHTML = rows.map(([target, label]) => `<button type="button" data-action="set-tab" data-tab="${target}" class="${tab === target ? 'active' : ''}">${esc(label)}</button>`).join('');
    return nav;
  }

  function wrapCollapsible(node, label, open = false) {
    if (!node || node.closest('.hc-simple-collapsible')) return null;
    const details = document.createElement('details');
    details.className = 'hc-simple-collapsible';
    details.open = open;
    details.innerHTML = `<summary><span>＋</span><strong>${esc(label)}</strong><small>Tocca per aprire</small></summary>`;
    node.before(details);
    details.appendChild(node);
    return details;
  }

  function addSearch(main, label = 'Cerca') {
    if (!main || main.querySelector('[data-simple-search]')) return;
    const cards = Array.from(main.querySelectorAll('.data-card, .report-card'));
    if (cards.length < 3) return;
    const box = document.createElement('div');
    box.className = 'hc-simple-search';
    box.innerHTML = `<label><span class="sr-only">${esc(label)}</span><span aria-hidden="true">⌕</span><input type="search" data-simple-search placeholder="${esc(label)}…" autocomplete="off"></label><small>${cards.length} elementi</small>`;
    const firstList = main.querySelector('.data-list, .section-stack');
    if (firstList) firstList.insertAdjacentElement('beforebegin', box);
    else insertAfterHeader(box);
  }

  function addAdminDashboardActions(main, summary) {
    if (main.querySelector('[data-simple-page-marker="admin-home"]')) return;
    const section = document.createElement('section');
    section.className = 'hc-simple-next-action';
    section.dataset.simplePageMarker = 'admin-home';
    const actions = [];
    if (Number(summary.pendingProperties || 0) > 0) actions.push(['requests', `${summary.pendingProperties} richieste da verificare`, 'Approva piano, prezzo e immobile', 'gold']);
    if (Number(summary.dueChecks || 0) > 0) actions.push(['checks', `${summary.dueChecks} controlli da fare`, 'Apri la lista e inizia il prossimo controllo', 'success']);
    if (Number(summary.todoTasks || 0) > 0) actions.push(['tasks', `${summary.todoTasks} attività da completare`, 'Controlla le scadenze operative', 'primary']);
    if (!actions.length) actions.push(['checks', 'Nessuna urgenza', 'Tutto aggiornato. Puoi consultare i prossimi controlli.', 'teal']);
    section.innerHTML = `<div class="hc-simple-section-heading"><span class="eyebrow">Da fare adesso</span><h2>Le priorità, senza cercarle nei menu</h2></div><div class="hc-simple-action-grid">${actions.map(([tab, title, subtitle, style], index) => `<button class="hc-simple-action-card ${style} ${index === 0 ? 'primary-action' : ''}" type="button" data-action="set-tab" data-tab="${tab}"><strong>${esc(title)}</strong><span>${esc(subtitle)}</span><em>Apri →</em></button>`).join('')}</div>`;
    insertAfterHeader(section);
  }

  function clientNextAction(data) {
    const properties = data.properties || [];
    const approved = properties.filter((property) => property.active && property.request_status === 'approved');
    const pending = properties.filter((property) => property.request_status === 'pending');
    const unpaidExtra = (data.payments || []).filter((payment) => payment.status === 'pending');
    if (!properties.length) return {
      tab: 'properties', title: 'Aggiungi la tua casa', text: 'Il piano è scelto. Inserisci ora indirizzo e informazioni dell’immobile.', button: 'Inserisci immobile', style: 'gold',
    };
    if (pending.length) return {
      tab: 'properties', title: 'Richiesta in verifica', text: `${pending[0].name} è stata inviata a Home Care. Ti avviseremo appena sarà approvata.`, button: 'Vedi la richiesta', style: 'teal',
    };
    if (approved.length && !data.customer.payment_valid) return {
      tab: 'payments', title: 'Attiva il servizio', text: 'L’immobile è approvato. Completa il pagamento mensile o annuale.', button: 'Vai al pagamento', style: 'gold',
    };
    if (unpaidExtra.length) return {
      tab: 'payments', title: 'Hai un preventivo da controllare', text: `${unpaidExtra.length} pagamento${unpaidExtra.length === 1 ? '' : 'i'} in attesa.`, button: 'Apri preventivi', style: 'gold',
    };
    if ((data.reports || []).length) return {
      tab: 'reports', title: 'Ultimo report disponibile', text: `Apri il controllo più recente di ${data.reports[0].property_name}.`, button: 'Apri report', style: 'teal',
    };
    return {
      tab: 'properties', title: 'Il servizio è attivo', text: 'Qui trovi stato della casa, prossima visita e periodi di occupazione.', button: 'Vedi la mia casa', style: 'success',
    };
  }

  function enhanceClientHome(main, data) {
    if (main.querySelector('[data-simple-page-marker="client-home"]')) return;
    const next = clientNextAction(data);
    const section = document.createElement('section');
    section.className = `hc-simple-next-action ${next.style}`;
    section.dataset.simplePageMarker = 'client-home';
    section.innerHTML = `<div><span class="eyebrow">Il prossimo passo</span><h2>${esc(next.title)}</h2><p>${esc(next.text)}</p></div><button class="button ${next.style === 'gold' ? 'gold' : next.style === 'success' ? 'success' : 'teal'}" type="button" data-action="set-tab" data-tab="${esc(next.tab)}">${esc(next.button)}</button>`;
    insertAfterHeader(section);
    const stats = main.querySelector('.stat-grid');
    if (stats) wrapCollapsible(stats, 'Riepilogo completo del servizio', false);
    const planPayment = main.querySelector('.plan-payment');
    if (planPayment && data.customer.payment_valid) wrapCollapsible(planPayment, 'Piano e pagamenti', false);
  }

  function enhanceClientProperties(main, data) {
    if (main.querySelector('[data-simple-page-marker="client-properties"]')) return;
    const marker = document.createElement('section');
    marker.className = 'hc-simple-plan-summary';
    marker.dataset.simplePageMarker = 'client-properties';
    const plan = (data.plans || []).find((item) => item.id === data.customer.current_package_type);
    marker.innerHTML = `<div><span class="eyebrow">Piano scelto</span><strong>${esc(plan?.label || data.customer.current_package_type || 'Da scegliere')}</strong><small>${esc(plan?.price_label || '')}</small></div><button class="button light compact" type="button" data-action="set-tab" data-tab="payments">Piano e pagamenti</button>`;
    insertAfterHeader(marker);

    const sections = Array.from(main.querySelectorAll(':scope > section.card'));
    const formSection = sections.find((section) => section.querySelector('[data-form="client-property"]'));
    const listSection = sections.find((section) => section !== formSection && section.querySelector('.data-list, .empty-state'));
    const shouldOpen = !data.properties.length || localStorage.getItem('hc_open_property_form') === '1';
    const details = wrapCollapsible(formSection, 'Aggiungi un nuovo immobile', shouldOpen);
    if (details && listSection) details.before(listSection);
    if (shouldOpen) localStorage.removeItem('hc_open_property_form');
    const select = formSection?.querySelector('[name="package_type"]');
    if (select && data.customer.current_package_type) select.value = data.customer.current_package_type;
    addSearch(main, 'Cerca tra le tue case');
  }

  function enhanceAdminGroupedPage(main, group) {
    if (!main.querySelector(`[data-simple-page-marker="segments-${group}"]`)) insertAfterHeader(groupTabs(group));
  }

  function enhanceFormsAndLists(main, tab) {
    if (tab === 'customers') {
      const forms = main.querySelector(':scope > .split-grid');
      wrapCollapsible(forms, 'Aggiungi cliente o registra un pagamento', false);
      const list = Array.from(main.querySelectorAll(':scope > section.card')).find((section) => section.querySelector('.data-list'));
      const details = forms?.closest('.hc-simple-collapsible');
      if (list && details) details.before(list);
      addSearch(main, 'Cerca cliente');
    }
    if (tab === 'properties') {
      const form = Array.from(main.querySelectorAll(':scope > section.card')).find((section) => section.querySelector('[data-form="admin-property"]'));
      wrapCollapsible(form, 'Aggiungi immobile manualmente', false);
      const list = Array.from(main.querySelectorAll(':scope > section.card')).find((section) => section !== form && section.querySelector('.data-list'));
      const details = form?.closest('.hc-simple-collapsible');
      if (list && details) details.before(list);
      addSearch(main, 'Cerca immobile o cliente');
    }
    if (tab === 'tasks') {
      const form = Array.from(main.querySelectorAll(':scope > section.card')).find((section) => section.querySelector('[data-form="task"]'));
      wrapCollapsible(form, 'Aggiungi una nuova attività', false);
    }
    if (['reports', 'messages', 'requests', 'payments', 'custom_plans'].includes(tab)) {
      addSearch(main, tab === 'messages' ? 'Cerca cliente o messaggio' : 'Cerca');
    }
  }

  async function enhanceClient(main, tab) {
    const data = await clientData();
    if (!data.customer.current_package_type) {
      await openPlanGate();
      return;
    }
    closePlanGate();
    if (tab === 'home') enhanceClientHome(main, data);
    if (tab === 'properties') enhanceClientProperties(main, data);
    if (tab === 'reports') addSearch(main, 'Cerca report o immobile');
  }

  async function enhanceAdmin(main, tab) {
    if (tab === 'dashboard' && !main.querySelector('[data-simple-page-marker="admin-home"]')) {
      addAdminDashboardActions(main, await request('/api/admin/summary'));
      const stats = main.querySelector('.stat-grid');
      if (stats) wrapCollapsible(stats, 'Tutti i numeri della gestione', false);
    }
    if (['checks', 'tasks', 'route', 'reports'].includes(tab)) enhanceAdminGroupedPage(main, 'today');
    if (['customers', 'properties', 'requests', 'custom_plans', 'payments'].includes(tab)) enhanceAdminGroupedPage(main, 'clients');
    enhanceFormsAndLists(main, tab);
  }

  async function enhance() {
    if (state.enhancing) return;
    state.enhancing = true;
    try {
      const shell = document.querySelector('.app-topbar');
      if (!shell) {
        removeSimpleChrome();
        state.user = null;
        state.clientData = null;
        return;
      }
      const user = await ensureUser();
      if (!user) return;
      installNavigation();
      const main = document.getElementById('main');
      if (!main || main.querySelector('.boot-screen')) return;
      const tab = currentTab();
      if (user.role === 'client') await enhanceClient(main, tab);
      else await enhanceAdmin(main, tab);
      syncNavActive();
    } catch (error) {
      if (error.status !== 401) console.warn('Simple UI V44:', error);
    } finally {
      state.enhancing = false;
    }
  }

  function scheduleEnhance() {
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(enhance, 110);
  }

  async function savePlan(form) {
    const selected = form.querySelector('[name="simple_plan"]:checked')?.value;
    if (!selected) throw new Error('Scegli un piano per continuare.');
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      const response = await request('/api/client/plan-selection', {
        method: 'POST',
        body: { package_type: selected },
      });
      localStorage.setItem('hc_selected_plan', response.plan.id);
      localStorage.setItem('hc_open_property_form', '1');
      state.clientData = await request('/api/client/dashboard');
      closePlanGate();
      toast(`Piano ${response.plan.label} scelto. Ora inserisci la tua casa.`, 'success');
      clickTab('properties');
    } finally {
      if (button?.isConnected) button.disabled = false;
    }
  }

  document.addEventListener('click', (event) => {
    const simple = event.target.closest('[data-simple-action]');
    if (simple) {
      const action = simple.dataset.simpleAction;
      if (action === 'open-more') {
        event.preventDefault();
        event.stopPropagation();
        openMore();
        return;
      }
      if (action === 'close-more') {
        event.preventDefault();
        closeMore();
        return;
      }
    }
    if (event.target.closest('.hc-simple-more-overlay [data-action="set-tab"], .hc-simple-more-overlay [data-action="logout"]')) closeMore();
  }, true);

  document.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-simple-form="plan-selection"]');
    if (!form) return;
    event.preventDefault();
    event.stopPropagation();
    savePlan(form).catch((error) => toast(error.message || 'Piano non salvato.', 'danger'));
  }, true);

  document.addEventListener('input', (event) => {
    const input = event.target.closest('[data-simple-search]');
    if (!input) return;
    const main = input.closest('#main');
    const query = input.value.trim().toLocaleLowerCase('it-IT');
    const cards = Array.from(main?.querySelectorAll('.data-card, .report-card') || []);
    let visible = 0;
    cards.forEach((card) => {
      const match = !query || card.textContent.toLocaleLowerCase('it-IT').includes(query);
      card.hidden = !match;
      if (match) visible += 1;
    });
    const counter = input.closest('.hc-simple-search')?.querySelector('small');
    if (counter) counter.textContent = `${visible} elementi`;
  });

  document.addEventListener('change', (event) => {
    const radio = event.target.closest('.hc-simple-plan-card input[type="radio"]');
    if (!radio) return;
    document.querySelectorAll('.hc-simple-plan-card').forEach((card) => card.classList.toggle('selected', card.contains(radio)));
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.moreOverlay && !state.moreOverlay.hidden) closeMore();
  });

  function start() {
    state.observer = new MutationObserver(scheduleEnhance);
    state.observer.observe(root || document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', scheduleEnhance);
    scheduleEnhance();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}());
