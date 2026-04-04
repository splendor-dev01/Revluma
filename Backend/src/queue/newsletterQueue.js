// src/queue/newsletterQueue.js
// ============================================================
// PRODUCTION-READY NEWSLETTER QUEUE (BullMQ + Redis)
// - Batch email sending with rate limiting
// - Retry logic for failed sends
// - Per-recipient delivery tracking
// - Worker-based async processing
// ============================================================

const { Queue, Worker } = require('bullmq');
const sgMail = require('@sendgrid/mail');
const db = require('../config/db');
const logger = require('../utils/logger');

let redisConnection;

try {
  const { redis } = require('./redis');
  redisConnection = redis;
} catch (err) {
  logger.warn('Redis not available for newsletter queue — falling back to synchronous sending');
}

const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@revluma.onrender.com';
const FROM_NAME = process.env.SENDGRID_FROM_NAME || 'Revluma';
const BASE_URL = process.env.BASE_URL || 'https://revluma.onrender.com';

// ====================== QUEUE SETUP ======================

let newsletterQueue = null;
let newsletterWorker = null;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildNewsletterHTML(subject, content, unsubToken) {
  const unsubUrl = `${BASE_URL}/api/newsletter/unsubscribe?token=${encodeURIComponent(unsubToken)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#0a0a0a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#111111;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:32px 40px 16px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">Revluma</h1>
        </td></tr>
        <tr><td style="padding:16px 40px 40px;">
          <h2 style="margin:0 0 20px;color:#ffffff;font-size:20px;font-weight:600;">${escapeHtml(subject)}</h2>
          <div style="color:#c0c0c0;font-size:14px;line-height:1.7;">${content}</div>
        </td></tr>
        <tr><td style="padding:24px 40px;background-color:#0a0a0a;border-top:1px solid #222222;">
          <p style="margin:0 0 8px;color:#444444;font-size:11px;text-align:center;">
            Revluma — Revenue intelligence for modern e-commerce
          </p>
          <p style="margin:0;color:#333333;font-size:11px;text-align:center;">
            <a href="${unsubUrl}" style="color:#555555;text-decoration:underline;">Unsubscribe</a>
            &nbsp;&middot;&nbsp;
            <a href="${BASE_URL}" style="color:#555555;text-decoration:underline;">splendor.ai</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

if (redisConnection) {
  newsletterQueue = new Queue('newsletter-send', {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10000 },
      removeOnComplete: { age: 604800 },
      removeOnFail: { age: 2592000 }
    }
  });

  // ====================== WORKER ======================
  newsletterWorker = new Worker('newsletter-send', async (job) => {
    const { sendId, subject, content, subscriberId, email, unsubToken } = job.data;

    if (!email || !subject || !content) {
      throw new Error('Missing required job data');
    }

    const correlationId = job.id || 'nl-' + Date.now();

    try {
      const html = buildNewsletterHTML(subject, content, unsubToken);

      const msg = {
        to: email,
        from: { email: FROM_EMAIL, name: FROM_NAME },
        subject: subject,
        text: subject,
        html: html,
        trackingSettings: {
          clickTracking: { enable: true },
          openTracking: { enable: true }
        }
      };

      await sgMail.send(msg);

      // Update event record
      await db.query(
        `UPDATE newsletter_send_events
         SET status = 'sent', sent_at = NOW()
         WHERE send_id = $1 AND subscriber_id = $2`,
        [sendId, subscriberId],
        'system'
      );

      logger.info('Newsletter email sent via queue', { sendId, email, correlationId });
      return { success: true, email };

    } catch (err) {
      logger.error('Newsletter queue email failed', {
        sendId,
        email,
        error: err.message,
        correlationId
      });

      // Update event record with failure
      await db.query(
        `UPDATE newsletter_send_events
         SET status = 'failed', error_message = $3
         WHERE send_id = $1 AND subscriber_id = $2`,
        [sendId, subscriberId, err.message],
        'system'
      );

      throw err; // BullMQ will retry
    }
  }, {
    connection: redisConnection,
    concurrency: 10,
    limiter: { max: 100, duration: 60000 } // 100 emails per minute
  });

  newsletterWorker.on('completed', (job) => {
    logger.debug('Newsletter job completed', { jobId: job.id, email: job.data.email });
  });

  newsletterWorker.on('failed', (job, err) => {
    logger.error('Newsletter job failed permanently', {
      jobId: job?.id,
      email: job?.data?.email,
      attempts: job?.attemptsMade,
      error: err?.message
    });
  });
}

// ====================== QUEUE HELPER ======================

/**
 * Queue a newsletter send to all verified subscribers
 * Falls back to synchronous sending if Redis is not available
 */
async function queueNewsletterSend(sendId, subject, content, contentText, subscribers) {
  if (newsletterQueue) {
    // Queue-based approach
    const jobs = subscribers.map(sub => ({
      name: 'send-email',
      data: {
        sendId,
        subject,
        content,
        subscriberId: sub.id,
        email: sub.email,
        unsubToken: sub.unsub_token
      }
    }));

    // Add jobs in bulk with small delay between batches
    await newsletterQueue.addBulk(jobs.map((job, i) => ({
      ...job,
      opts: {
        delay: Math.floor(i / 50) * 1200 // Stagger: 50 emails per batch, 1.2s between batches
      }
    })));

    logger.info('Newsletter jobs queued', { sendId, jobCount: jobs.length });
    return { queued: true, jobCount: jobs.length };
  }

  // Fallback: synchronous sending
  logger.info('Redis unavailable — sending newsletter synchronously', { sendId });
  return { queued: false };
}

module.exports = {
  newsletterQueue,
  newsletterWorker,
  queueNewsletterSend
};
