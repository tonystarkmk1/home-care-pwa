'use strict';

const crypto = require('crypto');

function booleanValue(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null || value === '') return fallback;
  if (['true', '1', 'yes', 'on'].includes(String(value).toLowerCase())) return true;
  if (['false', '0', 'no', 'off'].includes(String(value).toLowerCase())) return false;
  return fallback;
}

function installGuidedChecks(dependencies) {
  const {
    app, q, transaction, auth, role, asyncHandler, upload, uuid, text,
    listOfStrings, HttpError, imageType, safeOriginalName,
  } = dependencies;

  if (!app || !q || !transaction || !auth || !role || !asyncHandler || !upload) {
    throw new Error('Dipendenze guided-checks-v2 incomplete');
  }

  const paidSql = `(c.payment_status='paid' AND (c.paid_until IS NULL OR c.paid_until>=CURRENT_DATE))`;

  function normalizeItems(value) {
    const items = listOfStrings(value || [], {
      name: 'Checklist',
      itemName: 'Voce della checklist',
      maxItems: 100,
      maxLength: 300,
    });
    const seen = new Set();
    return items.filter((item) => {
      const key = item.toLocaleLowerCase('it-IT');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function propertyTemplate(propertyId, client) {
    const property = (await q(
      `SELECT p.id,p.name,p.address,p.city,p.package_type,p.active,p.request_status,
              c.id customer_id,c.name customer_name,
              ps.label plan_label,ps.features_json
         FROM properties p
         JOIN customers c ON c.id=p.customer_id
         JOIN plan_settings ps ON ps.id=p.package_type
        WHERE p.id=$1`,
      [propertyId],
      client
    )).rows[0];
    if (!property) throw new HttpError(404, 'Immobile non trovato', 'NOT_FOUND');
    const template = (await q(
      `SELECT items_json,updated_at FROM property_check_templates WHERE property_id=$1`,
      [propertyId],
      client
    )).rows[0];
    const fallback = Array.isArray(property.features_json) ? property.features_json : [];
    return {
      property,
      items: template && Array.isArray(template.items_json) ? template.items_json : fallback,
      source: template ? 'property' : 'plan',
      updated_at: template?.updated_at || null,
    };
  }

  async function sessionSummary(sessionId, client) {
    const session = (await q(
      `SELECT gc.*,p.name property_name,p.address,p.city,p.package_type,p.customer_id,
              c.name customer_name,c.phone customer_phone,
              ps.label plan_label,
              COUNT(i.id)::int items_total,
              COUNT(i.id) FILTER (WHERE i.checked=TRUE)::int items_checked,
              COALESCE(SUM(photo_count.count),0)::int photos_count
         FROM guided_checks gc
         JOIN properties p ON p.id=gc.property_id
         JOIN customers c ON c.id=p.customer_id
         JOIN plan_settings ps ON ps.id=p.package_type
         LEFT JOIN guided_check_items i ON i.guided_check_id=gc.id
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int count
             FROM guided_check_item_photos ph
            WHERE ph.guided_check_item_id=i.id
         ) photo_count ON TRUE
        WHERE gc.id=$1
        GROUP BY gc.id,p.id,c.id,ps.id`,
      [sessionId],
      client
    )).rows[0];
    if (!session) throw new HttpError(404, 'Controllo guidato non trovato', 'NOT_FOUND');
    return session;
  }

  async function sessionDetails(sessionId, client) {
    const session = await sessionSummary(sessionId, client);
    const items = (await q(
      `SELECT i.id,i.sort_order,i.label,i.checked,i.checked_at,i.notes,i.created_at,i.updated_at,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id',ph.id,
                    'mime_type',ph.mime_type,
                    'size_bytes',ph.size_bytes,
                    'created_at',ph.created_at
                  )
                  ORDER BY ph.created_at
                ) FILTER (WHERE ph.id IS NOT NULL),
                '[]'::json
              ) photos
         FROM guided_check_items i
         LEFT JOIN guided_check_item_photos ph ON ph.guided_check_item_id=i.id
        WHERE i.guided_check_id=$1
        GROUP BY i.id
        ORDER BY i.sort_order,i.created_at`,
      [sessionId],
      client
    )).rows;
    return {
      ...session,
      items: items.map((item) => ({
        ...item,
        photos: (Array.isArray(item.photos) ? item.photos : []).map((photo) => ({
          ...photo,
          url: `/api/admin/guided-check-photos/${photo.id}`,
        })),
      })),
    };
  }

  async function assertEditableSession(sessionId, itemId, client) {
    const row = (await q(
      `SELECT i.*,gc.status,gc.property_id
         FROM guided_check_items i
         JOIN guided_checks gc ON gc.id=i.guided_check_id
        WHERE i.id=$1 AND gc.id=$2
        FOR UPDATE OF i,gc`,
      [itemId, sessionId],
      client
    )).rows[0];
    if (!row) throw new HttpError(404, 'Voce del controllo non trovata', 'NOT_FOUND');
    if (!['in_progress', 'draft'].includes(row.status)) {
      throw new HttpError(409, 'Il controllo non è più modificabile', 'GUIDED_CHECK_LOCKED');
    }
    return row;
  }

  app.get('/api/admin/properties/:id/checklist-template', auth(), role('admin', 'helper'), asyncHandler(async (req, res) => {
    const propertyId = uuid(req.params.id, 'Immobile');
    res.json(await propertyTemplate(propertyId));
  }));

  app.put('/api/admin/properties/:id/checklist-template', auth(), role('admin'), asyncHandler(async (req, res) => {
    const propertyId = uuid(req.params.id, 'Immobile');
    const items = normalizeItems(req.body.items_json || req.body.items || []);
    if (!items.length) throw new HttpError(400, 'Inserisci almeno una voce nella checklist', 'CHECKLIST_REQUIRED');
    const template = await transaction(async (client) => {
      await propertyTemplate(propertyId, client);
      return (await q(
        `INSERT INTO property_check_templates(property_id,items_json,updated_by_user_id)
         VALUES($1,$2::jsonb,$3)
         ON CONFLICT (property_id) DO UPDATE
           SET items_json=EXCLUDED.items_json,
               updated_by_user_id=EXCLUDED.updated_by_user_id,
               updated_at=NOW()
         RETURNING *`,
        [propertyId, JSON.stringify(items), req.user.id],
        client
      )).rows[0];
    });
    res.json({ template: { ...template, items_json: items } });
  }));

  app.get('/api/admin/guided-checks', auth(), role('admin', 'helper'), asyncHandler(async (req, res) => {
    const allowed = new Set(['in_progress', 'draft', 'approved', 'canceled']);
    const requested = String(req.query.status || 'open').trim();
    let condition = `gc.status IN ('in_progress','draft')`;
    const params = [];
    if (requested !== 'open') {
      if (!allowed.has(requested)) throw new HttpError(400, 'Stato controllo non valido', 'VALIDATION_ERROR');
      params.push(requested);
      condition = `gc.status=$1`;
    }
    const rows = (await q(
      `SELECT gc.*,p.name property_name,p.address,p.city,p.package_type,p.customer_id,
              c.name customer_name,ps.label plan_label,
              COUNT(i.id)::int items_total,
              COUNT(i.id) FILTER (WHERE i.checked=TRUE)::int items_checked,
              COALESCE(SUM(photo_count.count),0)::int photos_count
         FROM guided_checks gc
         JOIN properties p ON p.id=gc.property_id
         JOIN customers c ON c.id=p.customer_id
         JOIN plan_settings ps ON ps.id=p.package_type
         LEFT JOIN guided_check_items i ON i.guided_check_id=gc.id
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int count FROM guided_check_item_photos ph
            WHERE ph.guided_check_item_id=i.id
         ) photo_count ON TRUE
        WHERE ${condition}
        GROUP BY gc.id,p.id,c.id,ps.id
        ORDER BY CASE gc.status WHEN 'draft' THEN 0 ELSE 1 END,gc.updated_at DESC`,
      params
    )).rows;
    res.json({ guided_checks: rows });
  }));

  app.post('/api/admin/guided-checks/start', auth(), role('admin', 'helper'), asyncHandler(async (req, res) => {
    const propertyId = uuid(req.body.property_id, 'Immobile');
    const result = await transaction(async (client) => {
      const property = (await q(
        `SELECT p.*,c.name customer_name,ps.label plan_label,ps.features_json,
                CASE WHEN ${paidSql} THEN TRUE ELSE FALSE END payment_valid,
                EXISTS(
                  SELECT 1 FROM property_occupancies o
                   WHERE o.property_id=p.id AND CURRENT_DATE BETWEEN o.start_date AND o.end_date
                ) occupied_today
           FROM properties p
           JOIN customers c ON c.id=p.customer_id
           JOIN plan_settings ps ON ps.id=p.package_type
          WHERE p.id=$1
          FOR UPDATE OF p`,
        [propertyId],
        client
      )).rows[0];
      if (!property) throw new HttpError(404, 'Immobile non trovato', 'NOT_FOUND');
      if (!property.active || property.request_status !== 'approved') {
        throw new HttpError(409, 'L’immobile non è attivo', 'PROPERTY_INACTIVE');
      }
      if (!property.payment_valid) {
        throw new HttpError(402, 'Pagamento non regolare: controllo sospeso', 'PAYMENT_REQUIRED');
      }
      if (property.occupied_today) {
        throw new HttpError(409, 'La casa risulta occupata oggi: il controllo non è necessario', 'PROPERTY_OCCUPIED');
      }

      const existing = (await q(
        `SELECT * FROM guided_checks
          WHERE property_id=$1 AND status IN ('in_progress','draft')
          ORDER BY created_at DESC LIMIT 1
          FOR UPDATE`,
        [propertyId],
        client
      )).rows[0];
      if (existing) {
        if (existing.status === 'draft') {
          throw new HttpError(409, 'Esiste già un report in bozza da approvare per questo immobile', 'DRAFT_EXISTS');
        }
        return { session: await sessionDetails(existing.id, client), resumed: true };
      }

      const template = (await q(
        `SELECT items_json FROM property_check_templates WHERE property_id=$1`,
        [propertyId],
        client
      )).rows[0];
      const items = normalizeItems(template?.items_json || property.features_json || []);
      if (!items.length) {
        throw new HttpError(409, 'Configura prima la lista delle cose da controllare per questo immobile', 'CHECKLIST_REQUIRED');
      }

      const session = (await q(
        `INSERT INTO guided_checks(property_id,started_by_user_id,status,started_at)
         VALUES($1,$2,'in_progress',NOW()) RETURNING *`,
        [propertyId, req.user.id],
        client
      )).rows[0];
      for (let index = 0; index < items.length; index += 1) {
        await q(
          `INSERT INTO guided_check_items(guided_check_id,sort_order,label)
           VALUES($1,$2,$3)`,
          [session.id, index, items[index]],
          client
        );
      }
      return { session: await sessionDetails(session.id, client), resumed: false };
    });
    res.status(result.resumed ? 200 : 201).json(result);
  }));

  app.get('/api/admin/guided-checks/:id', auth(), role('admin', 'helper'), asyncHandler(async (req, res) => {
    const sessionId = uuid(req.params.id, 'Controllo');
    res.json({ guided_check: await sessionDetails(sessionId) });
  }));

  app.patch('/api/admin/guided-checks/:id', auth(), role('admin', 'helper'), asyncHandler(async (req, res) => {
    const sessionId = uuid(req.params.id, 'Controllo');
    const overallNotes = text(req.body.overall_notes, { name: 'Note generali', max: 5000 });
    const session = (await q(
      `UPDATE guided_checks
          SET overall_notes=$2,updated_at=NOW()
        WHERE id=$1 AND status IN ('in_progress','draft')
        RETURNING *`,
      [sessionId, overallNotes]
    )).rows[0];
    if (!session) throw new HttpError(404, 'Controllo non trovato o non modificabile', 'NOT_FOUND');
    res.json({ guided_check: session });
  }));

  app.patch('/api/admin/guided-checks/:id/items/:itemId', auth(), role('admin', 'helper'), asyncHandler(async (req, res) => {
    const sessionId = uuid(req.params.id, 'Controllo');
    const itemId = uuid(req.params.itemId, 'Voce');
    const checked = booleanValue(req.body.checked, false);
    const notes = text(req.body.notes, { name: 'Nota della voce', max: 2000 });
    const item = await transaction(async (client) => {
      await assertEditableSession(sessionId, itemId, client);
      return (await q(
        `UPDATE guided_check_items
            SET checked=$3,
                checked_at=CASE WHEN $3 THEN COALESCE(checked_at,NOW()) ELSE NULL END,
                notes=$4,
                updated_at=NOW()
          WHERE id=$1 AND guided_check_id=$2
          RETURNING *`,
        [itemId, sessionId, checked, notes],
        client
      )).rows[0];
    });
    res.json({ item });
  }));

  app.post('/api/admin/guided-checks/:id/items/:itemId/photos', auth(), role('admin', 'helper'), upload.array('photos', 4), asyncHandler(async (req, res) => {
    const sessionId = uuid(req.params.id, 'Controllo');
    const itemId = uuid(req.params.itemId, 'Voce');
    const files = req.files || [];
    if (!files.length) throw new HttpError(400, 'Seleziona almeno una fotografia', 'INVALID_UPLOAD');
    if (files.reduce((sum, file) => sum + file.size, 0) > 24 * 1024 * 1024) {
      throw new HttpError(400, 'Le fotografie superano il limite complessivo di 24 MB', 'INVALID_UPLOAD');
    }
    const photos = await transaction(async (client) => {
      await assertEditableSession(sessionId, itemId, client);
      const inserted = [];
      for (const file of files) {
        const detected = imageType(file.buffer);
        if (!detected || detected !== file.mimetype) {
          throw new HttpError(400, 'Una fotografia non è un’immagine valida', 'INVALID_UPLOAD');
        }
        inserted.push((await q(
          `INSERT INTO guided_check_item_photos(
             guided_check_item_id,mime_type,original_name,size_bytes,sha256,image_data
           ) VALUES($1,$2,$3,$4,$5,$6)
           RETURNING id,mime_type,size_bytes,created_at`,
          [
            itemId,
            detected,
            safeOriginalName(file.originalname),
            file.size,
            crypto.createHash('sha256').update(file.buffer).digest('hex'),
            file.buffer,
          ],
          client
        )).rows[0]);
      }
      return inserted;
    });
    res.status(201).json({
      photos: photos.map((photo) => ({ ...photo, url: `/api/admin/guided-check-photos/${photo.id}` })),
    });
  }));

  app.get('/api/admin/guided-check-photos/:id', auth(), role('admin', 'helper'), asyncHandler(async (req, res) => {
    const photoId = uuid(req.params.id, 'Fotografia');
    const photo = (await q(
      `SELECT mime_type,original_name,size_bytes,image_data
         FROM guided_check_item_photos WHERE id=$1`,
      [photoId]
    )).rows[0];
    if (!photo) throw new HttpError(404, 'Fotografia non trovata', 'NOT_FOUND');
    res.set('Content-Type', photo.mime_type);
    res.set('Content-Length', String(photo.size_bytes));
    res.set('Content-Disposition', `inline; filename="${safeOriginalName(photo.original_name)}"`);
    res.set('Cache-Control', 'private, max-age=120');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(photo.image_data);
  }));

  app.delete('/api/admin/guided-check-photos/:id', auth(), role('admin', 'helper'), asyncHandler(async (req, res) => {
    const photoId = uuid(req.params.id, 'Fotografia');
    const photo = (await q(
      `DELETE FROM guided_check_item_photos ph
        USING guided_check_items i,guided_checks gc
        WHERE ph.id=$1
          AND i.id=ph.guided_check_item_id
          AND gc.id=i.guided_check_id
          AND gc.status IN ('in_progress','draft')
        RETURNING ph.id`,
      [photoId]
    )).rows[0];
    if (!photo) throw new HttpError(404, 'Fotografia non trovata o non eliminabile', 'NOT_FOUND');
    res.json({ photo });
  }));

  app.post('/api/admin/guided-checks/:id/finish', auth(), role('admin', 'helper'), asyncHandler(async (req, res) => {
    const sessionId = uuid(req.params.id, 'Controllo');
    const session = await transaction(async (client) => {
      const current = (await q(
        `SELECT gc.*,p.name property_name,c.name customer_name
           FROM guided_checks gc
           JOIN properties p ON p.id=gc.property_id
           JOIN customers c ON c.id=p.customer_id
          WHERE gc.id=$1 FOR UPDATE OF gc`,
        [sessionId],
        client
      )).rows[0];
      if (!current) throw new HttpError(404, 'Controllo non trovato', 'NOT_FOUND');
      if (current.status !== 'in_progress') throw new HttpError(409, 'Il controllo non è in corso', 'GUIDED_CHECK_STATE');
      const remaining = Number((await q(
        `SELECT COUNT(*)::int count FROM guided_check_items
          WHERE guided_check_id=$1 AND checked=FALSE`,
        [sessionId],
        client
      )).rows[0]?.count || 0);
      if (remaining > 0) {
        throw new HttpError(409, `Completa tutte le voci prima di terminare. Ne mancano ${remaining}.`, 'CHECKLIST_INCOMPLETE');
      }
      const updated = (await q(
        `UPDATE guided_checks
            SET status='draft',finished_at=NOW(),updated_at=NOW()
          WHERE id=$1 RETURNING *`,
        [sessionId],
        client
      )).rows[0];
      await q(
        `INSERT INTO notifications(user_id,kind,title,body,link_tab,dedupe_key)
         SELECT u.id,'report','Report da approvare',$1,'reports',$2
           FROM users u WHERE u.role='admin'
         ON CONFLICT (user_id,dedupe_key) DO NOTHING`,
        [
          `Il controllo di ${current.property_name} per ${current.customer_name} è terminato ed è pronto per la revisione.`,
          `guided-draft:${sessionId}`,
        ],
        client
      );
      return updated;
    });
    res.json({ guided_check: session });
  }));

  app.post('/api/admin/guided-checks/:id/reopen', auth(), role('admin'), asyncHandler(async (req, res) => {
    const sessionId = uuid(req.params.id, 'Controllo');
    const session = (await q(
      `UPDATE guided_checks
          SET status='in_progress',finished_at=NULL,updated_at=NOW()
        WHERE id=$1 AND status='draft'
        RETURNING *`,
      [sessionId]
    )).rows[0];
    if (!session) throw new HttpError(404, 'Bozza non trovata', 'NOT_FOUND');
    res.json({ guided_check: session });
  }));

  app.post('/api/admin/guided-checks/:id/approve', auth(), role('admin'), asyncHandler(async (req, res) => {
    const sessionId = uuid(req.params.id, 'Controllo');
    const result = await transaction(async (client) => {
      const current = (await q(
        `SELECT gc.*,p.name property_name,p.customer_id,p.package_type,p.next_check_date,
                ps.days
           FROM guided_checks gc
           JOIN properties p ON p.id=gc.property_id
           JOIN plan_settings ps ON ps.id=p.package_type
          WHERE gc.id=$1 FOR UPDATE OF gc`,
        [sessionId],
        client
      )).rows[0];
      if (!current) throw new HttpError(404, 'Controllo non trovato', 'NOT_FOUND');
      if (current.status !== 'draft') throw new HttpError(409, 'Il report non è in attesa di approvazione', 'GUIDED_CHECK_STATE');

      const items = (await q(
        `SELECT id,label,notes,sort_order FROM guided_check_items
          WHERE guided_check_id=$1 ORDER BY sort_order`,
        [sessionId],
        client
      )).rows;
      if (!items.length) throw new HttpError(409, 'La checklist del controllo è vuota', 'CHECKLIST_REQUIRED');

      const detailNotes = items
        .filter((item) => item.notes)
        .map((item) => `${item.label}: ${item.notes}`);
      const reportNotes = [
        current.overall_notes || '',
        detailNotes.length ? `Dettagli delle verifiche:\n${detailNotes.join('\n')}` : '',
      ].filter(Boolean).join('\n\n') || null;
      const checklist = items.map((item) => item.label);

      const check = (await q(
        `INSERT INTO checks(property_id,due_date,completed_at,status,notes,checklist_json)
         VALUES($1,COALESCE($2,CURRENT_DATE),COALESCE($3,NOW()),'done',$4,$5::jsonb)
         RETURNING *`,
        [
          current.property_id,
          current.next_check_date,
          current.finished_at,
          reportNotes,
          JSON.stringify(checklist),
        ],
        client
      )).rows[0];

      await q(
        `INSERT INTO check_photos(check_id,mime_type,original_name,size_bytes,sha256,image_data)
         SELECT $2,ph.mime_type,ph.original_name,ph.size_bytes,ph.sha256,ph.image_data
           FROM guided_check_item_photos ph
           JOIN guided_check_items i ON i.id=ph.guided_check_item_id
          WHERE i.guided_check_id=$1`,
        [sessionId, check.id],
        client
      );

      await q(
        `UPDATE properties
            SET next_check_date=home_care_next_available_date(
                  id,
                  (COALESCE($2::timestamptz,NOW())::date + $3::int)
                ),
                updated_at=NOW()
          WHERE id=$1`,
        [current.property_id, current.finished_at, Number(current.days || 30)],
        client
      );

      const approved = (await q(
        `UPDATE guided_checks
            SET status='approved',check_id=$2,approved_by_user_id=$3,
                approved_at=NOW(),updated_at=NOW()
          WHERE id=$1 RETURNING *`,
        [sessionId, check.id, req.user.id],
        client
      )).rows[0];
      return { guided_check: approved, check };
    });
    res.json(result);
  }));

  app.delete('/api/admin/guided-checks/:id', auth(), role('admin'), asyncHandler(async (req, res) => {
    const sessionId = uuid(req.params.id, 'Controllo');
    const session = (await q(
      `DELETE FROM guided_checks
        WHERE id=$1 AND status IN ('in_progress','draft','canceled')
        RETURNING *`,
      [sessionId]
    )).rows[0];
    if (!session) throw new HttpError(404, 'Controllo non trovato o non eliminabile', 'NOT_FOUND');
    res.json({ guided_check: session });
  }));
}

module.exports = { installGuidedChecks };
