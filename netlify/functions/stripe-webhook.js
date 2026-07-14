// Netlify Serverless Function: Stripe Webhook Handler
// Handles checkout.session.completed events
// Updates booking status to 'paid' and creates Google Calendar event

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nysoddktcdzynktrddte.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55c29kZGt0Y2R6eW5rdHJkZHRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MTYyMzAsImV4cCI6MjA4ODk5MjIzMH0.uj4aEhQ0fWog_6OA6ypx5N8Kou871hw7eipgKPIiIDU';
  const SITE_URL = process.env.URL || 'https://groupridekc.netlify.app';

  try {
    let stripeEvent;

    // Verify webhook signature if secret is configured
    if (STRIPE_WEBHOOK_SECRET) {
      const signature = event.headers['stripe-signature'];
      if (!signature) {
        return { statusCode: 400, body: 'Missing Stripe signature' };
      }
      // For now, we'll parse the event directly and verify via Stripe API
      // Full signature verification would require the stripe npm package
      stripeEvent = JSON.parse(event.body);

      // Verify the event by fetching it from Stripe
      const verifyRes = await fetch(`https://api.stripe.com/v1/events/${stripeEvent.id}`, {
        headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
      });
      const verified = await verifyRes.json();
      if (verified.error) {
        console.error('Event verification failed:', verified.error);
        return { statusCode: 400, body: 'Event verification failed' };
      }
      stripeEvent = verified;
    } else {
      stripeEvent = JSON.parse(event.body);
    }

    // Only handle checkout.session.completed
    if (stripeEvent.type !== 'checkout.session.completed') {
      return { statusCode: 200, body: JSON.stringify({ received: true, ignored: true }) };
    }

    const session = stripeEvent.data.object;
    const bookingId = session.metadata?.booking_id;

    if (!bookingId) {
      console.warn('No booking_id in session metadata');
      return { statusCode: 200, body: JSON.stringify({ received: true, no_booking: true }) };
    }

    console.log(`Payment completed for booking: ${bookingId}`);

    // Determine if this was a full payment or deposit
    // Stripe amount_total is in cents
    const amountPaidDollars = (session.amount_total || 0) / 100;

    // 1. Fetch the booking first so we can compare amount paid vs total
    const preCheckRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}&select=total_price,deposit_amount,payment_status`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );
    const preCheckData = await preCheckRes.json();
    const preBooking = preCheckData?.[0] || {};
    const totalPrice = parseFloat(preBooking.total_price) || 0;
    // isFullPayment is true if:
    // - deposit was already paid (so this payment is the balance), OR
    // - amount paid is within $0.50 of the total (full payment in one shot)
    // (Note: removed full_payment_required check — column doesn't exist in Supabase, was breaking the SELECT.)
    const isFullPayment =
      preBooking.payment_status === 'deposit_paid' ||
      (totalPrice > 0 && Math.abs(amountPaidDollars - totalPrice) < 0.50);
    const newPaymentStatus = isFullPayment ? 'fully_paid' : 'deposit_paid';

    console.log(`Payment: $${amountPaidDollars} | Total: $${totalPrice} | Status: ${newPaymentStatus}`);

    // 2. Update booking status
    const updateRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          status: 'paid',
          payment_status: newPaymentStatus,
          stripe_session_id: session.id,
        }),
      }
    );

    if (!updateRes.ok) {
      console.error('Supabase update failed:', updateRes.status);
    }

    // 2. Fetch the full booking to create calendar event
    const bookingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}&select=*`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );
    const bookingData = await bookingRes.json();
    const booking = bookingData?.[0];

    if (booking) {
      // 3. Create Google Calendar event via the existing function
      try {
        const calRes = await fetch(`${SITE_URL}/.netlify/functions/create-calendar-event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            booking_id: booking.id,
            booking_type: 'kc',
            vehicle: booking.vehicle,
            trip_type: booking.trip_type,
            pickup_date: booking.pickup_date,
            pickup_time: booking.pickup_time,
            pickup_address: booking.pickup_address,
            dropoff_address: booking.dropoff_address,
            passengers: booking.passengers,
            phone: booking.phone,
            email: booking.email,
            customer_name: booking.customer_name,
            route_miles: booking.route_miles,
            total_price: booking.total_price,
            deposit_amount: booking.deposit_amount,
            payment_status: newPaymentStatus,
            source_page: booking.source_page,
          }),
        });
        const calData = await calRes.json();
        console.log('Calendar event created:', calData.eventId || calData);
      } catch (calErr) {
        console.error('Calendar event creation failed (non-critical):', calErr.message);
      }

      // 4. Send customer payment confirmation email (non-blocking)
      const RESEND_API_KEY = process.env.RESEND_API_KEY;
      const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'GroupRideKC@gmail.com';

      if (RESEND_API_KEY && booking.email) {
        try {
          const custEmailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'Group Ride KC <bookings@groupridekc.com>',
              to: [booking.email],
              subject: isFullPayment
                ? `✅ Payment Confirmed — You're All Set! Group Ride KC`
                : `✅ Deposit Confirmed — Group Ride KC`,
              html: buildCustomerConfirmationEmail(booking, isFullPayment),
            }),
          });
          const custEmailData = await custEmailRes.json();
          if (custEmailData.error) {
            console.error('Customer confirmation email error:', custEmailData.error);
          } else {
            console.log('Customer confirmation email sent:', custEmailData.id);
          }
        } catch (emailErr) {
          console.error('Customer confirmation email failed (non-critical):', emailErr.message);
        }
      }

      // 5. Send admin deposit-paid notification (non-blocking)
      if (RESEND_API_KEY) {
        try {
          const adminEmailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'Group Ride KC <bookings@groupridekc.com>',
              to: [ADMIN_EMAIL],
              subject: isFullPayment
                ? `💳 Balance Paid — ${booking.customer_name || 'Customer'} — ${formatDate(booking.pickup_date)}`
                : `💳 Deposit Paid — ${booking.customer_name || 'Customer'} — ${formatDate(booking.pickup_date)}`,
              html: buildAdminDepositEmail(booking, isFullPayment),
            }),
          });
          const adminEmailData = await adminEmailRes.json();
          if (adminEmailData.error) {
            console.error('Admin deposit notification error:', adminEmailData.error);
          } else {
            console.log('Admin deposit notification sent:', adminEmailData.id);
          }
        } catch (emailErr) {
          console.error('Admin deposit notification failed (non-critical):', emailErr.message);
        }
      }

      // 6. Send customer SMS payment confirmation (non-blocking)
      const QUO_API_KEY = process.env.QUO_API_KEY;
      const QUO_PHONE_NUMBER_ID = process.env.QUO_PHONE_NUMBER_ID;
      if (QUO_API_KEY && QUO_PHONE_NUMBER_ID && booking.phone) {
        try {
          let phone = booking.phone.replace(/\D/g, '');
          if (phone.length === 10) phone = '1' + phone;
          if (!phone.startsWith('+')) phone = '+' + phone;
          const smsRemainingBalance = Math.max(0, parseFloat(booking.total_price) - parseFloat(booking.deposit_amount));
          const smsRes = await fetch('https://api.openphone.com/v1/messages', {
            method: 'POST',
            headers: { Authorization: QUO_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: QUO_PHONE_NUMBER_ID,
              to: [phone],
              content: isFullPayment
                ? `Your balance has been paid and your ride is confirmed!\nDate: ${formatDate(booking.pickup_date)} at ${formatTime(booking.pickup_time)}.\nPickup: ${booking.pickup_address}\nDestination: ${booking.dropoff_address}.`
                : `${booking.customer_name ? booking.customer_name.split(' ')[0] + ', your' : 'Your'} Group Ride KC booking is confirmed!\nDate: ${formatDate(booking.pickup_date)} at ${formatTime(booking.pickup_time)}.\nPickup: ${booking.pickup_address}\nDestination: ${booking.dropoff_address}.\nDeposit paid: $${parseFloat(booking.deposit_amount).toFixed(2)}.${smsRemainingBalance > 0 ? `\nBalance of $${smsRemainingBalance.toFixed(2)} due 72 hrs before pickup.` : ''}`,
            }),
          });
          const smsData = await smsRes.json();
          if (!smsRes.ok) {
            console.error('QUO SMS error (payment confirmation):', JSON.stringify(smsData));
          } else {
            console.log('Payment confirmation SMS sent via QUO:', smsData?.data?.id);
          }
        } catch (smsErr) {
          console.error('Payment confirmation SMS failed:', smsErr.message);
        }
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ received: true, booking_id: bookingId }),
    };

  } catch (err) {
    console.error('Stripe webhook error:', err.message || err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
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

const LOGO_URL = 'https://groupridekc.netlify.app/images/grkc-logo-van.png';

function emailHeader() {
  return `<div style="text-align: center; margin-bottom: 24px;"><img src="${LOGO_URL}" alt="Group Ride KC" style="width: 180px; height: auto;" /></div>`;
}

// ── Customer payment confirmation email ──
function buildCustomerConfirmationEmail(booking, isFullPayment) {
  const vehicleLabel = booking.vehicle === 'van' ? '10-Passenger Van' : 'GMC Yukon Denali XL';
  const tripLabel = booking.trip_type === 'roundtrip' ? 'Round Trip' : 'One-Way';
  const remaining = (booking.total_price || 0) - (booking.deposit_amount || 0);
  const headline = isFullPayment ? 'Paid in Full — You\'re All Set!' : 'Deposit Confirmed!';
  const headlineColor = '#22c55e';
  const intro = isFullPayment
    ? 'Your full payment has been received and your ride is confirmed. No further payment needed — see you there!'
    : 'Your deposit has been received and your ride is locked in. Here\'s a summary of your booking:';

  const paymentRows = isFullPayment
    ? `<tr><td style="padding: 8px 0; color: #aaa;">Paid in Full</td><td style="padding: 8px 0; color: #22c55e; font-weight: bold;">$${(booking.total_price || 0).toFixed(2)}</td></tr>
       <tr><td style="padding: 8px 0; color: #aaa;">Balance Due</td><td style="padding: 8px 0; color: #22c55e; font-weight: bold;">$0.00 — Nothing more owed!</td></tr>`
    : `<tr><td style="padding: 8px 0; color: #aaa;">Deposit Paid</td><td style="padding: 8px 0; color: #22c55e; font-weight: bold;">$${booking.deposit_amount}</td></tr>
       <tr><td style="padding: 8px 0; color: #aaa;">Balance Due</td><td style="padding: 8px 0; color: #FFB81C; font-weight: bold;">$${remaining.toFixed(2)} (due 72 hrs before pickup)</td></tr>`;

  const policyNote = isFullPayment
    ? 'Cancellations made more than 72 hours before pickup are eligible for a 50% refund of payments made. Cancellations within 72 hours are non-refundable.'
    : 'Remaining balance is due 72 hours before pickup — you\'ll receive a reminder at 96 hours out. If balance is not received by 72 hours before pickup, we reserve the right to cancel and retain the deposit. Cancellations made more than 72 hours before pickup are eligible for a 50% refund of payments made. Cancellations within 72 hours are non-refundable.';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f5f5f5; padding: 20px;">
  <div style="background: #0a0a0a; color: #ffffff; border-radius: 12px; padding: 30px;">
    ${emailHeader()}
    <h1 style="color: ${headlineColor}; margin-top: 0;">${headline}</h1>
    <p style="color: #ccc; font-size: 16px;">Hi ${booking.customer_name || 'there'},</p>
    <p style="color: #ccc;">${intro}</p>

    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr><td style="padding: 8px 0; color: #aaa; width: 140px;">Trip Type</td><td style="padding: 8px 0; color: #fff;">${tripLabel}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Date</td><td style="padding: 8px 0; color: #fff;">${formatDate(booking.pickup_date)}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Time</td><td style="padding: 8px 0; color: #fff;">${formatTime(booking.pickup_time)}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Pickup</td><td style="padding: 8px 0; color: #fff;">${booking.pickup_address}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Drop-off</td><td style="padding: 8px 0; color: #fff;">${booking.dropoff_address}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Passengers</td><td style="padding: 8px 0; color: #fff;">${booking.passengers}</td></tr>
      ${paymentRows}
    </table>

    <div style="background: rgba(255,255,255,.05); border-radius: 8px; padding: 14px 16px; margin: 16px 0;">
      <p style="font-size: 12px; color: #999; margin: 0; line-height: 1.6;">
        <strong style="color: #ccc;">Cancellation Policy:</strong> ${policyNote}
      </p>
    </div>

    <p style="font-size: 12px; color: #666; text-align: center; margin-top: 20px;">
      Questions? Reply to this email or text us at (816) 552-6669.
    </p>
  </div>
</body>
</html>`;
}

// ── Admin deposit-paid / balance-paid notification email ──
function buildAdminDepositEmail(booking, isFullPayment) {
  const vehicleLabel = booking.vehicle === 'van' ? '10-Passenger Van' : 'GMC Yukon Denali XL';
  const tripLabel = booking.trip_type === 'roundtrip' ? 'Round Trip' : 'One-Way';
  const remaining = (booking.total_price || 0) - (booking.deposit_amount || 0);
  const headline = isFullPayment ? '✅ Balance Received — Paid in Full' : '💳 Deposit Received';
  const intro = isFullPayment
    ? 'A customer has paid their remaining balance. The booking is now paid in full.'
    : 'A customer has paid their deposit. The ride is confirmed and on the calendar.';
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f5f5f5; padding: 20px;">
  <div style="background: #0a0a0a; color: #ffffff; border-radius: 12px; padding: 30px;">
    ${emailHeader()}
    <h1 style="color: #22c55e; margin-top: 0;">${headline}</h1>
    <p style="color: #ccc;">${intro}</p>

    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr><td style="padding: 8px 0; color: #aaa; width: 140px;">Customer</td><td style="padding: 8px 0; color: #fff;">${booking.customer_name || 'N/A'}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Phone</td><td style="padding: 8px 0; color: #FFB81C; font-weight: bold;">${booking.phone || 'N/A'}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Email</td><td style="padding: 8px 0; color: #fff;">${booking.email || 'N/A'}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Vehicle</td><td style="padding: 8px 0; color: #fff;">${vehicleLabel}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Trip Type</td><td style="padding: 8px 0; color: #fff;">${tripLabel}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Date</td><td style="padding: 8px 0; color: #fff;">${formatDate(booking.pickup_date)}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Time</td><td style="padding: 8px 0; color: #fff;">${formatTime(booking.pickup_time)}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Pickup</td><td style="padding: 8px 0; color: #fff;">${booking.pickup_address}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Drop-off</td><td style="padding: 8px 0; color: #fff;">${booking.dropoff_address}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Passengers</td><td style="padding: 8px 0; color: #fff;">${booking.passengers}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Total Price</td><td style="padding: 8px 0; color: #FFB81C; font-weight: bold;">$${booking.total_price}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Deposit Paid</td><td style="padding: 8px 0; color: #22c55e; font-weight: bold;">$${booking.deposit_amount}</td></tr>
      <tr><td style="padding: 8px 0; color: #aaa;">Balance Owed</td><td style="padding: 8px 0; color: #fff;">${remaining <= 0 ? '<span style="color:#22c55e; font-weight:bold;">$0.00 — Paid in Full</span>' : `$${remaining.toFixed(2)} (due 72 hrs before pickup)`}</td></tr>
    </table>

    <p style="font-size: 12px; color: #666; text-align: center; margin-top: 20px;">
      Booking ID: ${booking.id}
    </p>
  </div>
</body>
</html>`;
}
