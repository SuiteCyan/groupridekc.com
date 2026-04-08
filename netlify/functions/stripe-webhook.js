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

    // 1. Update booking status to 'paid' and payment_status to 'deposit_paid'
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
          payment_status: 'deposit_paid',
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
            payment_status: 'deposit_paid',
            source_page: booking.source_page,
          }),
        });
        const calData = await calRes.json();
        console.log('Calendar event created:', calData.eventId || calData);
      } catch (calErr) {
        console.error('Calendar event creation failed (non-critical):', calErr.message);
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
