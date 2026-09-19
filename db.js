'use strict';

require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL no está configurada.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  ssl:
    process.env.DATABASE_SSL === 'true'
      ? {
          rejectUnauthorized:
            process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false'
        }
      : false,

  max: 5,

  idleTimeoutMillis: 30000,

  // Evita que procesos de test queden 30 s esperando a que el pool libere
  // conexiones inactivas. En producción se mantiene el comportamiento normal.
  allowExitOnIdle:
    process.env.NODE_ENV === 'test' ||
    Boolean(process.env.TEST_DATABASE_URL),

  connectionTimeoutMillis: 10000
});

const adapter =
  new PrismaPg(pool);

const prisma =
  new PrismaClient({
    adapter
  });

module.exports = {
  prisma,
  pool
};