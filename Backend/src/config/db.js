// Production-ready PostgreSQL connection pool with tenant-aware RLS support

const { Pool } = require('pg');
const dotenv   = require('dotenv');
const path     = require('path');

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const isProduction = process.env.NODE_ENV === 'production';

let pool = null;

// ── Pool initialisation ──────────────────────────────────────────
const dbUrl = process.env.DATABASE_URL;

// Accept both postgres:// AND postgresql:// (pg supports both)
const validUrl = dbUrl && /^postgres(ql)?s?:\/\//i.test(dbUrl);

if (!dbUrl) {
  console.warn('⚠️  DATABASE_URL not set — all DB queries will fail');
} else if (!validUrl) {
  console.error('❌  DATABASE_URL format invalid. Must start with postgres:// or postgresql://');
  console.error('    Current value starts with:', dbUrl.substring(0, 20));
} else {
  try {
    pool = new Pool({
      connectionString: dbUrl,
      ssl: isProduction && !dbUrl.includes('sslmode=disable')
        ? { rejectUnauthorized: true, ca: process.env.DB_CA_CERT || undefined }
        : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      allowExitOnIdle: false,
    });

    pool.on('error', (err) => {
      console.error('[DB] Idle client error:', err.message);
      if (isProduction) process.exit(-1);
    });

    console.log('[DB] Pool created — awaiting first connection...');
  } catch (err) {
    console.error('[DB] Pool creation threw:', err.message);
    pool = null;
  }
}

// ── Safe pool getter ─────────────────────────────────────────────
function getPool() {
  if (!pool) {
    throw new Error(
      'Database pool is null. Check DATABASE_URL in your .env file. ' +
      'It must start with postgres:// or postgresql:// and include a valid password.'
    );
  }
  return pool;
}

// ── Health check ─────────────────────────────────────────────────
async function checkConnection() {
  if (!pool) {
    console.warn('[DB] checkConnection: pool is null — skipping');
    return false;
  }
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      console.log('[DB] ✅  Health check passed');
      return true;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[DB] ❌  Health check failed:', err.message);
    return false;
  }
}

// ── Tenant context (RLS) ─────────────────────────────────────────
async function withTenantContext(tenantId, callback) {
  if (!tenantId) throw new Error('tenantId required for RLS');

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (tenantId !== 'system' && !uuidRegex.test(tenantId)) {
    throw new Error('Invalid tenant ID format');
  }

  const client = await getPool().connect();
  try {
    await client.query(`SET app.current_tenant_id = '${tenantId}'`);
    return await callback(client);
  } finally {
    client.release();
  }
}

// ── Tenant query (RLS enforced) ──────────────────────────────────
async function query(text, params = [], tenantId = null) {
  if (!tenantId) {
    throw new Error('tenantId is required for all queries (RLS enforcement)');
  }
  return withTenantContext(tenantId, async (client) => {
    try {
      return await client.query(text, params);
    } catch (err) {
      console.error('[DB] Query failed:', { text, error: err.message });
      throw err;
    }
  });
}

// ── System query (no RLS — use for auth, migrations, health) ─────
async function systemQuery(text, params = []) {
  const p = getPool(); // throws clearly if pool is null
  try {
    return await p.query(text, params);
  } catch (err) {
    console.error('[DB] System query failed:', { text, error: err.message });
    throw err;
  }
}

// ── Exports ──────────────────────────────────────────────────────
module.exports = { query, systemQuery, checkConnection, withTenantContext, getPool, pool };

// ── Startup check ────────────────────────────────────────────────
(async () => {
  if (!pool) return; // warnings already printed above
  try {
    const ok = await checkConnection();
    if (!ok) console.warn('⚠️  Server starting without a working database connection');
  } catch (err) {
    console.warn('⚠️  Startup DB check error:', err.message);
  }
})();