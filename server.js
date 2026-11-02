'use strict';

// ═══════════════════════════════════════════════════════════════
//   JUKEBOX DIGITAL — Servidor Principal (Con Panel de Admin)
//   Stack: Node.js · Express · Socket.io · Yt-Search
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const ytSearch = require('yt-search');
const { MemoriaCanciones } = require('./lib/memoria');
const { normalizarTexto, nombreArtista, crearHuella, mismaHuella, pareceCancion } = require('./lib/identidad');

const app    = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout:  60000,
  pingInterval: 25000
});

// ESTADO EN MEMORIA
let cola          = [];   
let reproduciendo = null;
let historialReproducidas = []; // 🔥 NUEVO: Historial de últimas canciones reproducidas

// 🔥 CACHÉ DE BÚSQUEDAS PARA VELOCIDAD
const cacheSearches = {};
const CACHE_TTL = 3600000; // 1 hora en milisegundos
const MAX_CACHE_SEARCHES = 500;

// Motor Auto-DJ: recomendaciones locales, sin servicios ni APIs externas.
const HISTORIAL_MAX = 60;
const AUTO_DJ_REINTENTO_MS = Number(process.env.JUKEBOX_AUTODJ_REINTENTO_MS) || 10000;
const AUTO_DJ_REINTENTO_MAX_MS = Number(process.env.JUKEBOX_AUTODJ_REINTENTO_MAX_MS) || 300000;
const AUTO_DJ_BUSQUEDA_TIMEOUT_MS = Number(process.env.JUKEBOX_AUTODJ_TIMEOUT_MS) || 9000;
const AUTO_DJ_MAX_CONSULTAS = 8;      // límite de búsquedas por intento
const AUTO_DJ_CANDIDATOS_SUFICIENTES = 8;
const AUTO_DJ_RESULTADOS_POR_CONSULTA = 30;   // con historial largo, el top de YouTube se llena de canciones ya sonadas
let autoDjEnCurso = false;
let autoDjPreparada = null;
let autoDjRetryTimer = null;
let autoDjFallos = 0;                 // intentos seguidos sin canción nueva (para espaciar reintentos)
let autoDjRotacion = 0;               // rota las búsquedas para no pedir siempre lo mismo
let detenido = false;

// MEMORIA PERSISTENTE: recuerda TODAS las canciones reproducidas (sin límite) y sobrevive
// a reinicios. Detecta la misma canción aunque cambie el videoId, el canal o las etiquetas.
const DATA_DIR = process.env.JUKEBOX_DATA_DIR || path.join(__dirname, 'data');
const memoria = new MemoriaCanciones({
  archivo: path.join(DATA_DIR, 'historial-canciones.jsonl'),
  strictPersistence: process.env.JUKEBOX_REQUIRE_PERSISTENCE !== 'false'
});
// Se reconstruye la ventana visible y el perfil desde TODO el historial persistente.
historialReproducidas = memoria.obtenerRecientes(HISTORIAL_MAX).map(r => ({
  ...r,
  nombre: r.nombreSolicitante || 'Historial',
  timestamp: new Date(r.reproducidaEn).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
}));
// Metadatos de búsquedas recientes: permiten identificar artista/género cuando
// un cliente solicita un video cuyo título no incluye al intérprete.
const metadataVideos = new Map();
const MAX_METADATA_VIDEOS = 2500;
// Recomendaciones descartadas: se conserva identidad musical, no solo videoId.
const recomendacionesDescartadas = new Map();
const MAX_DESCARTADAS = 500;
const videosFallidos = [];
const feedbackAutoDj = new Map();
const MAX_FEEDBACK = 300;

// Ids únicos y crecientes para las solicitudes (Date.now() puede repetirse en el mismo ms).
let ultimoIdSolicitud = 0;
function nuevoIdSolicitud() {
  const ahora = Date.now();
  ultimoIdSolicitud = ahora > ultimoIdSolicitud ? ahora : ultimoIdSolicitud + 1;
  return ultimoIdSolicitud;
}

app.use(express.static(path.join(__dirname, 'public')));

function guardarMetadataVideo(video) {
  if (!video || !video.videoId) return;
  const id = String(video.videoId);
  metadataVideos.delete(id);
  metadataVideos.set(id, {
    videoId: id,
    title: String(video.title || ''),
    artista: nombreArtista(video),
    generos: detectarGeneros(video),
    epoca: detectarEpoca(video),
    author: video.author || null,
    description: String(video.description || '').slice(0, 3000),
    seconds: Number(video.seconds || (video.duration && video.duration.seconds) || 0) || 0,
    thumbnail: video.thumbnail || ''
  });
  while (metadataVideos.size > MAX_METADATA_VIDEOS) {
    metadataVideos.delete(metadataVideos.keys().next().value);
  }
}

function enriquecerCancion(cancion) {
  const meta = metadataVideos.get(String(cancion.videoId)) || {};
  const combinada = { ...meta, ...cancion };
  combinada.titulo = String(cancion.titulo || meta.title || '');
  combinada.artista = String(cancion.artista || cancion.artist || meta.artista || nombreArtista(combinada) || '');
  combinada.generos = Array.isArray(cancion.generos) && cancion.generos.length
    ? cancion.generos
    : (meta.generos && meta.generos.length ? meta.generos : detectarGeneros({ ...meta, ...combinada }));
  combinada.epoca = cancion.epoca || meta.epoca || detectarEpoca({ ...meta, ...combinada });
  combinada.duracionSegundos = Number(cancion.duracionSegundos || meta.seconds || 0) || null;
  return combinada;
}

// Cada canción queda guardada DURANTE el inicio de reproducción, antes de
// notificar al televisor. En producción el servidor falla de forma cerrada
// si el historial no se puede escribir.
function marcarComoReproducido(cancion) {
  if (!cancion || !cancion.videoId) throw new Error('Canción sin videoId');
  const registrada = memoria.registrar(cancion);
  if (!registrada && memoria.buscarRepetida(cancion).repetida) {
    throw new Error('La canción ya figura en el historial persistente');
  }
}

function emitirReproduccion(cancion) {
  if (detenido) return false;
  const preparada = enriquecerCancion(cancion);
  preparada.inicioMs = Date.now();
  try {
    marcarComoReproducido(preparada);
  } catch (error) {
    console.error('[PLAYBACK] Reproducción bloqueada: no se pudo garantizar el historial:', error.message);
    io.emit('error_reproduccion', { mensaje: 'No se pudo guardar el historial. La reproducción se pausó para evitar repetir canciones.' });
    return false;
  }
  reproduciendo = preparada;
  console.log(`[PLAYBACK] Emitiendo nueva_reproduccion: "${reproduciendo.titulo}" | origen=${reproduciendo.origen || 'solicitud'} | id=${reproduciendo.id} | videoId=${reproduciendo.videoId}`);
  io.emit('nueva_reproduccion', reproduciendo);
  io.emit('cola_actualizada', { cola, reproduciendo });
  return true;
}

// Descarta la recomendación preparada y la recuerda para no volver a ofrecerla.
function descartarAutoDjPreparada(motivo) {
  if (!autoDjPreparada) return;
  recomendacionesDescartadas.set(String(autoDjPreparada.videoId), autoDjPreparada);
  while (recomendacionesDescartadas.size > MAX_DESCARTADAS) {
    recomendacionesDescartadas.delete(recomendacionesDescartadas.keys().next().value);
  }
  console.log(`[AUTO-DJ] Recomendación descartada (${motivo}): "${autoDjPreparada.titulo}"`);
  autoDjPreparada = null;
}

// Validación única que usan tanto la búsqueda como el momento de reproducir.
// Lee SIEMPRE el estado actual (no una foto antigua), así una solicitud o una canción
// que cambió mientras se buscaba también se tiene en cuenta.
function validarCandidatoAutoDj(video, opciones = {}) {
  if (!video || !video.videoId) return { ok: false, motivo: 'sin-videoId' };
  const id = String(video.videoId);
  if (!pareceCancion(video)) return { ok: false, motivo: 'no-es-una-cancion' };
  if (recomendacionesDescartadas.has(id) ||
      Array.from(recomendacionesDescartadas.values()).some(c => mismaHuella(crearHuella(video), crearHuella(c)))) {
    return { ok: false, motivo: 'recomendacion-descartada' };
  }
  if (videosFallidos.includes(id)) return { ok: false, motivo: 'video-fallido' };

  const rep = memoria.buscarRepetida(video);
  if (rep.repetida) return { ok: false, motivo: `ya-reproducida (${rep.motivo})`, con: rep.con };

  const huella = crearHuella(video);
  const comparar = [
    ...(reproduciendo ? [['sonando', reproduciendo]] : []),
    ...cola.map(c => ['en-cola-publica', c]),
    ...(!opciones.ignorarPreparada && autoDjPreparada ? [['preparada', autoDjPreparada]] : [])
  ];
  for (const [donde, otra] of comparar) {
    if (String(otra.videoId) === id || mismaHuella(huella, crearHuella(otra))) {
      return { ok: false, motivo: `duplicada-de-${donde}`, con: otra.titulo };
    }
  }
  return { ok: true };
}

function reproducirAutoDjPreparada() {
  if (detenido || reproduciendo || cola.length > 0 || !autoDjPreparada) return false;
  // Última comprobación justo antes de sonar: nunca se emite una repetida.
  const control = validarCandidatoAutoDj(autoDjPreparada, { ignorarPreparada: true });
  if (!control.ok) {
    descartarAutoDjPreparada(`falló la validación final: ${control.motivo}`);
    programarReintentoAutoDJ();
    return false;
  }
  const siguiente = autoDjPreparada;
  if (!emitirReproduccion(siguiente)) {
    programarReintentoAutoDJ();
    return false;
  }
  autoDjPreparada = null;
  console.log(`[AUTO-DJ] Reproduciendo: "${siguiente.titulo}"`);
  rellenarColaAutoDJ();
  return true;
}

function intentarReproducir() {
  if (!reproduciendo && cola.length > 0) {
    descartarAutoDjPreparada('hay solicitudes en la cola');
    const siguiente = cola.shift();
    if (!emitirReproduccion(siguiente)) {
      cola.unshift(siguiente);
      return false;
    }
    console.log(`[►] Auto-inicio → "${siguiente.titulo}" (${siguiente.nombre})`);
    if (cola.length === 0) rellenarColaAutoDJ();
    return true;
  }
  return false;
}

function agregarAlHistorial(cancion) {
  if (!cancion || !cancion.videoId) return;
  if (historialReproducidas[0] && String(historialReproducidas[0].videoId) === String(cancion.videoId)) return;
  historialReproducidas.unshift({
    ...cancion,
    reproducidaEn: Date.now()
  });
  if (historialReproducidas.length > HISTORIAL_MAX) historialReproducidas.length = HISTORIAL_MAX;
  io.emit('historial_actualizado', { historialReproducidas });
}

const PALABRAS_COMUNES = new Set([
  'official','video','music','audio','lyrics','lyric','hd','4k','remaster',
  'version','live','feat','ft','the','and','de','la','el','en','del','con',
  'song','songs','mix','topic','vevo','original','clip'
]);

function tokensMusicales(texto) {
  return normalizarTexto(texto).split(' ')
    .filter(t => t.length > 2 && !PALABRAS_COMUNES.has(t));
}

function similitudTexto(a, b) {
  const A = new Set(tokensMusicales(a));
  const B = new Set(tokensMusicales(b));
  if (!A.size || !B.size) return 0;
  let comunes = 0;
  A.forEach(t => { if (B.has(t)) comunes++; });
  return comunes / Math.max(1, Math.min(A.size, B.size));
}

// La detección de canciones repetidas vive en lib/identidad.js (huella musical) y
// lib/memoria.js (historial persistente). Ver validarCandidatoAutoDj().

function claveArtista(nombre) {
  return normalizarTexto(nombre).replace(/\b(official|vevo|topic|records|music)\b/g, '').trim();
}

const MAPA_GENEROS = {
  reggaeton: ['reggaeton','regueton','urbano latino','perreo'],
  salsa: ['salsa','salsa romantica','salsa brava'],
  bachata: ['bachata'],
  merengue: ['merengue'],
  vallenato: ['vallenato','vallenatos'],
  cumbia: ['cumbia'],
  champeta: ['champeta'],
  popular: ['musica popular','despecho','carrilera','guasca'],
  tropical: ['tropical','tropicales'],
  regional: ['regional mexicano','banda','norteno','corridos','ranchera'],
  pop: ['pop','pop latino','dance pop'],
  rock: ['rock','hard rock','alternative rock','indie rock','punk'],
  electronica: ['electronica','edm','house','techno','trance'],
  hiphop: ['hip hop','hip-hop','rap','trap'],
  jazz: ['jazz','smooth jazz'],
  reggae: ['reggae','dancehall'],
  balada: ['balada','romantica','bolero']
};

// Coincidencia por palabra completa: "pop" no debe activarse con "popular" ni
// "rap" con "trapiche".
const REGEX_GENEROS = Object.entries(MAPA_GENEROS).map(([genero, claves]) => [
  genero,
  new RegExp('(^| )(' + claves.map(c => normalizarTexto(c)).join('|') + ')( |$)')
]);

function detectarGeneros(video) {
  const texto = normalizarTexto([
    video && (video.title || video.titulo),
    video && video.description,
    nombreArtista(video)
  ].filter(Boolean).join(' '));
  return REGEX_GENEROS.filter(([, regex]) => regex.test(texto)).map(([genero]) => genero);
}

function detectarEpoca(video) {
  const texto = normalizarTexto(video && (video.title || video.titulo));
  const anio = texto.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  if (anio) return Math.floor(Number(anio[1]) / 10) * 10;
  const decada = texto.match(/\b(50|60|70|80|90)s\b/);
  return decada ? Number(decada[1]) + 1900 : null;
}

function puntuarCandidato(video, semilla, fuente, artistasRecientes, feedback, perfil = obtenerPerfilAutoDJ()) {
  const titulo = String(video.title || '');
  const artistaKey = claveArtista(nombreArtista(video));
  let score = fuente.peso;

  // Afinidad con el promedio musical de las últimas canciones.
  const generosCandidato = detectarGeneros(video);
  const pesosGenero = perfil.generos || [];
  if (pesosGenero.length && generosCandidato.length) {
    const totalPeso = pesosGenero.reduce((suma, item) => suma + item[1], 0) || 1;
    const afinidad = pesosGenero.reduce((suma, [genero, peso]) =>
      suma + (generosCandidato.includes(genero) ? peso : 0), 0) / totalPeso;
    score += Math.round(afinidad * 24);
    if (afinidad === 0) score -= 5;
  } else if (semilla) {
    score += Math.round(similitudTexto(semilla.titulo, titulo) * 8);
  }

  // Favorecer artistas relacionados, sin encadenar siempre al mismo cantante.
  const pesoArtista = (perfil.artistas || []).find(([artista]) => artista === artistaKey);
  if (artistaKey && artistasRecientes.has(artistaKey)) score -= 12;
  else if (pesoArtista) score += Math.min(5, Math.round(pesoArtista[1] * 2));
  else if (artistaKey) score += 5;

  // Popularidad como señal secundaria, no como criterio dominante.
  const vistas = Number(video.views || 0);
  if (vistas > 0) score += Math.min(8, Math.log10(vistas + 1) * 1.1);
  if (feedback) score += Math.max(-12, Math.min(12, feedback.score || 0));

  const epocaCandidato = detectarEpoca(video);
  const epocaDominante = perfil.epocas && perfil.epocas[0] ? Number(perfil.epocas[0][0]) : null;
  if (epocaCandidato && epocaDominante) score += epocaCandidato === epocaDominante ? 6 : -2;

  const segundos = Number(video.seconds || (video.duration && video.duration.seconds) || 0);
  if (segundos > 0 && segundos < 75) score -= 25;
  if (segundos >= 150) score += 2;
  return score;
}

function registrarFeedback(cancion, motivo) {
  if (!cancion || !cancion.videoId) return;
  const key = String(cancion.videoId);
  const artistaKey = claveArtista(nombreArtista(cancion));
  const previo = feedbackAutoDj.get(key) || { score: 0, completadas: 0, saltos: 0 };
  const razon = String(motivo || '').toLowerCase();

  // Un final natural es una señal positiva. Errores técnicos nunca son
  // interpretados como rechazo musical. El salto administrativo es neutral.
  if (razon === 'ended' || razon === 'natural_end') {
    previo.score = Math.min(12, previo.score + 3);
    previo.completadas++;
  } else if (razon.includes('admin') || razon.includes('skip')) {
    previo.saltos++; // El salto administrativo no se interpreta como rechazo de la audiencia.
  } else if (razon.includes('error') || razon.includes('timeout')) {
    videosFallidos.unshift(key);
    while (videosFallidos.length > 60) videosFallidos.pop();
  }

  feedbackAutoDj.delete(key);
  feedbackAutoDj.set(key, previo);
  if (artistaKey) {
    const artistFeedbackKey = 'artist:' + artistaKey;
    const artistFeedback = feedbackAutoDj.get(artistFeedbackKey) || { score: 0, completadas: 0, saltos: 0 };
    if (razon === 'ended' || razon === 'natural_end') {
      artistFeedback.score = Math.min(12, artistFeedback.score + 1.5);
      artistFeedback.completadas++;
    } else if (razon.includes('admin') || razon.includes('skip')) {
      artistFeedback.saltos++;
    }
    feedbackAutoDj.delete(artistFeedbackKey);
    feedbackAutoDj.set(artistFeedbackKey, artistFeedback);
  }
  while (feedbackAutoDj.size > MAX_FEEDBACK) {
    feedbackAutoDj.delete(feedbackAutoDj.keys().next().value);
  }
}

function programarReintentoAutoDJ() {
  if (detenido || autoDjRetryTimer || cola.length > 0) return;
  // Espera creciente (10 s, 20 s, 40 s ... hasta 5 min) para no saturar YouTube cuando
  // no hay canciones nuevas, y sin perder nunca el historial ni tocar la cola pública.
  const espera = Math.min(AUTO_DJ_REINTENTO_MAX_MS, AUTO_DJ_REINTENTO_MS * Math.pow(2, Math.max(0, autoDjFallos - 1)));
  console.log(`[AUTO-DJ] Nuevo intento en ${espera >= 1000 ? Math.round(espera / 1000) + ' s' : espera + ' ms'} (fallos seguidos: ${autoDjFallos}).`);
  autoDjRetryTimer = setTimeout(() => {
    autoDjRetryTimer = null;
    if (detenido || cola.length > 0) return;
    if (autoDjPreparada && !reproduciendo) reproducirAutoDjPreparada();
    else if (!autoDjPreparada) rellenarColaAutoDJ();
  }, espera);
  if (autoDjRetryTimer.unref) autoDjRetryTimer.unref();
}

function obtenerPerfilAutoDJ() {
  // El resumen incluye todo el historial persistente; las últimas pistas reciben
  // un peso adicional para que el estilo se adapte a lo que suena esta noche.
  const resumen = memoria.resumenMusical();
  const recientes = [
    ...(reproduciendo ? [reproduciendo] : []),
    ...memoria.obtenerRecientes(40)
  ].filter((c, i, arr) => c && c.videoId &&
    arr.findIndex(x => x && String(x.videoId) === String(c.videoId)) === i).slice(0, 30);

  const pesosGenero = new Map(resumen.generos || []);
  const pesosArtista = new Map(resumen.artistas || []);
  recientes.forEach((cancion, indice) => {
    const peso = Math.max(0.4, 1.5 - indice * 0.035);
    const generosCancion = Array.isArray(cancion.generos) && cancion.generos.length
      ? cancion.generos : detectarGeneros(cancion);
    generosCancion.forEach(genero => {
      pesosGenero.set(genero, (pesosGenero.get(genero) || 0) + peso);
    });
    const artista = claveArtista(nombreArtista(cancion));
    if (artista) pesosArtista.set(artista, (pesosArtista.get(artista) || 0) + peso);
  });

  const generos = Array.from(pesosGenero.entries()).sort((a, b) => b[1] - a[1]);
  const artistas = Array.from(pesosArtista.entries()).sort((a, b) => b[1] - a[1]);
  return { recientes, generos, artistas, epocas: resumen.epocas || [], total: resumen.total };
}

const VARIANTES_BUSQUEDA = [
  'éxitos', 'clásicos', 'románticas', 'para bailar', 'más sonadas', 'de los 90',
  'de los 2000', 'inolvidables', 'que no pueden faltar', 'en español', 'colombia', 'de siempre'
];

function etiquetaGenero(genero) {
  return genero === 'hiphop' ? 'hip hop' :
    genero === 'electronica' ? 'música electrónica' :
    genero === 'regional' ? 'regional mexicano' :
    genero === 'popular' ? 'música popular despecho' :
    genero === 'tropical' ? 'música tropical' : genero;
}

function crearConsultasRecomendacion(semilla, perfil = obtenerPerfilAutoDJ(), rotacion = 0) {
  const base = [];
  const variantes = [];
  const recientes = perfil.recientes || [];
  const generos = perfil.generos || [];
  const artistas = perfil.artistas || [];

  // Las consultas se basan en la tendencia de varias canciones, no solo en la última.
  generos.slice(0, 3).forEach(([genero, peso], indice) => {
    const etiqueta = etiquetaGenero(genero);
    base.push({
      q: `mejores canciones de ${etiqueta} artistas variados`,
      peso: 46 - indice * 5 + Math.min(5, peso)
    });
    // Variantes que cambian en cada intento: YouTube devuelve siempre el mismo top si la
    // búsqueda no cambia, y esas canciones ya sonaron.
    variantes.push({
      q: `${etiqueta} ${VARIANTES_BUSQUEDA[(rotacion + indice * 3) % VARIANTES_BUSQUEDA.length]}`,
      peso: 44 - indice * 5 + Math.min(5, peso)
    });
  });

  artistas.slice(0, 2).forEach(([artista], indice) => {
    base.push({
      q: `${artista} canciones similares artistas del mismo género`,
      peso: 34 - indice * 4
    });
    variantes.push({
      q: `${artista} ${VARIANTES_BUSQUEDA[(rotacion + indice * 5 + 1) % VARIANTES_BUSQUEDA.length]}`,
      peso: 33 - indice * 4
    });
  });

  const epoca = perfil.epocas && perfil.epocas[0] ? Number(perfil.epocas[0][0]) : null;
  if (epoca) {
    base.push({ q: `grandes canciones de los años ${String(epoca).slice(-2)} artistas variados`, peso: 29 });
  }

  // Añade una búsqueda basada en las dos pistas recientes más representativas.
  recientes.slice(0, 2).forEach((cancion, indice) => {
    const artista = nombreArtista(cancion);
    const titulo = String(cancion.titulo || '').trim();
    if (titulo && artista) {
      base.push({
        q: `canciones similares a ${artista} ${titulo}`,
        peso: 30 - indice * 4
      });
    }
  });

  if (!base.length && semilla && semilla.titulo) {
    base.push({ q: `${semilla.titulo} canciones similares`, peso: 35 });
  }

  // Si ya hubo intentos fallidos, las variantes van primero.
  const orden = autoDjFallos > 0 ? [...variantes, ...base] : [];
  if (!orden.length) {
    // Intercala base y variantes para que ambas entren dentro del límite de consultas.
    const max = Math.max(base.length, variantes.length);
    for (let i = 0; i < max; i++) {
      if (base[i]) orden.push(base[i]);
      if (variantes[i]) orden.push(variantes[i]);
    }
  }
  const vistas = new Set();
  return orden.filter(c => !vistas.has(c.q) && vistas.add(c.q));
}

async function buscarAutoDjConTimeout(query) {
  let timer;
  try {
    return await Promise.race([
      ytSearch(query),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Tiempo de búsqueda agotado')), AUTO_DJ_BUSQUEDA_TIMEOUT_MS);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Prepara una recomendación mientras suena la canción actual.
// La recomendación nunca se inserta en la cola pública de clientes.
async function rellenarColaAutoDJ() {
  if (detenido || autoDjEnCurso || autoDjPreparada || cola.length > 0) return;
  const semilla = reproduciendo || historialReproducidas[0] || null;
  if (!semilla || !semilla.titulo) {
    console.log('[AUTO-DJ] En espera: necesita una primera canción como referencia.');
    return;
  }

  const perfilMusical = obtenerPerfilAutoDJ();
  const consultas = crearConsultasRecomendacion(semilla, perfilMusical, autoDjRotacion++)
    .slice(0, AUTO_DJ_MAX_CONSULTAS);
  if (!consultas.length) return;
  autoDjEnCurso = true;

  try {
    const artistasRecientes = new Map();
    (perfilMusical.recientes || []).slice(0, 12).forEach(c => {
      const key = claveArtista(nombreArtista(c));
      if (key) artistasRecientes.set(key, (artistasRecientes.get(key) || 0) + 1);
    });
    const artistasSet = new Set(
      Array.from(artistasRecientes.entries()).filter(([, n]) => n >= 2).map(([k]) => k)
    );

    const candidatos = new Map();
    const descartes = {};            // motivo -> cantidad (solo para el registro de diagnóstico)
    let consultasExitosas = 0;
    for (const fuente of consultas) {
      if (detenido || cola.length > 0) break;
      if (candidatos.size >= AUTO_DJ_CANDIDATOS_SUFICIENTES) break;
      try {
        const resultado = await buscarAutoDjConTimeout(fuente.q);
        consultasExitosas++;
        if (detenido) return;
        const videos = resultado && Array.isArray(resultado.videos) ? resultado.videos : [];
        videos.slice(0, AUTO_DJ_RESULTADOS_POR_CONSULTA).forEach(video => {
          if (!video || !video.videoId || !video.title) return;
          guardarMetadataVideo(video);
          const id = String(video.videoId);

          // Validación contra el estado ACTUAL: historial persistente, canción sonando,
          // cola pública, recomendación preparada y recomendaciones descartadas.
          // No acepta la misma canción en otro video/canal/versión.
          const valido = validarCandidatoAutoDj(video);
          if (!valido.ok) {
            const clave = valido.motivo.split(' ')[0];
            descartes[clave] = (descartes[clave] || 0) + 1;
            return;
          }
          // También evita que la misma canción entre dos veces en esta selección,
          // aunque las búsquedas la encuentren en canales diferentes.
          const huella = crearHuella(video);
          if (Array.from(candidatos.values()).some(item => item.id !== id && mismaHuella(huella, item.huella))) {
            descartes['duplicada-en-esta-ronda'] = (descartes['duplicada-en-esta-ronda'] || 0) + 1;
            return;
          }
          const score = puntuarCandidato(
            video, semilla, fuente, artistasSet,
            feedbackAutoDj.get('artist:' + claveArtista(nombreArtista(video))) || feedbackAutoDj.get(id),
            perfilMusical
          );
          const previo = candidatos.get(id);
          if (!previo || score > previo.score) candidatos.set(id, { id, video, huella, score });
        });
      } catch (error) {
        console.warn('[AUTO-DJ] Consulta fallida:', error.message);
      }
    }

    if (detenido) return;
    if (cola.length > 0) {
      console.log('[AUTO-DJ] Solicitud del público detectada; recomendación descartada.');
      return;
    }
    if (
      reproduciendo &&
      String(reproduciendo.videoId) !== String(semilla.videoId)
    ) {
      console.log('[AUTO-DJ] La canción de referencia cambió; se descarta la recomendación obsoleta.');
      return;
    }

    if (consultasExitosas === 0) {
      autoDjFallos++;
      console.warn('[AUTO-DJ] Ninguna búsqueda respondió (¿sin conexión?); se reintentará.');
      programarReintentoAutoDJ();
      return;
    }

    // Revalidación final con el estado de AHORA: durante las búsquedas pudo llegar o
    // empezar a sonar una canción que coincida con alguna candidata.
    const ranking = Array.from(candidatos.values())
      .sort((a, b) => b.score - a.score)
      .filter(item => validarCandidatoAutoDj(item.video).ok);
    const elegido = ranking.find(item => {
      const artista = claveArtista(nombreArtista(item.video));
      return !artista || !artistasSet.has(artista);
    }) || ranking[0];

    if (!elegido) {
      autoDjFallos++;
      console.warn(`[AUTO-DJ] Sin canciones nuevas (descartes: ${JSON.stringify(descartes)}). ` +
        'Se prefiere esperar antes que repetir una canción.');
      programarReintentoAutoDJ();
      return;
    }

    autoDjFallos = 0;
    const video = elegido.video;
    autoDjPreparada = {
      id: `autodj-${Date.now()}-${video.videoId}`,
      videoId: String(video.videoId),
      titulo: String(video.title).slice(0, 100),
      nombre: 'Auto-DJ GENESIS',
      artista: nombreArtista(video),
      thumbnail: video.thumbnail || '',
      duracion: video.timestamp || (video.duration && video.duration.timestamp) || '',
      timestamp: new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
      origen: 'autodj',
      scoreRecomendacion: Math.round(elegido.score)
    };
    console.log(`[AUTO-DJ] Siguiente canción preparada: "${autoDjPreparada.titulo}"`);

    if (!reproduciendo && cola.length === 0) reproducirAutoDjPreparada();
  } catch (error) {
    console.error('[AUTO-DJ] Error generando recomendación:', error.message);
    autoDjFallos++;
    programarReintentoAutoDJ();
  } finally {
    autoDjEnCurso = false;
    // Si esta búsqueda inició el Auto DJ desde reposo, empezar a preparar
    // la siguiente pista apenas quede sonando la primera recomendación.
    if (!detenido && reproduciendo && cola.length === 0 && !autoDjPreparada && !autoDjRetryTimer) {
      setImmediate(() => rellenarColaAutoDJ());
    }
  }
}

// SOCKET.IO — TIEMPO REAL
io.on('connection', (socket) => {
  const clienteId = socket.id.slice(0, 8);
  console.log(`[+] Conectado [${clienteId}] · Total: ${io.engine.clientsCount} cliente(s)`);

  // Enviar estado inicial incluyendo historial
  socket.emit('estado_inicial', { cola, reproduciendo, historialReproducidas });

  // BUSCADOR EN VIVO DESDE EL CELULAR Y ADMIN (CON CACHÉ)
  socket.on('buscar_canciones', async (query) => {
    try {
      if (!query || !query.trim()) return;
      
      const queryKey = query.toLowerCase().trim();
      const now = Date.now();
      
      // 🚀 SI ESTÁ EN CACHÉ Y NO EXPIRÓ, DEVOLVER AL INSTANTE
      if (cacheSearches[queryKey] && (now - cacheSearches[queryKey].timestamp) < CACHE_TTL) {
        console.log(`[⚡ CACHÉ] Búsqueda: "${query}" desde [${clienteId}]`);
        cacheSearches[queryKey].videos.forEach(guardarMetadataVideo);
        socket.emit('resultados_busqueda', {
          items: cacheSearches[queryKey].videos,
          query
        });
        return;
      }
      
      // SI NO ESTÁ EN CACHÉ, BUSCAR EN YOUTUBE
      console.log(`[🔍] Buscando: "${query}" desde [${clienteId}]`);
      const r = await ytSearch(query.trim());
      const videos = r.videos ? r.videos.slice(0, 25) : [];
      videos.forEach(guardarMetadataVideo);

      // GUARDAR EN CACHÉ con limpieza de entradas vencidas y límite de tamaño.
      for (const [key, entrada] of Object.entries(cacheSearches)) {
        if (now - entrada.timestamp >= CACHE_TTL) delete cacheSearches[key];
      }
      cacheSearches[queryKey] = { videos, timestamp: now };
      while (Object.keys(cacheSearches).length > MAX_CACHE_SEARCHES) {
        delete cacheSearches[Object.keys(cacheSearches)[0]];
      }
      
      socket.emit('resultados_busqueda', { items: videos, query });
    } catch (error) {
      console.error(`[❌] Error en búsqueda:`, error.message);
      socket.emit('error_busqueda', { mensaje: 'Error en el buscador.' });
    }
  });

  // AGREGAR CANCIÓN A LA COLA
  socket.on('agregar_cancion', (cancion) => {
    if (!cancion || !cancion.videoId || !cancion.titulo || !cancion.nombre) {
      socket.emit('error_cancion', { mensaje: 'Datos incompletos.' });
      return;
    }

    // 🔥 VALIDACIÓN: Evitar duplicados en la fila para TODOS (sin importar quién la pidió)
    const videoIdNormalizado = String(cancion.videoId).trim();
    
    const yaEnCola = cola.some(c => String(c.videoId) === videoIdNormalizado);
    const yaSuena = reproduciendo && String(reproduciendo.videoId) === videoIdNormalizado;

    if (yaEnCola || yaSuena) {
      console.log(`[⚠️  DUPLICADO] ${cancion.nombre} intentó pedir "${cancion.titulo}" pero ya está en la fila.`);
      socket.emit('error_cancion', { 
        mensaje: `🎵 "${cancion.titulo}" ya está en la fila. ¡Todos la disfrutaremos juntos!` 
      });
      return;
    }

    const meta = metadataVideos.get(videoIdNormalizado) || {};
    const nueva = enriquecerCancion({
      id:        nuevoIdSolicitud(),
      videoId:   videoIdNormalizado,
      titulo:    String(cancion.titulo).trim().slice(0, 100),
      nombre:    String(cancion.nombre).trim().slice(0, 30),
      nombreSolicitante: String(cancion.nombre).trim().slice(0, 30),
      thumbnail: cancion.thumbnail ? String(cancion.thumbnail) : '',
      timestamp: new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
      artista:   String(cancion.artista || cancion.artist || meta.artista || ''),
      generos:   Array.isArray(cancion.generos) ? cancion.generos : undefined,
      duracionSegundos: Number(cancion.duracionSegundos || meta.seconds || 0) || null
    });

    // Una sola regla de identidad para solicitudes, Auto DJ, historial y cola.
    // Se comprueba antes de confirmar al cliente para que una repetición no entre.
    const repetidaEnHistorial = memoria.buscarRepetida(nueva);
    const repetidaActual = reproduciendo && mismaHuella(crearHuella(nueva), crearHuella(reproduciendo));
    const repetidaCola = cola.find(c => mismaHuella(crearHuella(nueva), crearHuella(c)));
    const repetidaPreparada = autoDjPreparada && mismaHuella(crearHuella(nueva), crearHuella(autoDjPreparada));
    if (repetidaEnHistorial.repetida || repetidaActual || repetidaCola || repetidaPreparada) {
      const yaSonada = repetidaEnHistorial.repetida;
      socket.emit('error_cancion', {
        mensaje: yaSonada
          ? `🎵 "${nueva.titulo}" ya se reprodujo anteriormente y no se puede repetir.`
          : `🎵 "${nueva.titulo}" ya está sonando o está en la fila.`
      });
      return;
    }

    cola.push(nueva);
    console.log(`[COLA][DIAGNOSTICO] Solicitud recibida por ${clienteId}; reproduciendo=${reproduciendo ? reproduciendo.titulo + ' (id=' + reproduciendo.id + ', origen=' + (reproduciendo.origen || 'solicitud') + ')' : 'null'}; cola=${cola.length}`);
    // Una solicitud pública reemplaza la recomendación preparada para el
    // siguiente turno, pero NUNCA interrumpe la canción que ya está sonando.
    descartarAutoDjPreparada('llegó una solicitud pública');
    console.log(`[+] Cola: "${nueva.titulo}" por "${nueva.nombre}"`);
    socket.emit('cancion_confirmada', { titulo: nueva.titulo });

    if (reproduciendo) {
      // Mientras haya una reproducción activa (incluido Auto-DJ), solo se
      // actualiza la cola. avanzarCola() la iniciará al terminar la canción.
      io.emit('cola_actualizada', { cola, reproduciendo });
      console.log('[COLA] Solicitud añadida; se reproducirá al terminar la pista actual.');
      return;
    }

    // Solo iniciar inmediatamente cuando realmente no hay nada reproduciéndose.
    intentarReproducir();
    io.emit('cola_actualizada', { cola, reproduciendo });
  });

  // SEÑAL DEL BAR (TERMINÓ CANCIÓN) O DEL ADMIN (SALTAR CANCIÓN)
  socket.on('siguiente_cancion', (payload = {}) => {
    const playbackId =
      payload && typeof payload === 'object'
        ? payload.playbackId
        : payload;

    // Una reconexión o webOS puede repetir el evento ENDED. Solo avanzar
    // si la señal corresponde exactamente a la reproducción vigente. Sin
    // playbackId no se avanza: así un celular (o un evento viejo) no puede
    // saltar la canción que está sonando. El televisor siempre lo envía y el
    // panel de administración usa admin_saltar.
    if (
      playbackId === undefined ||
      playbackId === null ||
      !reproduciendo ||
      String(reproduciendo.id) !== String(playbackId)
    ) {
      console.log(
        `[↪] Señal duplicada/atrasada ignorada para reproducción ${playbackId}.`
      );
      return;
    }

    const motivo = payload && typeof payload === 'object' ? payload.motivo : '';
    console.warn(`[AVANCE][DIAGNOSTICO] siguiente_cancion recibido desde ${clienteId}; playbackId=${playbackId}; motivo=${motivo || 'sin motivo'}; actual=${reproduciendo ? reproduciendo.titulo + ' (id=' + reproduciendo.id + ')' : 'null'}; cola=${cola.length}`);
    if (reproduciendo) {
      registrarFeedback(reproduciendo, motivo);
      if (motivo === 'ended' || motivo === 'natural_end') agregarAlHistorial(reproduciendo);
    }
    avanzarCola(motivo);
  });

  // ── ✨ NUEVOS EVENTOS: PANEL DE ADMINISTRACIÓN ────────────────
  
  // Saltar canción desde el panel
  socket.on('admin_saltar', () => {
    console.warn(`[AVANCE][DIAGNOSTICO] admin_saltar recibido desde ${clienteId}; actual=${reproduciendo ? reproduciendo.titulo + ' (id=' + reproduciendo.id + ')' : 'null'}; cola=${cola.length}`);
    console.log(`[⚡ ADMIN] Forzó saltar canción actual.`);
    if (reproduciendo) registrarFeedback(reproduciendo, 'admin_skip');
    avanzarCola('admin_saltar');
  });

  // Eliminar una canción específica de la fila usando su ID
  socket.on('admin_eliminar_cancion', (id) => {
    console.log(`[⚡ ADMIN] Eliminó canción con ID: ${id}`);
    cola = cola.filter(cancion => cancion.id !== Number(id));
    io.emit('cola_actualizada', { cola, reproduciendo });
    if (cola.length === 0 && reproduciendo) rellenarColaAutoDJ();
  });

  // Vaciar toda la fila por completo
  socket.on('admin_vaciar_cola', () => {
    console.log(`[⚡ ADMIN] Vació por completo la fila de espera.`);
    cola = [];
    io.emit('cola_actualizada', { cola, reproduciendo });
    if (reproduciendo) rellenarColaAutoDJ();
  });

  // 🔥 NUEVO: Reordenar la fila (Drag & Drop)
  socket.on('reordenar_cola', (nuevoOrdenIds) => {
    console.log(`[⚡ ADMIN] Reordenó la fila de espera visualmente.`);
    if (!Array.isArray(nuevoOrdenIds)) return;
    const colaReordenada = [];
    
    nuevoOrdenIds.forEach(id => {
      // Usamos String para asegurar que el ID que llega del HTML coincida con el número del backend
      const cancion = cola.find(c => String(c.id) === String(id));
      if (cancion) {
        colaReordenada.push(cancion);
      }
    });

    // Las solicitudes que llegaron después de que el admin abrió el panel (y por eso
    // no vienen en su lista) se conservan al final, en su orden de llegada.
    const idsIncluidos = new Set(colaReordenada.map(c => String(c.id)));
    cola.forEach(c => { if (!idsIncluidos.has(String(c.id))) colaReordenada.push(c); });

    // Actualizamos la memoria del servidor con el nuevo orden
    cola = colaReordenada;
    
    // Le decimos a todos (Bar y Clientes) que actualicen su pantalla de inmediato
    io.emit('cola_actualizada', { cola, reproduciendo });
  });

  // 🔥 NUEVO: Evento para registrar cuando se termina de reproducir una canción
  socket.on('cancion_terminada', (cancion) => {
    if (
      cancion && cancion.videoId && reproduciendo &&
      String(cancion.videoId) === String(reproduciendo.videoId)
    ) {
      agregarAlHistorial(cancion);
      // Emitir historial actualizado a todos los clientes
      io.emit('historial_actualizado', { historialReproducidas });
    }
  });

  // Función interna para avanzar la lista
  function avanzarCola(motivo = '') {
    reproduciendo = null;

    if (cola.length > 0) {
      descartarAutoDjPreparada('hay solicitudes en la cola');
      const siguiente = cola.shift();
      if (!emitirReproduccion(siguiente)) {
        cola.unshift(siguiente);
        io.emit('cola_actualizada', { cola, reproduciendo: null });
        return;
      }
      console.log(`[►] Reproduciendo solicitud → "${siguiente.titulo}"`);
      if (cola.length === 0) rellenarColaAutoDJ();
      return;
    }

    console.log('[AUTO-DJ] Cola pública vacía. Continuando reproducción automática.');
    if (!reproducirAutoDjPreparada()) {
      io.emit('cola_actualizada', { cola, reproduciendo: null });
      rellenarColaAutoDJ();
    }
  }

  socket.on('solicitar_estado', () => {
    socket.emit('estado_inicial', { cola, reproduciendo, historialReproducidas });
  });

  socket.on('disconnect', (reason) => {
    console.log(`[-] Desconectado [${clienteId}]`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  const puerto = server.address().port;
  console.log(`\n Jukebox con Panel de Administración activo en puerto ${puerto}`);
  console.log(` -> Panel Admin: http://localhost:${puerto}/admin.html\n`);
});

// Apagado ordenado (también lo usan las pruebas automáticas).
function detener() {
  detenido = true;
  clearTimeout(autoDjRetryTimer);
  autoDjRetryTimer = null;
  io.close();
  if (server.listening) server.close();
}

module.exports = {
  server,
  io,
  detener,
  estadoInterno: () => ({
    cola: cola.slice(), reproduciendo, autoDjPreparada,
    totalRecordadas: memoria.total, memoria: memoria.estado(),
    perfilMusical: memoria.resumenMusical(), autoDjFallos
  })
};

