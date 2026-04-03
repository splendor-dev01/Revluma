const { Queue, Worker } = require('bullmq');
const cron = require('node-cron');
const db = require('../config/db'); // updated version with tenant enforcement
const logger = require('../utils/logger');
const { redis: redisConnection } = require('../queue/redis');
const { scoringQueue } = require('../intelligence/trendingEngine');

// System tenant ID for global ingestion (no user-specific tenant)
const SYSTEM_TENANT_ID = '00000000-0000-0000-0000-000000000000';

const SOURCE_WEIGHTS = {
  shoplus_tiktok_trends: 0.85,    // high for general trending
  kalodata_tiktok_shop: 0.95,     // highest for sales accuracy
  fastmoss_tiktok: 0.90,          // strong viral detection
  internal: 1.0,                  // highest — your own users' real sales
  mock: 0.3                       // lowest — only for fallback
};

// Ingestion queue
const ingestQueue = new Queue('trend-raw-ingest', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 86400 }, // 1 day
    removeOnFail: { age: 604800 }     // 7 days
  }
});

// ====================== SOURCES – REAL ONLY IN PRODUCTION ======================
const SOURCES = [
  {
    name: 'shopify',
    enabled: !!process.env.SHOPIFY_ACCESS_TOKEN,
    priority: 11,
    fetch: async () => {
      const Shopify = require('shopify-api-node');
      const shopify = new Shopify({
        shopName: process.env.SHOPIFY_STORE_URL.replace('.myshopify.com', ''),
        accessToken: process.env.SHOPIFY_ACCESS_TOKEN
      });

      try {
        logger.info('Fetching Shopify internal data');
        const products = await shopify.product.list({ limit: 20, order: 'updated_at desc' });

        // Fetch analytics (simplified - use GraphQL for full sales velocity)
        const rawItems = products.map(p => ({
          product_key: `shopify-${p.id}`,
          name: p.title,
          description: p.body_html,
          image_urls: p.images?.map(img => img.src) || [],
          avg_price: parseFloat(p.variants[0]?.price || 0),
          currency: p.variants[0]?.price_currency || 'USD',
          units_sold_24h: 0, // Fetch from orders/analytics endpoint
          units_sold_7d: 0,
          units_sold_30d: 0,
          velocity_score: 0, // Calculate from recent orders
          top_regions: { 'internal': 100 },
          top_categories: p.product_type ? [p.product_type] : [],
          aggregated_reviews: { avg_rating: null, count: 0 },
          source_timestamp: new Date().toISOString(),
          source: 'shopify_internal'
        }));

        return rawItems;
      } catch (err) {
        logger.error('Shopify fetch failed', { error: err.message });
        throw err;
      }
    }
  },
  {
    name: 'shoplus_tiktok_trends',
    enabled: !!process.env.SHOPLUS_API_KEY,
    priority: 10,
    fetch: async () => {
      const apiKey = process.env.SHOPLUS_API_KEY;
      if (!apiKey) throw new Error('Shoplus API key missing in production');

      try {
        logger.info('Fetching real data from Shoplus');

        // Dynamic params (category/region from job or default)
        const category = 'beauty'; // make dynamic later via job.data
        const region = 'US';

        const url = `${process.env.SHOPLUS_API_BASE || 'https://api.shoplus.net/v1'}/trending/products?region=${region}&category=${category}&limit=20&sort=velocity_desc`;

        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json',
            'User-Agent': 'Revluma/1.0 (Production Ingestion)'
          },
          signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) {
          throw new Error(`Shoplus failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // Normalize (adapt to real Shoplus response – check docs)
        return (data.data?.products || []).map(item => ({
          product_key: item.id || `${(item.title || item.name || 'unknown').toLowerCase().replace(/\s+/g, '-')}-${region}-${Date.now()}`,
          name: item.title || item.name || 'Unknown',
          description: item.description || '',
          image_urls: item.images?.slice(0, 3) || (item.thumbnail ? [item.thumbnail] : []),
          units_sold_24h: item.sales_last_24h || item.estimated_sales_24h || 0,
          units_sold_7d: item.sales_last_7d || 0,
          units_sold_30d: item.sales_last_30d || 0,
          velocity_score: item.velocity_index || (item.sales_last_24h / 24) || 0,
          avg_price: parseFloat(item.price_range?.avg || item.price || 0),
          currency: item.currency || 'NGN',
          top_regions: { [region]: 100 },
          top_categories: item.categories || ['beauty', 'tiktok_shop'],
          aggregated_reviews: {
            avg_rating: parseFloat(item.rating || null),
            count: item.review_count || 0
          },
          source_timestamp: new Date().toISOString(),
          source: 'shoplus'
        }));
      } catch (err) {
        logger.error('Shoplus ingestion failed permanently', { error: err.message });
        throw err; // BullMQ will retry, but log permanently
      }
    }
  },

  {
    name: 'fastmoss_tiktok',
    enabled: !!process.env.FASTMOSS_API_KEY,
    priority: 9,
    fetch: async () => {
      const apiKey = process.env.FASTMOSS_API_KEY;
      if (!apiKey) throw new Error('FastMoss API key missing');

      try {
        logger.info('Fetching real data from FastMoss');

        const url = 'https://api.fastmoss.com/v1/trending/products?region=US&category=beauty&limit=15';
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json'
          },
          signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) throw new Error(`FastMoss ${response.status}`);

        const data = await response.json();

        // Normalize (adapt from FastMoss docs – typical structure)
        return (data.products || []).map(item => ({
          product_key: item.product_id || `${item.name.toLowerCase().replace(/\s+/g, '-')}-ng`,
          name: item.name,
          description: item.desc || '',
          image_urls: item.images || [],
          units_sold_24h: item.daily_sales || 0,
          units_sold_7d: item.weekly_sales || 0,
          units_sold_30d: item.monthly_sales || 0,
          velocity_score: item.growth_rate || 0,
          avg_price: parseFloat(item.avg_price || 0),
          currency: 'NGN',
          top_regions: { NG: 100 },
          top_categories: ['beauty', 'tiktok_shop'],
          aggregated_reviews: {
            avg_rating: parseFloat(item.rating || null),
            count: item.review_count || 0
          },
          source_timestamp: new Date().toISOString(),
          source: 'fastmoss'
        }));
      } catch (err) {
        logger.error('FastMoss fetch failed', { error: err.message });
        throw err;
      }
    }
  },
];

// ====================== RAW INGEST WORKER ======================
new Worker('trend-raw-ingest', async (job) => {
  const { sourceName } = job.data;

  const source = SOURCES.find(s => s.name === sourceName);
  if (!source || !source.enabled) {
    logger.warn(`Source not enabled or missing: ${sourceName}`);
    return;
  }

  try {
    const rawItems = await source.fetch();

    for (const raw of rawItems) {
      // Dedup: same source + product_key + recent ingest (6h window)
      const existing = await db.query(
        `SELECT id FROM raw_trend_sources 
         WHERE product_key = $1 AND source = $2 
           AND ingested_at > NOW() - INTERVAL '6 hours'`,
        [raw.product_key, sourceName],
        SYSTEM_TENANT_ID  // global ingestion
      );

      if (existing.rowCount > 0) {
        logger.debug('Duplicate raw skipped', { product_key: raw.product_key, source: sourceName });
        continue;
      }

      // Store raw audit trail
      await db.query(
        'INSERT INTO raw_trend_sources (product_key, source, raw_data) VALUES ($1, $2, $3)',
        [raw.product_key, sourceName, raw],
        SYSTEM_TENANT_ID
      );

      // Queue scoring – system tenant for global data
      await scoringQueue.add('score-product', {
        product_key: raw.product_key,
        rawSources: [raw],
        tenantId: SYSTEM_TENANT_ID
      });
    }

    logger.info(`Ingestion complete`, { source: sourceName, count: rawItems.length });
  } catch (err) {
    logger.error(`Ingest worker failed`, { sourceName, jobId: job.id, error: err.message, stack: err.stack });
    throw err; // retry
  }
}, {
  connection: redisConnection,
  concurrency: 3,
  limiter: { max: 100, duration: 60000 } // 100/min per worker
});

// ====================== SCHEDULED INGEST ======================
cron.schedule('0 */4 * * *', async () => {
  try {
    logger.info('Scheduled ingestion started');

    for (const source of SOURCES.filter(s => s.enabled)) {
      await ingestQueue.add('ingest-source', { sourceName: source.name }, {
        jobId: `ingest-${source.name}-${Date.now()}`,
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 604800 }
      });
    }
  } catch (err) {
    logger.error('Scheduled ingest cron failed', { error: err.message });
  }
}, {
  scheduled: true,
  timezone: 'Africa/Lagos'
});

// Manual trigger (admin only – protect with auth in route)
async function triggerIngest(sourceName = null) {
  if (sourceName) {
    const source = SOURCES.find(s => s.name === sourceName && s.enabled);
    if (!source) throw new Error(`Source ${sourceName} not found or disabled`);
    await ingestQueue.add('ingest-source', { sourceName });
    return `Triggered ingest for ${sourceName}`;
  }

  // All enabled sources
  for (const source of SOURCES.filter(s => s.enabled)) {
    await ingestQueue.add('ingest-source', { sourceName: source.name });
  }
  return 'Triggered full ingestion cycle';
}


module.exports = { ingestQueue, triggerIngest };