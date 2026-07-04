const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const indexPath = path.join(publicDir, 'index.html');
const INSTALL_SCRIPT_VERSION = 31;

let html = fs.readFileSync(indexPath, 'utf8');

try {
  const source = path.join(publicDir, 'icon-192.png');
  const target = path.join(publicDir, 'apple-touch-icon.png');
  if (fs.existsSync(source)) fs.copyFileSync(source, target);
} catch (_) {}

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

ensureHeadTag('rel="icon" type="image/png" sizes="192x192"', '<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">');
ensureHeadTag('rel="icon" type="image/png" sizes="512x512"', '<link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png">');
ensureHeadTag('rel="apple-touch-icon"', '<link rel="apple-touch-icon" sizes="192x192" href="/apple-touch-icon.png">');
ensureHeadTag('name="mobile-web-app-capable"', '<meta name="mobile-web-app-capable" content="yes">');
ensureHeadTag('name="apple-mobile-web-app-capable"', '<meta name="apple-mobile-web-app-capable" content="yes">');
ensureHeadTag('name="apple-mobile-web-app-status-bar-style"', '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">');
ensureHeadTag('name="apple-mobile-web-app-title"', '<meta name="apple-mobile-web-app-title" content="Home Care">');
ensureHeadTag('name="application-name"', '<meta name="application-name" content="Home Care">');
ensureHeadTag(
  '__homeCarePwaPrompt',
  '<script>window.__homeCarePwaPrompt=null;window.addEventListener("beforeinstallprompt",function(event){event.preventDefault();window.__homeCarePwaPrompt=event;try{window.dispatchEvent(new Event("homecarebeforeinstallprompt"))}catch(e){}});</script>'
);

html = html.replace(/<button class="btn light small hc-install-direct"[^>]*>Installa app<\/button>\s*/g, '');
html = html.replace(/<button data-install-app class="btn light small"[^>]*>Installa app<\/button>\s*/g, '');
html = html.replace(/<button class="btn light small" onclick="installApp\(\)">Installa app<\/button>\s*/g, '');

const originalBoot = "async function boot(){try{S.config=await api('/api/config',{headers:{}})}catch(e){}if(!S.token)return publicHome();try{S.user=(await api('/api/auth/me')).user;shell()}catch(e){localStorage.removeItem('hc_token');publicHome(e.message)}}";
const previousSafeBoot = "async function boot(){app.innerHTML='<main class=\"wrap\"><div class=\"card\"><h2>Caricamento Home Care...</h2><p class=\"muted\">Preparazione app in corso.</p></div></main>';const startupToken=S.token;const withTimeout=(promise,ms,message)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(message)),ms))]);try{S.config=await withTimeout(api('/api/config',{headers:{}}),6000,'Configurazione temporaneamente non raggiungibile')}catch(e){}if(!startupToken)return publicHome();try{S.user=(await withTimeout(api('/api/auth/me'),8000,'Sessione non verificata. Accedi di nuovo.')).user;shell()}catch(e){localStorage.removeItem('hc_token');S.token=null;publicHome(e.message||'Sessione scaduta. Accedi di nuovo.')}}";
const safeBoot = "async function boot(){const startupToken=S.token;const withTimeout=(promise,ms,message)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(message)),ms))]);if(!startupToken){publicHome();api('/api/config',{headers:{}}).then(c=>{S.config=c}).catch(()=>{});return}app.innerHTML='<main class=\"wrap\"><div class=\"card\"><h2>Caricamento Home Care...</h2><p class=\"muted\">Preparazione area riservata in corso.</p></div></main>';try{S.config=await withTimeout(api('/api/config',{headers:{}}),5000,'Configurazione temporaneamente non raggiungibile')}catch(e){}try{S.user=(await withTimeout(api('/api/auth/me'),8000,'Sessione non verificata. Accedi di nuovo.')).user;shell()}catch(e){localStorage.removeItem('hc_token');S.token=null;publicHome(e.message||'Sessione scaduta. Accedi di nuovo.')}}";
if (html.includes(originalBoot)) html = html.replace(originalBoot, safeBoot);
else if (html.includes(previousSafeBoot)) html = html.replace(previousSafeBoot, safeBoot);

const installScript = `<script src="/install-app.js?v=${INSTALL_SCRIPT_VERSION}"></script>`;
if (!html.includes('/install-app.js')) {
  html = html.replace('</body></html>', `${installScript}</body></html>`);
} else {
  html = html.replace(/<script src="\/install-app\.js(?:\?v=\d+)?"><\/script>/g, installScript);
}

fs.writeFileSync(indexPath, html);
console.log('Patch installazione PWA applicata: pulsante installa, prompt nativo prioritario, fallback Android/Samsung, iOS, pagina pubblica immediata e protezione anti-schermo-bianco.');
