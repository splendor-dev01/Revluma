// src/controllers/shopifyController.js
const crypto = require('crypto');
const db = require('../config/db');
const logger = require('../utils/logger');

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SCOPES = 'read_products,read_orders';
const APP_URL = process.env.APP_URL || (process.env.NODE_ENV === 'production' ? 'https://yourdomain.com' : 'http://localhost:5000');

// @desc    Initiate Shopify OAuth flow
exports.initiateAuth = async (req, res) => {
  const { shop } = req.query;
  const tenant_id = req.user.tenant_id;

  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }

  // TODO: Store the shop and tenant_id mapping temporarily, e.g., in a session or a temporary table

  const redirectUri = `${APP_URL}/api/shopify/auth/callback`;
  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&redirect_uri=${redirectUri}`;

  res.redirect(installUrl);
};

// @desc    Shopify OAuth callback
exports.authCallback = async (req, res) => {
  const { shop, hmac, code } = req.query;

  if (!shop || !hmac || !code) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  // 1. HMAC Validation (Security Check)
  const map = { ...req.query };
  delete map['hmac'];
  const message = new URLSearchParams(map).toString();
  const providedHmac = Buffer.from(hmac, 'utf-8');
  const generatedHmac = Buffer.from(
    crypto
      .createHmac('sha256', SHOPIFY_API_SECRET)
      .update(message)
      .digest('hex'),
    'utf-8'
  );

  if (!crypto.timingSafeEqual(providedHmac, generatedHmac)) {
    logger.warn('HMAC validation failed', { shop });
    return res.status(400).json({ error: 'HMAC validation failed' });
  }

  // 2. Exchange authorization code for an access token
  const accessTokenPayload = {
    client_id: SHOPIFY_API_KEY,
    client_secret: SHOPIFY_API_SECRET,
    code,
  };

  try {
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(accessTokenPayload),
    });

    const data = await response.json();
    const accessToken = data.access_token;

    if (!accessToken) {
      logger.error('Failed to get access token', { shop, data });
      return res.status(500).json({ error: 'Failed to get access token' });
    }

    // 3. Store the access token securely
    // TODO: Retrieve the tenant_id associated with the shop
    const tenant_id = 'retrieved-tenant-id'; // Replace with actual logic
    await db.query(
      'UPDATE tenants SET shopify_access_token = $1, shopify_shop_name = $2 WHERE id = $3',
      [accessToken, shop, tenant_id],
      tenant_id
    );

    logger.info('Shopify store connected successfully', { shop, tenant_id });

    // TODO: Redirect to a success page in your frontend application
    res.json({ message: 'Shopify store connected successfully!' });

  } catch (err) {
    logger.error('Shopify auth callback failed', { shop, error: err.message });
    res.status(500).json({ error: 'An error occurred during authentication.' });
  }
};
