// Netlify Function: Admin Manual Reminder
// Handles two actions:
//   action=lookup  — find a booking by ID, phone, or email
//   action=send    — send the balance reminder SMS + email for a booking

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const ADMIN_SECRET    = process.env.ADMIN_SECRET;
  const SUPABASE_URL    = process.env.SUPABASE_URL    || 'https://nysoddktcdzynktrddte.supabase.co';
  const SUPABASE_KEY    = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55c29kZGt0Y2R6eW5rdHJkZHRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MTYyMzAsImV4cCI6MjA4ODk5MjIzMH0.uj4aEhQ0fWog_6OA6ypx5N8Kou871hw7eipgKPIiIDU';
  const RESEND_API_KEY  = process.env.RESEND_API_KEY;
  const QUO_API_KEY     = process.env.QUO_API_KEY;
  const QUO_PHONE_NUMBER_ID = process.env.QUO_PHONE_NUMBER_ID;
  const SITE_URL        = process.env.URL || 'https://groupridekc.com';
  const LOGO_URL        = 'https://groupridekc.netlify.app/images/grkc-logo-van.png';

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { secret, action, query, booking_id } = body;

  // ── Auth check ──
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // ── LIST (dashboard: all bookings 30 days past through future) ──
  if (action === 'list') {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    const r = await sbFetch(
      `${SUPABASE_URL}/rest/v1/bookings?pickup_date=gte.${cutoffDate}&select=*&order=pickup_date.asc,pickup_time.asc&limit=200`,
      SUPABASE_KEY
    );
    const bookings = await r.json();
    return { statusCode: 200, body: JSON.stringify({ bookings: Array.isArray(bookings) ? bookings : [] }) };
  }

  // ── LOOKUP ──
  if (action === 'lookup') {
    if (!query) return { statusCode: 400, body: JSON.stringify({ error: 'Missing search query' }) };

    const q = query.trim();
    let bookings = [];

    // Try ID first
    if (q.length > 20) {
      const r = await sbFetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${q}&select=*`, SUPABASE_KEY);
      bookings = await r.json();
    }

    // Try phone
    if (!bookings?.length) {
      const phone = q.replace(/\D/g, '');
      if (phone.length >= 10) {
        const r = await sbFetch(`${SUPABASE_URL}/rest/v1/bookings?phone=ilike.*${phone.slice(-10)}*&select=*&order=created_at.desc&limit=5`, SUPABASE_KEY);
        bookings = await r.json();
      }
    }

    // Try email
    if (!bookings?.length) {
      const r = await sbFetch(`${SUPABASE_URL}/rest/v1/bookings?email=ilike.*${encodeURIComponent(q)}*&select=*&order=created_at.desc&limit=5`, SUPABASE_KEY);
      bookings = await r.json();
    }

    // Try name
    if (!bookings?.length) {
      const r = await sbFetch(`${SUPABASE_URL}/rest/v1/bookings?customer_name=ilike.*${encodeURIComponent(q)}*&select=*&order=created_at.desc&limit=5`, SUPABASE_KEY);
      bookings = await r.json();
    }

    if (!Array.isArray(bookings) || bookings.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ bookings: [] }) };
    }

    return { statusCode: 200, body: JSON.stringify({ bookings }) };
  }

  // ── SEND REMINDER ──
  if (action === 'send') {
    if (!booking_id) return { statusCode: 400, body: JSON.stringify({ error: 'Missing booking_id' }) };

    const r = await sbFetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${booking_id}&select=*`, SUPABASE_KEY);
    const bookings = await r.json();
    const booking = bookings?.[0];

    if (!booking) return { statusCode: 404, body: JSON.stringify({ error: 'Booking not found' }) };

    const firstName     = (booking.customer_name || 'there').split(' ')[0];
    const total         = parseFloat(booking.total_price) || 0;
    const deposit       = parseFloat(booking.deposit_amount) || 0;
    const balance       = Math.max(0, total - deposit);
    const pickupDateFmt = formatDate(booking.pickup_date);
    const pickupTimeFmt = formatTime(booking.pickup_time);
    const payLink       = `${SITE_URL}/pay?id=${booking.id}`;

    const results = { sms: null, email: null };

    // ── SMS ──
    if (QUO_API_KEY && QUO_PHONE_NUMBER_ID && booking.phone) {
      try {
        let phone = booking.phone.replace(/\D/g, '');
        if (phone.length === 10) phone = '1' + phone;
        if (!phone.startsWith('+')) phone = '+' + phone;

        const smsRes = await fetch('https://api.openphone.com/v1/messages', {
          method: 'POST',
          headers: { Authorization: QUO_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: QUO_PHONE_NUMBER_ID,
            to: [phone],
            content: `Hi ${firstName}! Your Group Ride KC balance of $${balance.toFixed(2)} is due within 24 hours for your ride on ${pickupDateFmt}. Pay now: ${payLink} - If not received by 72 hrs before pickup, we reserve the right to cancel and retain the deposit.`,
          }),
        });
        const smsData = await smsRes.json();
        results.sms = smsRes.ok ? 'sent' : `error: ${JSON.stringify(smsData)}`;
      } catch (e) {
        results.sms = `error: ${e.message}`;
      }
    } else {
      results.sms = 'skipped — missing QUO config or phone';
    }

    // ── Email ──
    if (RESEND_API_KEY && booking.email) {
      try {
        const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f5f5f5;padding:20px;">
  <div style="background:#0a0a0a;color:#fff;border-radius:12px;padding:30px;">
    <div style="text-align:center;margin-bottom:24px;">
      <img src="${LOGO_URL}" alt="Group Ride KC" style="width:180px;height:auto;" />
    </div>
    <h1 style="color:#FFB81C;margin-top:0;text-align:center;">Balance Due Reminder</h1>
    <p style="color:#ddd;font-size:15px;">Hi ${firstName},</p>
    <p style="color:#ddd;font-size:15px;">
      Your Group Ride KC trip is coming up on <strong>${pickupDateFmt} at ${pickupTimeFmt}</strong>.
      Your remaining balance of <strong style="color:#FFB81C;">$${balance.toFixed(2)}</strong> must be received
      within 24 hours to guarantee your ride.
    </p>
    <div style="background:#1a1a1a;border:1px solid #FFB81C;border-radius:10px;padding:20px;margin:24px 0;text-align:center;">
      <p style="color:#FFB81C;font-size:1.1rem;font-weight:bold;margin:0 0 8px;">Balance Due</p>
      <p style="color:#fff;font-size:2rem;font-weight:800;margin:0;">$${balance.toFixed(2)}</p>
    </div>
    <div style="background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:20px;margin:24px 0;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:6px 0;color:#aaa;">Date</td><td style="padding:6px 0;color:#fff;">${pickupDateFmt}</td></tr>
        <tr><td style="padding:6px 0;color:#aaa;">Pickup Time</td><td style="padding:6px 0;color:#fff;">${pickupTimeFmt}</td></tr>
        <tr><td style="padding:6px 0;color:#aaa;">Pickup</td><td style="padding:6px 0;color:#fff;">${booking.pickup_address || 'N/A'}</td></tr>
        <tr><td style="padding:6px 0;color:#aaa;">Drop-off</td><td style="padding:6px 0;color:#fff;">${booking.dropoff_address || 'N/A'}</td></tr>
        <tr><td style="padding:6px 0;color:#aaa;">Total</td><td style="padding:6px 0;color:#fff;">$${total.toFixed(2)}</td></tr>
        <tr><td style="padding:6px 0;color:#aaa;">Deposit Paid</td><td style="padding:6px 0;color:#22c55e;">$${deposit.toFixed(2)}</td></tr>
        <tr><td style="padding:6px 0;color:#FFB81C;font-weight:bold;">Balance Due</td><td style="padding:6px 0;color:#FFB81C;font-weight:bold;">$${balance.toFixed(2)}</td></tr>
      </table>
    </div>
    <div style="text-align:center;margin:30px 0 10px;">
      <a href="${payLink}" style="display:inline-block;background:#E31837;color:#fff;padding:16px 48px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:18px;">
        Pay Balance - $${balance.toFixed(2)}
      </a>
    </div>
    <p style="text-align:center;color:#888;font-size:13px;margin-top:8px;">
      Questions? Call or text us at <a href="tel:+18165526669" style="color:#FFB81C;">(816) 552-6669</a>
    </p>
  </div>
</body>
</html>`;

        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Group Ride KC <bookings@groupridekc.com>',
            to: [booking.email],
            subject: `Balance Due - Your Group Ride KC trip is on ${pickupDateFmt}`,
            html: emailHtml,
          }),
        });
        const emailData = await emailRes.json();
        results.email = emailData.error ? `error: ${emailData.error.message}` : 'sent';
      } catch (e) {
        results.email = `error: ${e.message}`;
      }
    } else {
      results.email = 'skipped — missing Resend config or email';
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, results }) };
  }

  // ── CANCEL REQUEST (customer-initiated, flags for admin review) ──
  if (action === 'cancel_request') {
    if (!booking_id) return { statusCode: 400, body: JSON.stringify({ error: 'Missing booking_id' }) };

    const r = await sbFetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${booking_id}&select=*`, SUPABASE_KEY);
    const bookings = await r.json();
    const booking = bookings?.[0];
    if (!booking) return { statusCode: 404, body: JSON.stringify({ error: 'Booking not found' }) };

    // Mark cancel requested in Supabase
    await sbPatch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${booking_id}`, SUPABASE_KEY, { cancel_requested: true });

    // Notify admin by email
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'GroupRideKC@gmail.com';
    if (RESEND_API_KEY) {
      const firstName    = (booking.customer_name || 'Customer').split(' ')[0];
      const pickupDateFmt = formatDate(booking.pickup_date);
      const pickupTimeFmt = formatTime(booking.pickup_time);
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Group Ride KC <bookings@groupridekc.com>',
          to: [ADMIN_EMAIL],
          subject: `Cancellation Request — ${booking.customer_name} (${pickupDateFmt})`,
          html: `<p><strong>${booking.customer_name}</strong> has requested to cancel their ride on <strong>${pickupDateFmt} at ${pickupTimeFmt}</strong>.</p>
                 <p>Phone: ${booking.phone || 'N/A'} · Email: ${booking.email || 'N/A'}</p>
                 <p>Log in to the <a href="${SITE_URL}/admin-reminders">Admin Portal</a> to confirm or reject the cancellation.</p>`,
        }),
      }).catch(() => {});
    }

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  }

  // ── CANCEL (admin-confirmed, sends customer notifications + optional refund) ──
  if (action === 'cancel') {
    if (!booking_id) return { statusCode: 400, body: JSON.stringify({ error: 'Missing booking_id' }) };

    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'GroupRideKC@gmail.com';

    const r = await sbFetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${booking_id}&select=*`, SUPABASE_KEY);
    const bookings = await r.json();
    const booking = bookings?.[0];
    if (!booking) return { statusCode: 404, body: JSON.stringify({ error: 'Booking not found' }) };

    const firstName     = (booking.customer_name || 'there').split(' ')[0];
    const total         = parseFloat(booking.total_price) || 0;
    const deposit       = parseFloat(booking.deposit_amount) || 0;
    const pickupDateFmt = formatDate(booking.pickup_date);
    const pickupTimeFmt = formatTime(booking.pickup_time);
    const results       = { supabase: null, sms: null, email: null, refund: null };

    // ── Determine refund eligibility (>72 hrs before pickup = 50% deposit back) ──
    let refundAmountCents = 0;
    let refundNote = 'no refund — within 72-hour window';
    if (booking.pickup_date && booking.pickup_time) {
      const pickupUTC  = new Date(`${booking.pickup_date}T${booking.pickup_time}:00Z`);
      const hoursUntil = (pickupUTC - new Date()) / (1000 * 60 * 60);
      if (hoursUntil > 72 && deposit > 0) {
        refundAmountCents = Math.round(deposit * 0.5 * 100);
        refundNote = `50% deposit refund ($${(refundAmountCents / 100).toFixed(2)})`;
      }
    }

    // ── 1. Mark cancelled in Supabase ──
    try {
      await sbPatch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${booking_id}`, SUPABASE_KEY, {
        status: 'cancelled',
        cancel_requested: false,
      });
      results.supabase = 'cancelled';
    } catch (e) { results.supabase = `error: ${e.message}`; }

    // ── 2. Issue Stripe refund if eligible ──
    if (refundAmountCents > 0 && STRIPE_SECRET_KEY && booking.stripe_session_id) {
      try {
        // Retrieve payment_intent from the Stripe session
        const sessionRes  = await fetch(`https://api.stripe.com/v1/checkout/sessions/${booking.stripe_session_id}`, {
          headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
        });
        const sessionData = await sessionRes.json();
        const paymentIntent = sessionData.payment_intent;

        if (paymentIntent) {
          const refundRes = await fetch('https://api.stripe.com/v1/refunds', {
            method: 'POST',
            headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ payment_intent: paymentIntent, amount: String(refundAmountCents) }).toString(),
          });
          const refundData = await refundRes.json();
          results.refund = refundData.error ? `error: ${refundData.error.message}` : `issued: $${(refundAmountCents / 100).toFixed(2)}`;
        } else {
          results.refund = 'skipped — no payment intent on session';
        }
      } catch (e) { results.refund = `error: ${e.message}`; }
    } else if (refundAmountCents === 0) {
      results.refund = refundNote;
    } else {
      results.refund = 'skipped — missing Stripe config or session ID';
    }

    // ── 3. Customer SMS ──
    if (QUO_API_KEY && QUO_PHONE_NUMBER_ID && booking.phone) {
      try {
        let phone = booking.phone.replace(/\D/g, '');
        if (phone.length === 10) phone = '1' + phone;
        if (!phone.startsWith('+')) phone = '+' + phone;
        const smsContent = refundAmountCents > 0
          ? `Hi ${firstName}, your Group Ride KC ride on ${pickupDateFmt} has been cancelled. A refund of $${(refundAmountCents / 100).toFixed(2)} will be returned to your card within 5-10 business days. Questions? Call (816) 552-6669.`
          : `Hi ${firstName}, your Group Ride KC ride on ${pickupDateFmt} has been cancelled. Per our cancellation policy, the deposit is non-refundable within 72 hours of pickup. Questions? Call (816) 552-6669.`;
        const smsRes = await fetch('https://api.openphone.com/v1/messages', {
          method: 'POST',
          headers: { Authorization: QUO_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: QUO_PHONE_NUMBER_ID, to: [phone], content: smsContent }),
        });
        const smsData = await smsRes.json();
        results.sms = smsRes.ok ? 'sent' : `error: ${JSON.stringify(smsData)}`;
      } catch (e) { results.sms = `error: ${e.message}`; }
    } else { results.sms = 'skipped — missing QUO config or phone'; }

    // ── 4. Customer email ──
    if (RESEND_API_KEY && booking.email) {
      try {
        const refundLine = refundAmountCents > 0
          ? `<p style="color:#ddd;font-size:15px;">A refund of <strong style="color:#22c55e;">$${(refundAmountCents / 100).toFixed(2)}</strong> (50% of your deposit) will be returned to your original payment method within 5–10 business days.</p>`
          : `<p style="color:#ddd;font-size:15px;">Per our cancellation policy, the deposit is non-refundable when cancelled within 72 hours of the scheduled pickup.</p>`;

        const emailHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f5f5f5;padding:20px;">
  <div style="background:#0a0a0a;color:#fff;border-radius:12px;padding:30px;">
    <div style="text-align:center;margin-bottom:24px;">
      <img src="${LOGO_URL}" alt="Group Ride KC" style="width:180px;height:auto;" />
    </div>
    <h1 style="color:#E31837;margin-top:0;text-align:center;">Ride Cancelled</h1>
    <p style="color:#ddd;font-size:15px;">Hi ${firstName},</p>
    <p style="color:#ddd;font-size:15px;">Your Group Ride KC ride scheduled for <strong>${pickupDateFmt} at ${pickupTimeFmt}</strong> has been cancelled.</p>
    ${refundLine}
    <p style="color:#ddd;font-size:15px;">We're sorry for any inconvenience. We hope to ride with you again soon!</p>
    <p style="text-align:center;color:#888;font-size:13px;margin-top:24px;">Questions? Call or text <a href="tel:+18165526669" style="color:#FFB81C;">(816) 552-6669</a></p>
  </div>
</body></html>`;

        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Group Ride KC <bookings@groupridekc.com>',
            to: [booking.email],
            bcc: [ADMIN_EMAIL],
            subject: `Your Group Ride KC ride on ${pickupDateFmt} has been cancelled`,
            html: emailHtml,
          }),
        });
        const emailData = await emailRes.json();
        results.email = emailData.error ? `error: ${emailData.error.message}` : 'sent';
      } catch (e) { results.email = `error: ${e.message}`; }
    } else { results.email = 'skipped — missing Resend config or email'; }

    return { statusCode: 200, body: JSON.stringify({ success: true, results, refund_note: refundNote }) };
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Invalid action' }) };
};

// ── Helpers ──
function sbFetch(url, key) {
  return fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
}

function sbPatch(url, key, data) {
  return fetch(url, {
    method: 'PATCH',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(data),
  });
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[1]}/${parts[2]}/${parts[0]}`;
}

function formatTime(timeStr) {
  if (!timeStr) return 'N/A';
  const parts = timeStr.split(':');
  let h = parseInt(parts[0]);
  const m = parts[1] || '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}
