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
const AUTO_DJ_COLA_OBJETIVO = 4;
const AUTO_DJ_UMBRAL_RECARGA = 2;
const AUTO_DJ_REINTENTO_MS = 12000;
let autoDjEnCurso = false;
let autoDjUltimoIntento = 0;
let autoDjRetryTimer = null;
const videosFallidos = [];
const feedbackAutoDj = new Map();
const MAX_FEEDBACK = 300;

app.use(express.static(path.join(__dirname, 'public')));

function intentarReproducir() {
  if (!reproduciendo && cola.length > 0) {
    reproduciendo = cola.shift();
    reproduciendo.inicioMs = Date.now();
    console.log(`\n[►] Auto-inicio → "${reproduciendo.titulo}" (${reproduciendo.nombre})`);
    io.emit('nueva_reproduccion', reproduciendo);
    io.emit('cola_actualizada', { cola, reproduciendo });
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
    video && (video.artista || video.artist || (video.author && video.author.name) || video.nombre) || ''
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

  // Relación de título: favorece canciones del mismo universo musical.
  score += Math.round(similitudTexto(semilla.titulo, titulo) * 18);

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
  if (autoDjRetryTimer) return;
  autoDjRetryTimer = setTimeout(() => {
    autoDjRetryTimer = null;
    if (cola.length < AUTO_DJ_UMBRAL_RECARGA) rellenarColaAutoDJ();
  }, AUTO_DJ_REINTENTO_MS);
}

function crearConsultasRecomendacion(semilla) {
  const titulo = String(semilla && semilla.titulo || '').trim();
  const artista = nombreArtista(semilla);
  const consultas = [];
  if (titulo && artista) {
    consultas.push({ q: `"${artista}" "${titulo}" canciones similares`, peso: 42 });
    consultas.push({ q: `${artista} artistas similares canciones`, peso: 34 });
    consultas.push({ q: `${artista} mejores canciones`, peso: 26 });
  } else if (titulo) {
    consultas.push({ q: `${titulo} canciones similares`, peso: 38 });
    consultas.push({ q: `${titulo} artistas relacionados`, peso: 30 });
  }
  // No usar búsquedas genéricas ni semillas aleatorias. Sin canción semilla,
  // el motor espera una canción solicitada por el público.
  return consultas;
}

async function rellenarColaAutoDJ() {
  if (autoDjEnCurso || cola.length >= AUTO_DJ_UMBRAL_RECARGA) return;
  if (Date.now() - autoDjUltimoIntento < 4000) return;

  const semilla = reproduciendo || historialReproducidas[0] || null;
  if (!semilla || !semilla.titulo) {
    console.log('[AUTO-DJ] Esperando una canción semilla del público.');
    return;
  }

  const consultas = crearConsultasRecomendacion(semilla);
  if (!consultas.length) return;

  autoDjEnCurso = true;
  autoDjUltimoIntento = Date.now();

  try {
    const excluidos = new Set([
      ...historialReproducidas.slice(0, 35).map(c => String(c.videoId)),
      ...videosFallidos,
      ...cola.map(c => String(c.videoId)),
      ...(reproduciendo ? [String(reproduciendo.videoId)] : [])
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
      try {
        const resultado = await ytSearch(fuente.q);
        const videos = resultado && Array.isArray(resultado.videos) ? resultado.videos : [];
        videos.slice(0, 18).forEach(video => {
          if (!video || !video.videoId || !video.title) return;
          const id = String(video.videoId);
          if (excluidos.has(id)) return;
          const existente = candidatos.get(id);
          const score = puntuarCandidato(
            video, semilla, fuente, artistasSet, feedbackAutoDj.get('artist:' + claveArtista(nombreArtista(video))) || feedbackAutoDj.get(id)
          );
          if (!existente || score > existente.score) {
            candidatos.set(id, { video, score, fuente: fuente.q });
          }
        });
      } catch (error) {
        console.warn('[AUTO-DJ] Falló una consulta relacionada:', error.message);
      }
    }

    const ranking = Array.from(candidatos.values()).sort((a, b) => b.score - a.score);
    const seleccionados = [];
    const artistasElegidos = new Set();
    const faltan = Math.max(0, AUTO_DJ_COLA_OBJETIVO - cola.length);

    // Selección por ranking con diversidad: máximo un tema por artista
    // en esta tanda, salvo que no existan suficientes alternativas.
    for (const item of ranking) {
      if (seleccionados.length >= faltan) break;
      const artista = claveArtista(nombreArtista(item.video));
      if (artista && artistasElegidos.has(artista)) continue;
      seleccionados.push(item);
      if (artista) artistasElegidos.add(artista);
    }
    if (seleccionados.length < faltan) {
      for (const item of ranking) {
        if (seleccionados.length >= faltan) break;
        if (seleccionados.some(x => String(x.video.videoId) === String(item.video.videoId))) continue;
        seleccionados.push(item);
      }
    }

    seleccionados.forEach((item, index) => {
      const video = item.video;
      cola.push({
        id: `autodj-${Date.now()}-${index}-${video.videoId}`,
        videoId: String(video.videoId),
        titulo: String(video.title).slice(0, 100),
        nombre: 'Auto-DJ GENESIS',
        artista: nombreArtista(video),
        thumbnail: video.thumbnail || '',
        duracion: video.timestamp || (video.duration && video.duration.timestamp) || '',
        timestamp: new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
        origen: 'autodj',
        scoreRecomendacion: Math.round(item.score)
      });
      console.log(`[AUTO-DJ] + "${video.title}" | afinidad ${Math.round(item.score)} | ${nombreArtista(video) || 'artista desconocido'}`);
    });

    if (seleccionados.length) {
      if (!reproduciendo) intentarReproducir();
      io.emit('cola_actualizada', { cola, reproduciendo });
    } else {
      console.warn('[AUTO-DJ] Sin candidatos relacionados disponibles; se reintentará.');
      programarReintentoAutoDJ();
    }
  } catch (error) {
    console.error('[AUTO-DJ] Error generando recomendaciones:', error.message);
    programarReintentoAutoDJ();
  } finally {
    autoDjEnCurso = false;
  }
}

// SOCKET.IO — TIEMPO REAL
io.on('connection', (socket) => {
  const clienteId = socket.id.slice(0, 8);
  console.log(`[+] Conectado [${clienteId}] · Total: ${io.engine.clientsCount} cliente(s)`);

  // Enviar estado inicial incluyendo historial
  socket.emit('estado_inicial', { cola, reproduciendo, historialReproducidas });
  if (!reproduciendo && cola.length < AUTO_DJ_UMBRAL_RECARGA) rellenarColaAutoDJ();

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
    
    const yaEnCola = cola.some(c => c.videoId === videoIdNormalizado);

    if (yaEnCola) {
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
    if (cola.length > 0) {
      reproduciendo = cola.shift();
      reproduciendo.inicioMs = Date.now();
      console.log(`[►] Reproduciendo → "${reproduciendo.titulo}"`);
      io.emit('nueva_reproduccion', reproduciendo);
    } else {
      reproduciendo = null;
      console.log('[■] Fila vacía. El Auto-DJ buscará la siguiente tanda.');
    }
    io.emit('cola_actualizada', { cola, reproduciendo });
    if (cola.length < AUTO_DJ_UMBRAL_RECARGA) rellenarColaAutoDJ();
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

