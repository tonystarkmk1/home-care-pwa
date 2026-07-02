const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'public', 'index.html');

try {
  try { require('./generate-pwa-png-icons.js'); } catch (e) { console.warn('PWA icons skipped:', e.message); }

  let html = fs.readFileSync(indexPath, 'utf8');

  if (!html.includes('apple-mobile-web-app-capable')) {
    const meta = [
      '<link rel="manifest" href="/manifest.json">',
      '<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">',
      '<link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png">',
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
      '<meta name="mobile-web-app-capable" content="yes">',
      '<meta name="apple-mobile-web-app-capable" content="yes">',
      '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
      '<meta name="apple-mobile-web-app-title" content="Home Care">',
      '<meta name="application-name" content="Home Care">'
    ].join('\n  ');
    html = html.replace('<link rel="manifest" href="/manifest.json">', meta);
  }

  html = html.replace("class=\"btn ${id==='base'?'gold':'teal'}\"", "class=\"btn teal\"");

  if (!html.includes('/install-app.js')) {
    html = html.replace('</body></html>', '<script src="/install-app.js?v=5"></script></body></html>');
  }

  fs.writeFileSync(indexPath, html);
  console.log('Safe UI startup patch applied.');
} catch (e) {
  console.warn('Safe UI startup patch skipped:', e.message);
}
