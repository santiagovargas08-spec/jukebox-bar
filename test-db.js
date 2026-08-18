'use strict';

const { requireTestDatabase } = require('./tests/helpers.js');

requireTestDatabase();

delete require.cache[require.resolve('./db.js')];
const { prisma } = require('./db.js');

async function main() {
  let bar;

  try {
    console.log('\n=================================');
    console.log(' TEST DE BASE DE DATOS');
    console.log('=================================\n');

    await prisma.$queryRaw`SELECT 1`;
    console.log('✓ PostgreSQL conectado');

    bar = await prisma.bar.create({
      data: {
        name: 'GENESIS 2.0 - TEST',
        slug: `genesis-2-test-${Date.now()}`,
        settings: {
          create: {
            displayName: 'GENESIS 2.0',
            primaryColor: '#00F0FF',
            secondaryColor: '#FF0055',
            welcomeMessage: 'Bienvenido a GENESIS 2.0'
          }
        },
        license: {
          create: {
            status: 'TRIAL',
            trialStartedAt: new Date(),
            trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          }
        }
      },
      include: {
        settings: true,
        license: true
      }
    });

    console.log(`✓ Bar creado: ${bar.name} (id=${bar.id})`);

    const cancion = await prisma.queueItem.create({
      data: {
        barId: bar.id,
        videoId: `TEST_VIDEO_${Date.now()}`,
        title: 'Canción de prueba',
        name: 'Cliente Test'
      }
    });

    console.log(`✓ Cola: ${cancion.title}`);

    const historial = await prisma.songHistory.create({
      data: {
        barId: bar.id,
        videoId: cancion.videoId,
        title: cancion.title,
        name: cancion.name
      }
    });

    console.log(`✓ Historial: ${historial.title}`);
    console.log('\n✓ Test completado correctamente\n');
  } catch (error) {
    console.error('\n❌ ERROR EN TEST:');
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (bar?.id) {
      await prisma.bar.delete({ where: { id: bar.id } });
      console.log('✓ Datos de prueba eliminados');
    }

    await prisma.$disconnect();
  }
}

main();
