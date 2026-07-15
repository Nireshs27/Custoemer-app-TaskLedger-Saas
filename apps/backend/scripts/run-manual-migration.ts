import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  // Determine SSL setting based on connection string
  const sslDisabled = /sslmode=disable|ssl=false/i.test(databaseUrl);

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: sslDisabled ? false : { rejectUnauthorized: false }
  });

  try {
    const migrationFile = process.argv[2] || '20260209_add_org_id_and_pending_delete.sql';
    const migrationPath = path.join(__dirname, '..', 'migrations', migrationFile);
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    console.log(`🚀 Running migration: ${migrationFile}`);
    await pool.query(sql);
    console.log('✅ Migration completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
