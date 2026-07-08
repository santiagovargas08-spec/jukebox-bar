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

// 🔥 CONSTANTES DE HISTORIAL
const HISTORIAL_MAX = 10; // Mantener las últimas 10 canciones reproducidas

app.use(express.static(path.join(__dirname, 'public')));

function intentarReproducir() {
  if (!reproduciendo && cola.length > 0) {
    reproduciendo = cola.shift();
    console.log(`\n[►] Auto-inicio → "${reproduciendo.titulo}" (${reproduciendo.nombre})`);
    io.emit('nueva_reproduccion', reproduciendo);
    io.emit('cola_actualizada', { cola, reproduciendo });
    return true;
  }
  return false;
}

// 🔥 NUEVA FUNCIÓN: Agregar a historial
function agregarAlHistorial(cancion) {
  if (cancion && cancion.videoId) {
    // Evitar duplicados consecutivos
    if (historialReproducidas.length === 0 || 
        historialReproducidas[0].videoId !== cancion.videoId) {
      historialReproducidas.unshift(cancion);
      // Mantener solo las últimas HISTORIAL_MAX canciones
      if (historialReproducidas.length > HISTORIAL_MAX) {
        historialReproducidas.pop();
      }
      console.log(`[📜] Historial actualizado (${historialReproducidas.length} canciones)`);
    }
  }
}

// 🔥 NUEVA FUNCIÓN: Obtener una canción semilla del historial (preferiblemente la más antigua del mix)
function obtenerSemillaDelHistorial() {
  // Retornar la canción más antigua del historial (la última en la cola)
  // Esto asegura variedad en el Auto-DJ
  if (historialReproducidas.length > 0) {
    const semilla = historialReproducidas[Math.floor(Math.random() * historialReproducidas.length)];
    console.log(`[🎲] Semilla Auto-DJ seleccionada del historial: "${semilla.titulo}"`);
    return semilla.videoId;
  }
  // Fallback: semillas predefinidas si el historial está vacío
  const semillasMix = [
    'nJ7rBzClyCg', 'Qk7rhW-SB1g', 'D14H7qE1Tq0', 'y9Q30K7xLko', 
    'c8mP91kZ9C8', 'Wj6HkY10Y9U', 'z_a9OvhN168', '5R-7E5u2t8U', 
    'wDeZiEZGS3Q', 'W0Wc3eQ0Y5k', 'lM0D-l3w-X0', 'R5j71wB27cE', 
    'a-H_h2v4O0I', 'ca48oMV59LU', 'TapXs54Ah3E', '2aD2hYg1_n8', 
    'eHhLzHofkE8', 'I_mQv7-QIfs', 'eM6A7gJ_U2Y', 'G8v7gBWe3c4'
  ];
  return semillasMix[Math.floor(Math.random() * semillasMix.length)];
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

    // 🔥 VALIDACIÓN: Evitar que el mismo usuario pida la misma canción más de una vez
    const videoIdNormalizado = String(cancion.videoId).trim();
    const nombreNormalizado = String(cancion.nombre).trim().toLowerCase();
    
    const yaEnCola = cola.some(c => 
      c.videoId === videoIdNormalizado && 
      c.nombre.toLowerCase() === nombreNormalizado
    );

    if (yaEnCola) {
      console.log(`[⚠️  DUPLICADO] ${cancion.nombre} intentó pedir "${cancion.titulo}" pero ya está en la fila.`);
      socket.emit('error_cancion', { 
        mensaje: `🚫 Ya pediste "${cancion.titulo}". Dale oportunidad a otras canciones 🎵` 
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
  socket.on('siguiente_cancion', () => {
    avanzarCola();
  });

  // ── ✨ NUEVOS EVENTOS: PANEL DE ADMINISTRACIÓN ────────────────
  
  // Saltar canción desde el panel
  socket.on('admin_saltar', () => {
    console.log(`[⚡ ADMIN] Forzó saltar canción actual.`);
    avanzarCola();
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
  function avanzarCola() {
    if (cola.length > 0) {
      reproduciendo = cola.shift();
      console.log(`[►] Reproduciendo → "${reproduciendo.titulo}"`);
      io.emit('nueva_reproduccion', reproduciendo);
    } else {
      reproduciendo = null;
      console.log('[■] Fila vacía.');
    }
    io.emit('cola_actualizada', { cola, reproduciendo });
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
