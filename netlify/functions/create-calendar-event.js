// Netlify Serverless Function: Create Google Calendar Event for new bookings
// Uses Google Calendar REST API with a service account (no npm dependencies)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // Netlify stores env vars with literal \n — replace with real newlines
  const GOOGLE_PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

  console.log('ENV CHECK — email:', !!GOOGLE_SERVICE_ACCOUNT_EMAIL, 'key:', !!GOOGLE_PRIVATE_KEY, 'key length:', (GOOGLE_PRIVATE_KEY||'').length, 'calId:', !!GOOGLE_CALENDAR_ID);

  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !GOOGLE_CALENDAR_ID) {
    console.warn('Google Calendar credentials not configured — skipping event creation');
    console.warn('Missing:', !GOOGLE_SERVICE_ACCOUNT_EMAIL ? 'EMAIL' : '', !GOOGLE_PRIVATE_KEY ? 'KEY' : '', !GOOGLE_CALENDAR_ID ? 'CAL_ID' : '');
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'Calendar not configured' }) };
  }

  try {
    const booking = JSON.parse(event.body);

    // ── Build JWT for Google OAuth2 ──
    const jwt = await createSignedJWT(GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY);

    // ── Exchange JWT for access token ──
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('Token error:', tokenData);
      throw new Error('Failed to get Google access token');
    }

    // ── Build calendar event ──
    const startDateTime = buildDateTime(booking.pickup_date, booking.pickup_time);
    // Estimate 2-hour event duration (pickup + ride + buffer)
    // Keep same bare-local format as startDateTime (no Z suffix) so Google uses the timeZone field
    const [datePart, timePart] = startDateTime.split('T');
    const [hh, mm] = timePart.split(':').map(Number);
    const endHH = String(hh + 2).padStart(2, '0');
    const endDateTime = `${datePart}T${endHH}:${String(mm).padStart(2, '0')}:00`;

    const vehicleLabel = booking.vehicle === 'van' ? '🚐 10-Passenger Van' : '🚙 Chevy Suburban';
    const tripLabel = booking.trip_type === 'round_trip' ? 'Round Trip' : 'One-Way';
    const bookingType = booking.booking_type || 'kc';
    const typeTag = bookingType === 'loto' ? '🏖️ LOTO' : '⚽ KC';

    const calEvent = {
      summary: `${typeTag} ${vehicleLabel} — ${booking.passengers || '?'}p — ${booking.customer_name || booking.phone || 'No name'}`,
      description: [
        `📋 Booking #${booking.booking_id || 'N/A'}`,
        `🔄 Trip Type: ${tripLabel}`,
        `👥 Passengers: ${booking.passengers || '?'}`,
        `📱 Phone: ${booking.phone || 'N/A'}`,
        `📧 Email: ${booking.email || 'N/A'}`,
        ``,
        `📍 Pickup: ${booking.pickup_address || 'N/A'}`,
        `📍 Drop-off: ${booking.dropoff_address || 'N/A'}`,
        booking.route_miles ? `🛣️ Distance: ${booking.route_miles} mi` : '',
        ``,
        `💰 Total: $${booking.total_price || '?'}`,
        `💳 Deposit: $${booking.deposit_amount || '?'}`,
        `📊 Payment: ${booking.payment_status || 'pending'}`,
        ``,
        `Source: ${booking.source_page || 'unknown'}`,
      ].filter(Boolean).join('\n'),
      location: booking.pickup_address || '',
      start: {
        dateTime: startDateTime,
        timeZone: 'America/Chicago',
      },
      end: {
        dateTime: endDateTime,
        timeZone: 'America/Chicago',
      },
      colorId: bookingType === 'loto' ? '7' : '11', // Peacock for LOTO, Tomato for KC
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 60 },
          { method: 'popup', minutes: 15 },
        ],
      },
    };

    // ── Create the event ──
    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(calEvent),
      }
    );

    const calData = await calRes.json();
    if (calData.error) {
      console.error('Calendar API error:', calData.error);
      throw new Error(calData.error.message);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: calData.id, htmlLink: calData.htmlLink }),
    };

  } catch (err) {
    console.error('Calendar function error:', err.message || err);
    console.error('Stack:', err.stack || 'no stack');
    // Return 200 anyway so the booking flow isn't blocked by calendar issues
    return {
      statusCode: 200,
      body: JSON.stringify({ error: err.message, skipped: true }),
    };
  }
};

// ── Helper: Build ISO datetime from date + time strings ──
function buildDateTime(dateStr, timeStr) {
  // dateStr: "2026-06-15", timeStr: "14:30" or "2:30 PM"
  if (!dateStr) return new Date().toISOString();

  let hours = 12, minutes = 0;
  if (timeStr) {
    // Handle "HH:MM" or "H:MM AM/PM"
    const pmMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (pmMatch) {
      hours = parseInt(pmMatch[1]);
      minutes = parseInt(pmMatch[2]);
      if (pmMatch[3]) {
        const period = pmMatch[3].toUpperCase();
        if (period === 'PM' && hours !== 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;
      }
    }
  }

  // Build as Central Time (America/Chicago)
  const pad = (n) => String(n).padStart(2, '0');
  return `${dateStr}T${pad(hours)}:${pad(minutes)}:00`;
}

// ── Helper: Create a signed JWT for Google service account auth ──
// Pure JS implementation — no npm dependencies
async function createSignedJWT(clientEmail, privateKeyPEM) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/calendar.events',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const encoder = new TextEncoder();
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  // Import the PEM private key
  const key = await importPrivateKey(privateKeyPEM);

  // Sign with RS256
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    encoder.encode(signingInput)
  );

  const signatureB64 = base64url(signature);
  return `${signingInput}.${signatureB64}`;
}

function base64url(input) {
  let str;
  if (typeof input === 'string') {
    str = Buffer.from(input).toString('base64');
  } else {
    str = Buffer.from(new Uint8Array(input)).toString('base64');
  }
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPrivateKey(pem) {
  // Remove PEM header/footer and newlines
  const pemBody = pem
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, '')
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');

  const binaryKey = Buffer.from(pemBody, 'base64');

  return crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}
