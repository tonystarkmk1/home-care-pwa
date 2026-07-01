const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, 'start-stripe.js');
const target = path.join(__dirname, '.start-stripe-fixed-runtime.js');
let code = fs.readFileSync(source, 'utf8');

// Dentro start-stripe.js viene generato codice runtime con una regex per togliere lo slash finale.
// Serve mantenere il backslash nella stringa generata, altrimenti il runtime vede // e rompe il JS.
code = code.split("replace(/\\/$/, '')").join("replace(/\\\\/$/, '')");

fs.writeFileSync(target, code);
require(target);
