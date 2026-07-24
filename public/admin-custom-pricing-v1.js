(function(){
  const SERVICE_CATALOG = [
    { id:'controllo_extra', label:'Controllo aggiuntivo mensile', price:20 },
    { id:'aerazione', label:'Aerazione ambienti', price:10 },
    { id:'posta', label:'Ritiro posta o piccole consegne', price:15 },
    { id:'contatori', label:'Lettura contatori', price:5 },
    { id:'report_dettagliato', label:'Report fotografico dettagliato', price:10 },
    { id:'priorita', label:'Priorità nella pianificazione interventi', price:20 },
    { id:'esterni', label:'Verifica aree esterne, cancelli e recinzioni', price:15 },
    { id:'irrigazione', label:'Verifica irrigazione ove accessibile', price:25 },
    { id:'giardino', label:'Cura ordinaria giardino', price:80 },
    { id:'preparazione_arrivo', label:'Preparazione casa prima dell’arrivo', price:35 }
  ];

  function euro(value){
    return new Intl.NumberFormat('it-IT', { style:'currency', currency:'EUR' }).format(Number(value || 0));
  }

  function centsToEuro(cents){
    return (Number(cents || 0) / 100).toFixed(2).replace('.', ',');
  }

  function parseEuro(value){
    const n = Number(String(value || '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function customerOptions(selected){
    return (S.customers || []).map((customer)=>`<option value="${customer.id}" ${selected===customer.id?'selected':''}>${esc(customer.name)}${customer.email?' · '+esc(customer.email):''}</option>`).join('');
  }

  function propertyOptions(customerId, selected){
    const rows = (S.properties || []).filter((property)=>!customerId || property.customer_id === customerId);
    return '<option value="">Nessun immobile specifico</option>' + rows.map((property)=>`<option value="${property.id}" ${selected===property.id?'selected':''}>${esc(property.customer_name || '')} · ${esc(property.name)} · ${esc(property.address || '')}</option>`).join('');
  }

  function selectedServices(form){
    return SERVICE_CATALOG.filter((service)=>form.querySelector(`[name="svc_${service.id}"]`)?.checked).map((service)=>{
      const price = parseEuro(form.querySelector(`[name="price_${service.id}"]`)?.value || service.price);
      return { id: service.id, label: service.label, price_euro: price };
    });
  }

  function calculateCustomPlan(form){
    const base = parseEuro(form.base_price_euro?.value || 0);
    const extraControls = Math.max(0, Number(form.extra_controls?.value || 0));
    const extraControlPrice = parseEuro(form.extra_control_price_euro?.value || 0);
    const services = selectedServices(form);
    const servicesTotal = services.reduce((sum, service)=>sum + Number(service.price_euro || 0), 0) + (extraControls * extraControlPrice);
    const subtotal = base + servicesTotal;
    const discountType = form.discount_type?.value || 'none';
    const discountRaw = parseEuro(form.discount_value?.value || 0);
    let discount = 0;
    if(discountType === 'percent') discount = subtotal * Math.min(discountRaw, 100) / 100;
    if(discountType === 'amount') discount = discountRaw;
    discount = Math.min(discount, subtotal);
    const override = parseEuro(form.final_price_euro?.value || 0);
    const final = override > 0 ? override : Math.max(0, subtotal - discount);
    return { base, extraControls, extraControlPrice, services, servicesTotal, subtotal, discountType, discountRaw, discount, final, override };
  }

  function updateCustomPlanPreview(){
    const form = document.getElementById('adminCustomPlanForm');
    if(!form) return;
    const calc = calculateCustomPlan(form);
    const box = document.getElementById('customPlanPreview');
    if(!box) return;
    const lines = [];
    lines.push(`<b>Base mensile:</b> ${euro(calc.base)}`);
    if(calc.extraControls > 0) lines.push(`<b>Controlli aggiuntivi:</b> ${calc.extraControls} × ${euro(calc.extraControlPrice)} = ${euro(calc.extraControls * calc.extraControlPrice)}`);
    if(calc.services.length) lines.push(`<b>Servizi selezionati:</b><br>${calc.services.map((service)=>`• ${esc(service.label)}: ${euro(service.price_euro)}`).join('<br>')}`);
    else lines.push('<b>Servizi selezionati:</b> nessuno');
    lines.push(`<b>Totale prima dello sconto:</b> ${euro(calc.subtotal)}`);
    if(calc.discount > 0) lines.push(`<b>Sconto:</b> -${euro(calc.discount)}${calc.discountType==='percent'?' ('+calc.discountRaw+'%)':''}`);
    if(calc.override > 0) lines.push('<b>Prezzo finale impostato manualmente</b>');
    lines.push(`<b style="font-size:20px">Prezzo finale mensile: ${euro(calc.final)}</b>`);
    box.innerHTML = lines.join('<br>');
  }

  function installCustomPricingStyles(){
    if(document.getElementById('admin-custom-pricing-styles')) return;
    const style = document.createElement('style');
    style.id = 'admin-custom-pricing-styles';
    style.textContent = `.custom-service-row{display:grid;grid-template-columns:1fr 130px;gap:10px;align-items:center;border:1px solid var(--line);border-radius:14px;padding:10px;margin:8px 0;background:#fffdf7}.custom-service-row label{margin:0}.custom-service-row input[type=number]{padding:9px}.custom-total-preview{border-left:5px solid var(--gold);background:#fff8e8;border-radius:14px;padding:12px;margin:14px 0;line-height:1.55}.custom-plan-status{display:inline-flex;border-radius:999px;padding:5px 9px;font-size:12px;font-weight:900}.custom-plan-status.active{background:#e4f6eb;color:#176b35}.custom-plan-status.draft{background:#fff4d6;color:#8a5d00}.custom-plan-status.archived{background:#fee4e2;color:#9a1d13}@media(max-width:860px){.custom-service-row{grid-template-columns:1fr}}`;
    document.head.appendChild(style);
  }

  function customPlanFormHtml(){
    const firstCustomer = S.customers?.[0]?.id || '';
    return `<div class="card"><h2>Crea piano personalizzato cliente</h2><p class="muted">Costruisci un piano su misura, applica uno sconto oppure imposta direttamente il prezzo finale mensile. Se lo attivi, il cliente vedrà il piano Personalizzato e potrà pagare l’importo confermato.</p><form id="adminCustomPlanForm"><label>Cliente</label><select name="customer_id" id="customPlanCustomer" required>${customerOptions(firstCustomer)}</select><label>Immobile collegato</label><select name="property_id" id="customPlanProperty">${propertyOptions(firstCustomer)}</select><label>Nome piano</label><input name="title" value="Piano personalizzato Home Care" required><div class="row"><div class="col4"><label>Base mensile</label><input name="base_price_euro" type="number" min="0" step="0.01" value="39"></div><div class="col4"><label>Controlli aggiuntivi/mese</label><input name="extra_controls" type="number" min="0" step="1" value="0"></div><div class="col4"><label>Prezzo per controllo extra</label><input name="extra_control_price_euro" type="number" min="0" step="0.01" value="20"></div></div><h3>Servizi mensili</h3>${SERVICE_CATALOG.filter((service)=>service.id!=='controllo_extra').map((service)=>`<div class="custom-service-row"><label><input type="checkbox" name="svc_${service.id}" style="width:auto"> ${esc(service.label)}</label><input name="price_${service.id}" type="number" min="0" step="0.01" value="${service.price}"></div>`).join('')}<h3>Sconto o prezzo finale</h3><div class="row"><div class="col4"><label>Tipo sconto</label><select name="discount_type"><option value="none">Nessuno</option><option value="amount">Sconto in €</option><option value="percent">Sconto in %</option></select></div><div class="col4"><label>Valore sconto</label><input name="discount_value" type="number" min="0" step="0.01" value="0"></div><div class="col4"><label>Prezzo finale mensile</label><input name="final_price_euro" type="number" min="0" step="0.01" placeholder="Lascia vuoto per calcolo automatico"></div></div><label>Note interne / riepilogo per cliente</label><textarea name="notes" placeholder="Es. prezzo concordato per servizi selezionati dal cliente"></textarea><div id="customPlanPreview" class="custom-total-preview"></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" name="action" value="draft">Salva bozza</button><button class="btn green" name="action" value="activate">Salva e attiva al cliente</button></div></form></div>`;
  }

  function customPlansTable(plans){
    if(!plans.length) return '<p>Nessun piano personalizzato creato.</p>';
    return `<table><thead><tr><th>Cliente</th><th>Piano</th><th>Immobile</th><th>Prezzo</th><th>Stato</th><th></th></tr></thead><tbody>${plans.map((plan)=>`<tr><td><b>${esc(plan.customer_name || '')}</b><br>${esc(plan.customer_email || '')}</td><td><b>${esc(plan.title)}</b><br><span class="muted">${esc(plan.notes || '')}</span></td><td>${esc(plan.property_name || '-')}</td><td><b>${money(plan.final_price_cents)}</b>/mese<br><span class="muted">Totale: ${money(plan.subtotal_cents)}${plan.discount_value_cents || plan.discount_percent ? ' · sconto applicato' : ''}</span></td><td><span class="custom-plan-status ${esc(plan.status)}">${plan.status === 'active' ? 'Attivo' : plan.status === 'archived' ? 'Archiviato' : 'Bozza'}</span></td><td>${plan.status !== 'active' ? `<button class="btn small green" onclick="activateCustomPlan('${plan.id}')">Attiva</button>` : ''}${plan.status !== 'archived' ? ` <button class="btn small red" onclick="archiveCustomPlan('${plan.id}')">Archivia</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
  }

  window.adminCustomPricing = async function(){
    installCustomPricingStyles();
    await loadBase();
    const response = await api('/api/admin/customer-custom-plans');
    document.getElementById('main').innerHTML = `<div class="row"><div class="col4">${customPlanFormHtml()}</div><div class="col8"><div class="card"><h2>Piani personalizzati creati</h2>${customPlansTable(response.plans || [])}</div></div></div>`;
    const form = document.getElementById('adminCustomPlanForm');
    const customerSelect = document.getElementById('customPlanCustomer');
    const propertySelect = document.getElementById('customPlanProperty');
    if(customerSelect && propertySelect) {
      customerSelect.addEventListener('change', ()=>{ propertySelect.innerHTML = propertyOptions(customerSelect.value); });
    }
    form.querySelectorAll('input,select,textarea').forEach((element)=>element.addEventListener('input', updateCustomPlanPreview));
    form.querySelectorAll('select').forEach((element)=>element.addEventListener('change', updateCustomPlanPreview));
    updateCustomPlanPreview();
    form.onsubmit = async function(event){
      event.preventDefault();
      const calc = calculateCustomPlan(form);
      const payload = Object.fromEntries(new FormData(form));
      payload.activate = event.submitter?.value === 'activate';
      payload.services = calc.services;
      payload.extra_controls = calc.extraControls;
      payload.extra_control_price_euro = calc.extraControlPrice;
      payload.subtotal_euro = calc.subtotal;
      payload.final_price_euro = calc.final;
      payload.discount_type = calc.discountType;
      payload.discount_value = calc.discountRaw;
      await api('/api/admin/customer-custom-plans', { method:'POST', body: JSON.stringify(payload) });
      alert(payload.activate ? 'Piano personalizzato salvato e attivato al cliente.' : 'Bozza piano personalizzato salvata.');
      adminCustomPricing();
    };
  };

  window.activateCustomPlan = async function(id){
    await api('/api/admin/customer-custom-plans/' + id + '/activate', { method:'POST', body:'{}' });
    alert('Piano personalizzato attivato.');
    adminCustomPricing();
  };

  window.archiveCustomPlan = async function(id){
    if(!confirm('Archiviare questo piano personalizzato?')) return;
    await api('/api/admin/customer-custom-plans/' + id + '/archive', { method:'POST', body:'{}' });
    adminCustomPricing();
  };

  window.applyAdminCustomPricingV1 = function(){
    installCustomPricingStyles();
    window.adminShell = adminShell = async function(){
      const adminItems = [
        {id:'dashboard',label:'Dashboard'},
        {id:'requests',label:'Richieste immobili'},
        {id:'customers',label:'Clienti'},
        {id:'properties',label:'Immobili/GPS'},
        {id:'checks',label:'Controlli'},
        {id:'reports',label:'Report'},
        {id:'tasks',label:'Cose da fare'},
        {id:'route',label:'Giro'}
      ];
      if(S.user.role === 'admin') {
        adminItems.push({id:'payments',label:'Pagamenti'});
        adminItems.push({id:'messages',label:'Messaggi'});
        if(typeof adminContacts === 'function') adminItems.push({id:'contacts',label:'Contatti'});
        adminItems.push({id:'custom_pricing',label:'Piani cliente'});
        if(typeof adminPlanSettings === 'function') adminItems.push({id:'plan_settings',label:'Piani / Listino'});
        adminItems.push({id:'helpers',label:'Aiutanti'});
      }
      app.innerHTML=topPrivate()+`<div class="layout">${side(adminItems,S.tab,'adminSet')}<main class="main" id="main">Caricamento...</main></div>`;
      await loadBase();
      const routes = { dashboard:adminDashboard, requests:adminRequests, customers:adminCustomers, properties:adminProperties, checks:adminChecks, reports:adminReports, tasks:adminTasks, route:adminRoute, payments:adminPayments, messages:adminMessages, custom_pricing:adminCustomPricing, helpers:adminHelpers };
      if(typeof adminContacts === 'function') routes.contacts = adminContacts;
      if(typeof adminPlanSettings === 'function') routes.plan_settings = adminPlanSettings;
      (routes[S.tab] || adminDashboard)();
    };
  };
})();
