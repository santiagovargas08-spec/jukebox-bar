'use strict';

// ═══════════════════════════════════════════════════════════════
//   JUKEBOX DIGITAL — Servidor Principal (Con Panel de Admin)
//   Stack: Node.js · Express · Socket.io · Yt-Search
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const ytSearch = require('yt-search');

const app    = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout:  60000,
  pingInterval: 25000
});

// ESTADO EN MEMORIA
let cola          = [];   
let reproduciendo = null; 

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

// SOCKET.IO — TIEMPO REAL
io.on('connection', (socket) => {
  const clienteId = socket.id.slice(0, 8);
  console.log(`[+] Conectado [${clienteId}] · Total: ${io.engine.clientsCount} cliente(s)`);

  // Enviar estado inicial
  socket.emit('estado_inicial', { cola, reproduciendo });

  // BUSCADOR EN VIVO DESDE EL CELULAR
  socket.on('buscar_canciones', async (query) => {
    try {
      if (!query || !query.trim()) return;
      console.log(`[🔍] Buscando: "${query}" desde [${clienteId}]`);
      const r = await ytSearch(query.trim());
      const videos = r.videos ? r.videos.slice(0, 25) : [];
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

    const nueva = {
      id:        Date.now(), // ID único basado en tiempo para poder borrarla específicamente
      videoId:   String(cancion.videoId).trim(),
      titulo:    String(cancion.titulo).trim().slice(0, 100),
      nombre:    String(cancion.nombre).trim().slice(0, 30),
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
    socket.emit('estado_inicial', { cola, reproduciendo });
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
