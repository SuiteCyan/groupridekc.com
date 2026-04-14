// Netlify Serverless Function: Send customer confirmation email after deposit payment
// Uses Resend API (no npm dependencies). Invoked by stripe-webhook.js once
// Stripe reports checkout.session.completed for a booking.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'GroupRideKC@gmail.com';
  const REPLY_TO = process.env.REPLY_TO_EMAIL || ADMIN_EMAIL;

  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not configured — skipping customer confirmation email');
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
  function money(n) {
    const v = parseFloat(n);
    if (isNaN(v)) return '?';
    return v.toFixed(2);
  }
  const LOGO_URL = 'https://groupridekc.netlify.app/images/grkc-logo-van.png';

  try {
    const { booking_id, booking_data } = JSON.parse(event.body);

    if (!booking_id || !booking_data) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing booking_id or booking_data' }) };
    }

    const customerEmail = booking_data.email;
    if (!customerEmail) {
      console.warn('No customer email on booking, skipping', booking_id);
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'No customer email' }) };
    }

    const vehicleLabel = booking_data.vehicle === 'van' ? '10-Passenger Van' : 'Chevy Suburban';
    const tripLabel = booking_data.trip_type === 'roundtrip' ? 'Round Trip' : 'One-Way';

    const total = parseFloat(booking_data.total_price) || 0;
    const deposit = parseFloat(booking_data.deposit_amount) || 0;
    const balance = Math.max(0, total - deposit);

    const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f5f5f5; padding: 20px;">
  <div style="background: #0a0a0a; color: #ffffff; border-radius: 12px; padding: 30px;">
    <div style="text-align: center; margin-bottom: 24px;">
      <img src="${LOGO_URL}" alt="Group Ride KC" style="width: 180px; height: auto;" />
    </div>

    <h1 style="color: #22c55e; margin-top: 0; text-align: center;">Payment Received — You're Booked! 🚐</h1>

    <p style="color: #ddd; font-size: 15px; line-height: 1.5;">
      Hi ${booking_data.customer_name ? booking_data.customer_name.split(' ')[0] : 'there'},
    </p>
    <p style="color: #ddd; font-size: 15px; line-height: 1.5;">
      Thanks for booking with Group Ride KC! We've received your deposit and your ride is confirmed. Here's a summary of your trip for your records.
    </p>

    <div style="background: #1a1a1a; border: 1px solid #333; border-radius: 10px; padding: 20px; margin: 24px 0;">
      <h3 style="color: #FFB81C; margin: 0 0 14px; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">Trip Details</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #aaa; width: 140px;">Vehicle</td>
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
      </table>
    </div>

    <div style="background: #1a1a1a; border: 1px solid #333; border-radius: 10px; padding: 20px; margin: 24px 0;">
      <h3 style="color: #FFB81C; margin: 0 0 14px; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">Payment Summary</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 6px 0; color: #aaa;">Trip Total</td>
          <td style="padding: 6px 0; color: #fff; text-align: right;">$${money(total)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #22c55e;">Deposit Paid</td>
          <td style="padding: 6px 0; color: #22c55e; text-align: right; font-weight: bold;">− $${money(deposit)}</td>
        </tr>
        <tr><td colspan="2" style="border-top: 1px solid #333; padding: 0; height: 8px;"></td></tr>
        <tr>
          <td style="padding: 6px 0; color: #FFB81C; font-weight: bold; font-size: 15px;">Balance Due at Pickup</td>
          <td style="padding: 6px 0; color: #FFB81C; font-weight: bold; font-size: 15px; text-align: right;">$${money(balance)}</td>
        </tr>
      </table>
    </div>

    <div style="background: #1a1a1a; border: 1px solid #333; border-radius: 10px; padding: 20px; margin: 24px 0;">
      <h3 style="color: #FFB81C; margin: 0 0 10px; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">What's Next</h3>
      <p style="color: #ddd; font-size: 14px; line-height: 1.6; margin: 0;">
        Your driver's name and contact info will be texted and emailed to you ahead of your pickup. The remaining balance is due at pickup.
        Plans change? You can cancel up to 72 hours before your ride for a 50% refund — just reply to this email or give us a call.
      </p>
    </div>

    <p style="text-align: center; margin: 30px 0 10px;">
      <a href="tel:+18165526669" style="display: inline-block; background: #E31837; color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 15px;">
        📞 (816) 552-6669
      </a>
    </p>

    <p style="margin-top: 24px; font-size: 12px; color: #666; text-align: center;">
      Booking ID: ${booking_id}<br/>
      Group Ride KC · Kansas City, MO
    </p>
  </div>
</body>
</html>`;

    // Send customer email via Resend API
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Group Ride KC <bookings@groupridekc.com>',
        to: [customerEmail],
        reply_to: REPLY_TO,
        bcc: [ADMIN_EMAIL],
        subject: `🚐 Your Group Ride KC booking is confirmed — ${formatDate(booking_data.pickup_date)}`,
        html: emailHtml,
      }),
    });

    const emailData = await emailRes.json();
    if (emailData.error) {
      console.error('Resend API error (customer confirmation):', emailData.error);
      throw new Error(emailData.error.message || 'Customer email send failed');
    }

    console.log('Customer confirmation email sent:', emailData.id);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, emailId: emailData.id }),
    };

  } catch (err) {
    console.error('send-customer-confirmation error:', err.message || err);
    // Return 200 so the payment flow isn't blocked
    return {
      statusCode: 200,
      body: JSON.stringify({ error: err.message, skipped: true }),
    };
  }
};
