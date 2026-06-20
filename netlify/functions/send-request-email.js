// Netlify Scheduled Function: Post-Ride Review Request
// Runs every hour. Finds bookings where the pickup was 2–4 hours ago (ride likely complete),
// sends a review request email + SMS, and marks review_request_sent = true.
//
// ⚠️  SUPABASE REQUIREMENT: Add a boolean column `review_request_sent` (default false)
//     to your `bookings` table before deploying this function.
//
// ⚠️  NETLIFY ENV VAR: Set GMB_REVIEW_URL to your Google My Business review link.
//     Format once verified: https://g.page/r/[YOUR_PLACE_ID]/review
//     Until verified, requests will use the fallback URL below.
//
// Netlify schedule config is in netlify.toml:
//   [functions."send-review-request"]
//   schedule = "@hourly"

exports.handler = async () => {
  const SUPABASE_URL    = process.env.SUPABASE_URL || 'https://nysoddktcdzynktrddte.supabase.co';
  const SUPABASE_KEY    = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55c29kZGt0Y2R6eW5rdHJkZHRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MTYyMzAsImV4cCI6MjA4ODk5MjIzMH0.uj4aEhQ0fWog_6OA6ypx5N8Kou871hw7eipgKPIiIDU';
  const RESEND_API_KEY  = process.env.RESEND_API_KEY;
  const QUO_API_KEY     = process.env.QUO_API_KEY;
  const QUO_PHONE_NUMBER_ID = process.env.QUO_PHONE_NUMBER_ID;
  const SITE_URL        = process.env.URL || 'https://groupridekc.com';
  const LOGO_URL        = 'https://groupridekc.netlify.app/images/grkc-logo-van.png';
  // Update GMB_REVIEW_URL in Netlify env vars once Google My Business is verified
  const REVIEW_URL      = process.env.GMB_REVIEW_URL || 'https://groupridekc.com/leave-a-review';

  try {
    const now = new Date();

    // Find dates/times in the 2–4 hour window behind now
    // We query by pickup_date for efficiency, then filter by exact time in JS
    const minPickup = new Date(now.getTime() - 4 * 60 * 60 * 1000);
    const maxPickup = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    const datesToCheck = new Set();
    for (let d = new Date(minPickup); d <= maxPickup; d.setDate(d.getDate() + 1)) {
      datesToCheck.add(d.toISOString().slice(0, 10));
    }
    const dateList = Array.from(datesToCheck).join(',');

    // Query: paid bookings in date range, review not yet sent
    const queryUrl = `${SUPABASE_URL}/rest/v1/bookings?` +
      `select=*` +
      `&status=in.(paid,accepted)` +
      `&review_request_sent=eq.false` +
      `&pickup_date=in.(${dateList})`;

    const sbRes   = await fetch(queryUrl, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    const bookings = await sbRes.json();

    if (!Array.isArray(bookings) || bookings.length === 0) {
      console.log('No rides completed in review window at this time.');
      return { statusCode: 200, body: JSON.stringify({ sent: 0 }) };
    }

    let sent = 0;

    for (const booking of bookings) {
      // Build exact pickup datetime in Central Time (pickup_time is stored as America/Chicago).
      // Determine the correct UTC offset for this date — handles CDT vs CST automatically.
      const sampleUtc = new Date(`${booking.pickup_date}T12:00:00Z`);
      const tzOffset = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        timeZoneName: 'longOffset',
      }).formatToParts(sampleUtc).find(p => p.type === 'timeZoneName').value.replace('GMT', '');
      const pickup = new Date(`${booking.pickup_date}T${booking.pickup_time || '00:00'}:00${tzOffset}`);
      const hoursAfterPickup = (now - pickup) / (1000 * 60 * 60);

      if (hoursAfterPickup < 2 || hoursAfterPickup > 4) {
        console.log(`Booking ${booking.id}: ${hoursAfterPickup.toFixed(1)} hrs since pickup — skipping`);
        continue;
      }

      const firstName     = (booking.customer_name || 'there').split(' ')[0];
      const pickupDateFmt = formatDate(booking.pickup_date);

      // ── 1. Mark sent FIRST to prevent double-send ──
      await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${booking.id}`, {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ review_request_sent: true }),
      });

      // ── 2. Send review request email ──
      if (RESEND_API_KEY && booking.email) {
        const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f5f5f5;padding:20px;">
  <div style="background:#0a0a0a;color:#fff;border-radius:12px;padding:30px;">
    <div style="text-align:center;margin-bottom:24px;">
      <img src="${LOGO_URL}" alt="Group Ride KC" style="width:180px;height:auto;" />
    </div>

    <h1 style="color:#FFB81C;margin-top:0;text-align:center;">Thank You for Riding with Us!</h1>

    <p style="color:#ddd;font-size:15px;line-height:1.6;">Hi ${firstName},</p>
    <p style="color:#ddd;font-size:15px;line-height:1.6;">
      We hope you had a great experience on your ride today! It was a pleasure serving you and your group.
    </p>
    <p style="color:#ddd;font-size:15px;line-height:1.6;">
      If you have a minute, we'd love to hear about your experience. Reviews help other groups find us
      and mean the world to our small team.
    </p>

    <div style="text-align:center;margin:32px 0;">
      <a href="${REVIEW_URL}" style="display:inline-block;background:#FFB81C;color:#000;padding:16px 48px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:18px;">
        Leave Us a Review ★
      </a>
    </div>

    <p style="color:#ddd;font-size:15px;line-height:1.6;">
      We hope to ride with you again soon!
    </p>

    <p style="text-align:center;color:#888;font-size:13px;margin-top:24px;">
      Questions? Call or text us at <a href="tel:+18165526669" style="color:#FFB81C;">(816) 552-6669</a>
    </p>

    <p style="margin-top:24px;font-size:12px;color:#555;text-align:center;">
      Group Ride KC · Kansas City, MO
    </p>
  </div>
</body>
</html>`;

        try {
          const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'Group Ride KC <bookings@groupridekc.com>',
              to: [booking.email],
              subject: `Thank you for riding with us, ${firstName}! Leave us a review`,
              html: emailHtml,
            }),
          });
          const emailData = await emailRes.json();
          if (emailData.error) {
            console.error(`Review email error for booking ${booking.id}:`, emailData.error);
          } else {
            console.log(`Review request email sent for booking ${booking.id}`);
          }
        } catch (e) {
          console.error(`Review email failed for booking ${booking.id}:`, e.message);
        }
      }

      // ── 3. Send review request SMS ──
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
              content: `Hi ${firstName}! Thank you for riding with Group Ride KC today. If you have a minute, we would love a review: ${REVIEW_URL}`,
            }),
          });
          const smsData = await smsRes.json();
          if (!smsRes.ok) {
            console.error(`Review SMS error for booking ${booking.id}:`, JSON.stringify(smsData));
          } else {
            console.log(`Review request SMS sent for booking ${booking.id}`);
          }
        } catch (e) {
          console.error(`Review SMS failed for booking ${booking.id}:`, e.message);
        }
      }

      sent++;
      console.log(`Review request sent for booking ${booking.id} — ${booking.customer_name}, pickup ${pickupDateFmt}`);
    }

    return { statusCode: 200, body: JSON.stringify({ sent, checked: bookings.length }) };

  } catch (err) {
    console.error('send-review-request error:', err.message || err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// ── Helpers ──
function formatDate(d) {
  if (!d) return 'N/A';
  const p = d.split('-');
  return p.length === 3 ? `${p[1]}/${p[2]}/${p[0]}` : d;
}
