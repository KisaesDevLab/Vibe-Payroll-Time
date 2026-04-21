// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Replace the SMTP columns on `company_settings` with EmailIt.com
 * fields. Vibe PT uses EmailIt as its transactional email transport
 * rather than running our own Nodemailer/SMTP client — the appliance
 * has no on-host MTA, and EmailIt's API is HTTPS-only so we don't
 * need port 25/587 open on the NucBox's firewall.
 *
 * Per-company API key + from identity live here (API key encrypted
 * at rest, same AES-256-GCM envelope as the Twilio token). The
 * appliance-wide fallback comes from env vars (EMAILIT_API_KEY etc.)
 * and is only used when a company hasn't configured its own.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('company_settings', (t) => {
    t.dropColumn('smtp_host');
    t.dropColumn('smtp_port');
    t.dropColumn('smtp_user');
    t.dropColumn('smtp_pass_encrypted');
    t.dropColumn('smtp_from');
  });

  await knex.schema.alterTable('company_settings', (t) => {
    // Encrypted EmailIt API key (v1.iv.tag.ct base64url envelope).
    t.text('emailit_api_key_encrypted').nullable();
    t.string('emailit_from_email', 254).nullable();
    t.string('emailit_from_name', 200).nullable();
    // Optional reply-to used by customer-support-type flows.
    t.string('emailit_reply_to', 254).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('company_settings', (t) => {
    t.dropColumn('emailit_api_key_encrypted');
    t.dropColumn('emailit_from_email');
    t.dropColumn('emailit_from_name');
    t.dropColumn('emailit_reply_to');
  });
  await knex.schema.alterTable('company_settings', (t) => {
    t.string('smtp_host', 254).nullable();
    t.integer('smtp_port').nullable();
    t.string('smtp_user', 254).nullable();
    t.text('smtp_pass_encrypted').nullable();
    t.string('smtp_from', 254).nullable();
  });
};
