// TEMPORARY DEBUG FUNCTION — remove before launch
// Call via: https://groupridekc.netlify.app/.netlify/functions/test-sms?to=YOUR_PHONE

exports.handler = async (event) => {
  const QUO_API_KEY = process.env.QUO_API_KEY;
  const QUO_PHONE_NUMBER_ID = process.env.QUO_PHONE_NUMBER_ID;
  const to = event.queryStringParameters?.to || '+19135551234'; // override via ?to=

  const results = {};

  // Test 1: no prefix
  try {
    const res1 = await fetch('https://api.openphone.com/v1/messages', {
      method: 'POST',
      headers: { Authorization: QUO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: QUO_PHONE_NUMBER_ID, to: [to], content: 'GRK test (no prefix)' }),
    });
    results.noBearerStatus = res1.status;
    results.noBearerBody = await res1.json().catch(() => 'non-JSON response');
  } catch (e) {
    results.noBearerError = e.message;
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      env: {
        hasApiKey: !!QUO_API_KEY,
        apiKeyPrefix: QUO_API_KEY ? QUO_API_KEY.substring(0, 8) + '...' : null,
        phoneNumberId: QUO_PHONE_NUMBER_ID,
        to,
      },
      results,
    }, null, 2),
  };
};
