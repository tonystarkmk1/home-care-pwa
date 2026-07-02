const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'public', 'index.html');

try {
  require('./generate-pwa-png-icons.js');
} catch (error) {
  console.warn('Icone PWA non generate:', error.message);
}

try {
  let html = fs.readFileSync(indexPath, 'utf8');

  if (!html.includes('apple-mobile-web-app-capable')) {
    html = html.replace(
      '<link rel="manifest" href="/manifest.json">',
      '<link rel="manifest" href="/manifest.json">\n  <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">\n  <link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png">\n  <link rel="apple-touch-icon" href="/apple-touch-icon.png">\n  <meta name="mobile-web-app-capable" content="yes">\n  <meta name="apple-mobile-web-app-capable" content="yes">\n  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n  <meta name="apple-mobile-web-app-title" content="Home Care">\n  <meta name="application-name" content="Home Care">'
    );
  }

  // Colore unico per tutti i pulsanti “Richiedi questo servizio”.
  html = html.replace("class=\"btn ${id==='base'?'gold':'teal'}\"", "class=\"btn teal\"");

  // Rimuove eventuali vecchie iniezioni del pulsante per evitare duplicati.
  html = html.replace(/<button class="btn light small hc-install-direct"[^>]*>Installa app<\/button>\s*/g, '');
  html = html.replace(/<button data-install-app class="btn light small"[^>]*>Installa app<\/button>\s*/g, '');
  html = html.replace(/<button class="btn light small" onclick="installApp\(\)">Installa app<\/button>\s*/g, '');

  const installBtn = '<button class="btn light small hc-install-direct" onclick="location.href=\'/scarica-android.html\'">Installa app</button> ';
  html = html.replace(
    '<button class="btn light small" onclick="authView(\'login\')">Accedi</button>',
    installBtn + '<button class="btn light small" onclick="authView(\'login\')">Accedi</button>'
  );
  html = html.replace(
    '<button class="btn light small" onclick="logout()">Esci</button>',
    installBtn + '<button class="btn light small" onclick="logout()">Esci</button>'
  );

  if (!html.includes('/install-app.js')) {
    html = html.replace('</body></html>', '<script src="/install-app.js?v=20"></script></body></html>');
  } else {
    html = html.replace(/\/install-app\.js\?v=\d+/g, '/install-app.js?v=20');
  }

  fs.writeFileSync(indexPath, html);
  console.log('Avvio stabile: pulsante installa diretto, icone PWA e colori applicati.');
} catch (error) {
  console.warn('Patch install app non applicata:', error.message);
}

require('../server3.js');
