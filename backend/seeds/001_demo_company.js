// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Demo company seed.
 *
 * Creates "Acme Plumbing Co" as an INTERNAL firm company (is_internal=true)
 * with six employees, three jobs, and ~14 days of realistic time entries
 * covering the payroll-review cases the UI is meant to surface:
 *
 *   - Normal closed shifts (Alice, Bob, Carol, David, Eva full-time-ish)
 *   - An open shift (Alice is currently on the clock)
 *   - A break cycle (Bob is currently on break)
 *   - An auto-closed shift (Frank forgot to punch out at end of day)
 *   - An edited shift (Carol's start time was corrected; audit row follows)
 *   - An admin-created shift (David's missed-punch recovery)
 *   - Mixed sources (kiosk, web, mobile_pwa) + varied IP addresses so the
 *     Punch activity report has something interesting to filter on
 *
 * Idempotent — deletes the demo company first and recreates it. Safe to
 * rerun locally. Does NOT touch users / appliance_settings, so the
 * operator's SuperAdmin login is preserved.
 *
 * Run with:
 *   POSTGRES_DB=vibept npm run seed:run --workspace=backend
 */

/* eslint-disable @typescript-eslint/no-var-requires -- knex seeds run as CJS scripts */
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');

const SLUG = 'acme-plumbing';

// Mini-crypto helpers — duplicate the AES-GCM envelope and HMAC
// fingerprint logic from backend/src/services/crypto.ts so the seed
// stays a plain .js file (the knex CLI convention) without pulling in
// TS services. Formats MUST match what encryptSecret / pinFingerprint
// in crypto.ts produce, or the backend won't be able to decrypt / look
// up what we insert here.
function requireEncryptionKey() {
  const hex = process.env.SECRETS_ENCRYPTION_KEY;
  if (!hex) throw new Error('SECRETS_ENCRYPTION_KEY env var is required for seeding PINs');
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) throw new Error('SECRETS_ENCRYPTION_KEY must be 32 bytes hex');
  return buf;
}

function aesGcmEncrypt(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join(
    '.',
  );
}

function pinFingerprintFn(companyId, pin, key) {
  const derived = crypto.hkdfSync(
    'sha256',
    key,
    Buffer.alloc(0),
    Buffer.from('vibept:pin-fingerprint:v1', 'utf8'),
    32,
  );
  const h = crypto.createHmac('sha256', Buffer.from(derived));
  h.update(`${companyId}:${pin}`);
  return h.digest('hex');
}

async function pinMaterialFor(companyId, pin, key) {
  return {
    pin,
    hash: await bcrypt.hash(pin, 10),
    fingerprint: pinFingerprintFn(companyId, pin, key),
    encrypted: aesGcmEncrypt(pin, key),
  };
}

// Deterministic IPs for the demo so the Punch activity report shows
// clustering by location. No real privacy concern — example ranges only.
const OFFICE_IP = '10.0.1.20';
const KIOSK_IPS = ['10.0.1.51', '10.0.1.52']; // two kiosks at HQ
const HOME_IP = '192.168.1.42';
const REMOTE_IP = '203.0.113.9'; // "suspicious" remote punch

const UA_KIOSK =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 (Kiosk)';
const UA_PHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Version/17 Mobile Safari/604.1';
const UA_WEB =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// NOW is the real current moment (for "currently on the clock" and
// "on break right now" open entries).
// TODAY_NOON is local noon today, used as the anchor for atLocal() so
// setDate(-d) behaves predictably even when the seed runs right after
// midnight local or late at night UTC.
const NOW = new Date();
const TODAY_NOON = new Date(NOW);
TODAY_NOON.setHours(12, 0, 0, 0);
const MS_HOUR = 3_600_000;

function atLocal(daysAgo, hour, minute = 0) {
  const d = new Date(TODAY_NOON);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d;
}

/** knex.raw on Postgres returns { rows, ... } — this trims to just the
 *  first row's id, the only thing callers here need. */
async function uuid(knex) {
  const res = await knex.raw('SELECT gen_random_uuid() AS id');
  return res.rows[0].id;
}

exports.seed = async function seed(knex) {
  // 1. Wipe any previous demo company. FK cascades handle employees,
  //    jobs, time_entries, time_entry_audit, company_settings, etc.
  const existing = await knex('companies').where({ slug: SLUG }).first();
  if (existing) {
    await knex('companies').where({ id: existing.id }).del();
  }

  // 2. Company — marked internal so the demo exercises the
  //    internal_free license state (firm-use, never licensed).
  const [company] = await knex('companies')
    .insert({
      name: 'Acme Plumbing Co',
      slug: SLUG,
      timezone: 'America/Chicago',
      week_start_day: 0,
      pay_period_type: 'bi_weekly',
      is_internal: true,
      license_state: 'internal_free',
    })
    .returning(['id']);

  const companyId = company.id;

  // 3. Company settings
  await knex('company_settings').insert({
    company_id: companyId,
    allow_self_approve: false,
    punch_rounding_mode: 'none',
    punch_rounding_grace_minutes: 0,
  });

  // 4. Jobs
  const jobRows = await knex('jobs')
    .insert([
      { company_id: companyId, code: 'RES', name: 'Residential service' },
      { company_id: companyId, code: 'COM', name: 'Commercial contracts' },
      { company_id: companyId, code: 'EMG', name: 'Emergency after-hours' },
    ])
    .returning(['id', 'code']);
  const jobs = Object.fromEntries(jobRows.map((j) => [j.code, j.id]));

  // 5. Employees. Each gets a deterministic 6-digit PIN (non-weak)
  //    so the demo exercises the PIN-encryption flow and the admin
  //    immediately sees realistic values in the new PIN column.
  const encryptionKey = requireEncryptionKey();
  const seedEmployees = [
    {
      first_name: 'Alice',
      last_name: 'Anderson',
      employee_number: 'E001',
      email: 'alice@acme.demo',
      hired_at: atLocal(400, 9),
      pin: '100623',
    },
    {
      first_name: 'Bob',
      last_name: 'Burns',
      employee_number: 'E002',
      email: 'bob@acme.demo',
      hired_at: atLocal(320, 9),
      pin: '204816',
    },
    {
      first_name: 'Carol',
      last_name: 'Chen',
      employee_number: 'E003',
      email: 'carol@acme.demo',
      hired_at: atLocal(210, 9),
      pin: '307291',
    },
    {
      first_name: 'David',
      last_name: 'Davis',
      employee_number: 'E004',
      email: 'david@acme.demo',
      hired_at: atLocal(180, 9),
      pin: '401375',
    },
    {
      first_name: 'Eva',
      last_name: 'Estes',
      employee_number: 'E005',
      email: 'eva@acme.demo',
      hired_at: atLocal(90, 9),
      pin: '508264',
    },
    {
      first_name: 'Frank',
      last_name: 'Fox',
      employee_number: 'E006',
      email: 'frank@acme.demo',
      hired_at: atLocal(60, 9),
      pin: '603571',
    },
  ];

  const insertRows = await Promise.all(
    seedEmployees.map(async (e) => {
      const m = await pinMaterialFor(companyId, e.pin, encryptionKey);
      return {
        company_id: companyId,
        first_name: e.first_name,
        last_name: e.last_name,
        employee_number: e.employee_number,
        email: e.email,
        status: 'active',
        hired_at: e.hired_at,
        pin_hash: m.hash,
        pin_fingerprint: m.fingerprint,
        pin_encrypted: m.encrypted,
      };
    }),
  );

  const employeeRows = await knex('employees').insert(insertRows).returning(['id', 'first_name']);
  const emp = Object.fromEntries(employeeRows.map((e) => [e.first_name, e.id]));

  // 6. Time entries. Rather than hand-writing every row, define each
  //    employee's shift pattern and emit entries programmatically.
  //    Shifts older than 72h never match the offline-punch rule, so we
  //    set source_offline=false for everything here.

  const insertedEntries = [];

  // Helper: one complete closed work shift with optional mid-day break.
  // Skips (no-op) if the shift's end hour is in the future — so seeding
  // today's shift only works when the seed runs after the end of day.
  async function shift(opts) {
    const {
      employeeId,
      daysAgo,
      startHour,
      endHour,
      jobCode,
      source = 'kiosk',
      deviceId = `kiosk:${KIOSK_IPS[0]}`,
      ip = KIOSK_IPS[0],
      ua = UA_KIOSK,
      withBreak = false,
      createdBy = null,
    } = opts;
    // Guard: don't seed a shift whose end is in the future. Applies
    // mainly to "today" (d=0) when the seed runs mid-day.
    const endCheck = atLocal(daysAgo, opts.endHour);
    if (endCheck > NOW) return;

    const shiftId = await uuid(knex);

    const startA = atLocal(daysAgo, startHour);
    if (withBreak) {
      // Split into morning work + 30-min break + afternoon work.
      const breakStart = atLocal(daysAgo, 12, 0);
      const breakEnd = atLocal(daysAgo, 12, 30);
      const endB = atLocal(daysAgo, endHour);

      insertedEntries.push({
        company_id: companyId,
        employee_id: employeeId,
        shift_id: shiftId,
        entry_type: 'work',
        job_id: jobs[jobCode],
        started_at: startA,
        ended_at: breakStart,
        duration_seconds: Math.floor((breakStart - startA) / 1000),
        source,
        source_device_id: deviceId,
        source_offline: false,
        source_ip: ip,
        source_user_agent: ua,
        created_by: createdBy,
      });
      insertedEntries.push({
        company_id: companyId,
        employee_id: employeeId,
        shift_id: shiftId,
        entry_type: 'break',
        job_id: null,
        started_at: breakStart,
        ended_at: breakEnd,
        duration_seconds: Math.floor((breakEnd - breakStart) / 1000),
        source,
        source_device_id: deviceId,
        source_offline: false,
        source_ip: ip,
        source_user_agent: ua,
        created_by: createdBy,
      });
      insertedEntries.push({
        company_id: companyId,
        employee_id: employeeId,
        shift_id: shiftId,
        entry_type: 'work',
        job_id: jobs[jobCode],
        started_at: breakEnd,
        ended_at: endB,
        duration_seconds: Math.floor((endB - breakEnd) / 1000),
        source,
        source_device_id: deviceId,
        source_offline: false,
        source_ip: ip,
        source_user_agent: ua,
        created_by: createdBy,
      });
    } else {
      const endA = atLocal(daysAgo, endHour);
      insertedEntries.push({
        company_id: companyId,
        employee_id: employeeId,
        shift_id: shiftId,
        entry_type: 'work',
        job_id: jobs[jobCode],
        started_at: startA,
        ended_at: endA,
        duration_seconds: Math.floor((endA - startA) / 1000),
        source,
        source_device_id: deviceId,
        source_offline: false,
        source_ip: ip,
        source_user_agent: ua,
        created_by: createdBy,
      });
    }
  }

  // Alice: Mon-Fri 8-4 with a break each day (going back 14 days).
  for (let d = 28; d >= 0; d--) {
    const dayOfWeek = new Date(atLocal(d, 9)).getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;
    await shift({
      employeeId: emp.Alice,
      daysAgo: d,
      startHour: 8,
      endHour: 16,
      jobCode: 'RES',
      withBreak: true,
    });
  }
  // Alice is currently on the clock — open entry starting 2 hours ago.
  {
    const shiftId = await uuid(knex);
    insertedEntries.push({
      company_id: companyId,
      employee_id: emp.Alice,
      shift_id: shiftId,
      entry_type: 'work',
      job_id: jobs.RES,
      started_at: new Date(NOW.getTime() - 2 * MS_HOUR),
      ended_at: null,
      duration_seconds: null,
      source: 'kiosk',
      source_device_id: `kiosk:${KIOSK_IPS[0]}`,
      source_offline: false,
      source_ip: KIOSK_IPS[0],
      source_user_agent: UA_KIOSK,
      created_by: null,
    });
  }

  // Bob: Mon-Fri 9-5, second kiosk.
  for (let d = 28; d >= 0; d--) {
    const dayOfWeek = new Date(atLocal(d, 9)).getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;
    await shift({
      employeeId: emp.Bob,
      daysAgo: d,
      startHour: 9,
      endHour: 17,
      jobCode: 'COM',
      deviceId: `kiosk:${KIOSK_IPS[1]}`,
      ip: KIOSK_IPS[1],
    });
  }
  // Bob is currently on break. One closed work entry started 1h ago, one open break entry started 15m ago.
  {
    const shiftId = await uuid(knex);
    const workStart = new Date(NOW.getTime() - 1 * MS_HOUR);
    const breakStart = new Date(NOW.getTime() - 15 * 60 * 1000);
    insertedEntries.push({
      company_id: companyId,
      employee_id: emp.Bob,
      shift_id: shiftId,
      entry_type: 'work',
      job_id: jobs.COM,
      started_at: workStart,
      ended_at: breakStart,
      duration_seconds: Math.floor((breakStart - workStart) / 1000),
      source: 'kiosk',
      source_device_id: `kiosk:${KIOSK_IPS[1]}`,
      source_offline: false,
      source_ip: KIOSK_IPS[1],
      source_user_agent: UA_KIOSK,
      created_by: null,
    });
    insertedEntries.push({
      company_id: companyId,
      employee_id: emp.Bob,
      shift_id: shiftId,
      entry_type: 'break',
      job_id: null,
      started_at: breakStart,
      ended_at: null,
      duration_seconds: null,
      source: 'kiosk',
      source_device_id: `kiosk:${KIOSK_IPS[1]}`,
      source_offline: false,
      source_ip: KIOSK_IPS[1],
      source_user_agent: UA_KIOSK,
      created_by: null,
    });
  }

  // Carol: Mon/Tue/Thu 7-3, mobile_pwa from home IP.
  for (let d = 28; d >= 0; d--) {
    const dayOfWeek = new Date(atLocal(d, 9)).getDay();
    if (![1, 2, 4].includes(dayOfWeek)) continue;
    await shift({
      employeeId: emp.Carol,
      daysAgo: d,
      startHour: 7,
      endHour: 15,
      jobCode: 'COM',
      source: 'mobile_pwa',
      deviceId: 'ua:phone',
      ip: HOME_IP,
      ua: UA_PHONE,
    });
  }

  // David: Tue/Wed/Fri 10-4, only a handful of shifts. One of them is
  // admin-created (missed punch — see below).
  for (let d = 28; d >= 0; d--) {
    const dayOfWeek = new Date(atLocal(d, 9)).getDay();
    if (![2, 3, 5].includes(dayOfWeek)) continue;
    await shift({
      employeeId: emp.David,
      daysAgo: d,
      startHour: 10,
      endHour: 16,
      jobCode: 'RES',
      source: 'mobile_pwa',
      deviceId: 'ua:phone',
      ip: HOME_IP,
      ua: UA_PHONE,
    });
  }

  // Eva: weekends only (Sat-Sun 10-6). A couple shifts in the past 2 weeks.
  for (let d = 28; d >= 0; d--) {
    const dayOfWeek = new Date(atLocal(d, 9)).getDay();
    if (![0, 6].includes(dayOfWeek)) continue;
    await shift({
      employeeId: emp.Eva,
      daysAgo: d,
      startHour: 10,
      endHour: 18,
      jobCode: 'EMG',
      source: 'mobile_pwa',
      deviceId: 'ua:phone',
      ip: REMOTE_IP,
      ua: UA_PHONE,
    });
  }

  // Frank: one normal shift three days ago, PLUS an auto-closed shift
  // two days ago (forgot to punch out; cron closed at 23:59:59).
  await shift({
    employeeId: emp.Frank,
    daysAgo: 3,
    startHour: 9,
    endHour: 17,
    jobCode: 'COM',
  });
  {
    const shiftId = await uuid(knex);
    const start = atLocal(2, 9);
    const endOfDay = atLocal(2, 23, 59);
    insertedEntries.push({
      company_id: companyId,
      employee_id: emp.Frank,
      shift_id: shiftId,
      entry_type: 'work',
      job_id: jobs.COM,
      started_at: start,
      ended_at: endOfDay,
      duration_seconds: Math.floor((endOfDay - start) / 1000),
      source: 'kiosk',
      source_device_id: `kiosk:${KIOSK_IPS[0]}`,
      source_offline: false,
      source_ip: KIOSK_IPS[0],
      source_user_agent: UA_KIOSK,
      is_auto_closed: true,
      created_by: null,
    });
  }

  // Bulk insert all closed/open entries we accumulated.
  const returnedRows = await knex('time_entries')
    .insert(insertedEntries)
    .returning(['id', 'employee_id', 'started_at']);

  // 7. Demo edit — Carol's most-recent shift had its start time "corrected"
  //    (we claim the admin found a clock drift). Show an audit row for it.
  //    Pick any closed Carol entry to attach the edit to.
  const carolEntry = returnedRows.find(
    (r) => r.employee_id === emp.Carol && new Date(r.started_at) < NOW,
  );
  if (carolEntry) {
    const originalStart = new Date(carolEntry.started_at);
    const newStart = new Date(originalStart.getTime() - 12 * 60 * 1000);
    await knex('time_entries').where({ id: carolEntry.id }).update({
      started_at: newStart,
      edit_reason: 'Clock drift — Carol reported punching in 12 min later than actual.',
    });
    await knex('time_entry_audit').insert({
      time_entry_id: carolEntry.id,
      company_id: companyId,
      actor_user_id: null,
      action: 'edit',
      field: 'started_at',
      old_value: JSON.stringify(originalStart.toISOString()),
      new_value: JSON.stringify(newStart.toISOString()),
      reason: 'Clock drift — Carol reported punching in 12 min later than actual.',
    });
  }

  // 8. Demo admin-created entry — David's "missed punch" on day 4.
  {
    const shiftId = await uuid(knex);
    const start = atLocal(4, 10);
    const end = atLocal(4, 16);
    const [created] = await knex('time_entries')
      .insert({
        company_id: companyId,
        employee_id: emp.David,
        shift_id: shiftId,
        entry_type: 'work',
        job_id: jobs.RES,
        started_at: start,
        ended_at: end,
        duration_seconds: Math.floor((end - start) / 1000),
        source: 'web',
        source_device_id: 'web-admin-demo',
        source_offline: false,
        source_ip: OFFICE_IP,
        source_user_agent: UA_WEB,
        edit_reason: 'Missed punch — David was on site, confirmed by dispatch log.',
        created_by: null,
      })
      .returning(['id']);
    await knex('time_entry_audit').insert({
      time_entry_id: created.id,
      company_id: companyId,
      actor_user_id: null,
      action: 'create',
      reason: 'Missed punch — David was on site, confirmed by dispatch log.',
      new_value: JSON.stringify({
        entryType: 'work',
        startedAt: start.toISOString(),
        endedAt: end.toISOString(),
      }),
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    `[seed] Demo company "${SLUG}" created: ${employeeRows.length} employees, ` +
      `${jobRows.length} jobs, ${insertedEntries.length + 1} entries. ` +
      `Open shift: Alice. On break: Bob. Auto-closed: Frank. Edited: Carol. Admin-created: David.`,
  );
};
