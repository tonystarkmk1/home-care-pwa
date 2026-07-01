const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'serve-v4.js');
let code = fs.readFileSync(file, 'utf8');
code = code.replace(/async function addNotification\([\s\S]*?\nfunction emailCard/, "async function addNotification(){return null}\nfunction emailCard");
fs.writeFileSync(file, code);
console.log('Notifiche runtime impostate in modalità email-only.');
