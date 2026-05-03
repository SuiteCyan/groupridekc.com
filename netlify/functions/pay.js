// Netlify Function: Balance Payment Redirect
// URL: groupridekc.com/pay?id=[booking_id]
// Looks up the booking, generates a fresh Stripe checkout for the remaining balance,
// and redirects the customer directly to Stripe — no interstitial pages.

exports.handler = async (event) => {
  const bookingId = event.queryStringParameters?.id;

  if (!bookingId) {
    return htmlError('Missing booking ID. Please use the link from your reminder email or call us at (816) 552-6669.');
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nysoddktcdzynktrddte.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55c29kZGt0Y2R6eW5rdHJkZHRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MTYyMzAsImV4cCI6MjA4ODk5MjIzMH0.uj4aEhQ0fWog_6OA6ypx5N8Kou871hw7eipgKPIiIDU';
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const SITE_URL = process.env.URL || 'https://groupridekc.com';

  if (!STRIPE_SECRET_KEY) {
    return htmlError('Payment system not configured. Please call us at (816) 552-6669.');
  }

  try {
    // Look up the booking in Supabase
    const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}&select=*`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });
    const bookings = await sbRes.json();
    const booking = bookings?.[0];

    if (!booking) {
      return htmlError('Booking not found. Please call us at (816) 552-6669.');
    }

    const total = parseFloat(booking.total_price) || 0;
    const deposit = parseFloat(booking.deposit_amount) || 0;
    const balance = Math.max(0, total - deposit);

    // If already paid in full, show a friendly message instead of a $0 checkout
    if (balance <= 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
        body: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Already Paid — Group Ride KC</title>
<style>body{font-family:sans-serif;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center;}
.card{background:#141414;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:40px;max-width:420px;}
h2{color:#22c55e;margin-top:0;}p{color:rgba(255,255,255,.65);line-height:1.6;}
a{color:#FDB913;}</style>
</head>
<body><div class="card">
<h2>You're all paid up!</h2>
<p>Your balance has already been received. No further payment is needed.</p>
<p>Questions? Call or text us at <a href="tel:+18165526669">(816) 552-6669</a>.</p>
</div></body></html>`,
      };
    }

    // Generate a fresh Stripe Checkout session for the remaining balance
    const params = new URLSearchParams({
      'payment_method_types[]': 'card',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][product_data][name]': 'Group Ride KC — Remaining Balance',
      'line_items[0][price_data][unit_amount]': String(Math.round(balance * 100)),
      'line_items[0][quantity]': '1',
      'mode': 'payment',
      'success_url': `${SITE_URL}?payment=success&booking_id=${bookingId}&type=kc&session_id={CHECKOUT_SESSION_ID}`,
      'cancel_url': `${SITE_URL}?payment=cancelled&booking_id=${bookingId}`,
      'metadata[booking_id]': bookingId,
      'metadata[booking_type]': 'kc',
    });

    if (booking.email) params.set('customer_email', booking.email);

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const session = await stripeRes.json();

    if (session.error || !session.url) {
      console.error('Stripe error in pay.js:', session.error);
      return htmlError('Could not generate your payment link. Please call us at (816) 552-6669.');
    }

    // Redirect straight to Stripe — no interstitial
    return {
      statusCode: 302,
      headers: { Location: session.url },
      body: '',
    };

  } catch (err) {
    console.error('pay.js error:', err.message);
    return htmlError('Something went wrong. Please call us at (816) 552-6669.');
  }
};

function htmlError(message) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Error — Group Ride KC</title>
<style>body{font-family:sans-serif;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center;}
.card{background:#141414;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:40px;max-width:420px;}
h2{color:#E31837;margin-top:0;}p{color:rgba(255,255,255,.65);line-height:1.6;}
a{color:#FDB913;}</style>
</head>
<body><div class="card">
<h2>Something went wrong</h2>
<p>${message}</p>
</div></body></html>`,
  };
}
