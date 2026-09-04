// ============================================
// STRIPE PAYMENT - /api/stripe-payment
// POST { "amount": 299, "product_name": "Business Website Package", "currency": "usd" }
// Payment link banata hai jo client ko bhejo (amount DOLLARS mein)
// IMPORTANT RULE: Link tum khud bana kar khud approve kar ke bhejo!
// Requires: STRIPE_SECRET_KEY - https://dashboard.stripe.com/apikeys (test mode pehle!)
// ============================================
const vault = require('../lib/credentials.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    const { amount, product_name, currency, description } = req.body || {};
    if (!amount || amount <= 0) return res.status(400).json({ error: 'amount required (dollars, e.g. 299)' });
    const VAULT_STRIPE_KEY = await vault.getCredential('STRIPE_SECRET_KEY');
    if (!VAULT_STRIPE_KEY) {
      return res.status(500).json({ error: 'STRIPE_SECRET_KEY env var missing (set it in Vercel)' });
    }

    const params = new URLSearchParams({
      mode: 'payment',
      'line_items[0][price_data][currency]': (currency || 'usd').toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(Math.round(amount * 100)), // cents
      'line_items[0][price_data][product_data][name]': product_name || 'Website Development',
      'line_items[0][quantity]': '1',
      success_url: (description || '') + '' || undefined
    });

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + VAULT_STRIPE_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    const session = await stripeRes.json();
    if (!stripeRes.ok) throw new Error(session.error ? session.error.message : 'Stripe error');

    res.json({
      success: true,
      payment_link: session.url, // YE link client ko bhejo (WhatsApp/email pe)
      session_id: session.id,
      amount: amount,
      currency: (currency || 'usd').toUpperCase(),
      note: 'Pehle Stripe TEST mode mein test karo (sk_test_... key), phir live key lagao!'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
