'use strict';

const crypto = require('crypto');
const { installGuidedChecks } = require('./guided-checks-v2');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function parseDateTime(value, HttpError) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new HttpError(400, 'Data e ora del report non valide', 'VALIDATION_ERROR');
  if (date.getTime() > Date.now() + 5 * 60_000) throw new HttpError(400, 'La data del report non può essere nel futuro', 'VALIDATION_ERROR');
  return date.toISOString();
}

function installOperationalFeatures(dependencies) {
  const {
    app, q, transaction, auth, role, asyncHandler, upload, uuid, text, isoDate,
    listOfStrings, HttpError, config, mailer, imageType, safeOriginalName,
  } = dependencies;

  if (!app || !q || !transaction || !auth || !role || !asyncHandler) {
    throw new Error('Dipendenze operations-v2 incomplete');
  }

  installGuidedChecks(dependencies);

  async function notifyCustomer(client, customerId, kind, title, body, linkTab, dedupeKey) {
    await q(
      `INSERT INTO notifications(user_id,kind,title,body,link_tab,dedupe_key)
       SELECT u.id,$2,$3,$4,$5,$6
         FROM users u
        WHERE u.customer_id=$1 AND u.role='client'
       ON CONFLICT (user_id,dedupe_key) DO NOTHING`,
      [customerId, kind, title, body, linkTab || null, dedupeKey],
      client
    );
  }

  async function notifyAdmins(client, kind, title, body, linkTab, dedupeKey) {
    await q(
      `INSERT INTO notifications(user_id,kind,title,body,link_tab,dedupe_key)
       SELECT u.id,$1,$2,$3,$4,$5
         FROM users u
        WHERE u.role='admin'
       ON CONFLICT (user_id,dedupe_key) DO NOTHING`,
      [kind, title, body, linkTab || null, dedupeKey],
      client
    );
  }

  async function propertyForActor(client, propertyId, user) {
    const property = (await q(
      `SELECT p.*,c.name customer_name,c.email customer_email
         FROM properties p JOIN customers c ON c.id=p.customer_id
        WHERE p.id=$1 FOR UPDATE OF p`,
      [propertyId],
      client
    )).rows[0];
    if (!property) throw new HttpError(404, 'Immobile non trovato', 'NOT_FOUND');
    if (user.role === 'client' && property.customer_id !== user.customer_id) {
      throw new HttpError(403, 'Immobile non autorizzato', 'FORBIDDEN');
    }
    return property;
  }

  function validateRange(startValue, endValue) {
    const startDate = isoDate(startValue, { name: 'Data inizio', required: true });
    const endDate = isoDate(endValue, { name: 'Data fine', required: true });
    if (endDate < startDate) throw new HttpError(400, 'La data finale deve essere uguale o successiva alla data iniziale', 'VALIDATION_ERROR');
    const duration = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000;
    if (duration > 730) throw new HttpError(400, 'Il periodo non può superare due anni', 'VALIDATION_ERROR');
    return { startDate, endDate };
  }

  async function assertNoOccupancyOverlap(client, propertyId, startDate, endDate, excludeId = null) {
    const overlap = (await q(
      `SELECT id FROM property_occupancies
        WHERE property_id=$1
          AND daterange(start_date,end_date,'[]') && daterange($2::date,$3::date,'[]')
          AND ($4::uuid IS NULL OR id<>$4::uuid)
        LIMIT 1`,
      [propertyId, startDate, endDate, excludeId],
      client
    )).rows[0];
    if (overlap) throw new HttpError(409, 'Esiste già un periodo di occupazione sovrapposto', 'OCCUPANCY_OVERLAP');
  }

  async function recalculateNextCheck(client, propertyId) {
    const scheduling = (await q(
      `SELECT ps.days,MAX(ch.completed_at::date)::text last_completed
         FROM properties p JOIN plan_settings ps ON ps.id=p.package_type
         LEFT JOIN checks ch ON ch.property_id=p.id AND ch.status='done'
        WHERE p.id=$1 GROUP BY ps.days`,
      [propertyId],
      client
    )).rows[0];
    if (!scheduling) return;
    const candidate = scheduling.last_completed
      ? new Date(Date.parse(`${scheduling.last_completed}T00:00:00Z`) + Number(scheduling.days || 30) * 86_400_000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    await q(
      `UPDATE properties SET next_check_date=home_care_next_available_date(id,$2::date),updated_at=NOW() WHERE id=$1`,
      [propertyId, candidate],
      client
    );
  }

  async function listOccupancies(user, adminMode) {
    const conditions = [];
    const params = [];
    if (!adminMode) {
      params.push(user.customer_id);
      conditions.push(`p.customer_id=$${params.length}`);
    }
    const rows = (await q(
      `SELECT o.*,p.name property_name,p.address,p.customer_id,c.name customer_name
         FROM property_occupancies o
         JOIN properties p ON p.id=o.property_id
         JOIN customers c ON c.id=p.customer_id
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY CASE WHEN o.end_date>=CURRENT_DATE THEN 0 ELSE 1 END,o.start_date ASC,o.created_at DESC`,
      params
    )).rows;
    return rows;
  }

  async function createOccupancy(req, adminMode) {
    const propertyId = uuid(req.body.property_id, 'Immobile');
    const { startDate, endDate } = validateRange(req.body.start_date, req.body.end_date);
    const note = text(req.body.note, { name: 'Nota', max: 1000 });
    return transaction(async (client) => {
      const property = await propertyForActor(client, propertyId, req.user);
      await assertNoOccupancyOverlap(client, propertyId, startDate, endDate);
      const occupancy = (await q(
        `INSERT INTO property_occupancies(property_id,start_date,end_date,note,source_role,created_by_user_id)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [propertyId, startDate, endDate, note, adminMode ? 'admin' : 'client', req.user.id],
        client
      )).rows[0];
      await recalculateNextCheck(client, propertyId);
      const description = `${property.name}: casa occupata dal ${startDate} al ${endDate}${note ? `. ${note}` : ''}`;
      if (adminMode) {
        await notifyCustomer(client, property.customer_id, 'occupancy', 'Periodo di occupazione registrato', description, 'properties', `occupancy-created:${occupancy.id}`);
      } else {
        await notifyAdmins(client, 'occupancy', 'Nuovo periodo di occupazione', `${property.customer_name} ha indicato: ${description}`, 'properties', `occupancy-created:${occupancy.id}`);
      }
      return occupancy;
    });
  }

  async function updateOccupancy(req, adminMode) {
    const occupancyId = uuid(req.params.id, 'Periodo');
    const { startDate, endDate } = validateRange(req.body.start_date, req.body.end_date);
    const note = text(req.body.note, { name: 'Nota', max: 1000 });
    return transaction(async (client) => {
      const current = (await q(
        `SELECT o.*,p.customer_id,p.name property_name,c.name customer_name
           FROM property_occupancies o
           JOIN properties p ON p.id=o.property_id
           JOIN customers c ON c.id=p.customer_id
          WHERE o.id=$1 FOR UPDATE`,
        [occupancyId],
        client
      )).rows[0];
      if (!current) throw new HttpError(404, 'Periodo non trovato', 'NOT_FOUND');
      if (!adminMode && current.customer_id !== req.user.customer_id) throw new HttpError(403, 'Periodo non autorizzato', 'FORBIDDEN');
      await assertNoOccupancyOverlap(client, current.property_id, startDate, endDate, occupancyId);
      const occupancy = (await q(
        `UPDATE property_occupancies SET start_date=$2,end_date=$3,note=$4,updated_at=NOW() WHERE id=$1 RETURNING *`,
        [occupancyId, startDate, endDate, note],
        client
      )).rows[0];
      await recalculateNextCheck(client, current.property_id);
      const description = `${current.property_name}: periodo aggiornato dal ${startDate} al ${endDate}${note ? `. ${note}` : ''}`;
      if (adminMode) {
        await notifyCustomer(client, current.customer_id, 'occupancy', 'Periodo di occupazione aggiornato', description, 'properties', `occupancy-updated:${occupancy.id}:${occupancy.updated_at}`);
      } else {
        await notifyAdmins(client, 'occupancy', 'Periodo di occupazione aggiornato', `${current.customer_name} ha aggiornato: ${description}`, 'properties', `occupancy-updated:${occupancy.id}:${occupancy.updated_at}`);
      }
      return occupancy;
    });
  }

  async function deleteOccupancy(req, adminMode) {
    const occupancyId = uuid(req.params.id, 'Periodo');
    return transaction(async (client) => {
      const current = (await q(
        `SELECT o.*,p.customer_id,p.name property_name,c.name customer_name
           FROM property_occupancies o
           JOIN properties p ON p.id=o.property_id
           JOIN customers c ON c.id=p.customer_id
          WHERE o.id=$1 FOR UPDATE`,
        [occupancyId],
        client
      )).rows[0];
      if (!current) throw new HttpError(404, 'Periodo non trovato', 'NOT_FOUND');
      if (!adminMode && current.customer_id !== req.user.customer_id) throw new HttpError(403, 'Periodo non autorizzato', 'FORBIDDEN');
      await q('DELETE FROM property_occupancies WHERE id=$1', [occupancyId], client);
      const description = `${current.property_name}: periodo dal ${current.start_date} al ${current.end_date} eliminato.`;
      if (adminMode) {
        await notifyCustomer(client, current.customer_id, 'occupancy', 'Periodo di occupazione eliminato', description, 'properties', `occupancy-deleted:${occupancyId}`);
      } else {
        await notifyAdmins(client, 'occupancy', 'Periodo di occupazione eliminato', `${current.customer_name}: ${description}`, 'properties', `occupancy-deleted:${occupancyId}`);
      }
      return current;
    });
  }

  app.get('/api/client/occupancies', auth(), role('client'), asyncHandler(async (req, res) => {
    res.json({ occupancies: await listOccupancies(req.user, false) });
  }));
  app.post('/api/client/occupancies', auth(), role('client'), asyncHandler(async (req, res) => {
    res.status(201).json({ occupancy: await createOccupancy(req, false) });
  }));
  app.patch('/api/client/occupancies/:id', auth(), role('client'), asyncHandler(async (req, res) => {
    res.json({ occupancy: await updateOccupancy(req, false) });
  }));
  app.delete('/api/client/occupancies/:id', auth(), role('client'), asyncHandler(async (req, res) => {
    res.json({ occupancy: await deleteOccupancy(req, false) });
  }));

  app.get('/api/admin/occupancies', auth(), role('admin', 'helper'), asyncHandler(async (req, res) => {
    res.json({ occupancies: await listOccupancies(req.user, true) });
  }));
  app.post('/api/admin/occupancies', auth(), role('admin'), asyncHandler(async (req, res) => {
    res.status(201).json({ occupancy: await createOccupancy(req, true) });
  }));
  app.patch('/api/admin/occupancies/:id', auth(), role('admin'), asyncHandler(async (req, res) => {
    res.json({ occupancy: await updateOccupancy(req, true) });
  }));
  app.delete('/api/admin/occupancies/:id', auth(), role('admin'), asyncHandler(async (req, res) => {
    res.json({ occupancy: await deleteOccupancy(req, true) });
  }));

  app.patch('/api/admin/reports/:id', auth(), role('admin'), asyncHandler(async (req, res) => {
    const reportId = uuid(req.params.id, 'Report');
    const notes = text(req.body.notes, { name: 'Note', max: 5000 });
    const checklist = listOfStrings(req.body.checklist_json || [], { name: 'Checklist', maxItems: 80, maxLength: 300 });
    const completedAt = parseDateTime(req.body.completed_at, HttpError);
    const report = await transaction(async (client) => {
      const current = (await q(
        `SELECT ch.*,p.customer_id,p.name property_name
           FROM checks ch JOIN properties p ON p.id=ch.property_id
          WHERE ch.id=$1 AND ch.status='done' FOR UPDATE`,
        [reportId],
        client
      )).rows[0];
      if (!current) throw new HttpError(404, 'Report non trovato', 'NOT_FOUND');
      const updated = (await q(
        `UPDATE checks
            SET notes=$2,checklist_json=$3::jsonb,completed_at=COALESCE($4::timestamptz,completed_at),updated_at=NOW()
          WHERE id=$1 RETURNING *`,
        [reportId, notes, JSON.stringify(checklist), completedAt],
        client
      )).rows[0];
      await recalculateNextCheck(client, current.property_id);
      await notifyCustomer(client, current.customer_id, 'report', 'Report aggiornato', `Il report di ${current.property_name} è stato aggiornato da Home Care.`, 'reports', `report-updated:${reportId}:${updated.updated_at}`);
      return updated;
    });
    res.json({ report });
  }));

  app.post('/api/admin/reports/:id/photos', auth(), role('admin'), upload.array('photos', 8), asyncHandler(async (req, res) => {
    const reportId = uuid(req.params.id, 'Report');
    const files = req.files || [];
    if (!files.length) throw new HttpError(400, 'Seleziona almeno una fotografia', 'INVALID_UPLOAD');
    if (files.reduce((sum, file) => sum + file.size, 0) > 32 * 1024 * 1024) throw new HttpError(400, 'Le foto superano il limite complessivo di 32 MB', 'INVALID_UPLOAD');
    const photos = await transaction(async (client) => {
      const current = (await q(
        `SELECT ch.id,p.customer_id,p.name property_name
           FROM checks ch JOIN properties p ON p.id=ch.property_id
          WHERE ch.id=$1 AND ch.status='done' FOR UPDATE`,
        [reportId],
        client
      )).rows[0];
      if (!current) throw new HttpError(404, 'Report non trovato', 'NOT_FOUND');
      const inserted = [];
      for (const file of files) {
        const detected = imageType(file.buffer);
        if (!detected || detected !== file.mimetype) throw new HttpError(400, 'Una foto non è un’immagine valida', 'INVALID_UPLOAD');
        inserted.push((await q(
          `INSERT INTO check_photos(check_id,mime_type,original_name,size_bytes,sha256,image_data)
           VALUES($1,$2,$3,$4,$5,$6) RETURNING id,mime_type,size_bytes,created_at`,
          [reportId, detected, safeOriginalName(file.originalname), file.size, crypto.createHash('sha256').update(file.buffer).digest('hex'), file.buffer],
          client
        )).rows[0]);
      }
      await notifyCustomer(client, current.customer_id, 'report', 'Nuove foto nel report', `Sono state aggiunte nuove fotografie al report di ${current.property_name}.`, 'reports', `report-photos:${reportId}:${crypto.randomUUID()}`);
      return inserted;
    });
    res.status(201).json({ photos });
  }));

  app.delete('/api/admin/photos/:id', auth(), role('admin'), asyncHandler(async (req, res) => {
    const photoId = uuid(req.params.id, 'Foto');
    const photo = (await q('DELETE FROM check_photos WHERE id=$1 RETURNING id,check_id', [photoId])).rows[0];
    if (!photo) throw new HttpError(404, 'Foto non trovata', 'NOT_FOUND');
    res.json({ photo });
  }));

  app.delete('/api/admin/reports/:id', auth(), role('admin'), asyncHandler(async (req, res) => {
    const reportId = uuid(req.params.id, 'Report');
    const report = await transaction(async (client) => {
      const current = (await q(
        `SELECT ch.*,p.customer_id,p.name property_name,p.package_type
           FROM checks ch JOIN properties p ON p.id=ch.property_id
          WHERE ch.id=$1 AND ch.status='done' FOR UPDATE`,
        [reportId],
        client
      )).rows[0];
      if (!current) throw new HttpError(404, 'Report non trovato', 'NOT_FOUND');
      await q('DELETE FROM checks WHERE id=$1', [reportId], client);
      const scheduling = (await q(
        `SELECT ps.days,MAX(ch.completed_at::date)::text last_completed
           FROM properties p JOIN plan_settings ps ON ps.id=p.package_type
           LEFT JOIN checks ch ON ch.property_id=p.id AND ch.status='done'
          WHERE p.id=$1 GROUP BY ps.days`,
        [current.property_id],
        client
      )).rows[0];
      const candidate = scheduling?.last_completed
        ? new Date(Date.parse(`${scheduling.last_completed}T00:00:00Z`) + Number(scheduling.days || 30) * 86_400_000).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      await q(
        `UPDATE properties SET next_check_date=home_care_next_available_date(id,$2::date),updated_at=NOW() WHERE id=$1`,
        [current.property_id, candidate],
        client
      );
      return current;
    });
    res.json({ report });
  }));

  app.delete('/api/admin/properties/:id', auth(), role('admin'), asyncHandler(async (req, res) => {
    const propertyId = uuid(req.params.id, 'Immobile');
    const confirmName = text(req.body.confirm_name, { name: 'Nome di conferma', required: true, max: 160 });
    const confirmation = text(req.body.confirmation, { name: 'Conferma', required: true, max: 20 });
    if (confirmation !== 'ELIMINA') throw new HttpError(400, 'Conferma eliminazione non valida', 'CONFIRMATION_REQUIRED');
    const property = await transaction(async (client) => {
      const current = (await q('SELECT * FROM properties WHERE id=$1 FOR UPDATE', [propertyId], client)).rows[0];
      if (!current) throw new HttpError(404, 'Immobile non trovato', 'NOT_FOUND');
      if (current.name !== confirmName) throw new HttpError(400, 'Nome immobile non corrispondente', 'CONFIRMATION_REQUIRED');
      await q('DELETE FROM properties WHERE id=$1', [propertyId], client);
      return current;
    });
    res.json({ property });
  }));

  app.get('/api/notifications', auth(), asyncHandler(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
    const [notifications, unread, preferences] = await Promise.all([
      q(`SELECT id,kind,title,body,link_tab,read_at,email_status,created_at
           FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, [req.user.id, limit]),
      q('SELECT COUNT(*)::int count FROM notifications WHERE user_id=$1 AND read_at IS NULL', [req.user.id]),
      q('SELECT email_notifications FROM users WHERE id=$1', [req.user.id]),
    ]);
    res.json({
      notifications: notifications.rows,
      unread: Number(unread.rows[0]?.count || 0),
      email_notifications: preferences.rows[0]?.email_notifications !== false,
      email_enabled: Boolean(config.brevoApiKey && config.brevoSenderEmail),
    });
  }));

  app.patch('/api/notifications/:id/read', auth(), asyncHandler(async (req, res) => {
    const notificationId = uuid(req.params.id, 'Notifica');
    const notification = (await q(
      `UPDATE notifications SET read_at=COALESCE(read_at,NOW()) WHERE id=$1 AND user_id=$2 RETURNING *`,
      [notificationId, req.user.id]
    )).rows[0];
    if (!notification) throw new HttpError(404, 'Notifica non trovata', 'NOT_FOUND');
    res.json({ notification });
  }));

  app.post('/api/notifications/read-all', auth(), asyncHandler(async (req, res) => {
    await q('UPDATE notifications SET read_at=COALESCE(read_at,NOW()) WHERE user_id=$1', [req.user.id]);
    res.json({ ok: true });
  }));

  app.patch('/api/notifications/preferences', auth(), asyncHandler(async (req, res) => {
    const enabled = req.body.email_notifications === true || String(req.body.email_notifications).toLowerCase() === 'true';
    const user = (await q(
      'UPDATE users SET email_notifications=$2,updated_at=NOW() WHERE id=$1 RETURNING id,email_notifications',
      [req.user.id, enabled]
    )).rows[0];
    res.json({ user });
  }));

  app.post('/api/admin/notifications/test-email', auth(), role('admin'), asyncHandler(async (req, res) => {
    if (!config.brevoApiKey || !config.brevoSenderEmail) throw new HttpError(503, 'Brevo non è configurato completamente', 'EMAIL_DISABLED');
    const result = await mailer(
      config,
      req.user.email,
      'Test notifiche Home Care',
      `<div style="font-family:Arial,sans-serif;line-height:1.5"><h2>Notifiche Home Care attive</h2><p>Questa email conferma che l’invio tramite Brevo funziona correttamente.</p></div>`
    );
    res.json({ result });
  }));

  async function claimNotificationEmail() {
    return transaction(async (client) => {
      const row = (await q(
        `SELECT n.*,u.email,u.name,u.email_notifications
           FROM notifications n JOIN users u ON u.id=n.user_id
          WHERE (n.email_status='pending' OR (n.email_status='sending' AND n.created_at<NOW()-INTERVAL '10 minutes'))
            AND n.email_attempts<3
          ORDER BY n.created_at ASC
          FOR UPDATE OF n SKIP LOCKED LIMIT 1`,
        [],
        client
      )).rows[0];
      if (!row) return null;
      await q(
        `UPDATE notifications SET email_status='sending',email_attempts=email_attempts+1,email_error=NULL WHERE id=$1`,
        [row.id],
        client
      );
      row.email_attempts = Number(row.email_attempts || 0) + 1;
      return row;
    });
  }

  async function flushPendingEmails(max = 20) {
    if (!config.brevoApiKey || !config.brevoSenderEmail) return { processed: 0, disabled: true };
    let processed = 0;
    for (; processed < max; processed += 1) {
      const notification = await claimNotificationEmail();
      if (!notification) break;
      if (!notification.email || notification.email_notifications === false) {
        await q(`UPDATE notifications SET email_status='skipped' WHERE id=$1`, [notification.id]);
        continue;
      }
      try {
        const result = await mailer(
          config,
          notification.email,
          notification.title,
          `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#102a3d"><h2 style="color:#082a3e">${escapeHtml(notification.title)}</h2><p>${escapeHtml(notification.body)}</p><p style="color:#607284;font-size:13px">Apri Home Care per maggiori dettagli.</p></div>`
        );
        await q(
          `UPDATE notifications SET email_status=$2,email_sent_at=CASE WHEN $2='sent' THEN NOW() ELSE email_sent_at END,email_error=$3 WHERE id=$1`,
          [notification.id, result?.sent ? 'sent' : (notification.email_attempts >= 3 ? 'failed' : 'pending'), result?.sent ? null : String(result?.reason || 'Invio non completato').slice(0, 1000)]
        );
      } catch (error) {
        const finalFailure = notification.email_attempts >= 3;
        await q(
          `UPDATE notifications SET email_status=$2,email_error=$3 WHERE id=$1`,
          [notification.id, finalFailure ? 'failed' : 'pending', String(error.message || error).slice(0, 1000)]
        );
      }
    }
    return { processed, disabled: false };
  }

  let timer = null;
  if (!config.isTest) {
    const run = () => flushPendingEmails().catch((error) => console.error('Invio notifiche email non riuscito:', error));
    timer = setInterval(run, 30_000);
    timer.unref?.();
    setTimeout(run, 2_000).unref?.();
  }

  const operations = {
    flushPendingEmails,
    stop() { if (timer) clearInterval(timer); },
  };
  app.locals.operationsV2 = operations;
  return operations;
}

module.exports = { installOperationalFeatures };
