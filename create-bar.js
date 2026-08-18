'use strict';

const { prisma } = require('./db.js');

async function main() {
  const bar = await prisma.bar.upsert({
    where: {
      slug: 'genesis-2-0'
    },
    update: {
      name: 'GENESIS 2.0',
      active: true
    },
    create: {
      name: 'GENESIS 2.0',
      slug: 'genesis-2-0',
      active: true,

      settings: {
        create: {
          displayName: 'GENESIS 2.0',
          welcomeMessage: 'Bienvenido a GENESIS 2.0'
        }
      },

      license: {
        create: {
          status: 'TRIAL',
          trialStartedAt: new Date(),
          trialEndsAt: new Date(
            Date.now() + 14 * 24 * 60 * 60 * 1000
          )
        }
      }
    },

    include: {
      settings: true,
      license: true
    }
  });

  console.log('');
  console.log('=================================');
  console.log(' BAR COMERCIAL CREADO');
  console.log('=================================');
  console.log(`ID:       ${bar.id}`);
  console.log(`Nombre:   ${bar.name}`);
  console.log(`Slug:     ${bar.slug}`);
  console.log(`Licencia: ${bar.license?.status}`);
  console.log(`Trial:    ${bar.license?.trialEndsAt}`);
  console.log('=================================');
}

main()
  .catch(error => {
    console.error('ERROR:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });