const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const indexPath = path.join(publicDir, 'index.html');
const PWA_ASSET_VERSION = 32;
const INSTALL_SCRIPT_VERSION = 32;
const CLIENT_ONBOARDING_SCRIPT_VERSION = 1;

function runPatch(label, fn) {
  try {
    fn();
  } catch (error) {
    console.warn(`${label} non applicata:`, error.message);
  }
}

runPatch('Icone PWA', () => require('./generate-pwa-png-icons.js'));

runPatch('Icone launcher Home Care', () => {
  const copies = [
    ['icons/icon-192.png', 'icon-192.png'],
    ['icons/icon-512.png', 'icon-512.png'],
    ['icons/icon-180.png', 'apple-touch-icon.png'],
    ['apple-touch-icon.png', 'apple-touch-icon.png'],
    ['favicon.ico', 'favicon.ico']
  ];

  for (const [from, to] of copies) {
    const source = path.join(publicDir, from);
    const target = path.join(publicDir, to);
    if (fs.existsSync(source) && source !== target) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
  }
});

runPatch('Patch Personalizzato', () => require('./patch-custom-plan-v1.js'));
runPatch('Patch Contatti', () => require('./patch-contacts-v1.js'));
runPatch('Patch pagamenti piano/date', () => require('./patch-client-pay-date-v1.js'));
runPatch('Patch Piani/Listino', () => require('./patch-plan-settings-v1.js'));

runPatch('Patch installazione PWA e onboarding cliente', () => {
  let html = fs.readFileSync(indexPath, 'utf8');

  if (!html.includes('viewport-fit=cover')) {
    html = html.replace(
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<meta name="viewport" content="width=device-width,initial-scale=1, viewport-fit=cover">'
    );
  }

  function ensureHeadTag(uniqueText, tag) {
    if (!html.includes(uniqueText)) {
      html = html.replace('</head>', `  ${tag}\n</head>`);
    }
  }

  html = html.replace(/<link rel="manifest" href="\/manifest\.json(?:\?v=\d+)?">\s*/g, '');
  html = html.replace(/<link rel="shortcut icon"[^>]*>\s*/g, '');
  html = html.replace(/<link rel="icon"[^>]*>\s*/g, '');
  html = html.replace(/<link rel="apple-touch-icon"[^>]*>\s*/g, '');
  html = html.replace(/<meta name="msapplication-TileImage"[^>]*>\s*/g, '');
  html = html.replace(/<meta name="msapplication-TileColor"[^>]*>\s*/g, '');

  ensureHeadTag('rel="manifest"', `<link rel="manifest" href="/manifest.json?v=${PWA_ASSET_VERSION}">`);
  ensureHeadTag('rel="icon" type="image/svg+xml"', `<link rel="icon" type="image/svg+xml" href="/icon.svg?v=${PWA_ASSET_VERSION}">`);
  ensureHeadTag('rel="shortcut icon"', `<link rel="shortcut icon" href="/favicon.ico?v=${PWA_ASSET_VERSION}">`);
  ensureHeadTag('rel="icon" type="image/png" sizes="192x192"', `<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png?v=${PWA_ASSET_VERSION}">`);
  ensureHeadTag('rel="icon" type="image/png" sizes="512x512"', `<link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png?v=${PWA_ASSET_VERSION}">`);
  ensureHeadTag('rel="apple-touch-icon"', `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=${PWA_ASSET_VERSION}">`);
  ensureHeadTag('name="msapplication-TileImage"', `<meta name="msapplication-TileImage" content="/icon-192.png?v=${PWA_ASSET_VERSION}">`);
  ensureHeadTag('name="msapplication-TileColor"', '<meta name="msapplication-TileColor" content="#06243a">');
  ensureHeadTag('name="mobile-web-app-capable"', '<meta name="mobile-web-app-capable" content="yes">');
  ensureHeadTag('name="apple-mobile-web-app-capable"', '<meta name="apple-mobile-web-app-capable" content="yes">');
  ensureHeadTag('name="apple-mobile-web-app-status-bar-style"', '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">');
  ensureHeadTag('name="apple-mobile-web-app-title"', '<meta name="apple-mobile-web-app-title" content="Home Care">');
  ensureHeadTag('name="application-name"', '<meta name="application-name" content="Home Care">');
  ensureHeadTag(
    '__homeCarePwaPrompt',
    '<script>window.__homeCarePwaPrompt=null;window.addEventListener("beforeinstallprompt",function(event){event.preventDefault();window.__homeCarePwaPrompt=event;try{window.dispatchEvent(new Event("homecarebeforeinstallprompt"))}catch(e){}});</script>'
  );

  const clientOnboardingScript = `<script src="/client-onboarding-v1.js?v=${CLIENT_ONBOARDING_SCRIPT_VERSION}"></script>`;
  if (!html.includes('/client-onboarding-v1.js')) {
    html = html.replace('<script>\nconst app=', `${clientOnboardingScript}\n<script>\nconst app=`);
  } else {
    html = html.replace(/<script src="\/client-onboarding-v1\.js(?:\?v=\d+)?"><\/script>/g, clientOnboardingScript);
  }

  html = html.replace(/<button class="btn light small hc-install-direct"[^>]*>Installa app<\/button>\s*/g, '');
  html = html.replace(/<button data-install-app class="btn light small"[^>]*>Installa app<\/button>\s*/g, '');
  html = html.replace(/<button class="btn light small" onclick="installApp\(\)">Installa app<\/button>\s*/g, '');

  const originalBoot = "async function boot(){try{S.config=await api('/api/config',{headers:{}})}catch(e){}if(!S.token)return publicHome();try{S.user=(await api('/api/auth/me')).user;shell()}catch(e){localStorage.removeItem('hc_token');publicHome(e.message)}}";
  const previousSafeBoot = "async function boot(){app.innerHTML='<main class=\"wrap\"><div class=\"card\"><h2>Caricamento Home Care...</h2><p class=\"muted\">Preparazione app in corso.</p></div></main>';const startupToken=S.token;const withTimeout=(promise,ms,message)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(message)),ms))]);try{S.config=await withTimeout(api('/api/config',{headers:{}}),6000,'Configurazione temporaneamente non raggiungibile')}catch(e){}if(!startupToken)return publicHome();try{S.user=(await withTimeout(api('/api/auth/me'),8000,'Sessione non verificata. Accedi di nuovo.')).user;shell()}catch(e){localStorage.removeItem('hc_token');S.token=null;publicHome(e.message||'Sessione scaduta. Accedi di nuovo.')}}";
  const safeBoot = "async function boot(){const startupToken=S.token;const withTimeout=(promise,ms,message)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(message)),ms))]);if(!startupToken){publicHome();api('/api/config',{headers:{}}).then(c=>{S.config=c}).catch(()=>{});return}app.innerHTML='<main class=\"wrap\"><div class=\"card\"><h2>Caricamento Home Care...</h2><p class=\"muted\">Preparazione area riservata in corso.</p></div></main>';try{S.config=await withTimeout(api('/api/config',{headers:{}}),5000,'Configurazione temporaneamente non raggiungibile')}catch(e){}try{S.user=(await withTimeout(api('/api/auth/me'),8000,'Sessione non verificata. Accedi di nuovo.')).user;shell()}catch(e){localStorage.removeItem('hc_token');S.token=null;publicHome(e.message||'Sessione scaduta. Accedi di nuovo.')}}";
  if (html.includes(originalBoot)) {
    html = html.replace(originalBoot, safeBoot);
  } else if (html.includes(previousSafeBoot)) {
    html = html.replace(previousSafeBoot, safeBoot);
  }

  const applyScripts = 'if(window.applyPlanSettingsV1)window.applyPlanSettingsV1();if(window.applyClientOnboardingV1)window.applyClientOnboardingV1();boot();';
  html = html.replace(/if\(window\.applyPlanSettingsV1\)window\.applyPlanSettingsV1\(\);(?:if\(window\.applyClientOnboardingV1\)window\.applyClientOnboardingV1\(\);)?boot\(\);/g, applyScripts);
  if (!html.includes('window.applyClientOnboardingV1')) {
    html = html.replace('boot();', applyScripts);
  }

  const installScript = `<script src="/install-app.js?v=${INSTALL_SCRIPT_VERSION}"></script>`;
  if (!html.includes('/install-app.js')) {
    html = html.replace('</body></html>', `${installScript}</body></html>`);
  } else {
    html = html.replace(/<script src="\/install-app\.js(?:\?v=\d+)?"><\/script>/g, installScript);
  }

  fs.writeFileSync(indexPath, html);
  console.log('Avvio stabile: onboarding primo accesso cliente, icone launcher versionate, pulsante installa, prompt nativo prioritario, fallback Android/Samsung, iOS e protezione anti-schermo-bianco applicati.');
});

require('../server3.js');
