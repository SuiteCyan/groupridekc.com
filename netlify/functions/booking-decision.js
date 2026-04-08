// Netlify Serverless Function: Handle admin accept/deny booking decisions
// Called via email link: ?token=<admin_token>&action=accept|deny
// On accept: updates Supabase status, sends customer SMS + email with payment link
// On deny: updates Supabase status, sends customer SMS + email notification

exports.handler = async (event) => {
  const { token, action } = event.queryStringParameters || {};
  const SITE_URL = process.env.URL || 'https://groupridekc.netlify.app';

  if (!token || !['accept', 'deny'].includes(action)) {
    return htmlResponse(400, 'Invalid Request', 'Missing or invalid token/action.');
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nysoddktcdzynktrddte.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55c29kZGt0Y2R6eW5rdHJkZHRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MTYyMzAsImV4cCI6MjA4ODk5MjIzMH0.uj4aEhQ0fWog_6OA6ypx5N8Kou871hw7eipgKPIiIDU';
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
  const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

  try {
    // 1. Look up booking by admin_token
    const sbRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?admin_token=eq.${token}&select=*`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );
    const bookings = await sbRes.json();

    if (!bookings || bookings.length === 0) {
      return htmlResponse(404, 'Not Found', 'This booking link is invalid or has expired.');
    }

    const booking = bookings[0];

    // Check if already actioned
    if (booking.status !== 'pending_review') {
      const statusLabel = booking.status === 'accepted' ? 'already accepted' :
                          booking.status === 'denied' ? 'already denied' :
                          booking.status === 'paid' ? 'already paid' : booking.status;
      return htmlResponse(200, 'Already Processed', `This booking has been ${statusLabel}.`);
    }

    // 2. Update status in Supabase
    const newStatus = action === 'accept' ? 'accepted' : 'denied';
    const updateRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?admin_token=eq.${token}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ status: newStatus }),
      }
    );

    if (!updateRes.ok) {
      console.error('Supabase update failed:', updateRes.status, await updateRes.text());
      return htmlResponse(500, 'Error', 'Failed to update booking status. Please try again.');
    }

    // 3. Send customer notifications
    const vehicleLabel = booking.vehicle === 'van' ? '10-Passenger Van' : 'Chevy Suburban';
    const customerName = booking.customer_name || 'there';

    if (action === 'accept') {
      // Build Stripe payment link via the create-checkout function
      const checkoutPayload = {
        amount_cents: Math.round((booking.deposit_amount || booking.total_price * 0.5) * 100),
        booking_id: booking.id,
        booking_type: 'kc',
        customer_email: booking.email,
        description: `Group Ride KC — ${vehicleLabel} deposit`,
      };

      let paymentUrl = SITE_URL; // fallback
      try {
        const checkoutRes = await fetch(`${SITE_URL}/.netlify/functions/create-checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(checkoutPayload),
        });
        const checkoutData = await checkoutRes.json();
        if (checkoutData.url) paymentUrl = checkoutData.url;
      } catch (e) {
        console.error('Failed to create checkout session:', e.message);
      }

      // Send SMS via Twilio
      if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER && booking.phone) {
        await sendSMS(
          TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER,
          booking.phone,
          `Great news! Your Group Ride KC request for ${booking.pickup_date} has been approved! Check your email for details and a link to pay your deposit. — Group Ride KC`
        );
      }

      // Send acceptance email via Resend
      if (RESEND_API_KEY && booking.email) {
        await sendEmail(RESEND_API_KEY, booking.email, customerName, {
          subject: `✅ Your Group Ride KC Request is Approved!`,
          html: buildAcceptanceEmail(booking, vehicleLabel, paymentUrl),
        });
      }

      return htmlResponse(200, 'Ride Accepted ✓',
        `The ride for <strong>${customerName}</strong> on <strong>${booking.pickup_date}</strong> has been accepted.<br><br>The customer has been notified via SMS and email with a payment link.`);

    } else {
      // DENIED

      // Send SMS via Twilio
      if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER && booking.phone) {
        await sendSMS(
          TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER,
          booking.phone,
          `Hi ${customerName}, unfortunately we're unable to accommodate your Group Ride KC request for ${booking.pickup_date}. Please feel free to submit a new request for a different date/time. — Group Ride KC`
        );
      }

      // Send denial email via Resend
      if (RESEND_API_KEY && booking.email) {
        await sendEmail(RESEND_API_KEY, booking.email, customerName, {
          subject: `Your Group Ride KC Request — Update`,
          html: buildDenialEmail(booking, vehicleLabel),
        });
      }

      return htmlResponse(200, 'Ride Denied',
        `The ride for <strong>${customerName}</strong> on <strong>${booking.pickup_date}</strong> has been denied.<br><br>The customer has been notified via SMS and email.`);
    }

  } catch (err) {
    console.error('booking-decision error:', err.message || err);
    return htmlResponse(500, 'Error', `Something went wrong: ${err.message}`);
  }
};


// ── Helper: Send SMS via Twilio REST API ──
async function sendSMS(accountSid, authToken, from, to, body) {
  try {
    // Normalize phone: ensure +1 prefix for US numbers
    let phone = to.replace(/\D/g, '');
    if (phone.length === 10) phone = '1' + phone;
    if (!phone.startsWith('+')) phone = '+' + phone;

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ From: from, To: phone, Body: body }),
      }
    );
    const data = await res.json();
    if (data.error_code) {
      console.error('Twilio error:', data.message);
    } else {
      console.log('SMS sent:', data.sid);
    }
  } catch (e) {
    console.error('SMS send failed:', e.message);
  }
}


// ── Helper: Send email via Resend ──
async function sendEmail(apiKey, to, customerName, { subject, html }) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Group Ride KC <bookings@groupridekc.com>',
        to: [to],
        subject,
        html,
      }),
    });
    const data = await res.json();
    if (data.error) {
      console.error('Resend error:', data.error);
    } else {
      console.log('Email sent:', data.id);
    }
  } catch (e) {
    console.error('Email send failed:', e.message);
  }
}


// ── Helper: Build acceptance email HTML ──
function buildAcceptanceEmail(booking, vehicleLabel, paymentUrl) {
  const deposit = booking.deposit_amount || (booking.total_price * 0.5);
  const tripLabel = booking.trip_type === 'roundtrip' ? 'Round Trip' : 'One-Way';
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f5f5f5; padding: 20px;">
  <div style="background: #0a0a0a; color: #ffffff; border-radius: 12px; padding: 30px;">
    <h1 style="color: #22c55e; margin-top: 0;">Your Ride is Approved!</h1>
    <p style="color: #ccc; font-size: 16px;">Hi ${booking.customer_name || 'there'},</p>
    <p style="color: #ccc;">Great news — your Group Ride KC request has been approved! Here are your ride details:</p>

    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr><td style="padding: 8px 0; color: #aaa; width: 140px;">Vehicle</td><td style="padding: 8px 0; color: #fff;">${vehicleLabel}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Trip Type</td><td style="padding: 8px 0; color: #fff;">${tripLabel}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Date</td><td style="padding: 8px 0; color: #fff;">${booking.pickup_date}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Time</td><td style="padding: 8px 0; color: #fff;">${booking.pickup_time}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Pickup</td><td style="padding: 8px 0; color: #fff;">${booking.pickup_address}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Drop-off</td><td style="padding: 8px 0; color: #fff;">${booking.dropoff_address}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Passengers</td><td style="padding: 8px 0; color: #fff;">${booking.passengers}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Total</td><td style="padding: 8px 0; color: #FFB81C; font-weight: bold;">$${booking.total_price}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Deposit Due</td><td style="padding: 8px 0; color: #fff; font-weight: bold;">$${deposit}</td></tr>
    </table>

    <p style="color: #ccc;">To secure your ride, please pay the 50% non-refundable deposit below. The remaining balance is due on ride day.</p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${paymentUrl}" style="display: inline-block; background: #E31837; color: #fff; padding: 16px 48px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 18px;">
        Pay Deposit — $${deposit}
      </a>
    </div>

    <p style="font-size: 12px; color: #666; text-align: center; margin-top: 20px;">
      Questions? Reply to this email or text us at (816) 555-RIDE.
    </p>
  </div>
</body>
</html>`;
}


// ── Helper: Build denial email HTML ──
function buildDenialEmail(booking, vehicleLabel) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f5f5f5; padding: 20px;">
  <div style="background: #0a0a0a; color: #ffffff; border-radius: 12px; padding: 30px;">
    <h1 style="color: #E31837; margin-top: 0;">Ride Request Update</h1>
    <p style="color: #ccc; font-size: 16px;">Hi ${booking.customer_name || 'there'},</p>
    <p style="color: #ccc;">Unfortunately, we're unable to accommodate your ride request for <strong>${booking.pickup_date}</strong> at this time. This is usually due to scheduling conflicts with existing bookings.</p>

    <p style="color: #ccc;">We'd love to help you find another option! Please feel free to:</p>
    <ul style="color: #ccc;">
      <li>Submit a new request for a different date or time</li>
      <li>Contact us directly if you have questions</li>
    </ul>

    <div style="text-align: center; margin: 30px 0;">
      <a href="https://groupridekc.com/#quote-form-container" style="display: inline-block; background: #FFB81C; color: #000; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
        Request a Different Ride
      </a>
    </div>

    <p style="font-size: 12px; color: #666; text-align: center; margin-top: 20px;">
      Questions? Reply to this email or text us at (816) 555-RIDE.
    </p>
  </div>
</body>
</html>`;
}


// ── Helper: Return styled HTML page ──
function htmlResponse(statusCode, title, message) {
  return {
    statusCode: statusCode,
    headers: { 'Content-Type': 'text/html' },
    body: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — Group Ride KC</title>
  <style>
    body { font-family: Arial, sans-serif; background: #0a0a0a; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; }
    .card { background: #141414; border: 1px solid #333; border-radius: 16px; padding: 40px; max-width: 500px; text-align: center; }
    h1 { color: ${title.includes('Accepted') || title.includes('✓') ? '#22c55e' : title.includes('Denied') ? '#E31837' : '#FFB81C'}; margin-top: 0; }
    p { color: #ccc; line-height: 1.6; }
    a { color: #FFB81C; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    <p style="margin-top: 24px;"><a href="https://groupridekc.com">← Back to Group Ride KC</a></p>
  </div>
</body>
</html>`,
  };
}
