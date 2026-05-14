// Netlify Function: Submit Review
// Accepts review form submissions from /leave-a-review
// Emails the review to admin so nothing gets lost while GMB is pending.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const ADMIN_EMAIL    = process.env.ADMIN_EMAIL || 'GroupRideKC@gmail.com';
  const LOGO_URL       = 'https://groupridekc.netlify.app/images/grkc-logo-van.png';

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { rating, name, email, review } = body;

  if (!rating || !name || !email || !review) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const stars    = '★'.repeat(rating) + '☆'.repeat(5 - rating);
  const fromLine = email ? `${name} &lt;${email}&gt;` : name;

  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Email not configured' }) };
  }

  const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#f5f5f5;padding:20px;">
  <div style="background:#0a0a0a;border-radius:12px;padding:28px;">
    <div style="text-align:center;margin-bottom:20px;">
      <img src="${LOGO_URL}" alt="Group Ride KC" style="width:150px;height:auto;" />
    </div>
    <h2 style="color:#FFB81C;margin-top:0;text-align:center;">New Review Received</h2>

    <div style="background:#1a1a1a;border:1px solid #FFB81C;border-radius:10px;padding:20px;margin:20px 0;text-align:center;">
      <div style="font-size:2rem;color:#FFB81C;letter-spacing:4px;margin-bottom:8px;">${stars}</div>
      <div style="font-size:1.1rem;font-weight:bold;color:#fff;">${rating} out of 5 stars</div>
    </div>

    <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:20px;margin:16px 0;">
      <p style="color:#888;font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px;">From</p>
      <p style="color:#fff;font-size:1rem;margin:0 0 16px;">${fromLine}</p>
      <p style="color:#888;font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px;">Review</p>
      <p style="color:#ddd;font-size:.95rem;line-height:1.7;margin:0;">${review.replace(/\n/g, '<br>')}</p>
    </div>

    <p style="color:#555;font-size:.78rem;text-align:center;margin-top:20px;">
      Submitted via groupridekc.com/leave-a-review
    </p>
  </div>
</body>
</html>`;

  try {
    const res  = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Group Ride KC <bookings@groupridekc.com>',
        to: [ADMIN_EMAIL],
        reply_to: email || undefined,
        subject: `New ${rating}-Star Review from ${name}`,
        html: emailHtml,
      }),
    });
    const data = await res.json();

    if (data.error) {
      console.error('Resend error:', data.error);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to send' }) };
    }

    console.log(`Review submitted by ${name} (${rating} stars)`);
    return { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error('submit-review error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
