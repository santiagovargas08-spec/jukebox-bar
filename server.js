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

// Motor Auto-DJ: recomendaciones locales, sin servicios ni APIs externas.
const HISTORIAL_MAX = 60;
const AUTO_DJ_REINTENTO_MS = 10000;
const AUTO_DJ_BUSQUEDA_TIMEOUT_MS = 9000;
let autoDjEnCurso = false;
let autoDjPreparada = null;
let autoDjRetryTimer = null;
// Evita repetir cualquier video durante la sesión, aunque salga del historial visible.
const videosYaReproducidos = new Set();
const MAX_VIDEOS_SESION = 2000;
const videosFallidos = [];
const feedbackAutoDj = new Map();
const MAX_FEEDBACK = 300;

app.use(express.static(path.join(__dirname, 'public')));

function marcarComoReproducido(cancion) {
  if (!cancion || !cancion.videoId) return;
  const id = String(cancion.videoId);
  videosYaReproducidos.delete(id);
  videosYaReproducidos.add(id);
  while (videosYaReproducidos.size > MAX_VIDEOS_SESION) {
    videosYaReproducidos.delete(videosYaReproducidos.values().next().value);
  }
}

function emitirReproduccion(cancion) {
  reproduciendo = cancion;
  reproduciendo.inicioMs = Date.now();
  marcarComoReproducido(reproduciendo);
  io.emit('nueva_reproduccion', reproduciendo);
  io.emit('cola_actualizada', { cola, reproduciendo });
}

function reproducirAutoDjPreparada() {
  if (reproduciendo || cola.length > 0 || !autoDjPreparada) return false;
  const siguiente = autoDjPreparada;
  autoDjPreparada = null;
  emitirReproduccion(siguiente);
  console.log(`[AUTO-DJ] Reproduciendo: "${siguiente.titulo}"`);
  rellenarColaAutoDJ();
  return true;
}

function intentarReproducir() {
  if (!reproduciendo && cola.length > 0) {
    autoDjPreparada = null;
    const siguiente = cola.shift();
    emitirReproduccion(siguiente);
    console.log(`[►] Auto-inicio → "${siguiente.titulo}" (${siguiente.nombre})`);
    if (cola.length === 0) rellenarColaAutoDJ();
    return true;
  }
  return false;
}

function agregarAlHistorial(cancion) {
  if (!cancion || !cancion.videoId) return;
  marcarComoReproducido(cancion);
  if (historialReproducidas[0] && String(historialReproducidas[0].videoId) === String(cancion.videoId)) return;
  historialReproducidas.unshift({
    ...cancion,
    reproducidaEn: Date.now()
  });
  if (historialReproducidas.length > HISTORIAL_MAX) historialReproducidas.length = HISTORIAL_MAX;
  io.emit('historial_actualizado', { historialReproducidas });
}

function normalizarTexto(valor) {
  return String(valor || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
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

function nombreArtista(video) {
  return String(
    video && (video.artista || video.artist || (video.author && video.author.name)) || ''
  ).trim();
}

function claveArtista(nombre) {
  return normalizarTexto(nombre).replace(/\b(official|vevo|topic|records|music)\b/g, '').trim();
}

const MAPA_GENEROS = {
  reggaeton: ['reggaeton','regueton','urbano latino','perreo'],
  salsa: ['salsa','salsa romantica','salsa brava'],
  bachata: ['bachata'],
  merengue: ['merengue'],
  vallenato: ['vallenato'],
  cumbia: ['cumbia'],
  regional: ['regional mexicano','banda','norteno','corridos','ranchera'],
  pop: ['pop','pop latino','dance pop'],
  rock: ['rock','hard rock','alternative rock','indie rock','punk'],
  electronica: ['electronica','edm','house','techno','trance'],
  hiphop: ['hip hop','hip-hop','rap','trap'],
  jazz: ['jazz','smooth jazz'],
  reggae: ['reggae','dancehall'],
  balada: ['balada','romantica','bolero']
};

function detectarGeneros(video) {
  const texto = normalizarTexto([
    video && video.title,
    video && video.description,
    nombreArtista(video)
  ].filter(Boolean).join(' '));
  const encontrados = [];
  for (const [genero, claves] of Object.entries(MAPA_GENEROS)) {
    if (claves.some(clave => texto.includes(normalizarTexto(clave)))) encontrados.push(genero);
  }
  return encontrados;
}

function detectarEpoca(video) {
  const texto = normalizarTexto(video && video.title);
  const anio = texto.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  if (anio) return Math.floor(Number(anio[1]) / 10) * 10;
  const decada = texto.match(/\b(50|60|70|80|90)s\b/);
  return decada ? Number(decada[1]) + 1900 : null;
}

function puntuarCandidato(video, semilla, fuente, artistasRecientes, feedback) {
  const titulo = String(video.title || '');
  const artista = nombreArtista(video);
  const artistaSemilla = nombreArtista(semilla);
  let score = fuente.peso;

  // Relación de título, género inferido y época cuando el texto los declara.
  score += Math.round(similitudTexto(semilla.titulo, titulo) * 18);
  const generosSemilla = detectarGeneros(semilla);
  const generosCandidato = detectarGeneros(video);
  if (generosSemilla.length && generosCandidato.length) {
    score += generosSemilla.some(g => generosCandidato.includes(g)) ? 12 : -5;
  }
  const epocaSemilla = detectarEpoca(semilla);
  const epocaCandidato = detectarEpoca(video);
  if (epocaSemilla && epocaCandidato) score += epocaSemilla === epocaCandidato ? 5 : -2;

  const artistaKey = claveArtista(artista);
  const semillaKey = claveArtista(artistaSemilla);
  if (artistaKey && semillaKey && artistaKey === semillaKey) score += 7;
  else if (artistaKey && artistasRecientes.has(artistaKey)) score -= 18;
  else if (artistaKey) score += 9; // descubrir otro artista relacionado

  // Popularidad como señal secundaria, no como criterio dominante.
  const vistas = Number(video.views || 0);
  if (vistas > 0) score += Math.min(8, Math.log10(vistas + 1) * 1.1);

  // Señales aprendidas durante esta sesión: finalización/skip.
  if (feedback) score += Math.max(-12, Math.min(12, feedback.score || 0));

  // Evitar resultados excesivamente cortos (clips, intros, etc.).
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
  if (autoDjRetryTimer || cola.length > 0 || autoDjPreparada) return;
  autoDjRetryTimer = setTimeout(() => {
    autoDjRetryTimer = null;
    if (cola.length === 0 && !autoDjPreparada) rellenarColaAutoDJ();
  }, AUTO_DJ_REINTENTO_MS);
}

function crearConsultasRecomendacion(semilla) {
  const titulo = String(semilla && semilla.titulo || '').trim();
  const artista = nombreArtista(semilla);
  if (!titulo) return [];
  const consultas = [];
  if (artista) {
    consultas.push({ q: `"${artista}" "${titulo}" canciones similares`, peso: 42 });
    consultas.push({ q: `${artista} artistas similares canciones`, peso: 34 });
    consultas.push({ q: `${artista} mejores canciones`, peso: 26 });
  } else {
    consultas.push({ q: `${titulo} canciones similares`, peso: 38 });
    consultas.push({ q: `${titulo} artistas relacionados`, peso: 30 });
  }
  const generos = detectarGeneros(semilla);
  if (generos.length) {
    consultas.push({
      q: `${artista ? artista + ' ' : ''}${generos[0]} canciones similares a ${titulo}`,
      peso: 32
    });
  }
  return consultas;
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
  if (autoDjEnCurso || autoDjPreparada || cola.length > 0) return;
  const semilla = reproduciendo || historialReproducidas[0] || null;
  if (!semilla || !semilla.titulo) {
    console.log('[AUTO-DJ] En espera: necesita una primera canción como referencia.');
    return;
  }

  const consultas = crearConsultasRecomendacion(semilla);
  if (!consultas.length) return;
  autoDjEnCurso = true;

  try {
    const excluidos = new Set([
      ...videosYaReproducidos,
      ...historialReproducidas.map(c => String(c.videoId)),
      ...videosFallidos,
      ...cola.map(c => String(c.videoId)),
      ...(reproduciendo ? [String(reproduciendo.videoId)] : []),
      ...(autoDjPreparada ? [String(autoDjPreparada.videoId)] : [])
    ]);

    const artistasRecientes = new Map();
    historialReproducidas.slice(0, 12).forEach(c => {
      const key = claveArtista(nombreArtista(c));
      if (key) artistasRecientes.set(key, (artistasRecientes.get(key) || 0) + 1);
    });
    const artistasSet = new Set(
      Array.from(artistasRecientes.entries()).filter(([, n]) => n >= 2).map(([k]) => k)
    );

    const candidatos = new Map();
    for (const fuente of consultas) {
      if (cola.length > 0) break;
      try {
        const resultado = await buscarAutoDjConTimeout(fuente.q);
        const videos = resultado && Array.isArray(resultado.videos) ? resultado.videos : [];
        videos.slice(0, 20).forEach(video => {
          if (!video || !video.videoId || !video.title) return;
          const id = String(video.videoId);
          if (excluidos.has(id)) return;
          const score = puntuarCandidato(
            video, semilla, fuente, artistasSet,
            feedbackAutoDj.get('artist:' + claveArtista(nombreArtista(video))) || feedbackAutoDj.get(id)
          );
          const previo = candidatos.get(id);
          if (!previo || score > previo.score) candidatos.set(id, { video, score });
        });
      } catch (error) {
        console.warn('[AUTO-DJ] Consulta fallida:', error.message);
      }
    }

    if (cola.length > 0) {
      console.log('[AUTO-DJ] Solicitud del público detectada; recomendación descartada.');
      return;
    }

    const ranking = Array.from(candidatos.values()).sort((a, b) => b.score - a.score);
    const elegido = ranking.find(item => {
      const artista = claveArtista(nombreArtista(item.video));
      return !artista || !artistasSet.has(artista);
    }) || ranking[0];

    if (!elegido) {
      console.warn('[AUTO-DJ] Sin candidatos nuevos; se reintentará.');
      programarReintentoAutoDJ();
      return;
    }

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
    programarReintentoAutoDJ();
  } finally {
    autoDjEnCurso = false;
    // Si esta búsqueda inició el Auto DJ desde reposo, empezar a preparar
    // la siguiente pista apenas quede sonando la primera recomendación.
    if (reproduciendo && cola.length === 0 && !autoDjPreparada && !autoDjRetryTimer) {
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
      
      // GUARDAR EN CACHÉ
      cacheSearches[queryKey] = { videos, timestamp: now };
      
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

    const nueva = {
      id:        Date.now(), // ID único basado en tiempo para poder borrarla específicamente
      videoId:   videoIdNormalizado,
      titulo:    String(cancion.titulo).trim().slice(0, 100),
      nombre:    String(cancion.nombre).trim().slice(0, 30),
      thumbnail: cancion.thumbnail ? String(cancion.thumbnail) : '',
      timestamp: new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
    };

    cola.push(nueva);
    autoDjPreparada = null;
    console.log(`[+] Cola: "${nueva.titulo}" por "${nueva.nombre}"`);
    socket.emit('cancion_confirmada', { titulo: nueva.titulo });

    if (!intentarReproducir()) {
      io.emit('cola_actualizada', { cola, reproduciendo });
    }
  });

  // SEÑAL DEL BAR (TERMINÓ CANCIÓN) O DEL ADMIN (SALTAR CANCIÓN)
  socket.on('siguiente_cancion', (payload = {}) => {
    const playbackId =
      payload && typeof payload === 'object'
        ? payload.playbackId
        : payload;

    // Una reconexión o webOS puede repetir el evento ENDED. Solo avanzar
    // si la señal corresponde exactamente a la reproducción vigente.
    if (
      playbackId !== undefined &&
      playbackId !== null &&
      (
        !reproduciendo ||
        String(reproduciendo.id) !== String(playbackId)
      )
    ) {
      console.log(
        `[↪] Señal duplicada/atrasada ignorada para reproducción ${playbackId}.`
      );
      return;
    }

    const motivo = payload && typeof payload === 'object' ? payload.motivo : '';
    if (reproduciendo) {
      registrarFeedback(reproduciendo, motivo);
      if (motivo === 'ended' || motivo === 'natural_end') agregarAlHistorial(reproduciendo);
    }
    avanzarCola(motivo);
  });

  // ── ✨ NUEVOS EVENTOS: PANEL DE ADMINISTRACIÓN ────────────────
  
  // Saltar canción desde el panel
  socket.on('admin_saltar', () => {
    console.log(`[⚡ ADMIN] Forzó saltar canción actual.`);
    if (reproduciendo) registrarFeedback(reproduciendo, 'admin_skip');
    avanzarCola('admin_saltar');
  });

  // Eliminar una canción específica de la fila usando su ID
  socket.on('admin_eliminar_cancion', (id) => {
    console.log(`[⚡ ADMIN] Eliminó canción con ID: ${id}`);
    cola = cola.filter(cancion => cancion.id !== Number(id));
    io.emit('cola_actualizada', { cola, reproduciendo });
  });

  // Vaciar toda la fila por completo
  socket.on('admin_vaciar_cola', () => {
    console.log(`[⚡ ADMIN] Vació por completo la fila de espera.`);
    cola = [];
    io.emit('cola_actualizada', { cola, reproduciendo });
  });

  // 🔥 NUEVO: Reordenar la fila (Drag & Drop)
  socket.on('reordenar_cola', (nuevoOrdenIds) => {
    console.log(`[⚡ ADMIN] Reordenó la fila de espera visualmente.`);
    const colaReordenada = [];
    
    nuevoOrdenIds.forEach(id => {
      // Usamos String para asegurar que el ID que llega del HTML coincida con el número del backend
      const cancion = cola.find(c => String(c.id) === String(id));
      if (cancion) {
        colaReordenada.push(cancion);
      }
    });

    // Actualizamos la memoria del servidor con el nuevo orden
    cola = colaReordenada;
    
    // Le decimos a todos (Bar y Clientes) que actualicen su pantalla de inmediato
    io.emit('cola_actualizada', { cola, reproduciendo });
  });

  // 🔥 NUEVO: Evento para registrar cuando se termina de reproducir una canción
  socket.on('cancion_terminada', (cancion) => {
    if (cancion && cancion.videoId) {
      agregarAlHistorial(cancion);
      // Emitir historial actualizado a todos los clientes
      io.emit('historial_actualizado', { historialReproducidas });
    }
  });

  // Función interna para avanzar la lista
  function avanzarCola(motivo = '') {
    reproduciendo = null;

    if (cola.length > 0) {
      autoDjPreparada = null;
      const siguiente = cola.shift();
      emitirReproduccion(siguiente);
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
  console.log(`\n Jukebox con Panel de Administración activo en puerto ${PORT}`);
  console.log(` -> Panel Admin: http://localhost:${PORT}/admin.html\n`);
});

