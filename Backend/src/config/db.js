// Production-ready PostgreSQL connection pool with tenant-aware RLS support

const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

// Load .env FIRST before any other code runs
// On production (Render), environment variables should be set directly
// Try multiple paths for flexibility
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config(); // Also try default .env

const isProduction = process.env.NODE_ENV === 'production';

let pool = null;

// ── Pool initialisation ──────────────────────────────────────────
const dbUrl = process.env.DATABASE_URL;

console.log('[DB] Loading - DATABASE_URL:', dbUrl ? `SET (${dbUrl.length} chars, starts: ${dbUrl.substring(0, 15)}...)` : 'NOT SET');
console.log('[DB] NODE_ENV:', process.env.NODE_ENV);
console.log('[DB] Current working directory:', process.cwd());

// Accept both postgres:// AND postgresql:// (pg supports both)
const validUrl = dbUrl && /^postgres(ql)?s?:\/\//i.test(dbUrl);

// SSL configuration for production
const getSslConfig = () => {
  if (!isProduction) return false;
  if (dbUrl && dbUrl.includes('sslmode=disable')) return false;
  
  // For Render and most cloud providers, we need to allow self-signed certs
  return {
    rejectUnauthorized: false,
    ca: undefined,
    servername: undefined
  };
};

if (!dbUrl) {
  console.error('⚠️  DATABASE_URL is NOT SET in environment');
} else if (!validUrl) {
  console.error('⚠️  DATABASE_URL format invalid. Must start with postgres:// or postgresql://');
  console.error('    Current value starts with:', dbUrl.substring(0, 20));
} else {
  try {
    pool = new Pool({
      connectionString: dbUrl,
      ssl: getSslConfig(),
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000, // Increased from 5000
      allowExitOnIdle: false,
    });

    // Test connection immediately
    pool.on('connect', () => {
      console.log('[DB] New client connected');
    });

    pool.on('error', (err) => {
      console.error('[DB] Idle client error:', err.message);
      if (isProduction) process.exit(-1);
    });

    console.log('[DB] Pool created successfully');
    
    // Try a test query immediately
    pool.query('SELECT 1')
      .then(() => console.log('[DB] ✅ Test query passed'))
      .catch(err => console.error('[DB] ❌ Test query failed:', err.message));
      
  } catch (err) {
    console.error('[DB] Pool creation threw:', err.message);
    pool = null;
  }
}

// ── Safe pool getter ─────────────────────────────────────────────
function getPool() {
  if (!pool) {
    const dbUrl = process.env.DATABASE_URL;
    let errorMsg = 'Database not configured. ';
    
    if (!dbUrl) {
      errorMsg += 'Please add DATABASE_URL environment variable in your hosting dashboard (e.g., Render).';
    } else if (!/^postgres/i.test(dbUrl)) {
      errorMsg += 'DATABASE_URL must start with "postgres://" or "postgresql://".';
    } else {
      errorMsg += 'Please contact support.';
    }
    
    throw new Error(errorMsg);
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