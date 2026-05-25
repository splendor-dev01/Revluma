// - Shopify/TikTok cart abandonment events
// - HMAC verification (Shopify-style)
// - Tenant-safe via shop domain mapping
// - Idempotency & validation
// - Recovery trigger with delay
// - Rate limiting & observability

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../config/db');
const logger = require('../utils/logger');
const { recoveryQueue } = require('../queue/recoveryQueue');

// Rate limit (apply globally or here)
const webhookLimiter = require('express-rate-limit')({
  windowMs: 60 * 1000, // 1 min
  max: 100, // 100 req/min per IP
  message: { error: 'Too many webhook requests – IP blocked temporarily' }
});

router.use(webhookLimiter);

// Shopify HMAC verification middleware (adapt for TikTok if needed)
const verifyWebhook = async (req, res, next) => {
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];
  if (!hmacHeader) {
    logger.warn('Missing HMAC header – webhook rejected');
    return res.status(401).json({ error: 'Missing signature' });
  }

  // Shopify secret (per tenant in real setup)
  const shopifySecret = process.env.SHOPIFY_WEBHOOK_SECRET || 'your-secret-here';

  const body = JSON.stringify(req.body);
  const calculatedHmac = crypto
    .createHmac('sha256', shopifySecret)
    .update(body)
    .digest('base64');

  if (calculatedHmac !== hmacHeader) {
    logger.warn('Invalid webhook HMAC', { calculated: calculatedHmac, received: hmacHeader });
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
};

// Map webhook to tenant (critical for multi-tenant)
async function resolveTenant(payload, req) {
  const shopDomain = payload.domain || payload.shop_domain || req.headers['x-shopify-shop-domain'];

  if (!shopDomain) throw new Error('No shop domain in payload');

  const result = await db.query(
    'SELECT id FROM tenants WHERE store_url ILIKE $1 LIMIT 1',
    [`%${shopDomain}%`],
    'system' // global lookup
  );

  if (result.rowCount === 0) throw new Error(`No tenant found for shop: ${shopDomain}`);

  return result.rows[0].id;
}

// POST /api/webhook/abandoned-cart
router.post('/abandoned-cart', verifyWebhook, async (req, res) => {
  const payload = req.body;
  const correlationId = req.headers['x-correlation-id'] || 'wh-' + Date.now();

  try {
    // Basic payload validation
    if (!payload.id || !payload.total_price || !Array.isArray(payload.line_items)) {
      logger.warn('Invalid webhook payload', { correlationId, payload });
      return res.status(400).json({ error: 'Invalid payload structure' });
    }

    // Resolve tenant from shop domain (production critical)
    const tenant_id = await resolveTenant(payload, req);

    const externalCartId = payload.id;
    const cartValue = parseFloat(payload.total_price);
    const currency = payload.currency || 'USD';

    // Idempotency: already processed?
    const existing = await db.query(
      'SELECT id, status FROM abandoned_carts WHERE external_cart_id = $1 AND tenant_id = $2',
      [externalCartId, tenant_id],
      tenant_id
    );

    if (existing.rowCount > 0) {
      const cart = existing.rows[0];
      if (cart.status === 'recovered') {
        return res.status(200).json({ message: 'Cart already recovered' });
      }
      logger.debug('Duplicate webhook – already processed', { correlationId, externalCartId });
      return res.status(200).json({ message: 'Already processed' });
    }

    const sessionDuration = payload.session_duration_seconds || 0; // from pixel/session
    const scrollDepth = payload.scroll_depth || 0;
    const addRemoveActions = payload.add_remove_actions || 0;
    const repeatVisits = payload.repeat_visits || 1;
    const deviceType = payload.device_type || 'unknown';

    // Intent score (real model)
    let intentScore = 30; // base
    intentScore += Math.min(30, (sessionDuration / 60)); // +0.5 per second
    intentScore += Math.min(20, scrollDepth / 5);
    intentScore += addRemoveActions * 10; // positive if add, negative if remove
    intentScore += repeatVisits * 5;
    intentScore += deviceType === 'mobile' ? 10 : 0; // mobile higher intent
    intentScore = Math.max(0, Math.min(100, Math.round(intentScore)));

    // Prepare items JSONB
    const itemsJson = payload.line_items.map(item => ({
      product_id: item.product_id || item.variant_id || null,
      name: item.title || 'Unknown',
      qty: item.quantity || 1,
      price: parseFloat(item.price) || 0,
      image: item.image?.src || null
    }));


    // Insert cart
     const result = await db.query(
      `INSERT INTO abandoned_carts (
        tenant_id, external_cart_id, customer_email, customer_phone,
        cart_value, currency, items, abandonment_at, intent_score, status,
        session_duration_seconds, scroll_depth_percentage, add_remove_actions, repeat_visits, device_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id`,
      [
        tenant_id,
        externalCartId,
        payload.customer?.email || null,
        payload.customer?.phone || null,
        cartValue,
        currency,
        itemsJson,
        new Date(payload.updated_at || payload.created_at || Date.now()),
        intentScore,
        'new',
        sessionDuration,
        scrollDepth,
        addRemoveActions,
        repeatVisits,
        deviceType
      ],
      tenant_id
    );

    const newCartId = result.rows[0].id;

    logger.info('Abandoned cart recorded', {
      correlationId,
      tenant_id,
      externalCartId,
      cartValue,
      itemCount: itemsJson.length,
      intentScore
    });

    // Trigger recovery (after insert success)
    await recoveryQueue.add('cart-recovery', {
      cartId: newCartId,
      touchNumber: 1,
      tenant_id
    }, {
      delay: 300000 // 5 min – configurable later
    });

    res.status(201).json({
      message: 'Abandoned cart recorded – recovery queued',
      cart_id: newCartId
    });
  } catch (err) {
    logger.error('Webhook processing failed', {
      correlationId,
      error: err.message,
      stack: err.stack,
      payload: JSON.stringify(payload).slice(0, 500) // truncate
    });

    res.status(500).json({ error: 'Webhook processing failed' });
  }
});


// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'Webhook endpoint ready' });
});

module.exports = router;