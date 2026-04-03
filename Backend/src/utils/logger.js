// - JSON format for log aggregators
// - Correlation ID support (request tracing)
// - Level control via env
// - Console + file rotation
// - Sentry-ready (add transport later)

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const { v4: uuidv4 } = require('uuid');

const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

// Default metadata (add correlation ID per request later)
const defaultMeta = {
  service: 'revluma-backend',
  version: '1.0.0'
};

const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS Z' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json() // structured logs
  ),
  defaultMeta,
  transports: [
    // Console – colorful in dev, clean in prod
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: !isProduction }),
        winston.format.simple()
      )
    }),

    // File rotation (daily, keep 14 days)
    new DailyRotateFile({
      filename: 'logs/application-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      level: 'info' // only info+ in files
    }),

    // Error-only file
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d',
      level: 'error'
    })
  ]
});

// Helper to add correlation ID (use in middleware)
logger.withCorrelation = (correlationId = uuidv4().slice(0, 8)) => {
  return {
    info: (msg, meta = {}) => logger.info(msg, { ...meta, correlationId }),
    error: (msg, meta = {}) => logger.error(msg, { ...meta, correlationId, stack: new Error().stack }),
    warn: (msg, meta = {}) => logger.warn(msg, { ...meta, correlationId }),
    debug: (msg, meta = {}) => logger.debug(msg, { ...meta, correlationId })
  };
};

module.exports = logger;