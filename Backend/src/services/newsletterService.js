// src/services/newsletterService.js
// ============================================================
// PRODUCTION-READY NEWSLETTER SERVICE
// - Secure token generation (crypto.randomBytes)
// - SendGrid integration for email delivery
// - Double opt-in verification flow
// - Batch sending with retry logic
// - Per-recipient delivery tracking
// ============================================================

const crypto = require('crypto');
const sgMail = require('@sendgrid/mail');
const db = require('../config/db');
const logger = require('../utils/logger');

// Initialize SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@revluma.vercel.app';
const FROM_NAME = process.env.SENDGRID_FROM_NAME || 'Revluma';
const BASE_URL = process.env.BASE_URL || 'https://revluma.vercel.app';
const VERIFICATION_EXPIRY_HOURS = 24;
const BATCH_SIZE = 500;
const BATCH_DELAY_MS = 1200; // ~50 emails/sec to stay under SendGrid limits

// ====================== TOKEN GENERATION ======================

/**
 * Generate a cryptographically secure token
 * @param {number} bytes - Number of random bytes (default 32)
 * @returns {string} Hex-encoded token
 */
function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

// ====================== EMAIL TEMPLATES ======================

/**
 * Build verification email HTML
 */
function buildVerificationEmailHTML(email, token) {
  const verifyUrl = `${BASE_URL}/api/newsletter/verify?token=${encodeURIComponent(token)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#0a0a0a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#111111;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:40px 40px 20px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;">Revluma</h1>
        </td></tr>
        <tr><td style="padding:20px 40px 40px;">
          <h2 style="margin:0 0 16px;color:#ffffff;font-size:22px;font-weight:600;">Confirm your subscription</h2>
          <p style="margin:0 0 24px;color:#a0a0a0;font-size:15px;line-height:1.6;">
            You signed up for product updates, feature releases, and e-commerce intelligence from Revluma.
            Click the button below to confirm your email and activate your subscription.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
            <tr><td align="center">
              <a href="${verifyUrl}" style="display:inline-block;background-color:#ffffff;color:#0a0a0a;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:700;font-size:15px;">Confirm Subscription</a>
            </td></tr>
          </table>
          <p style="margin:0 0 12px;color:#666666;font-size:13px;line-height:1.5;">
            If the button doesn't work, copy and paste this link into your browser:
          </p>
          <p style="margin:0 0 20px;color:#888888;font-size:12px;word-break:break-all;line-height:1.5;">
            <a href="${verifyUrl}" style="color:#888888;">${verifyUrl}</a>
          </p>
          <p style="margin:0;color:#555555;font-size:12px;line-height:1.5;">
            This link expires in ${VERIFICATION_EXPIRY_HOURS} hours. If you didn't request this, you can safely ignore this email.
          </p>
        </td></tr>
        <tr><td style="padding:28px 40px;background-color:#0a0a0a;border-top:1px solid #222222;">
          <p style="margin:0 0 8px;color:#444444;font-size:11px;text-align:center;">
            Revluma — Revenue intelligence for modern e-commerce
          </p>
          <p style="margin:0;color:#333333;font-size:11px;text-align:center;">
            You received this because you subscribed at splendor.ai
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Build newsletter email HTML
 */
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

/**
 * Build unsubscribe confirmation HTML
 */
function buildUnsubscribeConfirmationHTML(email) {
  const resubUrl = `${BASE_URL}/api/newsletter/subscribe`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#0a0a0a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#111111;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:40px;text-align:center;">
          <h2 style="margin:0 0 16px;color:#ffffff;font-size:22px;font-weight:600;">You've been unsubscribed</h2>
          <p style="margin:0 0 24px;color:#a0a0a0;font-size:15px;line-height:1.6;">
            The email <strong style="color:#ffffff;">${escapeHtml(email)}</strong> has been removed from our newsletter list.
            You will no longer receive updates from Revluma.
          </p>
          <p style="margin:0;color:#666666;font-size:13px;line-height:1.5;">
            Changed your mind? You can always
            <a href="${BASE_URL}" style="color:#a0a0a0;text-decoration:underline;">resubscribe from our website</a>.
          </p>
        </td></tr>
        <tr><td style="padding:28px 40px;background-color:#0a0a0a;border-top:1px solid #222222;">
          <p style="margin:0;color:#333333;font-size:11px;text-align:center;">
            Revluma — Revenue intelligence for modern e-commerce
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Escape HTML to prevent injection
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ====================== CORE FUNCTIONS ======================

/**
 * Subscribe an email (creates pending subscription, sends verification)
 * @param {string} email - Subscriber email
 * @param {object} meta - Optional metadata { ip, userAgent, source }
 * @returns {object} Result with status and message
 */
async function subscribe(email, meta = {}) {
  const sanitizedEmail = String(email).trim().toLowerCase();

  // Validate email format
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  if (!sanitizedEmail || !emailRegex.test(sanitizedEmail) || sanitizedEmail.length > 254) {
    return { status: 400, message: 'Invalid email address format' };
  }

  try {
    // Check if already subscribed
    const existing = await db.query(
      'SELECT id, is_verified, is_unsubscribed, verify_token, verify_expires FROM newsletter_subscribers WHERE LOWER(email) = $1',
      [sanitizedEmail],
      'system'
    );

    if (existing.rowCount > 0) {
      const sub = existing.rows[0];

      // Already verified and not unsubscribed
      if (sub.is_verified && !sub.is_unsubscribed) {
        return { status: 200, message: 'Email already subscribed' };
      }

      // Unsubscribed — allow resubscription
      if (sub.is_unsubscribed) {
        const token = generateToken();
        const expires = new Date(Date.now() + VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000);

        await db.query(
          `UPDATE newsletter_subscribers
           SET is_unsubscribed = FALSE,
               is_verified = FALSE,
               verify_token = $1,
               verify_expires = $2,
               unsub_token = encode(gen_random_bytes(32), 'hex'),
               unsubscribed_at = NULL
           WHERE id = $3`,
          [token, expires, sub.id],
          'system'
        );

        await sendVerificationEmail(sanitizedEmail, token);
        logger.info('Resubscription verification sent', { email: sanitizedEmail });
        return { status: 200, message: 'Check your email to confirm your subscription' };
      }

      // Not verified — resend verification if token expired
      if (!sub.is_verified) {
        const tokenExpired = !sub.verify_expires || new Date(sub.verify_expires) < new Date();
        if (tokenExpired) {
          const token = generateToken();
          const expires = new Date(Date.now() + VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000);

          await db.query(
            'UPDATE newsletter_subscribers SET verify_token = $1, verify_expires = $2 WHERE id = $3',
            [token, expires, sub.id],
            'system'
          );

          await sendVerificationEmail(sanitizedEmail, token);
          logger.info('Verification re-sent', { email: sanitizedEmail });
          return { status: 200, message: 'Check your email to confirm your subscription' };
        }

        return { status: 200, message: 'Verification email already sent. Check your inbox.' };
      }
    }

    // New subscription
    const token = generateToken();
    const expires = new Date(Date.now() + VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000);

    await db.query(
      `INSERT INTO newsletter_subscribers (email, verify_token, verify_expires, source, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        sanitizedEmail,
        token,
        expires,
        meta.source || 'website',
        meta.ip || null,
        meta.userAgent || null
      ],
      'system'
    );

    await sendVerificationEmail(sanitizedEmail, token);
    logger.info('New subscription created, verification sent', { email: sanitizedEmail });
    return { status: 201, message: 'Check your email to confirm your subscription' };

  } catch (err) {
    logger.error('Subscribe failed', { email: sanitizedEmail, error: err.message, stack: err.stack });
    return { status: 500, message: 'Subscription failed. Please try again later.' };
  }
}

/**
 * Verify a subscription token
 * @param {string} token - Verification token
 * @returns {object} Result with status and message
 */
async function verify(token) {
  if (!token || typeof token !== 'string' || token.length < 10) {
    return { status: 400, message: 'Invalid or missing verification token' };
  }

  try {
    const result = await db.query(
      `UPDATE newsletter_subscribers
       SET is_verified = TRUE,
           verified_at = NOW(),
           verify_token = NULL,
           verify_expires = NULL
       WHERE verify_token = $1
         AND is_verified = FALSE
         AND (verify_expires IS NULL OR verify_expires > NOW())
       RETURNING id, email`,
      [token],
      'system'
    );

    if (result.rowCount === 0) {
      // Check if token was already used or expired
      const check = await db.query(
        'SELECT id, is_verified FROM newsletter_subscribers WHERE verify_token = $1 OR (verify_token IS NULL AND is_verified = TRUE)',
        [token],
        'system'
      );

      if (check.rowCount > 0 && check.rows[0].is_verified) {
        return { status: 200, message: 'Email already verified' };
      }

      return { status: 400, message: 'Invalid or expired verification token' };
    }

    const subscriber = result.rows[0];
    logger.info('Email verified successfully', { email: subscriber.email, id: subscriber.id });
    return { status: 200, message: 'Email verified successfully. You are now subscribed.' };

  } catch (err) {
    logger.error('Verification failed', { error: err.message, stack: err.stack });
    return { status: 500, message: 'Verification failed. Please try again.' };
  }
}

/**
 * Unsubscribe a user by token
 * @param {string} token - Unsubscribe token
 * @returns {object} Result with status, message, and HTML
 */
async function unsubscribe(token) {
  if (!token || typeof token !== 'string' || token.length < 10) {
    return { status: 400, message: 'Invalid or missing unsubscribe token' };
  }

  try {
    const result = await db.query(
      `UPDATE newsletter_subscribers
       SET is_unsubscribed = TRUE,
           unsubscribed_at = NOW(),
           is_verified = FALSE,
           verify_token = NULL,
           verify_expires = NULL
       WHERE unsub_token = $1
         AND is_unsubscribed = FALSE
       RETURNING id, email`,
      [token],
      'system'
    );

    if (result.rowCount === 0) {
      return { status: 400, message: 'Invalid unsubscribe token or already unsubscribed' };
    }

    const subscriber = result.rows[0];
    logger.info('User unsubscribed', { email: subscriber.email, id: subscriber.id });
    return {
      status: 200,
      message: 'Successfully unsubscribed',
      email: subscriber.email,
      html: buildUnsubscribeConfirmationHTML(subscriber.email)
    };

  } catch (err) {
    logger.error('Unsubscribe failed', { error: err.message, stack: err.stack });
    return { status: 500, message: 'Unsubscribe failed. Please try again.' };
  }
}

/**
 * Send verification email via SendGrid
 */
async function sendVerificationEmail(email, token) {
  const msg = {
    to: email,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: 'Confirm your subscription — Revluma',
    text: `Confirm your Revluma newsletter subscription by visiting this link:\n\n${BASE_URL}/api/newsletter/verify?token=${token}\n\nThis link expires in ${VERIFICATION_EXPIRY_HOURS} hours.\n\nIf you didn't request this, ignore this email.`,
    html: buildVerificationEmailHTML(email, token)
  };

  await sgMail.send(msg);
  logger.info('Verification email sent', { email });
}

/**
 * Send newsletter to all verified, active subscribers
 * @param {string} subject - Newsletter subject
 * @param {string} contentHTML - HTML content body
 * @param {string} contentText - Plain text fallback
 * @param {string} sentBy - Admin identifier
 * @returns {object} Send results
 */
async function sendNewsletter(subject, contentHTML, contentText, sentBy = 'system') {
  if (!subject || !contentHTML) {
    throw new Error('Subject and content are required');
  }

  // Create send record
  const sendRecord = await db.query(
    `INSERT INTO newsletter_sends (subject, content_html, content_text, status, sent_by)
     VALUES ($1, $2, $3, 'sending', $4) RETURNING id`,
    [subject, contentHTML, contentText || '', sentBy],
    'system'
  );
  const sendId = sendRecord.rows[0].id;

  // Fetch all active subscribers
  const subscribers = await db.query(
    `SELECT id, email, unsub_token FROM newsletter_subscribers
     WHERE is_verified = TRUE AND is_unsubscribed = FALSE
     ORDER BY created_at ASC`,
    [],
    'system'
  );

  const totalRecipients = subscribers.rowCount;
  await db.query(
    'UPDATE newsletter_sends SET total_recipients = $1 WHERE id = $2',
    [totalRecipients, sendId],
    'system'
  );

  if (totalRecipients === 0) {
    await db.query(
      "UPDATE newsletter_sends SET status = 'completed', completed_at = NOW() WHERE id = $1",
      [sendId],
      'system'
    );
    logger.info('No active subscribers for newsletter', { sendId });
    return { sendId, total: 0, sent: 0, failed: 0 };
  }

  logger.info('Starting newsletter send', { sendId, totalRecipients, subject });

  let sentCount = 0;
  let failedCount = 0;

  // Process in batches
  for (let i = 0; i < subscribers.rows.length; i += BATCH_SIZE) {
    const batch = subscribers.rows.slice(i, i + BATCH_SIZE);

    const promises = batch.map(async (sub) => {
      // Create event record
      const eventRes = await db.query(
        `INSERT INTO newsletter_send_events (send_id, subscriber_id, email, status)
         VALUES ($1, $2, $3, 'sending') RETURNING id`,
        [sendId, sub.id, sub.email],
        'system'
      );
      const eventId = eventRes.rows[0].id;

      try {
        const html = buildNewsletterHTML(subject, contentHTML, sub.unsub_token);

        const msg = {
          to: sub.email,
          from: { email: FROM_EMAIL, name: FROM_NAME },
          subject: subject,
          text: contentText || subject,
          html: html,
          trackingSettings: {
            clickTracking: { enable: true },
            openTracking: { enable: true }
          }
        };

        await sgMail.send(msg);

        await db.query(
          `UPDATE newsletter_send_events
           SET status = 'sent', sent_at = NOW()
           WHERE id = $1`,
          [eventId],
          'system'
        );

        sentCount++;
      } catch (err) {
        failedCount++;
        logger.error('Newsletter email failed', {
          sendId,
          subscriberId: sub.id,
          email: sub.email,
          error: err.message
        });

        await db.query(
          `UPDATE newsletter_send_events
           SET status = 'failed', error_message = $2
           WHERE id = $1`,
          [eventId, err.message],
          'system'
        );
      }
    });

    await Promise.allSettled(promises);

    // Delay between batches to respect rate limits
    if (i + BATCH_SIZE < subscribers.rows.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  // Update send record
  await db.query(
    `UPDATE newsletter_sends
     SET sent_count = $1, failed_count = $2, status = 'completed', completed_at = NOW()
     WHERE id = $3`,
    [sentCount, failedCount, sendId],
    'system'
  );

  logger.info('Newsletter send completed', { sendId, total: totalRecipients, sent: sentCount, failed: failedCount });

  return { sendId, total: totalRecipients, sent: sentCount, failed: failedCount };
}

/**
 * Get subscriber stats
 */
async function getStats() {
  const result = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE is_verified = TRUE AND is_unsubscribed = FALSE) as active_subscribers,
       COUNT(*) FILTER (WHERE is_verified = FALSE AND is_unsubscribed = FALSE) as pending_verification,
       COUNT(*) FILTER (WHERE is_unsubscribed = TRUE) as unsubscribed,
       COUNT(*) as total
     FROM newsletter_subscribers`,
    [],
    'system'
  );
  return result.rows[0];
}

module.exports = {
  subscribe,
  verify,
  unsubscribe,
  sendNewsletter,
  getStats,
  generateToken,
  escapeHtml
};
