// src/middleware/errorHandler.js
// ================================================
// PRODUCTION-READY Express Error Handler
// - Clean JSON responses
// - Correlation ID tracing
// - Conditional stack trace (dev only)
// - External monitoring hook (Sentry-ready)
// - Detailed logging with request context
// - Graceful fallback

const logger = require('../utils/logger'); // use your logger (with correlation if you add it)
const { v4: uuidv4 } = require('uuid');    // npm install uuid

module.exports = (err, req, res, next) => {
  // Generate or reuse correlation ID for tracing
  const correlationId = req.headers['x-correlation-id'] || uuidv4().slice(0, 8);

  // Enhance logger with context (tenant, user, request)
  const logContext = {
    correlationId,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    tenantId: req.user?.tenant_id || 'anonymous',
    userId: req.user?.id || 'anonymous',
    errorMessage: err.message,
    errorStack: err.stack
  };

  // Log the error (use your logger)
  logger.error('Unhandled error in request', logContext);

  // Optional: Send to external monitoring (Sentry, Datadog, etc.)
  // if (process.env.SENTRY_DSN) {
  //   Sentry.captureException(err, { extra: logContext });
  // }

  // Determine status & public message
  let status = err.status || 500;
  let publicMessage = err.message || 'Internal Server Error';

  // Handle known error types (add more as needed)
  if (err.name === 'ValidationError') {
    status = 400;
    publicMessage = 'Validation failed: ' + (err.details?.map(d => d.message).join(', ') || err.message);
  } else if (err.name === 'UnauthorizedError') {
    status = 401;
    publicMessage = 'Authentication failed';
  } else if (err.name === 'ForbiddenError') {
    status = 403;
    publicMessage = 'Access denied';
  } else if (err.code === '23505') { // Postgres unique violation
    status = 409;
    publicMessage = 'Resource already exists';
  }

  // Never leak stack/inner error in production
  const response = {
    error: publicMessage,
    correlationId, // helps user support trace issue
    ...(process.env.NODE_ENV === 'development' && {
      stack: err.stack,
      internalError: err.message // for dev only
    })
  };

  // Security headers
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  res.status(status).json(response);
};