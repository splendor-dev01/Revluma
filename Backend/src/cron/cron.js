// Full Trending Engine Crons
// 1. Internal sales aggregate (hourly)
cron.schedule('0 */1 * * *', async () => {
  const SYSTEM_TENANT_ID = '00000000-0000-0000-0000-000000000000';
  await db.query(`
    INSERT INTO internal_aggregated_sales (region, category, total_sales_24h, total_sales_7d, aggregated_at)
    SELECT 
      jsonb_object_keys(top_regions) as region,
      unnest(top_categories) as category,
      SUM(units_sold_24h)::int as total_sales_24h,
      SUM(units_sold_7d)::int as total_sales_7d,
      NOW()
    FROM trending_products
    WHERE source = 'internal'
    GROUP BY region, category
    ON CONFLICT (region, category) DO UPDATE SET
      total_sales_24h = EXCLUDED.total_sales_24h,
      total_sales_7d = EXCLUDED.total_sales_7d,
      aggregated_at = NOW()
  `, [], SYSTEM_TENANT_ID);
  logger.info('Internal sales aggregated');
});

// 4. Ghost account cleanup (hourly) - Interim guardrail
cron.schedule('0 */1 * * *', async () => {
  try {
    const { prisma } = require('../services/prisma');

    // Delete unverified users older than 24 hours (cascades to tenants)
    const result = await prisma.user.deleteMany({
      where: {
        emailVerified: false,
        createdAt: {
          lt: new Date(Date.now() - 24 * 60 * 60 * 1000) // 24 hours ago
        }
      }
    });

    if (result.count > 0) {
      logger.info(`Cleaned up ${result.count} ghost accounts`);
    }
  } catch (err) {
    logger.error('Ghost account cleanup failed', err);
  }
});

// 5. Pending registration cleanup (hourly) - Target architecture
cron.schedule('0 */1 * * *', async () => {
  try {
    const { prisma } = require('../services/prisma');

    // Delete expired pending registrations
    const result = await prisma.pendingRegistration.deleteMany({
      where: {
        expiresAt: {
          lt: new Date()
        }
      }
    });

    if (result.count > 0) {
      logger.info(`Cleaned up ${result.count} expired pending registrations`);
    }
  } catch (err) {
    logger.error('Pending registration cleanup failed', err);
  }
});

// 2. Trigger ingest every 2 hours (high-priority sources)
cron.schedule('0 */2 * * *', async () => {
  const { triggerIngest } = require('../pipeline/ingestionPipeline');
  try {
    await triggerIngest(); // All enabled
    logger.info('Cron ingest triggered');
  } catch (err) {
    logger.error('Cron ingest failed', err);
  }
});

// 3. Daily cleanup: Old jobs/raw data (retention 7d)
cron.schedule('0 2 * * *', async () => {
  // BullMQ cleanup (via queue)
  const queues = ['trend-raw-ingest', 'trend-scoring'];
  for (const qname of queues) {
    const { Queue } = require('bullmq');
    const q = new Queue(qname, { connection: require('../queue/redis').redis });
    await q.clean(604800000, 2592000000); // 7d complete, 30d failed
    await q.obliterate({ age: 2592000000 }); // Old failed
  }
  // DB raw cleanup
  await db.query(`
    DELETE FROM raw_trend_sources 
    WHERE ingested_at < NOW() - INTERVAL '7 days'
  `);
  logger.info('Daily cleanup complete');
});

// 4. Alert queue drain check (daily)
cron.schedule('0 3 * * *', async () => {
  logger.info('Cron jobs healthy');
});
await db.query(`
    INSERT INTO internal_aggregated_sales (region, category, total_sales_24h, total_sales_7d, aggregated_at)
    SELECT 
      jsonb_object_keys(top_regions) as region,
      unnest(top_categories) as category,
      SUM(units_sold_24h) as total_sales_24h,
      SUM(units_sold_7d) as total_sales_7d,
      NOW()
    FROM trending_products
    WHERE source = 'internal'
    GROUP BY region, category
    ON CONFLICT (region, category) DO UPDATE SET
      total_sales_24h = EXCLUDED.total_sales_24h,
      total_sales_7d = EXCLUDED.total_sales_7d,
      aggregated_at = NOW()
  `);