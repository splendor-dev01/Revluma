const { Pool } = require('pg');
require('dotenv').config();

const runSchemas = async () => {
  console.log('🚀 Running database schema setup...\n');
  
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  const schemas = [
    'schema-recovery.sql',
    'schema-onboarding.sql', 
    'schema-email-verification.sql',
    'schema-password-reset.sql',
    'schema-newsletter.sql',
    'schema-splendor.sql'
  ];
  
  for (const schema of schemas) {
    try {
      console.log(`Running ${schema}...`);
      const content = require('fs').readFileSync(__dirname + '/' + schema, 'utf8');
      await pool.query(content);
      console.log(`✓ ${schema} done\n`);
    } catch (err) {
      console.error(`✗ ${schema} failed:`, err.message, '\n');
    }
  }
  
  console.log('✅ Schema setup complete');
  await pool.end();
};

runSchemas();