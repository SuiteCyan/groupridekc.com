// Netlify Serverless Function: Send admin notification email for new booking requests
// Uses Resend API (no npm dependencies)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'GroupRideKC@gmail.com';
  const SITE_URL = process.env.URL || 'https://groupridekc.netlify.app';

  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not configured — skipping email');
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'Email not configured' }) };
  }

  // ── Formatting helpers ──
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
  const LOGO_URL = 'https://groupridekc.netlify.app/images/grkc-logo-van.png';

  try {
    const { booking_id, booking_data } = JSON.parse(event.body);

    if (!booking_id || !booking_data) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing booking_id or booking_data' }) };
    }

    // Fetch the booking from Supabase to get the admin_token
    const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nysoddktcdzynktrddte.supabase.co';
    const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55c29kZGt0Y2R6eW5rdHJkZHRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MTYyMzAsImV4cCI6MjA4ODk5MjIzMH0.uj4aEhQ0fWog_6OA6ypx5N8Kou871hw7eipgKPIiIDU';

    const sbRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${booking_id}&select=admin_token`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );
    const sbData = await sbRes.json();
    const adminToken = sbData?.[0]?.admin_token;

    if (!adminToken) {
      console.error('Could not fetch admin_token for booking:', booking_id);
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'No admin_token found' }) };
    }

    // Build accept/deny URLs
    const acceptUrl = `${SITE_URL}/.netlify/functions/booking-decision?token=${adminToken}&action=accept`;
    const denyUrl = `${SITE_URL}/.netlify/functions/booking-decision?token=${adminToken}&action=deny`;

    const vehicleLabel = booking_data.vehicle === 'van' ? '10-Passenger Van' : 'Chevy Suburban';
    const tripLabel = booking_data.trip_type === 'roundtrip' ? 'Round Trip' : 'One-Way';

    const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f5f5f5; padding: 20px;">
  <div style="background: #0a0a0a; color: #ffffff; border-radius: 12px; padding: 30px;">
    <div style="text-align: center; margin-bottom: 24px;"><img src="${LOGO_URL}" alt="Group Ride KC" style="width: 180px; height: auto;" /></div>
    <h1 style="color: #E31837; margin-top: 0;">New Ride Request</h1>

    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr>
        <td style="padding: 8px 0; color: #aaa; width: 140px;">Customer</td>
        <td style="padding: 8px 0; color: #fff;">${booking_data.customer_name || 'N/A'}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #aaa;">Phone</td>
        <td style="padding: 8px 0; color: #fff;">${booking_data.phone || 'N/A'}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #aaa;">Email</td>
        <td style="padding: 8px 0; color: #fff;">${booking_data.email || 'N/A'}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #aaa;">Vehicle</td>
        <td style="padding: 8px 0; color: #fff;">${vehicleLabel}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #aaa;">Trip Type</td>
        <td style="padding: 8px 0; color: #fff;">${tripLabel}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #aaa;">Passengers</td>
        <td style="padding: 8px 0; color: #fff;">${booking_data.passengers || '?'}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #aaa;">Pickup Date</td>
        <td style="padding: 8px 0; color: #fff;">${formatDate(booking_data.pickup_date)}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #aaa;">Pickup Time</td>
        <td style="padding: 8px 0; color: #fff;">${formatTime(booking_data.pickup_time)}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #aaa;">Pickup</td>
        <td style="padding: 8px 0; color: #fff;">${booking_data.pickup_address || 'N/A'}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #aaa;">Drop-off</td>
        <td style="padding: 8px 0; color: #fff;">${booking_data.dropoff_address || 'N/A'}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #aaa;">Distance</td>
        <td style="padding: 8px 0; color: #fff;">${booking_data.route_miles ? parseFloat(booking_data.route_miles).toFixed(1) + ' mi' : 'N/A'}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #aaa;">Estimated Total</td>
        <td style="padding: 8px 0; color: #FFB81C; font-weight: bold; font-size: 1.1em;">$${booking_data.total_price || '?'}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #aaa;">Deposit (50%)</td>
        <td style="padding: 8px 0; color: #fff;">$${booking_data.deposit_amount || '?'}</td>
      </tr>
      ${booking_data.notes ? `<tr><td style="padding: 8px 0; color: #aaa;">Notes</td><td style="padding: 8px 0; color: #fff;">${booking_data.notes}</td></tr>` : ''}
    </table>

    <div style="margin-top: 30px; text-align: center;">
      <a href="${acceptUrl}" style="display: inline-block; background: #22c55e; color: #fff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; margin-right: 12px;">
        ✓ Accept Ride
      </a>
      <a href="${denyUrl}" style="display: inline-block; background: #E31837; color: #fff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
        ✗ Deny Ride
      </a>
    </div>

    <p style="margin-top: 24px; font-size: 12px; color: #666; text-align: center;">
      Booking ID: ${booking_id}
    </p>
  </div>
</body>
</html>`;

    // Send email via Resend API
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Group Ride KC <bookings@groupridekc.com>',
        to: [ADMIN_EMAIL],
        subject: `🚐 New Ride Request — ${booking_data.customer_name || booking_data.phone || 'Customer'} — ${formatDate(booking_data.pickup_date)}`,
        html: emailHtml,
      }),
    });

    const emailData = await emailRes.json();
    if (emailData.error) {
      console.error('Resend API error:', emailData.error);
      throw new Error(emailData.error.message || 'Email send failed');
    }

    console.log('Admin email sent successfully:', emailData.id);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, emailId: emailData.id }),
    };

  } catch (err) {
    console.error('send-request-email error:', err.message || err);
    // Return 200 so the booking flow isn't blocked
    return {
      statusCode: 200,
      body: JSON.stringify({ error: err.message, skipped: true }),
    };
  }
};
