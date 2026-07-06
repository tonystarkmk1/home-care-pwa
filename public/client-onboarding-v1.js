(function(){
  const ONBOARDING_SCRIPT_VERSION = 2;

  function customerHasAnyProperty(data){
    return Array.isArray(data?.properties) && data.properties.length > 0;
  }

  function customerHasActiveProperty(data){
    return Array.isArray(data?.properties) && data.properties.some((property)=>property.active === true || property.request_status === 'approved');
  }

  function customerHasPendingProperty(data){
    return Array.isArray(data?.properties) && data.properties.some((property)=>property.request_status === 'pending');
  }

  function renderWhatWeDo(){
    return `<div class="card">
      <h2>Cosa facciamo per la tua casa</h2>
      <div class="grid">
        <div><h3>Controlli periodici</h3><p>Verifichiamo accessi, porte, finestre e condizioni generali dell’immobile quando sei lontano.</p></div>
        <div><h3>Report fotografici</h3><p>Dopo ogni controllo ricevi un riepilogo chiaro con foto e note operative.</p></div>
        <div><h3>Gestione richieste</h3><p>Puoi inviare richieste, comunicare con Home Care e aggiungere immobili da affidare al servizio.</p></div>
      </div>
    </div>`;
  }

  function renderHowItWorks(){
    return `<div class="card">
      <h2>Come funziona</h2>
      <ul class="clean">
        <li>Scegli il piano più adatto alla tua casa.</li>
        <li>Inserisci i dati dell’immobile e invia la richiesta.</li>
        <li>Home Care verifica la richiesta e ti conferma l’attivazione.</li>
        <li>Dopo l’approvazione gestisci report, chat e pagamenti dall’area cliente.</li>
      </ul>
    </div>`;
  }

  function renderClientOnboarding(data){
    const name = S.user?.name ? `, ${esc(S.user.name)}` : '';
    const selected = localStorage.getItem('hc_selected_package');
    document.getElementById('main').innerHTML = `<section class="hero" style="padding-top:0">
      <div>
        <span class="pill">Benvenuto${name}</span>
        <h1>Scegli il servizio e inoltra la richiesta</h1>
        <p>Scegli il piano più adatto alla tua casa, inserisci i dati dell’immobile e invia la richiesta. Home Care verificherà tutto e ti confermerà l’attivazione del servizio.</p>
        <div>
          <button class="btn gold" onclick="document.getElementById('client-plans')?.scrollIntoView({behavior:'smooth'})">Vedi i piani</button>
          <button class="btn light" onclick="clientSet('properties')">Inserisci immobile</button>
        </div>
      </div>
      ${renderHowItWorks()}
    </section>
    ${renderWhatWeDo()}
    <section id="client-plans" style="margin-top:14px">
      <h2>Scegli un piano</h2>
      <p class="muted">Seleziona un piano: nella schermata successiva inserirai i dati dell’immobile e invierai la richiesta a Home Care.</p>
      ${planCards()}
    </section>`;

    if (selected) {
      const plan = document.querySelector(`#client-plans .plan button[onclick="selectService('${selected}')"]`);
      if (plan) setTimeout(()=>plan.scrollIntoView({ behavior:'smooth', block:'center' }), 200);
    }
  }

  function renderPendingRequestHome(data){
    const pending = (data.properties || []).filter((property)=>property.request_status === 'pending');
    document.getElementById('main').innerHTML = `<div class="card">
      <h2>Richiesta inviata</h2>
      <p>Abbiamo ricevuto la tua richiesta. Home Care controllerà i dati dell’immobile e ti risponderà per confermare il servizio.</p>
      ${pending.length ? `<table><thead><tr><th>Immobile</th><th>Servizio richiesto</th><th>Stato</th></tr></thead><tbody>${pending.map((property)=>`<tr><td><b>${esc(property.name)}</b><br>${esc(property.address || '')}<br>${esc(property.city || '')}</td><td>${P[property.package_type] || property.package_type || '-'}</td><td><span class="badge warn">In verifica</span></td></tr>`).join('')}</tbody></table>` : ''}
      <p class="muted">Il pagamento e i controlli operativi partiranno dopo l’approvazione della richiesta.</p>
      <button class="btn teal" onclick="clientSet('properties')">Aggiungi un altro immobile</button>
    </div>
    <div style="margin-top:14px">${renderWhatWeDo()}</div>`;
  }

  function installClientOnboardingStyles(){
    if(document.getElementById('homecare-client-onboarding-styles')) return;
    const style = document.createElement('style');
    style.id = 'homecare-client-onboarding-styles';
    style.textContent = `.main .hero .card{align-self:stretch}.main #client-plans{margin-top:16px}.main #client-plans h2{margin-bottom:6px}.main #client-plans .grid{margin-top:14px}.main #client-plans .plan button{width:100%}@media(max-width:860px){.main .hero{gap:14px}.main #client-plans{padding-bottom:24px}}`;
    document.head.appendChild(style);
  }

  function patchClientShell(){
    if (typeof clientHome !== 'function' || typeof clientProperties !== 'function') return;
    const originalClientHome = clientHome;
    const originalClientProperties = clientProperties;

    window.clientHome = clientHome = function(data){
      installClientOnboardingStyles();
      if(!customerHasAnyProperty(data)) return renderClientOnboarding(data);
      if(!customerHasActiveProperty(data) && customerHasPendingProperty(data)) return renderPendingRequestHome(data);
      return originalClientHome(data);
    };

    window.clientProperties = clientProperties = function(data){
      installClientOnboardingStyles();
      originalClientProperties(data);
      const main = document.getElementById('main');
      if (!main) return;
      if (!customerHasAnyProperty(data)) {
        const title = main.querySelector('h2');
        if (title) title.textContent = 'Inserisci l’immobile e inoltra la richiesta';
        const form = document.getElementById('clientProp');
        if (form) {
          const intro = document.createElement('div');
          intro.className = 'notice';
          intro.innerHTML = '<b>Prima richiesta</b><br>Scegli il piano, inserisci l’immobile e invia la richiesta. Home Care la verificherà prima dell’attivazione.';
          form.parentElement.insertBefore(intro, form);
          const button = form.querySelector('button');
          if (button) button.textContent = 'Inoltra richiesta';
        }
      }
    };
  }

  window.applyClientOnboardingV1 = function(){
    installClientOnboardingStyles();
    patchClientShell();
  };
})();