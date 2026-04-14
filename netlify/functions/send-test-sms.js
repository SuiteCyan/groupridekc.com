// Netlify Serverless Function: Diagnostic SMS test endpoint
// Sends a test SMS via Twilio to confirm credentials + toll-free verification status.
//
// Usage (GET or POST):
//   /.netlify/functions/send-test-sms?key=YOUR_SECRET&to=+18165551234&msg=Hello
//
// - `key`  must match the TEST_SMS_SECRET env var. Required.
// - `to`   destination phone (defaults to TWILIO_TEST_TO env var if set).
// - `msg`  message body (optional; falls back to a default test message).
//
// Returns JSON with Twilio's response so you can see message SID, status,
// or any error_code (e.g. 30032 = toll-free not verified).
//
// REMOVE OR DISABLE AFTER TESTING — this endpoint is for diagnostics only.

exports.handler = async (event) => {
  const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
  const TWILIO_AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN;
  const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
  const TEST_SMS_SECRET = process.env.TEST_SMS_SECRET;
  const DEFAULT_TO = process.env.TWILIO_TEST_TO;

  // Combine query string and JSON body so the caller can use either
  const qs = event.queryStringParameters || {};
  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch (_) {}
  const params = { ...qs, ...body };

  // ── Auth: shared secret ──
  if (!TEST_SMS_SECRET) {
    return json(500, { error: 'TEST_SMS_SECRET env var not set on Netlify' });
  }
  if (params.key !== TEST_SMS_SECRET) {
    return json(401, { error: 'Invalid or missing key' });
  }

  // ── Required Twilio config ──
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    return json(500, {
      error: 'Twilio env vars missing',
      have: {
        TWILIO_ACCOUNT_SID: !!TWILIO_ACCOUNT_SID,
        TWILIO_AUTH_TOKEN: !!TWILIO_AUTH_TOKEN,
        TWILIO_PHONE_NUMBER: !!TWILIO_PHONE_NUMBER,
      },
    });
  }

  // ── Destination + message ──
  const rawTo = params.to || DEFAULT_TO;
  if (!rawTo) {
    return json(400, { error: 'Missing "to" phone number (and TWILIO_TEST_TO not set)' });
  }
  const to = normalizePhone(rawTo);
  const msg = params.msg || `Test from Group Ride KC at ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })} CT. If you got this, Twilio is working.`;

  // ── Send via Twilio REST API ──
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ From: TWILIO_PHONE_NUMBER, To: to, Body: msg }),
      }
    );
    const data = await res.json();

    if (data.error_code || data.code) {
      return json(200, {
        success: false,
        from: TWILIO_PHONE_NUMBER,
        to,
        twilio_status: res.status,
        error_code: data.error_code || data.code,
        message: data.message,
        more_info: data.more_info,
        hint: hintFor(data.error_code || data.code),
      });
    }

    return json(200, {
      success: true,
      from: TWILIO_PHONE_NUMBER,
      to,
      sid: data.sid,
      status: data.status,
      date_created: data.date_created,
    });
  } catch (err) {
    return json(500, { error: err.message || String(err) });
  }
};

// ── Helpers ──
function normalizePhone(raw) {
  let p = String(raw).replace(/\D/g, '');
  if (p.length === 10) p = '1' + p;
  if (!p.startsWith('+')) p = '+' + p;
  return p;
}

function hintFor(code) {
  const c = String(code);
  const hints = {
    '21211': 'Invalid "To" phone number — check format (e.g. +18165551234).',
    '21408': 'Permission to send to this region not enabled in Twilio console.',
    '21608': 'Trial accounts can only send to verified numbers. Verify the destination number in Twilio console.',
    '21610': 'The recipient replied STOP. Have them text START to opt back in.',
    '30032': 'Toll-free number not verified. Complete toll-free verification in Twilio console (or use a long code) before sending to unverified destinations.',
    '30034': 'A2P 10DLC registration required for long codes — campaign not approved.',
    '63016': 'Channel not configured for this account / region.',
  };
  return hints[c] || 'See Twilio docs link above for resolution steps.';
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body, null, 2),
  };
}
