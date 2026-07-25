'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const scriptsDir = __dirname;
const sourcePath = path.join(scriptsDir, 'apply-operations-v2.js');
const generatedPath = path.join(scriptsDir, '.apply-operations-v2.generated.js');
let source = fs.readFileSync(sourcePath, 'utf8');

// Il blocco dei test contiene template literal che devono essere copiati come
// testo nel file di test, non interpretati dal programma di migrazione.
const startToken = 'const testsAddition = String.raw`';
const endToken = "\n`;\nappendOnce('tests/app.test.js'";
const start = source.indexOf(startToken);
const bodyStart = start + startToken.length;
const end = source.indexOf(endToken, bodyStart);
if (start < 0 || end < 0) throw new Error('Blocco testsAddition non trovato nella patch');
const testBody = source.slice(bodyStart, end);
source = `${source.slice(0, start)}const testsAddition = ${JSON.stringify(testBody)};\nappendOnce('tests/app.test.js'${source.slice(end + endToken.length)}`;
source = source.replace(
  'node --check scripts/apply-operations-v2.js',
  'node --check scripts/run-operations-v2-patch.js'
);

fs.writeFileSync(generatedPath, source);
try {
  const check = spawnSync(process.execPath, ['--check', generatedPath], { stdio: 'inherit' });
  if (check.status !== 0) process.exit(check.status || 1);
  const run = spawnSync(process.execPath, [generatedPath], { stdio: 'inherit' });
  if (run.status !== 0) process.exit(run.status || 1);
} finally {
  fs.rmSync(generatedPath, { force: true });
}
