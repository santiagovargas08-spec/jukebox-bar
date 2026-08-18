'use strict';

require('dotenv').config({ path: '.env.test' });

const { Client } = require('pg');

async function main() {
  const testUrl = process.env.TEST_DATABASE_URL;

  if (!testUrl) {
    console.error('TEST_DATABASE_URL is required in .env.test');
    process.exit(1);
  }

  const parsed = new URL(testUrl);
  const dbName = parsed.pathname.replace(/^\//, '') || 'jukebox_test';

  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';

  const client = new Client({ connectionString: adminUrl.toString() });

  await client.connect();

  const exists = await client.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [dbName]
  );

  if (exists.rowCount === 0) {
    await client.query(`CREATE DATABASE "${dbName}"`);
    console.log(`Created database: ${dbName}`);
  } else {
    console.log(`Database exists: ${dbName}`);
  }

  await client.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
