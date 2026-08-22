'use strict';

require('dotenv').config();
const { prisma } = require('./db.js');
const { createMasterAdmin } = require('./services/masterAdminAuthService.js');

async function main() {
  const email = process.env.MASTER_ADMIN_EMAIL;
  const displayName = process.env.MASTER_ADMIN_NAME || 'Master Admin';
  const password = process.env.MASTER_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error('Configura MASTER_ADMIN_EMAIL y MASTER_ADMIN_PASSWORD antes de ejecutar este script.');
  }

  const existing = await prisma.masterAdmin.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (existing) {
    console.log(`Master Admin ya existe: ${existing.email} (id ${existing.id}). No se modifica.`);
    return;
  }

  const admin = await createMasterAdmin({ email, displayName, password });
  console.log(`Master Admin creado correctamente: ${admin.email} (id ${admin.id}).`);
}

main()
  .catch((error) => {
    console.error('ERROR:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
