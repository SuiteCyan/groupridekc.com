// Health check proxy for Resend domain verification status.
// Called by the Suite Cyan hub System Health panel.
// Keeps the RESEND_API_KEY server-side; returns a small JSON with status + text.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

exports.handler = async () => {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'fail', text: 'RESEND_API_KEY missing in Netlify env' }) };
  }

  try {
    const r = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
    });
    if (!r.ok) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'fail', text: `Resend API HTTP ${r.status}` }) };
    }
    const data = await r.json();
    const domains = data.data || [];
    const grk = domains.find((d) => d.name === 'groupridekc.com');

    if (!grk) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'fail', text: 'groupridekc.com not found in Resend account' }) };
    }
    if (grk.status === 'verified') {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'ok', text: 'Domain Verified' }) };
    }
    if (grk.status === 'pending') {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'warn', text: 'Pending verification' }) };
    }
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'fail', text: `Domain status: ${grk.status}` }) };
  } catch (err) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'fail', text: 'Network error: ' + (err.message || 'unknown') }) };
  }
};
