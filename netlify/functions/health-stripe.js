// Health check proxy for Stripe — verifies API key + account active for charges + payouts.
// Called by the Suite Cyan hub System Health panel.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

exports.handler = async () => {
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

  if (!STRIPE_SECRET_KEY) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'fail', text: 'STRIPE_SECRET_KEY missing in Netlify env' }) };
  }

  try {
    const r = await fetch('https://api.stripe.com/v1/account', {
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    });
    if (!r.ok) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'fail', text: `Stripe API HTTP ${r.status}` }) };
    }
    const acct = await r.json();
    const mode = STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'live' : 'test';
    if (!acct.charges_enabled) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'fail', text: `Charges disabled (${mode} mode)` }) };
    }
    if (!acct.payouts_enabled) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'warn', text: `Payouts disabled (${mode} mode)` }) };
    }
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'ok', text: `Account active · ${mode} mode` }) };
  } catch (err) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'fail', text: 'Network error: ' + (err.message || 'unknown') }) };
  }
};
