// Health check proxy for Quo (OpenPhone) — verifies API key + GRK phone number active.
// Called by the Suite Cyan hub System Health panel.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

exports.handler = async () => {
  const QUO_API_KEY = process.env.QUO_API_KEY;
  const QUO_PHONE_NUMBER_ID = process.env.QUO_PHONE_NUMBER_ID;

  if (!QUO_API_KEY) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'fail', text: 'QUO_API_KEY missing in Netlify env' }) };
  }

  try {
    // Note: OpenPhone API expects API key directly in Authorization (no "Bearer" prefix)
    const r = await fetch('https://api.openphone.com/v1/phone-numbers', {
      headers: { Authorization: QUO_API_KEY },
    });
    if (!r.ok) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'fail', text: `Quo API HTTP ${r.status}` }) };
    }
    const data = await r.json();
    const phones = data.data || [];
    if (!phones.length) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'fail', text: 'No phone numbers on account' }) };
    }
    if (QUO_PHONE_NUMBER_ID) {
      const ours = phones.find((p) => p.id === QUO_PHONE_NUMBER_ID);
      if (!ours) {
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'warn', text: 'Configured phone ID not in account' }) };
      }
      const num = ours.number || ours.formattedNumber || 'Phone';
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'ok', text: `${num} active` }) };
    }
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'ok', text: `${phones.length} number(s) active` }) };
  } catch (err) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'fail', text: 'Network error: ' + (err.message || 'unknown') }) };
  }
};
