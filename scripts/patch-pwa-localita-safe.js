const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, 'patch-pwa-localita.js');
const target = path.join(__dirname, '.patch-pwa-localita-runtime.js');
let code = fs.readFileSync(source, 'utf8');
code = code.replace('}\nhtml = html.replace("class=\\"btn ${id===\'base\'?\'gold\':\'teal\'}\\"", "class=\\"btn teal\\"");', '}\nhtml = html.replace("class=\\"btn ${id===\'base\'?\'gold\':\'teal\'}\\"", "class=\\"btn teal\\"");');
fs.writeFileSync(target, code);
require(target);
