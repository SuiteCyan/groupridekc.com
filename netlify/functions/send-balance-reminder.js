// Netlify Scheduled Function: 96-Hour Balance Reminder
// Runs every hour. Finds bookings with unpaid balance ~96 hours from pickup,
// sends email (Resend) + SMS (OpenPhone/QUO) reminding customer to pay within 24 hours.
// Also notifies admin.
//
// ⚠️  SUPABASE REQUIREMENT: Add a boolean column `balance_reminder_sent` (default false)
//     to your `bookings` table before deploying this function.
//
// Netlify schedule config is in netlify.toml:
//   [functions."send-balance-reminder"]
//   schedule = "@hourly"

exports.handler = async () => {
  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nysoddktcdzynktrddte.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55c29kZGt0Y2R6eW5rdHJkZHRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MTYyMzAsImV4cCI6MjA4ODk5MjIzMH0.uj4aEhQ0fWog_6OA6ypx5N8Kou871hw7eipgKPIiIDU';
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'GroupRideKC@gmail.com';
  const QUO_API_KEY = process.env.QUO_API_KEY;
  const QUO_PHONE_NUMBER_ID = process.env.QUO_PHONE_NUMBER_ID;
  const SITE_URL = process.env.URL || 'https://groupridekc.netlify.app';
  const LOGO_URL = 'https://groupridekc.netlify.app/images/grkc-logo-van.png';

  try {
    // ── Find the date range that corresponds to ~92–100 hours from now ──
    const now = new Date();
    const minPickup = new Date(now.getTime() + 92 * 60 * 60 * 1000);
    const maxPickup = new Date(now.getTime() + 100 * 60 * 60 * 1000);

    // Pull dates we need to scan (may span up to 2 calendar days)
    const datesToCheck = new Set();
    for (let d = new Date(minPickup); d <= maxPickup; d.setDate(d.getDate() + 1)) {
      datesToCheck.add(d.toISOString().slice(0, 10)); // YYYY-MM-DD
    }
    const dateList = Array.from(datesToCheck).join(',');

    // ── Query Supabase: confirmed bookings with deposit_paid + reminder not yet sent ──
    const queryUrl = `${SUPABASE_URL}/rest/v1/bookings?` +
      `select=*` +
      `&status=in.(paid,accepted)` +
      `&payment_status=eq.deposit_paid` +
      `&balance_reminder_sent=eq.false` +
      `&pickup_date=in.(${dateList})`;

    const sbRes = await fetch(queryUrl, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });
    const bookings = await sbRes.json();

    if (!Array.isArray(bookings) || bookings.length === 0) {
      console.log('No bookings needing balance reminder at this time.');
      return { statusCode: 200, body: JSON.stringify({ sent: 0 }) };
    }

    let sent = 0;

    for (const booking of bookings) {
      // ── Build exact pickup datetime (assume America/Chicago = UTC-5/6) ──
      // pickup_date: YYYY-MM-DD, pickup_time: HH:MM
      const pickupDateTimeStr = `${booking.pickup_date}T${booking.pickup_time || '00:00'}:00`;
      // Parse as local Central time using a simple offset heuristic
      // (Netlify functions run UTC — offset 5 or 6 hrs depending on DST)
      const pickupUTC = new Date(pickupDateTimeStr + 'Z'); // treat as UTC for comparison
      const hoursUntilPickup = (pickupUTC - now) / (1000 * 60 * 60);

      // Only send if genuinely in the 92–100 hour window
      if (hoursUntilPickup < 92 || hoursUntilPickup > 100) {
        console.log(`Booking ${booking.id}: ${hoursUntilPickup.toFixed(1)} hrs out — skipping`);
        continue;
      }

      const customerName = booking.customer_name || 'there';
      const firstName = customerName.split(' ')[0];
      const total = parseFloat(booking.total_price) || 0;
      const deposit = parseFloat(booking.deposit_amount) || 0;
      const balance = Math.max(0, total - deposit);
      const pickupDateFmt = formatDate(booking.pickup_date);
      const pickupTimeFmt = formatTime(booking.pickup_time);
      const vehicleLabel = booking.vehicle === 'van' ? '10-Passenger Van' : 'GMC Yukon Denali XL';

      // ── 1. Mark reminder sent FIRST to prevent double-send if function re-runs ──
      await fetch(
        `${SUPABASE_URL}/rest/v1/bookings?id=eq.${booking.id}`,
        {
          method: 'PATCH',
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ balance_reminder_sent: true }),
        }
      );

      // ── 2. Generate Stripe payment link for the balance ──
      let paymentUrl = `${SITE_URL}/#quote-form-container`; // fallback
      try {
        const checkoutRes = await fetch(`${SITE_URL}/.netlify/functions/create-checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount_cents: Math.round(balance * 100),
            booking_id: booking.id,
            booking_type: 'kc',
            customer_email: booking.email,
            description: `Group Ride KC — remaining balance (${vehicleLabel})`,
          }),
        });
        const checkoutData = await checkoutRes.json();
        if (checkoutData.url) paymentUrl = checkoutData.url;
        console.log(`Payment link generated for booking ${booking.id}: ${paymentUrl}`);
      } catch (checkoutErr) {
        console.error(`Failed to generate payment link for booking ${booking.id}:`, checkoutErr.message);
      }

      // ── 3. Send customer email ──
      if (RESEND_API_KEY && booking.email) {
        const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f5f5f5; padding: 20px;">
  <div style="background: #0a0a0a; color: #ffffff; border-radius: 12px; padding: 30px;">
    <div style="text-align: center; margin-bottom: 24px;">
      <img src="${LOGO_URL}" alt="Group Ride KC" style="width: 180px; height: auto;" />
    </div>

    <h1 style="color: #FFB81C; margin-top: 0; text-align: center;">⏰ Balance Due in 24 Hours</h1>

    <p style="color: #ddd; font-size: 15px; line-height: 1.5;">Hi ${firstName},</p>
    <p style="color: #ddd; font-size: 15px; line-height: 1.5;">
      Your Group Ride KC trip is coming up on <strong>${pickupDateFmt} at ${pickupTimeFmt}</strong>!
      Your remaining balance of <strong style="color: #FFB81C;">$${balance.toFixed(2)}</strong> is due
      <strong>within the next 24 hours</strong> (by 72 hours before your pickup).
    </p>

    <div style="background: #1a1a1a; border: 1px solid #FFB81C; border-radius: 10px; padding: 20px; margin: 24px 0; text-align: center;">
      <p style="color: #FFB81C; font-size: 1.1rem; font-weight: bold; margin: 0 0 8px;">Balance Due</p>
      <p style="color: #fff; font-size: 2rem; font-weight: 800; margin: 0;">$${balance.toFixed(2)}</p>
      <p style="color: #aaa; font-size: 0.85rem; margin: 8px 0 0;">Must be received within 24 hours to guarantee your ride</p>
    </div>

    <div style="background: #1a1a1a; border: 1px solid #333; border-radius: 10px; padding: 20px; margin: 24px 0;">
      <h3 style="color: #FFB81C; margin: 0 0 14px; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">Your Trip</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 6px 0; color: #aaa;">Date</td><td style="padding: 6px 0; color: #fff;">${pickupDateFmt}</td></tr>
        <tr><td style="padding: 6px 0; color: #aaa;">Pickup Time</td><td style="padding: 6px 0; color: #fff;">${pickupTimeFmt}</td></tr>
        <tr><td style="padding: 6px 0; color: #aaa;">Pickup</td><td style="padding: 6px 0; color: #fff;">${booking.pickup_address || 'N/A'}</td></tr>
        <tr><td style="padding: 6px 0; color: #aaa;">Drop-off</td><td style="padding: 6px 0; color: #fff;">${booking.dropoff_address || 'N/A'}</td></tr>
        <tr><td style="padding: 6px 0; color: #aaa;">Passengers</td><td style="padding: 6px 0; color: #fff;">${booking.passengers || 'N/A'}</td></tr>
        <tr><td style="padding: 6px 0; color: #aaa;">Total</td><td style="padding: 6px 0; color: #fff;">$${total.toFixed(2)}</td></tr>
        <tr><td style="padding: 6px 0; color: #aaa;">Deposit Paid</td><td style="padding: 6px 0; color: #22c55e;">$${deposit.toFixed(2)}</td></tr>
        <tr><td style="padding: 6px 0; color: #FFB81C; font-weight: bold;">Balance Due</td><td style="padding: 6px 0; color: #FFB81C; font-weight: bold;">$${balance.toFixed(2)}</td></tr>
      </table>
    </div>

    <div style="background: rgba(227,24,55,.1); border: 1px solid rgba(227,24,55,.3); border-radius: 8px; padding: 14px 16px; margin: 16px 0;">
      <p style="font-size: 13px; color: #ccc; margin: 0; line-height: 1.6;">
        <strong style="color: #E31837;">Important:</strong> If the remaining balance is not received within 24 hours,
        Group Ride KC reserves the right to cancel your ride and retain the deposit per our cancellation policy.
      </p>
    </div>

    <div style="text-align: center; margin: 30px 0 10px;">
      <a href="${paymentUrl}" style="display: inline-block; background: #E31837; color: #fff; padding: 16px 48px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 18px;">
        Pay Balance — $${balance.toFixed(2)}
      </a>
    </div>

    <p style="text-align: center; color: #888; font-size: 13px; margin-top: 8px;">
      Questions? Call or text us at <a href="tel:+18165526669" style="color: #FFB81C;">(816) 552-6669</a>
    </p>

    <p style="margin-top: 24px; font-size: 12px; color: #666; text-align: center;">
      Booking ID: ${booking.id}<br/>
      Group Ride KC · Kansas City, MO
    </p>
  </div>
</body>
</html>`;

        try {
          const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'Group Ride KC <bookings@groupridekc.com>',
              to: [booking.email],
              bcc: [ADMIN_EMAIL],
              subject: `⏰ Balance Due — Your Group Ride KC trip is in 4 days (${pickupDateFmt})`,
              html: emailHtml,
            }),
          });
          const emailData = await emailRes.json();
          if (emailData.error) {
            console.error(`Email error for booking ${booking.id}:`, emailData.error);
          } else {
            console.log(`Balance reminder email sent for booking ${booking.id}:`, emailData.id);
          }
        } catch (emailErr) {
          console.error(`Email failed for booking ${booking.id}:`, emailErr.message);
        }
      }

      // ── 3. Send customer SMS ──
      if (QUO_API_KEY && QUO_PHONE_NUMBER_ID && booking.phone) {
        try {
          let phone = booking.phone.replace(/\D/g, '');
          if (phone.length === 10) phone = '1' + phone;
          if (!phone.startsWith('+')) phone = '+' + phone;

          // Shorten the Stripe payment URL via TinyURL
          let shortUrl = paymentUrl;
          try {
            const tinyRes = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(paymentUrl)}`);
            if (tinyRes.ok) shortUrl = await tinyRes.text();
          } catch (e) {
            console.warn('TinyURL shortening failed, using full URL:', e.message);
          }

          const smsRes = await fetch('https://api.openphone.com/v1/messages', {
            method: 'POST',
            headers: { Authorization: QUO_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: QUO_PHONE_NUMBER_ID,
              to: [phone],
              content: `Hi ${firstName}! Your Group Ride KC balance of $${balance.toFixed(2)} is due within 24 hours for your ride on ${pickupDateFmt}. Pay now: ${shortUrl} - If not received by 72 hrs before pickup, we reserve the right to cancel and retain the deposit.`,
            }),
          });
          const smsData = await smsRes.json();
          if (!smsRes.ok) {
            console.error(`SMS error for booking ${booking.id}:`, JSON.stringify(smsData));
          } else {
            console.log(`Balance reminder SMS sent for booking ${booking.id}:`, smsData?.data?.id);
          }
        } catch (smsErr) {
          console.error(`SMS failed for booking ${booking.id}:`, smsErr.message);
        }
      }

      sent++;
      console.log(`Balance reminder sent for booking ${booking.id} — ${customerName}, pickup ${pickupDateFmt}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ sent, checked: bookings.length }),
    };

  } catch (err) {
    console.error('send-balance-reminder error:', err.message || err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// ── Helpers ──
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
