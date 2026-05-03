// Netlify Function: Customer Portal
// Handles:
//   action=login        — verify email + booking ID, return booking data
//   action=cancel_request — flag booking for admin cancellation review

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL    || 'https://nysoddktcdzynktrddte.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55c29kZGt0Y2R6eW5rdHJkZHRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MTYyMzAsImV4cCI6MjA4ODk5MjIzMH0.uj4aEhQ0fWog_6OA6ypx5N8Kou871hw7eipgKPIiIDU';
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const ADMIN_EMAIL  = process.env.ADMIN_EMAIL || 'GroupRideKC@gmail.com';
  const SITE_URL     = process.env.URL || 'https://groupridekc.com';

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { action, email, booking_id } = body;

  // Both actions require email + booking_id
  if (!email || !booking_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing email or booking_id' }) };
  }

  // Look up booking — must match both email AND id
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(booking_id)}&email=ilike.${encodeURIComponent(email.trim())}&select=*`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const rows = await res.json();
  const booking = rows?.[0];

  // Generic auth failure — don't reveal which field was wrong
  if (!booking) {
    return { statusCode: 401, body: JSON.stringify({ error: 'No booking found with that email and booking ID.' }) };
  }

  // ── LOGIN — return safe booking data ──
  if (action === 'login') {
    // Strip sensitive internal fields before sending to customer
    const safe = {
      id:               booking.id,
      customer_name:    booking.customer_name,
      email:            booking.email,
      phone:            booking.phone,
      pickup_date:      booking.pickup_date,
      pickup_time:      booking.pickup_time,
      pickup_address:   booking.pickup_address,
      dropoff_address:  booking.dropoff_address,
      passengers:       booking.passengers,
      total_price:      booking.total_price,
      deposit_amount:   booking.deposit_amount,
      payment_status:   booking.payment_status,
      status:           booking.status,
      cancel_requested: booking.cancel_requested,
      notes:            booking.notes,
    };
    return { statusCode: 200, body: JSON.stringify({ booking: safe }) };
  }

  // ── CANCEL REQUEST ──
  if (action === 'cancel_request') {
    if (booking.status === 'cancelled') {
      return { statusCode: 400, body: JSON.stringify({ error: 'This booking is already cancelled.' }) };
    }
    if (booking.cancel_requested) {
      return { statusCode: 400, body: JSON.stringify({ error: 'A cancellation request has already been submitted. We will be in touch soon.' }) };
    }

    // Flag in Supabase
    await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${booking.id}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ cancel_requested: true }),
    });

    // Notify admin
    const pickupDateFmt = formatDate(booking.pickup_date);
    const pickupTimeFmt = formatTime(booking.pickup_time);
    if (RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Group Ride KC <bookings@groupridekc.com>',
          to: [ADMIN_EMAIL],
          subject: `ACTION REQUIRED: Cancellation Request — ${booking.customer_name} (${pickupDateFmt})`,
          html: `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#f5f5f5;padding:20px;">
  <div style="background:#0a0a0a;border-radius:12px;padding:28px;">
    <h2 style="color:#E31837;margin-top:0;">Cancellation Request</h2>
    <p style="color:#ddd;font-size:15px;"><strong style="color:#fff;">${booking.customer_name}</strong> has requested to cancel their ride.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr><td style="color:#888;padding:6px 0;width:110px;">Date</td><td style="color:#fff;">${pickupDateFmt} at ${pickupTimeFmt}</td></tr>
      <tr><td style="color:#888;padding:6px 0;">Phone</td><td style="color:#fff;">${booking.phone || 'N/A'}</td></tr>
      <tr><td style="color:#888;padding:6px 0;">Email</td><td style="color:#fff;">${booking.email || 'N/A'}</td></tr>
      <tr><td style="color:#888;padding:6px 0;">Pickup</td><td style="color:#fff;">${booking.pickup_address || 'N/A'}</td></tr>
    </table>
    <div style="background:#1a1a1a;border:1px solid #FFB81C;border-radius:8px;padding:16px;margin:20px 0;">
      <p style="color:#FFB81C;font-weight:bold;margin:0 0 10px;">To cancel this ride:</p>
      <ol style="color:#ddd;font-size:14px;margin:0;padding-left:18px;line-height:2;">
        <li>Click the button below to open the Admin Portal</li>
        <li>Log in with your admin password</li>
        <li>Click the <strong style="color:#fff;">"Cancel Requests"</strong> filter at the top</li>
        <li>Find <strong style="color:#fff;">${booking.customer_name}</strong> and expand their booking</li>
        <li>Click <strong style="color:#fff;">"Cancel Ride"</strong> and confirm</li>
      </ol>
    </div>
    <div style="text-align:center;margin:24px 0 8px;">
      <a href="${SITE_URL}/admin-reminders" style="display:inline-block;background:#E31837;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;">Open Admin Portal</a>
    </div>
    <p style="color:#666;font-size:12px;text-align:center;margin-top:16px;">If you do not want to approve this cancellation, simply take no action. The booking will remain active.</p>
  </div>
</div>`,
        }),
      }).catch(() => {});
    }

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Invalid action' }) };
};

// ── Helpers ──
function formatDate(d) {
  if (!d) return 'N/A';
  const p = d.split('-');
  return p.length === 3 ? `${p[1]}/${p[2]}/${p[0]}` : d;
}
function formatTime(t) {
  if (!t) return 'N/A';
  const p = t.split(':');
  let h = parseInt(p[0]);
  const m = p[1] || '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12; else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}
