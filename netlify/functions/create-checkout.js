// Netlify Serverless Function: Create Stripe Checkout Session
// Uses Stripe REST API directly (no npm dependencies needed)

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Stripe secret key not configured' }) };
  }

  try {
    const { amount_cents, booking_id, booking_type, customer_email, description } = JSON.parse(event.body);

    if (!amount_cents || !booking_id || !customer_email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    // Determine the origin for redirect URLs
    const origin = event.headers.origin || event.headers.referer?.replace(/\/+$/, '') || 'https://groupridekc.com';

    // Build the Stripe Checkout Session request
    const params = new URLSearchParams({
      'payment_method_types[]': 'card',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][product_data][name]': description || 'Group Ride KC — Deposit',
      'line_items[0][price_data][unit_amount]': String(amount_cents),
      'line_items[0][quantity]': '1',
      'mode': 'payment',
      'success_url': `${origin}?payment=success&booking_id=${booking_id}&type=${booking_type || 'kc'}&session_id={CHECKOUT_SESSION_ID}`,
      'cancel_url': `${origin}?payment=cancelled&booking_id=${booking_id}`,
      'customer_email': customer_email,
      'metadata[booking_id]': booking_id,
      'metadata[booking_type]': booking_type || 'kc',
    });

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const session = await response.json();

    if (session.error) {
      console.error('Stripe error:', session.error);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: session.error.message }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url, sessionId: session.id }),
    };

  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
