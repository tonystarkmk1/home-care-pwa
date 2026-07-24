const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'public', 'index.html');
const serverPath = path.join(root, 'server3.js');
const CONTACTS_SCRIPT_VERSION = 2;

function patchIndex() {
  let html = fs.readFileSync(indexPath, 'utf8');

  if (!html.includes('/contacts-v1.js')) {
    html = html.replace('<script>\nconst app=', `<script src="/contacts-v1.js?v=${CONTACTS_SCRIPT_VERSION}"></script>\n<script>\nconst app=`);
  } else {
    html = html.replace(/\/contacts-v1\.js\?v=\d+/g, `/contacts-v1.js?v=${CONTACTS_SCRIPT_VERSION}`);
  }

  if (!html.includes('window.applyContactsV1')) {
    if (html.includes('if(window.applyCustomPlanV1)window.applyCustomPlanV1();boot();')) {
      html = html.replace('if(window.applyCustomPlanV1)window.applyCustomPlanV1();boot();', 'if(window.applyCustomPlanV1)window.applyCustomPlanV1();if(window.applyContactsV1)window.applyContactsV1();boot();');
    } else {
      html = html.replace("if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});boot();", "if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});if(window.applyContactsV1)window.applyContactsV1();boot();");
    }
  }

  fs.writeFileSync(indexPath, html);
}

function patchServer() {
  let code = fs.readFileSync(serverPath, 'utf8');
  if (code.includes("app.get('/api/client/contacts'")) return;

  const routes = `
app.get('/api/client/contacts', auth(), clientOnly, async (req, res) => {
  const contacts = (await q('SELECT * FROM contact_channels WHERE active=TRUE ORDER BY sort_order ASC, created_at ASC')).rows;
  res.json({ contacts });
});

app.get('/api/admin/contacts', auth(), adminOnly, async (req, res) => {
  const contacts = (await q('SELECT * FROM contact_channels ORDER BY active DESC, sort_order ASC, created_at ASC')).rows;
  res.json({ contacts });
});

app.post('/api/admin/contacts', auth(), adminOnly, async (req, res) => {
  const { label, kind = 'altro', value, note, sort_order = 0, active = true } = req.body;
  if (!label || !value) return res.status(400).json({ error: 'Nome contatto e valore obbligatori' });
  const contact = (await q('INSERT INTO contact_channels(label,kind,value,note,sort_order,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [label, kind, value, note || null, Number(sort_order) || 0, Boolean(active)])).rows[0];
  res.status(201).json({ contact });
});

app.patch('/api/admin/contacts/:id', auth(), adminOnly, async (req, res) => {
  const { label, kind, value, note, sort_order, active } = req.body;
  const contact = (await q('UPDATE contact_channels SET label=COALESCE($2,label),kind=COALESCE($3,kind),value=COALESCE($4,value),note=COALESCE($5,note),sort_order=COALESCE($6,sort_order),active=COALESCE($7,active),updated_at=NOW() WHERE id=$1 RETURNING *', [req.params.id, label || null, kind || null, value || null, note || null, typeof sort_order === 'undefined' ? null : Number(sort_order), typeof active === 'boolean' ? active : null])).rows[0];
  if (!contact) return res.status(404).json({ error: 'Contatto non trovato' });
  res.json({ contact });
});

app.post('/api/admin/contacts/:id/archive', auth(), adminOnly, async (req, res) => {
  const contact = (await q('UPDATE contact_channels SET active=FALSE,updated_at=NOW() WHERE id=$1 RETURNING *', [req.params.id])).rows[0];
  if (!contact) return res.status(404).json({ error: 'Contatto non trovato' });
  res.json({ contact });
});

app.post('/api/admin/contacts/:id/restore', auth(), adminOnly, async (req, res) => {
  const contact = (await q('UPDATE contact_channels SET active=TRUE,updated_at=NOW() WHERE id=$1 RETURNING *', [req.params.id])).rows[0];
  if (!contact) return res.status(404).json({ error: 'Contatto non trovato' });
  res.json({ contact });
});

`;

  const marker = "app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));";
  if (!code.includes(marker)) throw new Error('Marker catch-all non trovato');
  code = code.replace(marker, routes + marker);
  fs.writeFileSync(serverPath, code);
}

try {
  patchIndex();
  patchServer();
  console.log('Patch Contatti V1 applicata.');
} catch (error) {
  console.warn('Patch Contatti V1 non applicata:', error.message);
}
