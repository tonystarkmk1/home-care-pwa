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

  function monthlyTotalFromForm(form){
    let total = 39;
    const controls = Math.max(0, Number(form.querySelector('[name="custom_extra_controls"]')?.value || 0));
    total += controls * 20;
    form.querySelectorAll('[name="custom_monthly"]:checked').forEach((input)=>{
      const service = monthlyServices.find((item)=>item.id===input.value);
      if(service) total += service.price;
    });
    return total;
  }

  function customSummaryFromForm(form){
    const lines = [];
    const controls = Math.max(0, Number(form.querySelector('[name="custom_extra_controls"]')?.value || 0));
    if(controls>0) lines.push(`${controls} controllo/i aggiuntivo/i mensile/i (+${controls*20} €/mese)`);
    form.querySelectorAll('[name="custom_monthly"]:checked').forEach((input)=>{
      const service = monthlyServices.find((item)=>item.id===input.value);
      if(service) lines.push(`${service.label} (+${service.price} €/mese)`);
    });
    const extras = [];
    form.querySelectorAll('[name="custom_extra"]:checked').forEach((input)=>{
      const service = oneTimeServices.find((item)=>item.id===input.value);
      if(service) extras.push(`${service.label} (${service.priceLabel})`);
    });
    return { monthlyLines: lines, extras, monthlyTotal: monthlyTotalFromForm(form) };
  }

  function customPanel(){
    return `<div id="customPlanBox" class="notice" style="display:none">
      <h3>Piano Personalizzato</h3>
      <p>Parti dal servizio Base obbligatorio, che include 1 controllo mensile, e aggiungi solo i servizi che ti servono. Il prezzo finale verrà confermato da Home Care prima dell’attivazione.</p>
      <div class="card" style="box-shadow:none;margin:10px 0"><b>Base obbligatorio</b><br>1 controllo mensile incluso · <b>39 €/mese</b></div>
      <label>Controlli aggiuntivi al mese</label>
      <input name="custom_extra_controls" type="number" min="0" step="1" value="0">
      <small class="muted">Ogni controllo aggiuntivo: +20 €/mese</small>
      <h4>Servizi mensili aggiuntivi</h4>
      ${monthlyServices.map((s)=>`<label><input type="checkbox" name="custom_monthly" value="${s.id}" style="width:auto"> ${s.label} <b>+${s.price} €/mese</b></label>`).join('')}
      <h4>Servizi extra su richiesta</h4>
      ${oneTimeServices.map((s)=>`<label><input type="checkbox" name="custom_extra" value="${s.id}" style="width:auto"> ${s.label} <b>${s.priceLabel}</b></label>`).join('')}
      <div class="notice success"><b>Totale mensile indicativo: <span id="customMonthlyTotal">39 €/mese</span></b><br><span class="muted">Il totale è indicativo: Home Care confermerà il prezzo definitivo in fase di approvazione.</span></div>
    </div>`;
  }

  window.applyCustomPlanV1 = function(){
    try {
      if(typeof P !== 'undefined') {
        P.personalizzato = 'Personalizzato';
        P.localita_limitrofe = 'Personalizzato';
      }
      if(typeof PRICE !== 'undefined') {
        PRICE.personalizzato = 'da 39 €/mese';
        PRICE.localita_limitrofe = 'da 39 €/mese';
      }
      if(typeof PLAN_LIST !== 'undefined') {
        PLAN_LIST.splice(0, PLAN_LIST.length, 'base', 'comfort', 'premium', 'villa_giardino', 'personalizzato');
      }

      window.planCards = planCards = function(){
        const copy = {
          base:['1 controllo completo al mese','Verifica accessi, porte e finestre','Report fotografico dopo ogni visita'],
          comfort:['2 controlli completi al mese','Aerazione ambienti','Verifica visiva impianti accessibili','Ritiro posta o piccole consegne'],
          premium:['Controllo settimanale','Preparazione casa con 15 giorni di preavviso','Report fotografici dettagliati','Priorità nella pianificazione interventi'],
          villa_giardino:['Servizio Premium incluso','Cura ordinaria giardino','Aree esterne, cancelli e recinzioni'],
          personalizzato:['Base obbligatorio incluso','Scegli controlli aggiuntivi e servizi richiesti','Prezzo finale confermato da Home Care']
        };
        return `<div class="grid">${PLAN_LIST.map(id=>`<div class="card plan"><h3>${P[id]}</h3><div class="price">${PRICE[id]}</div><ul class="clean">${copy[id].map(x=>`<li>${x}</li>`).join('')}</ul><button class="btn teal" onclick="selectService('${id}')">Richiedi questo servizio</button></div>`).join('')}</div>`;
      };

      window.clientProperties = clientProperties = function(d){
        const selected=localStorage.getItem('hc_selected_package')||'base';
        document.getElementById('main').innerHTML=`<div class="card"><h2>Aggiungi immobile da affidare a Home Care</h2><form id="clientProp"><label>Nome immobile</label><input name="name" required placeholder="Casa al mare, Villetta, Appartamento"><label>Indirizzo completo</label><input name="address" required><div class="row"><div class="col6"><label>Comune</label><input name="city" value="Badesi"></div><div class="col6"><label>Zona / località</label><input name="zone"></div></div><label>Tipo immobile</label><select name="property_type"><option>Appartamento</option><option>Villetta</option><option>Villa con giardino</option><option>Altro</option></select><label>Servizio richiesto</label><select name="package_type" id="packageSelect">${PLAN_LIST.map(k=>`<option value="${k}" ${selected===k?'selected':''}>${P[k]} - ${PRICE[k]}</option>`).join('')}</select>${customPanel()}<label>Note utili</label><textarea name="notes"></textarea><button class="btn teal">Invia richiesta</button></form><div id="propMsg"></div></div><div class="card" style="margin-top:14px"><h2>I miei immobili</h2>${d.properties.length?`<table><thead><tr><th>Immobile</th><th>Indirizzo</th><th>Servizio</th><th>Stato</th><th>Prossimo controllo</th></tr></thead><tbody>${d.properties.map(p=>`<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.address)}<br>${esc(p.city)}</td><td>${P[p.package_type]||p.package_type}</td><td><span class="badge ${p.request_status==='pending'?'warn':p.active?'ok':'bad'}">${p.request_status==='pending'?'In attesa di verifica':p.active?'Attivo':'Non attivo'}</span></td><td>${p.next_check_date||'-'}</td></tr>`).join('')}</tbody></table>`:'<p>Nessun immobile inserito.</p>'}</div>`;
        const form=document.getElementById('clientProp');
        const select=document.getElementById('packageSelect');
        const customBox=document.getElementById('customPlanBox');
        function updateCustom(){
          if(customBox) customBox.style.display = select.value==='personalizzato' ? 'block' : 'none';
          const total=document.getElementById('customMonthlyTotal');
          if(total) total.textContent = monthlyTotalFromForm(form)+' €/mese';
        }
        select.addEventListener('change', updateCustom);
        form.querySelectorAll('[name="custom_extra_controls"],[name="custom_monthly"],[name="custom_extra"]').forEach(el=>el.addEventListener('input', updateCustom));
        updateCustom();
        form.onsubmit=async e=>{
          e.preventDefault();
          const box=document.getElementById('propMsg');
          const fd=new FormData(form);
          const data=Object.fromEntries(fd);
          if(data.package_type==='personalizzato'){
            const summary=customSummaryFromForm(form);
            const monthly = summary.monthlyLines.length ? summary.monthlyLines.map(x=>'• '+x).join('\n') : '• Nessun servizio aggiuntivo mensile';
            const extras = summary.extras.length ? summary.extras.map(x=>'• '+x).join('\n') : '• Nessun extra selezionato';
            data.notes = `${data.notes||''}\n\nRichiesta piano Personalizzato\nBase obbligatorio: 39 €/mese\nServizi mensili selezionati:\n${monthly}\nTotale mensile indicativo: ${summary.monthlyTotal} €/mese\nServizi extra richiesti:\n${extras}`.trim();
          }
          try{
            await api('/api/client/properties',{method:'POST',body:JSON.stringify(data)});
            localStorage.removeItem('hc_selected_package');
            box.innerHTML=note('Richiesta inviata. Home Care controllerà i dati e ti risponderà.','success');
            setTimeout(clientShell,800);
          }catch(x){box.innerHTML=note(x.message,'error')}
        };
      };

      window.adminRequests = adminRequests = async function(){
        const r=await api('/api/admin/property-requests');
        const priceMap={base:39,comfort:79,premium:199,villa_giardino:300,personalizzato:39,localita_limitrofe:39};
        function suggested(p){
          const text=String(p.client_notes||p.notes||'');
          const m=text.match(/Totale mensile indicativo:\s*(\d+(?:[,.]\d+)?)\s*€/i);
          if(m) return String(m[1]).replace(',','.');
          return priceMap[p.package_type]||39;
        }
        document.getElementById('main').innerHTML=`<div class="card"><h2>Richieste immobili da approvare</h2>${r.requests.length?`<table><thead><tr><th>Cliente</th><th>Immobile</th><th>Servizio richiesto</th><th>Prezzo mensile</th><th>Note</th><th></th></tr></thead><tbody>${r.requests.map(p=>`<tr><td>${esc(p.customer_name)}<br>${esc(p.customer_phone)}<br>${esc(p.customer_email)}</td><td><b>${esc(p.name)}</b><br>${esc(p.address)}<br>${esc(p.city)} ${esc(p.zone)}</td><td><select id="pkg-${p.id}">${PLAN_LIST.map(k=>`<option value="${k}" ${p.package_type===k?'selected':''}>${P[k]}</option>`).join('')}</select></td><td><input id="price-${p.id}" type="number" min="1" step="1" value="${suggested(p)}"><br><span class="muted">Puoi confermare o modificare il prezzo prima di approvare.</span></td><td style="white-space:pre-wrap">${esc(p.client_notes||p.notes||'')}</td><td><button class="btn small green" onclick="approveProp('${p.id}')">Approva</button></td></tr>`).join('')}</tbody></table>`:'<p>Nessuna richiesta in attesa.</p>'}</div>`;
      };

      window.approveProp = approveProp = async function(id){
        const package_type=document.getElementById('pkg-'+id)?.value;
        const monthly_price_euro=document.getElementById('price-'+id)?.value;
        await api(`/api/admin/properties/${id}/approve`,{method:'POST',body:JSON.stringify({package_type,monthly_price_euro})});
        alert('Immobile approvato');
        adminSet('requests');
      };
    } catch(e) {
      console.warn('Personalizzato V1 non applicato:', e);
    }
  };
})();
