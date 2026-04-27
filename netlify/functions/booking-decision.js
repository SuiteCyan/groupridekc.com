// Netlify Serverless Function: Handle admin accept/deny booking decisions + customer flexibility response
// Called via email link: ?token=<admin_token>&action=accept|deny|flexible|not_flexible
// On accept: updates Supabase status, sends customer SMS + email with payment link, shows cost calculator
// On deny: updates Supabase status, sends customer SMS + email with flexibility options
// On flexible: sends admin email that customer is open to alternative times
// On not_flexible: shows acknowledgment page

exports.handler = async (event) => {
  const { token, action } = event.queryStringParameters || {};
  const SITE_URL = process.env.URL || 'https://groupridekc.netlify.app';

  if (!token || !['accept', 'deny', 'flexible', 'not_flexible'].includes(action)) {
    return htmlResponse(400, 'Invalid Request', 'Missing or invalid token/action.');
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nysoddktcdzynktrddte.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55c29kZGt0Y2R6eW5rdHJkZHRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MTYyMzAsImV4cCI6MjA4ODk5MjIzMH0.uj4aEhQ0fWog_6OA6ypx5N8Kou871hw7eipgKPIiIDU';
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const QUO_API_KEY = process.env.QUO_API_KEY;
  const QUO_PHONE_NUMBER_ID = process.env.QUO_PHONE_NUMBER_ID;

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

    // Check if already actioned (allow flexibility responses on denied bookings)
    if (booking.status !== 'pending_review' && !['flexible', 'not_flexible'].includes(action)) {
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
      // Rides within 72 hours of pickup require full payment upfront.
      // Check both: time until pickup (UTC approximation) AND whether deposit_amount
      // was already set to the full total by the quote engine at submission time.
      const pickupDateTime = new Date(`${booking.pickup_date}T${booking.pickup_time || '00:00'}:00`);
      const hoursUntilPickup = (pickupDateTime - new Date()) / (1000 * 60 * 60);
      const chargeFullPayment = hoursUntilPickup <= 72 ||
        parseFloat(booking.deposit_amount) >= parseFloat(booking.total_price);
      const chargeAmount = chargeFullPayment
        ? (booking.total_price || 0)
        : (booking.deposit_amount || booking.total_price * 0.5);

      // Build Stripe payment link via the create-checkout function
      const checkoutPayload = {
        amount_cents: Math.round(chargeAmount * 100),
        booking_id: booking.id,
        booking_type: 'kc',
        customer_email: booking.email,
        description: chargeFullPayment
          ? `Group Ride KC — ${vehicleLabel} (full payment — ride within 72 hrs)`
          : `Group Ride KC — ${vehicleLabel} deposit`,
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

      // Send SMS via QUO
      if (QUO_API_KEY && QUO_PHONE_NUMBER_ID && booking.phone) {
        await sendSMS(
          QUO_API_KEY, QUO_PHONE_NUMBER_ID,
          booking.phone,
          `Great news ${booking.customer_name ? booking.customer_name.split(' ')[0] : ''}! Your Group Ride KC ride is approved 🎉\n📅 ${formatDate(booking.pickup_date)} at ${formatTime(booking.pickup_time)}\n📍 ${booking.pickup_address}\n\nCheck your email for your payment link to secure your booking. — Group Ride KC`
        );
      }

      // Send acceptance email via Resend
      if (RESEND_API_KEY && booking.email) {
        await sendEmail(RESEND_API_KEY, booking.email, customerName, {
          subject: `✅ Your Group Ride KC Request is Approved!`,
          html: buildAcceptanceEmail(booking, vehicleLabel, paymentUrl, chargeAmount, chargeFullPayment),
        });
      }

      return buildAcceptConfirmPage(booking, vehicleLabel);

    } else if (action === 'deny') {
      // DENIED

      // Send SMS via QUO
      if (QUO_API_KEY && QUO_PHONE_NUMBER_ID && booking.phone) {
        await sendSMS(
          QUO_API_KEY, QUO_PHONE_NUMBER_ID,
          booking.phone,
          `Hi ${customerName}, unfortunately the time slot you requested for ${formatDate(booking.pickup_date)} is not available. Check your email for more options. — Group Ride KC`
        );
      }

      // Send denial email via Resend
      if (RESEND_API_KEY && booking.email) {
        try {
          await sendEmail(RESEND_API_KEY, booking.email, customerName, {
            subject: `Your Group Ride KC Request — Time Slot Unavailable`,
            html: buildDenialEmail(booking, vehicleLabel, SITE_URL, token),
          });
          console.log('Denial email sent to:', booking.email);
        } catch (emailErr) {
          console.error('Denial email FAILED:', emailErr.message);
        }
      } else {
        console.error('Missing denial email prereqs — RESEND_API_KEY:', !!RESEND_API_KEY, 'email:', booking.email);
      }

      return htmlResponse(200, 'Ride Denied',
        `The ride for <strong>${customerName}</strong> on <strong>${formatDate(booking.pickup_date)}</strong> has been denied.<br><br>The customer has been notified via SMS and email with options to request an alternative time.`);

    } else if (action === 'flexible') {
      // Customer says their timeslot is flexible — notify admin
      if (RESEND_API_KEY) {
        await sendEmail(RESEND_API_KEY, 'GroupRideKC@gmail.com', 'Admin', {
          subject: `🔄 Customer Flexible — ${booking.customer_name || 'Customer'} wants alternative times`,
          html: buildFlexibleNotifyEmail(booking, vehicleLabel),
        });
      }
      return htmlResponse(200, 'Thank You!',
        `Thanks, ${customerName}! One of our customer service agents will be in touch shortly to help find an alternative time that works for you.<br><br>We appreciate your flexibility!`);

    } else if (action === 'not_flexible') {
      // Customer says not flexible — just acknowledge
      return htmlResponse(200, 'We Understand',
        `We're sorry we couldn't accommodate your requested time, ${customerName}. If your plans change, feel free to <a href="${SITE_URL}/#quote-form-container">submit a new request</a> anytime.<br><br>Thank you for considering Group Ride KC!`);
    }

  } catch (err) {
    console.error('booking-decision error:', err.message || err);
    return htmlResponse(500, 'Error', `Something went wrong: ${err.message}`);
  }
};


// ── Helper: Format date as MM/DD/YYYY ──
function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  const parts = dateStr.split('-'); // YYYY-MM-DD
  if (parts.length !== 3) return dateStr;
  return `${parts[1]}/${parts[2]}/${parts[0]}`;
}

// ── Helper: Format time as 12-hour with AM/PM ──
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

// ── Logo URL for emails ──
const LOGO_URL = 'https://groupridekc.netlify.app/images/grkc-logo-van.png';

// ── Reusable email header with logo ──
function emailHeader() {
  return `<div style="text-align: center; margin-bottom: 24px;"><img src="${LOGO_URL}" alt="Group Ride KC" style="width: 180px; height: auto;" /></div>`;
}

// ── Helper: Send SMS via QUO (formerly OpenPhone) REST API ──
async function sendSMS(apiKey, phoneNumberId, to, body) {
  try {
    // Normalize phone: ensure +1 prefix for US numbers
    let phone = to.replace(/\D/g, '');
    if (phone.length === 10) phone = '1' + phone;
    if (!phone.startsWith('+')) phone = '+' + phone;

    const res = await fetch('https://api.openphone.com/v1/messages', {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: phoneNumberId,
        to: [phone],
        content: body,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('QUO SMS error:', JSON.stringify(data));
    } else {
      console.log('SMS sent via QUO:', data?.data?.id);
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
        Authorization: apiKey,
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
function buildAcceptanceEmail(booking, vehicleLabel, paymentUrl, chargeAmount, chargeFullPayment) {
  const deposit = chargeAmount || booking.deposit_amount || (booking.total_price * 0.5);
  const tripLabel = booking.trip_type === 'roundtrip' ? 'Round Trip' : 'One-Way';
  const paymentLabel = chargeFullPayment ? 'Full Payment Due' : 'Deposit Due';
  const payBtnLabel = chargeFullPayment ? `Pay in Full — $${deposit}` : `Pay Deposit — $${deposit}`;
  const paymentNote = chargeFullPayment
    ? 'Because your ride is within 72 hours, <strong style="color:#fff;">full payment is required</strong> to confirm your booking.'
    : 'To secure your ride, please pay the 50% deposit below. The remaining balance is due 72 hours prior to your pickup time.';
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f5f5f5; padding: 20px;">
  <div style="background: #0a0a0a; color: #ffffff; border-radius: 12px; padding: 30px;">
    ${emailHeader()}
    <h1 style="color: #22c55e; margin-top: 0;">Your Ride is Approved!</h1>
    <p style="color: #ccc; font-size: 16px;">Hi ${booking.customer_name || 'there'},</p>
    <p style="color: #ccc;">Great news — your Group Ride KC request has been approved! Here are your ride details:</p>

    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr><td style="padding: 8px 0; color: #aaa; width: 140px;">Vehicle</td><td style="padding: 8px 0; color: #fff;">${vehicleLabel}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Trip Type</td><td style="padding: 8px 0; color: #fff;">${tripLabel}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Date</td><td style="padding: 8px 0; color: #fff;">${formatDate(booking.pickup_date)}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Time</td><td style="padding: 8px 0; color: #fff;">${formatTime(booking.pickup_time)}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Pickup</td><td style="padding: 8px 0; color: #fff;">${booking.pickup_address}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Drop-off</td><td style="padding: 8px 0; color: #fff;">${booking.dropoff_address}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Passengers</td><td style="padding: 8px 0; color: #fff;">${booking.passengers}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Total</td><td style="padding: 8px 0; color: #FFB81C; font-weight: bold;">$${booking.total_price}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">${paymentLabel}</td><td style="padding: 8px 0; color: #fff; font-weight: bold;">$${deposit}</td></tr>
    </table>

    <p style="color: #ccc;">${paymentNote}</p>

    <div style="background: rgba(255,255,255,.05); border-radius: 8px; padding: 14px 16px; margin: 16px 0;">
      <p style="font-size: 12px; color: #999; margin: 0; line-height: 1.6;">
        <strong style="color: #ccc;">Payment &amp; Cancellation Policy:</strong> ${chargeFullPayment
          ? 'Full payment is required for rides booked within 72 hours of pickup.'
          : 'Remaining balance is due 72 hours before pickup — you\'ll receive a reminder at 96 hours out. If balance is not received by 72 hours before pickup, we reserve the right to cancel and retain the deposit.'
        } Cancellations made more than 72 hours before pickup are eligible for a 50% refund of payments made. Cancellations within 72 hours are non-refundable.
      </p>
      <p style="font-size: 12px; color: #999; margin: 8px 0 0; line-height: 1.6;">
        <strong style="color: #ccc;">Cleaning Fee:</strong> An additional cleaning fee of up to $250 may be charged for excessive mess, including vomiting, spills, or damage to the vehicle interior.
      </p>
    </div>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${paymentUrl}" style="display: inline-block; background: #E31837; color: #fff; padding: 16px 48px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 18px;">
        ${payBtnLabel}
      </a>
    </div>

    <p style="font-size: 12px; color: #666; text-align: center; margin-top: 20px;">
      Questions? Reply to this email or text us at (816) 552-6669.
    </p>
  </div>
</body>
</html>`;
}


// ── Helper: Build denial email HTML ──
function buildDenialEmail(booking, vehicleLabel, siteUrl, token) {
  const flexUrl = `${siteUrl}/.netlify/functions/booking-decision?token=${token}&action=flexible`;
  const noFlexUrl = `${siteUrl}/.netlify/functions/booking-decision?token=${token}&action=not_flexible`;
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f5f5f5; padding: 20px;">
  <div style="background: #0a0a0a; color: #ffffff; border-radius: 12px; padding: 30px;">
    ${emailHeader()}
    <h1 style="color: #E31837; margin-top: 0;">Time Slot Unavailable</h1>
    <p style="color: #ccc; font-size: 16px;">Hi ${booking.customer_name || 'there'},</p>
    <p style="color: #ccc;">We're sorry, but the time slot you requested for <strong>${formatDate(booking.pickup_date)}</strong> at <strong>${formatTime(booking.pickup_time)}</strong> is not currently available.</p>

    <p style="color: #ccc;">However, one of our customer service agents would love to help find an alternative time that works for you. Is your schedule flexible?</p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${flexUrl}" style="display: inline-block; background: #22c55e; color: #fff; padding: 14px 36px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; margin: 6px;">
        Yes, my timeslot is flexible
      </a>
      <br>
      <a href="${noFlexUrl}" style="display: inline-block; background: #333; color: #ccc; padding: 14px 36px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px; margin: 6px; margin-top: 10px;">
        No, my timeslot is not flexible
      </a>
    </div>

    <p style="font-size: 13px; color: #aaa; text-align: center;">If you click "Yes," a member of our team will reach out to you directly to find the best available time.</p>

    <p style="font-size: 12px; color: #666; text-align: center; margin-top: 20px;">
      Questions? Reply to this email or text us at (816) 552-6669.
    </p>
  </div>
</body>
</html>`;
}

// ── Helper: Build admin notification for flexible customer ──
function buildFlexibleNotifyEmail(booking, vehicleLabel) {
  const tripLabel = booking.trip_type === 'roundtrip' ? 'Round Trip' : 'One-Way';
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f5f5f5; padding: 20px;">
  <div style="background: #0a0a0a; color: #ffffff; border-radius: 12px; padding: 30px;">
    ${emailHeader()}
    <h1 style="color: #FFB81C; margin-top: 0;">Customer Wants Alternative Times</h1>
    <p style="color: #ccc;">The customer below was denied but has indicated they are <strong style="color: #22c55e;">flexible with their schedule</strong>. Please reach out to offer alternative time slots.</p>

    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr><td style="padding: 8px 0; color: #aaa; width: 140px;">Customer</td><td style="padding: 8px 0; color: #fff;">${booking.customer_name || 'N/A'}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Phone</td><td style="padding: 8px 0; color: #FFB81C; font-weight: bold;">${booking.phone || 'N/A'}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Email</td><td style="padding: 8px 0; color: #fff;">${booking.email || 'N/A'}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Original Date</td><td style="padding: 8px 0; color: #fff;">${formatDate(booking.pickup_date)}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Original Time</td><td style="padding: 8px 0; color: #fff;">${formatTime(booking.pickup_time)}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Vehicle</td><td style="padding: 8px 0; color: #fff;">${vehicleLabel}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Trip Type</td><td style="padding: 8px 0; color: #fff;">${tripLabel}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Pickup</td><td style="padding: 8px 0; color: #fff;">${booking.pickup_address}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Drop-off</td><td style="padding: 8px 0; color: #fff;">${booking.dropoff_address}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Passengers</td><td style="padding: 8px 0; color: #fff;">${booking.passengers}</td></tr>
    </table>

    <p style="font-size: 14px; color: #FFB81C; font-weight: bold; text-align: center;">Please call or text this customer ASAP to find an available time.</p>
  </div>
</body>
</html>`;
}


// ── Helper: Build accept confirmation page with cost calculator ──
function buildAcceptConfirmPage(booking, vehicleLabel) {
  const customerName = booking.customer_name || 'Customer';
  const miles = booking.route_miles || 0;
  const isRoundTrip = booking.trip_type === 'roundtrip';
  const totalMiles = isRoundTrip ? miles * 2 : miles;
  const mpg = booking.vehicle === 'van' ? 13 : 15;
  const gasPrice = 3.39;
  const driverRate = 30;
  const estDriveMin = Math.round(miles * 2); // rough ~2 min/mile
  const bufferMin = isRoundTrip ? 30 : 15;
  const onsiteHours = (isRoundTrip && booking.local_transport_fee) ? Math.round(booking.local_transport_fee / 95) : 0;
  const totalTimeHrs = ((isRoundTrip ? estDriveMin * 2 : estDriveMin) + bufferMin) / 60 + onsiteHours;
  const fuelCost = (totalMiles / mpg) * gasPrice;
  const driverPay = totalTimeHrs * driverRate;
  const totalCost = driverPay + fuelCost;
  const revenue = booking.total_price || 0;
  const profit = revenue - totalCost;
  const margin = revenue > 0 ? (profit / revenue * 100) : 0;
  const profitColor = profit >= 0 ? '#22c55e' : '#E31837';

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ride Accepted — Group Ride KC</title>
  <style>
    body { font-family: Arial, sans-serif; background: #0a0a0a; color: #fff; display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; margin: 0; padding: 20px; }
    .page { max-width: 600px; width: 100%; }
    .card { background: #141414; border: 1px solid #333; border-radius: 16px; padding: 32px; text-align: center; margin-bottom: 20px; }
    h1 { color: #22c55e; margin-top: 0; }
    p { color: #ccc; line-height: 1.6; }
    a { color: #FFB81C; }
    .calc { background: #141414; border: 1px solid #333; border-radius: 16px; padding: 24px; }
    .calc h2 { color: #FFB81C; font-size: 1rem; margin: 0 0 16px; text-transform: uppercase; letter-spacing: 1px; font-size: 0.8rem; }
    .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 0.9rem; }
    .row .lbl { color: #888; }
    .row .val { color: #fff; font-weight: 600; }
    .row.sub .lbl { color: #555; font-size: 0.82rem; padding-left: 12px; }
    .row.sub .val { color: #777; font-size: 0.82rem; font-weight: 400; }
    hr { border: none; border-top: 1px solid #222; margin: 8px 0; }
    .total .lbl { color: #FFB81C; font-weight: 700; }
    .total .val { color: #FFB81C; font-weight: 800; font-size: 1.05rem; }
    .profit .lbl, .profit .val { color: ${profitColor}; font-weight: 800; font-size: 1.1rem; }
    .margin { text-align: right; font-size: 0.8rem; color: ${profitColor}; margin-top: 2px; }
    .note { font-size: 0.75rem; color: #555; margin-top: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <div style="text-align: center; margin-bottom: 16px;"><img src="${LOGO_URL}" alt="Group Ride KC" style="width: 160px; height: auto;" /></div>
      <h1>Ride Accepted ✓</h1>
      <p>The ride for <strong>${customerName}</strong> on <strong>${formatDate(booking.pickup_date)}</strong> has been accepted.</p>
      <p>The customer has been notified via SMS and email with a payment link.</p>
    </div>

    <div class="calc">
      <h2>Trip Cost Breakdown</h2>

      <div class="row sub"><span class="lbl">Vehicle</span><span class="val">${vehicleLabel} (${mpg} MPG)</span></div>
      <div class="row sub"><span class="lbl">Trip type</span><span class="val">${isRoundTrip ? 'Round Trip' : 'One-Way'}</span></div>
      <div class="row sub"><span class="lbl">Distance</span><span class="val">${totalMiles.toFixed(1)} mi${isRoundTrip ? ' (×2)' : ''}</span></div>
      <div class="row sub"><span class="lbl">Est. driver time</span><span class="val">${totalTimeHrs.toFixed(1)} hrs</span></div>
      ${onsiteHours > 0 ? `<div class="row sub"><span class="lbl">On-site wait</span><span class="val">${onsiteHours} hrs</span></div>` : ''}
      <div class="row sub"><span class="lbl">Fuel used</span><span class="val">${(totalMiles / mpg).toFixed(1)} gal</span></div>

      <hr>

      <div class="row"><span class="lbl">Driver Pay ($${driverRate}/hr × ${totalTimeHrs.toFixed(1)} hrs)</span><span class="val">$${driverPay.toFixed(2)}</span></div>
      <div class="row"><span class="lbl">Fuel ($${gasPrice}/gal)</span><span class="val">$${fuelCost.toFixed(2)}</span></div>

      <hr>

      <div class="row total"><span class="lbl">Total Trip Cost</span><span class="val">$${totalCost.toFixed(2)}</span></div>
      <div class="row"><span class="lbl">Customer Revenue</span><span class="val">$${revenue.toFixed(2)}</span></div>

      <hr>

      <div class="row profit"><span class="lbl">Profit</span><span class="val">${profit >= 0 ? '$' : '-$'}${Math.abs(profit).toFixed(2)}</span></div>
      <div class="margin">${margin.toFixed(1)}% margin</div>

      <div class="note">Driver rate: $30/hr · Gas: $3.39/gal (KC avg) · Includes 15-min buffer per leg</div>
    </div>

    <p style="text-align: center; margin-top: 16px;"><a href="https://groupridekc.netlify.app">← Back to Group Ride KC</a></p>
  </div>
</body>
</html>`,
  };
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
    <p style="margin-top: 24px;"><a href="https://groupridekc.netlify.app">← Back to Group Ride KC</a></p>
  </div>
</body>
</html>`,
  };
}
