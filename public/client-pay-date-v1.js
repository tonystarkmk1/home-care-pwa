(function(){
  const monthlyServices = [
    { id:'aerazione', label:'Aerazione ambienti', price:10 },
    { id:'posta', label:'Ritiro posta o piccole consegne', price:15 },
    { id:'contatori', label:'Lettura contatori', price:5 },
    { id:'report_dettagliato', label:'Report fotografico dettagliato', price:10 },
    { id:'priorita', label:'Priorità nella pianificazione degli interventi', price:20 },
    { id:'esterni', label:'Verifica visiva cancelli, recinzioni e illuminazione esterna', price:15 },
    { id:'irrigazione', label:'Verifica visiva irrigazione, ove accessibile', price:25 }
  ];

  const oneTimeServices = [
    { id:'preparazione_arrivo', label:'Preparazione casa prima dell’arrivo, con almeno 15 giorni di preavviso', priceLabel:'da 35 €' },
    { id:'apertura_tecnici', label:'Apertura casa per tecnici e supervisione durante i lavori', priceLabel:'70 €' }
  ];

  function fmtDate(value){
    if(!value) return '-';
    const text = String(value);
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    const date = new Date(text);
    if(Number.isNaN(date.getTime())) return text;
    return date.toLocaleDateString('it-IT');
  }

  function formatVisibleDates(root){
    const node = root || document.getElementById('main') || document.body;
    if(!node) return;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const toChange = [];
    while(walker.nextNode()) {
      const current = walker.currentNode;
      if(/\d{4}-\d{2}-\d{2}/.test(current.nodeValue || '')) toChange.push(current);
    }
    toChange.forEach((textNode)=>{
      textNode.nodeValue = textNode.nodeValue.replace(/(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)?/g, '$3/$2/$1');
    });
  }

  function fixedPlans(){
    const keys = ['base','comfort','premium','villa_giardino','personalizzato'];
    return keys.filter((key)=>typeof P !== 'undefined' && P[key]);
  }

  function normalizePlan(plan){
    if(plan === 'localita_limitrofe') return 'personalizzato';
    return fixedPlans().includes(plan) ? plan : 'base';
  }

  function planSelectHtml(current){
    const selected = normalizePlan(current || 'base');
    return `<select id="clientPlanSelect">${fixedPlans().map((key)=>`<option value="${key}" ${selected===key?'selected':''}>${P[key]} - ${PRICE[key] || ''}</option>`).join('')}</select>`;
  }

  function customMonthlyTotal(){
    const box = document.getElementById('clientCustomPlanBox');
    if(!box) return 39;
    let total = 39;
    const controls = Math.max(0, Number(box.querySelector('[name="renew_extra_controls"]')?.value || 0));
    total += controls * 20;
    box.querySelectorAll('[name="renew_monthly"]:checked').forEach((input)=>{
      const service = monthlyServices.find((item)=>item.id===input.value);
      if(service) total += service.price;
    });
    return total;
  }

  function customPlanPanel(){
    return `<div id="clientCustomPlanBox" class="notice" style="display:none;margin-top:12px">
      <h3>Configura il piano Personalizzato</h3>
      <p>Base obbligatorio: <b>39 €/mese</b>, con 1 controllo mensile incluso.</p>
      <label>Controlli aggiuntivi al mese</label>
      <input name="renew_extra_controls" type="number" min="0" step="1" value="0">
      <small class="muted">Ogni controllo aggiuntivo: +20 €/mese</small>
      <h4>Servizi mensili aggiuntivi</h4>
      ${monthlyServices.map((s)=>`<label><input type="checkbox" name="renew_monthly" value="${s.id}" style="width:auto"> ${s.label} <b>+${s.price} €/mese</b></label>`).join('')}
      <h4>Servizi extra su richiesta</h4>
      ${oneTimeServices.map((s)=>`<label><input type="checkbox" name="renew_extra" value="${s.id}" style="width:auto"> ${s.label} <b>${s.priceLabel}</b></label>`).join('')}
      <div class="notice success"><b>Totale mensile indicativo: <span id="renewCustomTotal">39 €/mese</span></b><br><span class="muted">Il totale serve per riattivare il piano personalizzato. Home Care può sempre verificare e confermare eventuali extra.</span></div>
    </div>`;
  }

  function selectedCustomSummary(){
    const box = document.getElementById('clientCustomPlanBox');
    if(!box) return null;
    const controls = Math.max(0, Number(box.querySelector('[name="renew_extra_controls"]')?.value || 0));
    const monthly = [];
    if(controls>0) monthly.push(`${controls} controllo/i aggiuntivo/i mensile/i (+${controls*20} €/mese)`);
    box.querySelectorAll('[name="renew_monthly"]:checked').forEach((input)=>{
      const service = monthlyServices.find((item)=>item.id===input.value);
      if(service) monthly.push(`${service.label} (+${service.price} €/mese)`);
    });
    const extras = [];
    box.querySelectorAll('[name="renew_extra"]:checked').forEach((input)=>{
      const service = oneTimeServices.find((item)=>item.id===input.value);
      if(service) extras.push(`${service.label} (${service.priceLabel})`);
    });
    return { monthlyTotal: customMonthlyTotal(), monthly, extras };
  }

  function updateRenewCustomPanel(){
    const select = document.getElementById('clientPlanSelect');
    const box = document.getElementById('clientCustomPlanBox');
    const total = document.getElementById('renewCustomTotal');
    if(!select || !box) return;
    box.style.display = select.value === 'personalizzato' ? 'block' : 'none';
    if(total) total.textContent = customMonthlyTotal() + ' €/mese';
  }

  function planPaymentBox(d){
    const rawCurrent = d.customer?.current_package_type || 'base';
    const current = normalizePlan(rawCurrent);
    const paid = Boolean(d.customer?.payment_valid);
    const currentName = P[current] || P[rawCurrent] || 'Base';
    return `<div class="card" style="margin-top:14px"><h2>${paid?'Gestisci piano':'Riattiva il servizio'}</h2>${paid?`<div class="notice success"><b>Piano attivo: ${currentName}</b><br>Puoi cambiare piano o rinnovare scegliendo una delle opzioni qui sotto.</div>`:`<div class="notice error"><b>Piano scaduto / da riattivare: ${currentName}</b><br>Il servizio resta sospeso finché il pagamento non viene riattivato. Puoi pagare subito il piano scaduto oppure scegliere un nuovo piano.</div>`}<label>Piano da pagare / attivare</label>${planSelectHtml(current)}${customPlanPanel()}<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn gold" onclick="payClientPlan('monthly')">Paga mensile</button><button class="btn teal" onclick="payClientPlan('annual')">Paga annuale</button></div><p class="muted">Il pagamento mensile attiva o riattiva l’abbonamento. Il pagamento annuale calcola 12 mensilità.</p></div>`;
  }

  window.payClientPlan = async function(billing){
    try {
      const select = document.getElementById('clientPlanSelect');
      const package_type = select ? select.value : undefined;
      const body = { billing, package_type };
      if(package_type === 'personalizzato') {
        const summary = selectedCustomSummary();
        body.custom_monthly_price_euro = summary ? summary.monthlyTotal : 39;
        body.custom_summary = summary ? `Piano Personalizzato\nTotale mensile: ${summary.monthlyTotal} €/mese\nServizi mensili:\n${summary.monthly.length ? summary.monthly.map(x=>'• '+x).join('\n') : '• Nessun servizio aggiuntivo'}\nExtra:\n${summary.extras.length ? summary.extras.map(x=>'• '+x).join('\n') : '• Nessun extra'}` : '';
      }
      const result = await api('/api/client/plan-checkout', {
        method:'POST',
        body: JSON.stringify(body)
      });
      if(result.url) location.href = result.url;
      else alert('Link pagamento non disponibile.');
    } catch(error) {
      alert(error.message || 'Errore pagamento');
    }
  };

  window.applyClientPayDateV1 = function(){
    try {
      window.fmtDateIT = fmtDate;

      window.reportHtml = reportHtml = function(r){
        let photos=[];
        try{photos=Array.isArray(r.photo_urls)?r.photo_urls:JSON.parse(r.photo_urls||'[]')}catch(e){}
        let checklist=[];
        try{checklist=Array.isArray(r.checklist_json)?r.checklist_json:JSON.parse(r.checklist_json||'[]')}catch(e){}
        return `<div class="notice"><b>${esc(r.property_name)}</b> · ${fmtDate(r.completed_at)}<p>${esc(r.notes||'')}</p>${checklist.length?`<ul class="clean">${checklist.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}<div class="photos">${photos.map(u=>`<a href="${u}" target="_blank"><img src="${u}"></a>`).join('')}</div></div>`;
      };

      window.clientHome = clientHome = function(d){
        const latest=d.reports.slice(0,3),pending=d.payments.filter(p=>p.status==='pending'),upcoming=d.properties.filter(p=>p.active).slice(0,5);
        document.getElementById('main').innerHTML=`<div class="grid"><div class="card"><h3>Stato</h3><span class="badge ${d.customer?.payment_valid?'ok':'bad'}">${d.customer?.payment_valid?'Pagamento regolare':'Pagamento non regolare'}</span><p>Piano cliente: <b>${P[normalizePlan(d.customer?.current_package_type)]||'Non ancora attivo'}</b></p></div><div class="card"><h3>Prossime scadenze</h3>${upcoming.length?upcoming.map(p=>`<p><b>${esc(p.name)}</b><br>Prossimo controllo: ${fmtDate(p.next_check_date)}</p>`).join(''):'<p>Nessun controllo pianificato.</p>'}</div><div class="card"><h3>Preventivi / extra da pagare</h3>${pending.length?pending.map(p=>`<p><b>${money(p.amount_cents)}</b><br>${esc(p.description)}${p.payment_url?`<br><a class="btn small gold" target="_blank" href="${p.payment_url}">Paga ora</a>`:''}</p>`).join(''):'<p>Nessun pagamento extra in sospeso.</p>'}</div></div>${planPaymentBox(d)}<div class="card" style="margin-top:14px"><h2>Ultimi report</h2>${latest.length?latest.map(reportHtml).join(''):'<p>Nessun report disponibile.</p>'}</div>`;
        setupRenewEvents();
        formatVisibleDates();
      };

      window.clientPayments = clientPayments = function(d){
        const rows = d.payments.length ? `<table><thead><tr><th>Descrizione</th><th>Importo</th><th>Stato</th><th></th></tr></thead><tbody>${d.payments.map(p=>`<tr><td>${esc(p.description)}</td><td>${money(p.amount_cents)}</td><td><span class="badge ${p.status==='paid'?'ok':p.status==='canceled'?'bad':'warn'}">${p.status==='pending'?'Da pagare':p.status==='paid'?'Pagato':p.status}</span></td><td>${p.status==='pending'&&p.payment_url?`<a class="btn small gold" target="_blank" href="${p.payment_url}">Paga ora</a>`:''}</td></tr>`).join('')}</tbody></table>` : '<p>Nessun preventivo o extra.</p>';
        document.getElementById('main').innerHTML=`${planPaymentBox(d)}<div class="card" style="margin-top:14px"><h2>Pagamenti / Preventivi manutenzione</h2>${rows}</div>`;
        setupRenewEvents();
        formatVisibleDates();
      };

      function setupRenewEvents(){
        const select = document.getElementById('clientPlanSelect');
        if(select) select.addEventListener('change', updateRenewCustomPanel);
        document.querySelectorAll('#clientCustomPlanBox input').forEach((input)=>input.addEventListener('input', updateRenewCustomPanel));
        updateRenewCustomPanel();
      }

      const originalClientProperties = window.clientProperties || clientProperties;
      window.clientProperties = clientProperties = function(d){
        originalClientProperties(d);
        formatVisibleDates();
      };

      const originalAdminReports = window.adminReports || adminReports;
      if(typeof originalAdminReports === 'function') {
        window.adminReports = adminReports = async function(){
          await originalAdminReports();
          formatVisibleDates();
        };
      }
    } catch(error) {
      console.warn('ClientPayDate V1 non applicato:', error);
    }
  };
})();
