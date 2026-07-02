const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'public', 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

// Meta tag per installazione PWA e iOS con icone PNG compatibili.
if (!html.includes('apple-mobile-web-app-capable')) {
  html = html.replace(
    '<link rel="manifest" href="/manifest.json">',
    '<link rel="manifest" href="/manifest.json">\n  <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">\n  <link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png">\n  <link rel="apple-touch-icon" href="/apple-touch-icon.png">\n  <meta name="mobile-web-app-capable" content="yes">\n  <meta name="apple-mobile-web-app-capable" content="yes">\n  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n  <meta name="apple-mobile-web-app-title" content="Home Care">\n  <meta name="application-name" content="Home Care">'
  );
}

// Funzione installazione: se l'app è già installata il pulsante viene nascosto.
if (!html.includes('function isHomeCareInstalled')) {
  const installCode = [
    'let deferredInstallPrompt=null;',
    "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();deferredInstallPrompt=e});",
    'function isHomeCareInstalled(){',
    "  const ua=navigator.userAgent||'';",
    "  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone===true || /HomeCareAndroid/i.test(ua) || (/; wv\)/i.test(ua)&&location.hostname.indexOf('homecarebadesi.com')>-1);",
    '}',
    'function installButtonStyle(){return isHomeCareInstalled()?\'style="display:none"\':\'\'}',
    'function hideInstallButtons(){if(isHomeCareInstalled())document.querySelectorAll(\'[data-install-app]\').forEach(function(b){b.style.display=\'none\'});}',
    "window.addEventListener('appinstalled',hideInstallButtons);",
    "document.addEventListener('DOMContentLoaded',hideInstallButtons);",
    'async function installApp(){',
    '  if(isHomeCareInstalled())return;',
    "  const ua=navigator.userAgent||'';",
    "  if(/Android/i.test(ua)){ location.href='/scarica-android.html'; return; }",
    '  if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;hideInstallButtons();return}',
    "  alert('Su iPhone apri il sito da Safari, premi Condividi e scegli Aggiungi a schermata Home.');",
    '}',
  ].join('\n') + '\n';
  html = html.replace('async function boot()', installCode + 'async function boot()');
}

// Se una versione precedente della funzione era già stata inserita, la riscriviamo.
html = html.replace(
  /async function installApp\(\)\{[\s\S]*?\n\}/,
  [
    'async function installApp(){',
    '  if(isHomeCareInstalled())return;',
    "  const ua=navigator.userAgent||'';",
    "  if(/Android/i.test(ua)){ location.href='/scarica-android.html'; return; }",
    '  if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;hideInstallButtons();return}',
    "  alert('Su iPhone apri il sito da Safari, premi Condividi e scegli Aggiungi a schermata Home.');",
    '}'
  ].join('\n')
);

// Colore unico per tutti i pulsanti “Richiedi questo servizio”.
html = html.replace("class=\"btn ${id==='base'?'gold':'teal'}\"", "class=\"btn teal\"");

// Rimuove eventuali vecchi pulsanti installa e aggiunge quelli nuovi, nascosti se già installata.
html = html.replace(/<button class="btn light small" onclick="installApp\(\)">Installa app<\/button>\s*/g, '');
html = html.replace(/<button data-install-app class="btn light small"[^>]*onclick="installApp\(\)">Installa app<\/button>\s*/g, '');

html = html.replace(
  '<button class="btn light small" onclick="authView(\'login\')">Accedi</button>',
  '<button data-install-app class="btn light small" ${installButtonStyle()} onclick="installApp()">Installa app</button> <button class="btn light small" onclick="authView(\'login\')">Accedi</button>'
);
html = html.replace(
  '<button class="btn light small" onclick="logout()">Esci</button>',
  '<button data-install-app class="btn light small" ${installButtonStyle()} onclick="installApp()">Installa app</button> <button class="btn light small" onclick="logout()">Esci</button>'
);

fs.writeFileSync(indexPath, html);
console.log('Installazione Android/PWA aggiornata: pulsante nascosto quando app già installata.');
