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

// Funzione installazione: prova PWA nativa; su Android offre APK vero; su iPhone dà istruzioni.
if (!html.includes('let deferredInstallPrompt')) {
  const installCode = [
    'let deferredInstallPrompt=null;',
    "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();deferredInstallPrompt=e});",
    'async function installApp(){',
    '  if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;return}',
    "  const ua=navigator.userAgent||'';",
    "  if(/Android/i.test(ua)){ if(confirm('Vuoi scaricare la versione Android installabile di Home Care?')) location.href='/scarica-android.html'; return; }",
    "  alert('Su iPhone apri il sito da Safari, premi Condividi e scegli Aggiungi a schermata Home.');",
    '}',
  ].join('\n') + '\n';
  html = html.replace('async function boot()', installCode + 'async function boot()');
}

// Colore unico per tutti i pulsanti “Richiedi questo servizio”.
html = html.replace("class=\"btn ${id==='base'?'gold':'teal'}\"", "class=\"btn teal\"");

// Pulsante installa app nella barra pubblica e privata.
html = html.replace(
  '<button class="btn light small" onclick="authView(\'login\')">Accedi</button>',
  '<button class="btn light small" onclick="installApp()">Installa app</button> <button class="btn light small" onclick="authView(\'login\')">Accedi</button>'
);
html = html.replace(
  '<button class="btn light small" onclick="logout()">Esci</button>',
  '<button class="btn light small" onclick="installApp()">Installa app</button> <button class="btn light small" onclick="logout()">Esci</button>'
);

fs.writeFileSync(indexPath, html);
console.log('PWA/APK installabile con PNG e colore pulsanti piani aggiornati.');
