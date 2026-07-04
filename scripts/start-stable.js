const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const indexPath = path.join(publicDir, 'index.html');
const INSTALL_SCRIPT_VERSION = 26;

function runPatch(label, fn) {
  try {
    fn();
  } catch (error) {
    console.warn(`${label} non applicata:`, error.message);
  }
}

runPatch('Icone PWA', () => require('./generate-pwa-png-icons.js'));

runPatch('Apple touch icon PWA', () => {
  const source = path.join(publicDir, 'icon-192.png');
  const target = path.join(publicDir, 'apple-touch-icon.png');
  if (fs.existsSync(source)) fs.copyFileSync(source, target);
});

runPatch('Patch Personalizzato', () => require('./patch-custom-plan-v1.js'));
runPatch('Patch Contatti', () => require('./patch-contacts-v1.js'));
runPatch('Patch pagamenti piano/date', () => require('./patch-client-pay-date-v1.js'));
runPatch('Patch Piani/Listino', () => require('./patch-plan-settings-v1.js'));

runPatch('Patch installazione PWA', () => {
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

  ensureHeadTag('rel="icon" type="image/png" sizes="192x192"', '<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">');
  ensureHeadTag('rel="icon" type="image/png" sizes="512x512"', '<link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png">');
  ensureHeadTag('rel="apple-touch-icon"', '<link rel="apple-touch-icon" sizes="192x192" href="/apple-touch-icon.png">');
  ensureHeadTag('name="mobile-web-app-capable"', '<meta name="mobile-web-app-capable" content="yes">');
  ensureHeadTag('name="apple-mobile-web-app-capable"', '<meta name="apple-mobile-web-app-capable" content="yes">');
  ensureHeadTag('name="apple-mobile-web-app-status-bar-style"', '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">');
  ensureHeadTag('name="apple-mobile-web-app-title"', '<meta name="apple-mobile-web-app-title" content="Home Care">');
  ensureHeadTag('name="application-name"', '<meta name="application-name" content="Home Care">');

  // Colore unico per tutti i pulsanti “Richiedi questo servizio”.
  html = html.replace("class=\"btn ${id==='base'?'gold':'teal'}\"", 'class="btn teal"');

  // Rimuove tutte le vecchie iniezioni del pulsante, inclusa la vecchia scorciatoia APK.
  html = html.replace(/<button class="btn light small hc-install-direct"[^>]*>Installa app<\/button>\s*/g, '');
  html = html.replace(/<button data-install-app class="btn light small"[^>]*>Installa app<\/button>\s*/g, '');
  html = html.replace(/<button class="btn light small" onclick="installApp\(\)">Installa app<\/button>\s*/g, '');

  // Pulsante installa nella barra pubblica: install-app.js apre il prompt PWA nativo o le istruzioni iOS.
  const installBtn = '<button class="btn light small hc-install-direct" type="button" data-pwa-manual-install>Installa app</button> ';
  html = html.replace(
    '<button class="btn light small" onclick="authView(\'login\')">Accedi</button>',
    installBtn + '<button class="btn light small" onclick="authView(\'login\')">Accedi</button>'
  );

  const installScript = `<script src="/install-app.js?v=${INSTALL_SCRIPT_VERSION}"></script>`;
  if (!html.includes('/install-app.js')) {
    html = html.replace('</body></html>', `${installScript}</body></html>`);
  } else {
    html = html.replace(/<script src="\/install-app\.js(?:\?v=\d+)?"><\/script>/g, installScript);
  }

  fs.writeFileSync(indexPath, html);
  console.log('Avvio stabile: PWA installabile con prompt nativo, iOS, icone, personalizzato, contatti, pagamenti/date, piani/listino e colori applicati.');
});

require('../server3.js');
