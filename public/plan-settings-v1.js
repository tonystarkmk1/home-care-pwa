(function(){
  let planSettingsPromise = null;
  window.PLAN_SETTINGS = window.PLAN_SETTINGS || [];
  window.PLAN_FEATURES = window.PLAN_FEATURES || {};

  function euroFromCents(cents){
    return ((Number(cents || 0) / 100).toFixed(2)).replace('.', ',');
  }

  function activePlanIds(plans){
    return plans.filter((p)=>p.active).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)).map((p)=>p.id);
  }

  async function loadPlanSettings(force){
    if(planSettingsPromise && !force) return planSettingsPromise;
    planSettingsPromise = fetch('/api/public/plan-settings?v=' + Date.now(), { cache:'no-store' })
      .then((r)=>r.ok?r.json():Promise.reject(new Error('Listino non disponibile')))
      .then((data)=>{
        const plans = Array.isArray(data.plans) ? data.plans : [];
        window.PLAN_SETTINGS = plans;
        const ids = activePlanIds(plans);
        if(typeof PLAN_LIST !== 'undefined' && ids.length) PLAN_LIST.splice(0, PLAN_LIST.length, ...ids);
        if(typeof P !== 'undefined') plans.forEach((plan)=>{ P[plan.id] = plan.label; });
        if(typeof PRICE !== 'undefined') plans.forEach((plan)=>{ PRICE[plan.id] = plan.price_label || euroFromCents(plan.price_cents) + '/mese'; });
        window.PLAN_FEATURES = {};
        plans.forEach((plan)=>{ window.PLAN_FEATURES[plan.id] = Array.isArray(plan.features) ? plan.features : []; });
        overridePlanCards();
        return plans;
      })
      .catch((error)=>{
        console.warn('Listino dinamico non caricato:', error.message);
        return [];
      });
    return planSettingsPromise;
  }

  function overridePlanCards(){
    window.planCards = planCards = function(){
      const ids = typeof PLAN_LIST !== 'undefined' ? PLAN_LIST : [];
      return `<div class="grid">${ids.map((id)=>{
        const features = (window.PLAN_FEATURES && window.PLAN_FEATURES[id] && window.PLAN_FEATURES[id].length) ? window.PLAN_FEATURES[id] : ['Servizio Home Care'];
        return `<div class="card plan"><h3>${P[id]||id}</h3><div class="price">${PRICE[id]||''}</div><ul class="clean">${features.map((x)=>`<li>${esc(x)}</li>`).join('')}</ul><button class="btn teal" onclick="selectService('${id}')">Richiedi questo servizio</button></div>`;
      }).join('')}</div>`;
    };
  }

  function featureTextarea(plan){
    return Array.isArray(plan.features) ? plan.features.join('\n') : '';
  }

  window.adminPlanSettings = async function(){
    const r = await api('/api/admin/plan-settings');
    const plans = r.plans || [];
    const cards = plans.map((plan)=>`<div class="card" style="margin-bottom:14px"><form id="plan-${plan.id}"><h3>${esc(plan.label)}</h3><div class="row"><div class="col4"><label>Nome piano</label><input name="label" value="${esc(plan.label)}" required></div><div class="col4"><label>Prezzo mensile</label><input name="price_euro" value="${euroFromCents(plan.price_cents)}" inputmode="decimal" required></div><div class="col4"><label>Etichetta prezzo pubblica</label><input name="price_label" value="${esc(plan.price_label||'')}" placeholder="es. da 300 €/mese"></div><div class="col3"><label>Ordine</label><input name="sort_order" type="number" value="${Number(plan.sort_order||0)}"></div><div class="col3"><label>Giorni tra controlli</label><input name="days" type="number" value="${Number(plan.days||30)}"></div><div class="col3"><label>Prezzo “da”</label><select name="from_price"><option value="false" ${plan.from_price?'':'selected'}>No</option><option value="true" ${plan.from_price?'selected':''}>Sì</option></select></div><div class="col3"><label>Visibile</label><select name="active"><option value="true" ${plan.active?'selected':''}>Sì</option><option value="false" ${plan.active?'':'selected'}>No</option></select></div></div><label>Servizi inclusi / descrizione, uno per riga</label><textarea name="features_text" style="min-height:150px">${esc(featureTextarea(plan))}</textarea><button type="button" class="btn green" onclick="savePlanSettings('${plan.id}')">Salva piano</button></form></div>`).join('');
    document.getElementById('main').innerHTML = `<div class="card"><h2>Piani e listino</h2><p class="muted">Da qui puoi modificare prezzi, nomi e servizi mostrati ai clienti. Le modifiche vengono usate anche nei pagamenti dei piani.</p></div>${cards}`;
  };

  window.savePlanSettings = async function(id){
    const form = document.getElementById('plan-' + id);
    if(!form) return;
    const data = Object.fromEntries(new FormData(form));
    data.active = data.active === 'true';
    data.from_price = data.from_price === 'true';
    await api('/api/admin/plan-settings/' + id, { method:'PATCH', body: JSON.stringify(data) });
    await loadPlanSettings(true);
    alert('Piano aggiornato');
    adminPlanSettings();
  };

  function installAdminShellOverride(){
    window.adminShell = adminShell = async function(){
      app.innerHTML=topPrivate()+`<div class="layout">${side([{id:'dashboard',label:'Dashboard'},{id:'requests',label:'Richieste immobili'},{id:'customers',label:'Clienti'},{id:'properties',label:'Immobili/GPS'},{id:'checks',label:'Controlli'},{id:'reports',label:'Report'},{id:'tasks',label:'Cose da fare'},{id:'route',label:'Giro'}].concat(S.user.role==='admin'?[{id:'payments',label:'Pagamenti'},{id:'messages',label:'Messaggi'},{id:'contacts',label:'Contatti'},{id:'plan_settings',label:'Piani / Listino'},{id:'helpers',label:'Aiutanti'}]:[]),S.tab,'adminSet')}<main class="main" id="main">Caricamento...</main></div>`;
      await loadBase();
      ({dashboard:adminDashboard,requests:adminRequests,customers:adminCustomers,properties:adminProperties,checks:adminChecks,reports:adminReports,tasks:adminTasks,route:adminRoute,payments:adminPayments,messages:adminMessages,contacts:adminContacts,plan_settings:adminPlanSettings,helpers:adminHelpers}[S.tab]||adminDashboard)();
    };
  }

  window.applyPlanSettingsV1 = function(){
    const originalBoot = boot;
    boot = async function(){
      await loadPlanSettings(true);
      installAdminShellOverride();
      return originalBoot();
    };
  };
})();
