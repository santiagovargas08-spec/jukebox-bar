'use strict';
// Pruebas de integración: servidor real + YouTube simulado + TV y celulares por Socket.IO.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io: conectarIo } = require('socket.io-client');
const { mismaCancion } = require('../lib/identidad');

// Silencia el registro del servidor durante las pruebas.
if (!process.env.JUKEBOX_TEST_LOG) console.log = console.warn = () => {};

const RAIZ = path.resolve(__dirname, '..');
const v = (videoId, title, canal, seconds = 210) =>
  ({ videoId, title, author: { name: canal }, seconds, views: 2e6, thumbnail: '', timestamp: '3:30' });

const esperar = async (cond, ms = 4000, paso = 10) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (await cond()) return true; await new Promise(r => setTimeout(r, paso)); }
  throw new Error('Tiempo de espera agotado: ' + cond.toString().slice(0, 120));
};
const dormir = ms => new Promise(r => setTimeout(r, ms));
const nuevoDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jukebox-it-'));

async function arrancar({ dataDir, buscar }) {
  process.env.PORT = '0';
  process.env.JUKEBOX_DATA_DIR = dataDir;
  process.env.JUKEBOX_AUTODJ_REINTENTO_MS = '30';
  process.env.JUKEBOX_AUTODJ_REINTENTO_MAX_MS = '120';
  const yt = require.resolve('yt-search');
  require.cache[yt] = { id: yt, filename: yt, loaded: true, exports: q => buscar(q), children: [], paths: [] };
  Object.keys(require.cache).forEach(k => {
    if (k === path.join(RAIZ, 'server.js') || k.startsWith(path.join(RAIZ, 'lib'))) delete require.cache[k];
  });
  const app = require('../server.js');
  if (!app.server.listening) await new Promise(r => app.server.once('listening', r));
  const url = `http://localhost:${app.server.address().port}`;
  const clientes = [];

  const conectar = async () => {
    const s = conectarIo(url, { forceNew: true, transports: ['websocket'] });
    clientes.push(s);
    await new Promise(r => s.once('connect', r));
    return s;
  };

  // TV: registra cada reproducción y puede "terminar" la canción actual.
  const tvSocket = await conectar();
  const reproducciones = [];
  tvSocket.on('nueva_reproduccion', c => reproducciones.push(c));
  await dormir(30);
  const tv = {
    reproducciones,
    get actual() { return app.estadoInterno().reproduciendo; },
    terminar: () => tvSocket.emit('siguiente_cancion', { playbackId: app.estadoInterno().reproduciendo.id, motivo: 'ended' }),
    esperarReproducciones: n => esperar(() => reproducciones.length >= n)
  };
  const celular = async () => {
    const s = await conectar();
    let n = 0;
    return {
      socket: s,
      pedir: async (titulo, videoId, nombre = 'Cliente') => {
        const ok = new Promise(r => { s.once('cancion_confirmada', r); s.once('error_cancion', r); });
        s.emit('agregar_cancion', { titulo, videoId, nombre: nombre + (++n) });
        return ok;
      }
    };
  };
  return {
    app, tv, celular, conectar,
    estado: app.estadoInterno,
    detener: async () => { clientes.forEach(c => c.disconnect()); app.detener(); await dormir(20); }
  };
}

// Catálogo de canciones "frescas" distintas entre sí.
const NUEVAS = [
  v('n01', 'Fruko y sus Tesos - El Preso', 'Fruko y sus Tesos'),
  v('n02', 'Grupo Niche - Cali Pachanguero', 'Grupo Niche'),
  v('n03', 'Carlos Vives - La Bicicleta', 'Carlos Vives'),
  v('n04', 'Diomedes Díaz - Mi Primera Cana', 'Diomedes Díaz'),
  v('n05', 'Celia Cruz - La Vida Es Un Carnaval', 'Celia Cruz'),
  v('n06', 'Binomio de Oro - Sin Medir Distancias', 'Binomio de Oro'),
  v('n07', 'Silvestre Dangond - Materialista', 'Silvestre Dangond'),
  v('n08', 'Shakira - Chantaje ft. Maluma', 'ShakiraVEVO'),
  v('n09', 'Marc Anthony - Vivir Mi Vida', 'Marc Anthony'),
  v('n10', 'Juanes - A Dios Le Pido', 'Juanes'),
  v('n11', 'Aterciopelados - Bolero Falaz', 'Aterciopelados'),
  v('n12', 'Systema Solar - Rumbo a Tambores', 'Systema Solar')
];

// Mismas canciones que ya sonaron, pero con otros IDs, canales y etiquetas.
const clonDe = (cancion, i) => [
  { ...cancion, videoId: cancion.videoId + 'x' + i, title: cancion.title + ' (Official Video)', author: { name: 'Otro Canal ' + i } },
  { ...cancion, videoId: cancion.videoId + 'y' + i, title: cancion.title.split(' - ').pop() + ' (Letra/Lyrics)', author: { name: 'Letras Latinas' } },
  { ...cancion, videoId: cancion.videoId + 'z' + i, title: cancion.title + ' [Audio HD]', author: { name: cancion.author.name + ' - Topic' } }
];

// ───────────────────────────────────────────────────────────────

test('Escenarios A, B, C: solicitudes FIFO, sin interrumpir, y Auto DJ retoma al vaciarse la cola', async () => {
  let busquedas = 0;
  const srv = await arrancar({ dataDir: nuevoDir(), buscar: async () => { busquedas++; return { videos: NUEVAS }; } });
  try {
    const cel = await srv.celular();

    // Una canción inicial suena (la primera referencia para Auto DJ).
    await cel.pedir('Joe Arroyo - La Rebelión', 'seed1');
    await srv.tv.esperarReproducciones(1);
    await esperar(() => srv.estado().autoDjPreparada);                 // Auto DJ ya preparó la siguiente
    const preparada = srv.estado().autoDjPreparada.videoId;
    const eventosAntes = srv.tv.reproducciones.length;

    // Escenario C: llega una solicitud con una recomendación preparada.
    await cel.pedir('Rubén Blades - Pedro Navaja', 'r1');
    assert.equal(srv.estado().autoDjPreparada, null, 'la recomendación preparada debe descartarse');
    assert.equal(srv.estado().reproduciendo.videoId, 'seed1', 'no se interrumpe la canción actual');
    assert.equal(srv.tv.reproducciones.length, eventosAntes, 'no se emite ninguna reproducción nueva');

    // Escenario B: cuatro solicitudes más (cinco en total), de varios clientes.
    const cel2 = await srv.celular();
    await cel2.pedir('Héctor Lavoe - El Cantante', 'r2');
    await cel.pedir('Willie Colón - Idilio', 'r3');
    await cel2.pedir('Oscar D\'León - Llorarás', 'r4');
    await cel.pedir('Joe Arroyo - En Barranquilla Me Quedo', 'r5');
    await dormir(150);                                                 // tiempo para que Auto DJ intente algo
    assert.equal(srv.estado().autoDjPreparada, null, 'con solicitudes en cola no se prepara nada');
    assert.deepEqual(srv.estado().cola.map(c => c.videoId), ['r1', 'r2', 'r3', 'r4', 'r5']);
    assert.equal(new Set(srv.estado().cola.map(c => c.id)).size, 5, 'ids de solicitud únicos');
    assert.equal(srv.tv.reproducciones.length, eventosAntes, 'sigue sin haber saltos');

    // Terminan una a una: deben sonar EXACTAMENTE en orden de llegada.
    for (const esperado of ['r1', 'r2', 'r3', 'r4', 'r5']) {
      srv.tv.terminar();
      await esperar(() => srv.estado().reproduciendo && srv.estado().reproduciendo.videoId === esperado);
      assert.equal(srv.estado().reproduciendo.origen, undefined, 'una solicitud no es de Auto DJ');
    }
    const ordenSolicitudes = srv.tv.reproducciones.map(c => c.videoId);
    assert.deepEqual(ordenSolicitudes, ['seed1', 'r1', 'r2', 'r3', 'r4', 'r5']);
    assert.ok(!ordenSolicitudes.includes(preparada), 'la recomendación descartada no se coló entre las solicitudes');

    // La cola quedó vacía: al terminar r5 entra Auto DJ automáticamente.
    srv.tv.terminar();
    await srv.tv.esperarReproducciones(7);
    const auto = srv.tv.reproducciones[6];
    assert.equal(auto.origen, 'autodj');
    assert.ok(NUEVAS.some(n => n.videoId === auto.videoId));
    assert.ok(busquedas > 0);
  } finally { await srv.detener(); }
});

test('Auto DJ nunca repite: mismo tema con distintos IDs y canales se rechaza (10 ciclos)', async () => {
  const dir = nuevoDir();
  const srv = await arrancar({
    dataDir: dir,
    buscar: async () => {
      // Cada búsqueda devuelve clones de TODO lo que ya sonó, mezclados con canciones nuevas.
      const sonadas = srv.tv ? srv.tv.reproducciones : [];
      const clones = sonadas.flatMap((c, i) => {
        const original = [...NUEVAS, v('seed1', 'Joe Arroyo - La Rebelión', 'Joe Arroyo')].find(n => n.videoId === c.videoId);
        return original ? clonDe(original, i) : [];
      });
      // Intercalados (clon, nueva, clon, nueva...) para que las nuevas también aparezcan
      // dentro de los primeros resultados, como pasaría en una búsqueda real.
      const mezcla = [];
      for (let i = 0; i < Math.max(clones.length, NUEVAS.length); i++) {
        if (clones[i]) mezcla.push(clones[i]);
        if (NUEVAS[i]) mezcla.push(NUEVAS[i]);
      }
      return { videos: mezcla };
    }
  });
  try {
    const cel = await srv.celular();
    await cel.pedir('Joe Arroyo - La Rebelión', 'seed1');
    await srv.tv.esperarReproducciones(1);
    for (let i = 2; i <= 11; i++) {
      await esperar(() => srv.estado().autoDjPreparada);
      srv.tv.terminar();
      await srv.tv.esperarReproducciones(i);
    }
    const sonadas = srv.tv.reproducciones;
    assert.equal(sonadas.length, 11);
    assert.equal(new Set(sonadas.map(c => c.videoId)).size, 11, 'ningún videoId repetido');
    for (let i = 0; i < sonadas.length; i++) {
      for (let j = i + 1; j < sonadas.length; j++) {
        assert.equal(
          mismaCancion(sonadas[i], sonadas[j]), false,
          `"${sonadas[i].titulo}" y "${sonadas[j].titulo}" son la misma canción`
        );
      }
    }
  } finally { await srv.detener(); }
});

test('Si solo hay canciones ya reproducidas, Auto DJ ESPERA (no repite) y retoma cuando aparece una nueva', async () => {
  let modo = 'solo-repetidas';
  const seed = v('seed1', 'Joe Arroyo - La Rebelión', 'Joe Arroyo');
  const srv = await arrancar({
    dataDir: nuevoDir(),
    buscar: async () => {
      if (modo === 'solo-repetidas') return { videos: [seed, ...clonDe(seed, 1), ...clonDe(seed, 2)] };
      if (modo === 'error') throw new Error('sin conexión');
      return { videos: [NUEVAS[0]] };
    }
  });
  try {
    const cel = await srv.celular();
    await cel.pedir('Joe Arroyo - La Rebelión', 'seed1');
    await srv.tv.esperarReproducciones(1);
    srv.tv.terminar();
    await esperar(() => srv.estado().reproduciendo === null);
    await dormir(500);                                                // varios reintentos
    assert.equal(srv.tv.reproducciones.length, 1, 'no debe sonar nada repetido');
    assert.equal(srv.estado().reproduciendo, null);
    assert.ok(srv.estado().autoDjFallos > 0, 'está reintentando');

    modo = 'error';                                                    // YouTube caído: tampoco bloquea ni repite
    await dormir(300);
    assert.equal(srv.tv.reproducciones.length, 1);

    modo = 'hay-nueva';                                                // aparece una canción nueva
    await srv.tv.esperarReproducciones(2);
    assert.equal(srv.tv.reproducciones[1].videoId, NUEVAS[0].videoId);
    assert.equal(srv.tv.reproducciones[1].origen, 'autodj');
  } finally { await srv.detener(); }
});

test('Reinicio del servidor: el historial persiste y no se repite lo que sonó antes', async () => {
  const dir = nuevoDir();
  const seed = v('seed1', 'Joe Arroyo - La Rebelión', 'Joe Arroyo');
  let srv = await arrancar({ dataDir: dir, buscar: async () => ({ videos: [NUEVAS[0]] }) });
  const cel1 = await srv.celular();
  await cel1.pedir('Joe Arroyo - La Rebelión', 'seed1');
  await srv.tv.esperarReproducciones(1);
  srv.tv.terminar();
  await srv.tv.esperarReproducciones(2);                              // Auto DJ puso n01
  assert.equal(srv.tv.reproducciones[1].videoId, 'n01');
  await srv.detener();

  // ── reinicio ──
  let modo = 'solo-repetidas';
  srv = await arrancar({
    dataDir: dir,
    buscar: async () => modo === 'solo-repetidas'
      ? { videos: [seed, ...clonDe(seed, 7), NUEVAS[0], ...clonDe(NUEVAS[0], 8)] }
      : { videos: [NUEVAS[0], NUEVAS[1]] }
  });
  try {
    assert.equal(srv.estado().totalRecordadas, 2, 'recuerda lo reproducido antes del reinicio');
    const cel = await srv.celular();
    await cel.pedir('Marc Anthony - Vivir Mi Vida', 'otra1');
    await srv.tv.esperarReproducciones(1);
    srv.tv.terminar();
    await esperar(() => srv.estado().reproduciendo === null);
    await dormir(400);
    assert.equal(srv.tv.reproducciones.length, 1, 'no repite canciones de antes del reinicio');
    modo = 'hay-nueva';
    await srv.tv.esperarReproducciones(2);
    assert.equal(srv.tv.reproducciones[1].videoId, 'n02', 'n01 ya sonó antes del reinicio; se elige la nueva');
  } finally { await srv.detener(); }
});

test('Condición de carrera: una solicitud llega mientras Auto DJ aún está buscando', async () => {
  let abrir;
  let compuerta = null;
  const srv = await arrancar({
    dataDir: nuevoDir(),
    buscar: async () => { if (compuerta) await compuerta; return { videos: NUEVAS }; }
  });
  try {
    const cel = await srv.celular();
    compuerta = new Promise(r => { abrir = r; });                      // la búsqueda queda "en vuelo"
    await cel.pedir('Joe Arroyo - La Rebelión', 'seed1');
    await srv.tv.esperarReproducciones(1);
    await cel.pedir('Rubén Blades - Pedro Navaja', 'r1');              // llega durante la búsqueda
    abrir();
    await dormir(150);
    assert.equal(srv.estado().autoDjPreparada, null, 'el resultado tardío se descarta');
    assert.equal(srv.estado().reproduciendo.videoId, 'seed1');
    srv.tv.terminar();
    await esperar(() => srv.estado().reproduciendo && srv.estado().reproduciendo.videoId === 'r1');
    assert.equal(srv.tv.reproducciones.length, 2, 'la solicitud sonó antes que cualquier recomendación');
  } finally { await srv.detener(); }
});

test('Nada interrumpe la canción actual: avances sin playbackId, atrasados o ajenos se ignoran', async () => {
  const srv = await arrancar({ dataDir: nuevoDir(), buscar: async () => ({ videos: NUEVAS }) });
  try {
    const cel = await srv.celular();
    const intruso = await srv.conectar();                              // otro celular malintencionado
    await cel.pedir('Joe Arroyo - La Rebelión', 'seed1');
    await srv.tv.esperarReproducciones(1);
    const id = srv.estado().reproduciendo.id;

    intruso.emit('siguiente_cancion');                                  // sin datos
    intruso.emit('siguiente_cancion', {});                              // sin playbackId
    intruso.emit('siguiente_cancion', { playbackId: 999, motivo: 'ended' });   // reproducción vieja
    intruso.emit('cancion_terminada', { videoId: 'otraCosa', titulo: 'Spam', nombre: 'x' });
    intruso.emit('reordenar_cola', 'no-es-una-lista');
    await dormir(200);
    assert.equal(srv.estado().reproduciendo.id, id);
    assert.equal(srv.tv.reproducciones.length, 1);

    // La señal correcta del televisor sí avanza, y repetirla (ENDED duplicado) no salta otra.
    await cel.pedir('Rubén Blades - Pedro Navaja', 'r1');
    await cel.pedir('Héctor Lavoe - El Cantante', 'r2');
    srv.tv.terminar();
    await esperar(() => srv.estado().reproduciendo.videoId === 'r1');
    intruso.emit('siguiente_cancion', { playbackId: id, motivo: 'ended' });   // duplicado atrasado
    await dormir(100);
    assert.equal(srv.estado().reproduciendo.videoId, 'r1');
    assert.equal(srv.tv.reproducciones.length, 2);
  } finally { await srv.detener(); }
});

test('Reordenar la cola desde el admin no pierde solicitudes que llegaron mientras tanto', async () => {
  const srv = await arrancar({ dataDir: nuevoDir(), buscar: async () => ({ videos: NUEVAS }) });
  try {
    const cel = await srv.celular();
    const admin = await srv.conectar();
    await cel.pedir('Tema Uno', 's0');
    await srv.tv.esperarReproducciones(1);
    await cel.pedir('Tema Dos', 'a');
    await cel.pedir('Tema Tres', 'b');
    const [a, b] = srv.estado().cola.map(c => c.id);
    await cel.pedir('Tema Cuatro', 'c');                                // llega después de que el admin vio la lista
    admin.emit('reordenar_cola', [b, a]);
    await esperar(() => srv.estado().cola[0].videoId === 'b');
    assert.deepEqual(srv.estado().cola.map(c => c.videoId), ['b', 'a', 'c']);
  } finally { await srv.detener(); }
});
