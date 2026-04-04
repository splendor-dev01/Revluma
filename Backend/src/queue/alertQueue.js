// - Multi-channel: Email (SendGrid), SMS & WhatsApp (Twilio)
// - Tenant-safe queries (RLS enforced)
// - Per-channel error isolation & retry
// - Observability, validation, cost control
// - Graceful degradation (one channel fail ≠ whole job fail)

const { Queue, Worker } = require('bullmq');
const { redis: redisConnection } = require('./redis');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const db = require('../config/db'); // updated version with tenant enforcement
const logger = require('../utils/logger');

const alertQueue = new Queue('alerts', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 4,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 604800 }, // 7 days
    removeOnFail: { age: 2592000 }     // 30 days
  }
});

// ====================== WORKER ======================
new Worker('alerts', async (job) => {
  const { tenant_id, product_key, message, channels = ['email'] } = job.data;

  // Validation
  if (!tenant_id || !product_key || !message) {
    throw new Error('Missing required job data: tenant_id, product_key, message');
  }

  // Fetch user contact info (owner only)
  const userRes = await db.query(
    'SELECT email, phone FROM users WHERE tenant_id = $1 AND is_owner = true LIMIT 1',
    [tenant_id],
    tenant_id  // RLS-safe – use tenant_id from job
  );

  const user = userRes.rows[0];
  if (!user) {
    logger.warn('No owner found for tenant – skipping alert', { tenant_id, product_key });
    return;
  }

  const correlationId = job.id || 'alert-' + Date.now(); // for tracing

  const logContext = {
    correlationId,
    tenant_id,
    product_key,
    channels
  };

  // Email via SendGrid
  if (channels.includes('email') && user.email && process.env.SENDGRID_API_KEY) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'SendGrid',
        auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY }
      });

      await transporter.sendMail({
        from: process.env.FROM_EMAIL || 'no-reply@revluma.onrender.com',
        to: user.email,
        subject: `Trend Alert: ${product_key} is exploding!`,
        text: message,
        html: `<h2>${message}</h2><p>View details in your Revluma dashboard.</p>`
      });

      logger.info('Email alert sent', { ...logContext, channel: 'email', to: user.email });
    } catch (err) {
      logger.error('Email alert failed', { ...logContext, channel: 'email', error: err.message });
      // Do NOT throw – isolate failure
    }
  }

  // SMS via Twilio
  if (channels.includes('sms') && user.phone && process.env.TWILIO_SID && process.env.TWILIO_AUTH_TOKEN) {
    try {
      const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: user.phone
      });

      logger.info('SMS alert sent', { ...logContext, channel: 'sms', to: user.phone });
    } catch (err) {
      logger.error('SMS alert failed', { ...logContext, channel: 'sms', error: err.message });
    }
  }

  // WhatsApp via Twilio
  if (channels.includes('whatsapp') && user.phone && process.env.TWILIO_WHATSAPP_FROM) {
    try {
      const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({
        body: message,
        from: process.env.TWILIO_WHATSAPP_FROM,
        to: `whatsapp:${user.phone}`
      });

      logger.info('WhatsApp alert sent', { ...logContext, channel: 'whatsapp', to: user.phone });
    } catch (err) {
      logger.error('WhatsApp alert failed', { ...logContext, channel: 'whatsapp', error: err.message });
    }
  }

  // Update last_alerted (always try, even if sends fail)
  try {
    await db.query(
      'UPDATE watchlist SET last_alerted_at = NOW() WHERE tenant_id = $1 AND product_key = $2',
      [tenant_id, product_key],
      tenant_id
    );
    logger.debug('Watchlist last_alerted updated', { tenant_id, product_key });
  } catch (err) {
    logger.error('Failed to update last_alerted', { ...logContext, error: err.message });
  }
}, {
  connection: redisConnection,
  concurrency: 5, // allow 5 parallel alerts
  limiter: { max: 300, duration: 60000 } // 5/min per worker to respect Twilio/SendGrid limits
});

// Error monitoring
alertQueue.on('failed', (job, err) => {
  logger.error('Alert job permanently failed', {
    jobId: job.id,
    attempts: job.attemptsMade,
    error: err.message,
    data: job.data
  });
  // Optional: Sentry.captureException(err, { extra: job.data })
});

module.exports = alertQueue;