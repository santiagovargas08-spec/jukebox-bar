'use strict';

// ═══════════════════════════════════════════════════════════════
//   JUKEBOX DIGITAL — Servidor Principal (Búsquedas Ilimitadas)
//   Stack: Node.js · Express · Socket.io · Yt-Search
//   Estado: en memoria (máxima velocidad, sin latencia de BD)
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const ytSearch = require('yt-search'); // ✨ LIBRERÍA DE BÚSQUEDAS ILIMITADAS

const app    = express();
const server = http.createServer(app);

// Configuración de Socket.io con CORS abierto
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout:  60000,  // 60s antes de considerar cliente desconectado
  pingInterval: 25000   // Ping cada 25s para mantener la conexión viva
});

// ─────────────────────────────────────────────────────────────
//   ESTADO EN MEMORIA
//   • cola         → Array de canciones en espera
//   • reproduciendo → Canción actualmente en pantalla (o null)
// ─────────────────────────────────────────────────────────────
let cola          = [];   // [ { id, videoId, titulo, nombre, thumbnail, timestamp } ]
let reproduciendo = null; // La canción que el bar está mostrando ahora mismo

// ─────────────────────────────────────────────────────────────
//   ARCHIVOS ESTÁTICOS
//   Sirve todo desde /public (bar.html, cliente.html, style.css)
// ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────────────────────
//   FUNCIÓN AUXILIAR: Intentar auto-iniciar reproducción
//   Si no hay nada reproduciendo y hay canciones en cola,
//   saca la primera y la marca como "reproduciendo".
// ─────────────────────────────────────────────────────────────
function intentarReproducir() {
  if (!reproduciendo && cola.length > 0) {
    reproduciendo = cola.shift();
    console.log(`\n[►] Auto-inicio → "${reproduciendo.titulo}" (${reproduciendo.nombre})`);
    // Notificar a TODOS: nueva canción empieza
    io.emit('nueva_reproduccion', reproduciendo);
    // Actualizar cola y estado para todos
    io.emit('cola_actualizada', { cola, reproduciendo });
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────
//   SOCKET.IO — GESTIÓN DE EVENTOS EN TIEMPO REAL
// ─────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  const clienteId = socket.id.slice(0, 8); // ID corto para logs
  console.log(`[+] Conectado [${clienteId}] · Total: ${io.engine.clientsCount} cliente(s)`);

  // ── 1. Enviar estado actual al cliente recién conectado ──────
  //    Esto permite que bar.html se recupere de una reconexión
  //    sin perder el estado de la cola.
  socket.emit('estado_inicial', { cola, reproduciendo });

  // ── NUEVO: CLIENTE → Solicita buscar una canción en YouTube (Búsquedas Ilimitadas) ──
  socket.on('buscar_canciones', async (query) => {
    try {
      if (!query || !query.trim()) return;
      
      console.log(`[🔍] Buscando: "${query}" desde el cliente [${clienteId}]`);
      
      // La librería busca en YouTube simulando la navegación de un usuario real
      const r = await ytSearch(query.trim());
      
      // Tomamos los primeros 25 resultados que sean videos reales (evitamos listas de reproducción o canales)
      const videos = r.videos ? r.videos.slice(0, 25) : [];
      
      // Enviamos los resultados ÚNICAMENTE al celular que hizo la búsqueda para no saturar al resto
      socket.emit('resultados_busqueda', { items: videos, query });
    } catch (error) {
      console.error(`[❌] Error en búsqueda de [${clienteId}]:`, error.message);
      socket.emit('error_busqueda', { mensaje: 'Error en el buscador. Intenta de nuevo.' });
    }
  });

  // ── 2. CLIENTE → Agrega una canción a la cola ───────────────
  //    Datos esperados: { videoId, titulo, nombre, thumbnail }
  socket.on('agregar_cancion', (cancion) => {
    // Validación básica de los datos requeridos
    if (!cancion || !cancion.videoId || !cancion.titulo || !cancion.nombre) {
      socket.emit('error_cancion', { mensaje: 'Datos incompletos. Intenta de nuevo.' });
      return;
    }

    // Sanear y normalizar la entrada para evitar datos inválidos
    const nueva = {
      id:        Date.now(),
      videoId:   String(cancion.videoId).trim(),
      titulo:    String(cancion.titulo).trim().slice(0, 100), // Máx 100 chars
      nombre:    String(cancion.nombre).trim().slice(0, 30),  // Máx 30 chars
      thumbnail: cancion.thumbnail ? String(cancion.thumbnail) : '',
      timestamp: new Date().toLocaleTimeString('es-CO', {
        hour:   '2-digit',
        minute: '2-digit'
      })
    };

    cola.push(nueva);
    console.log(`[+] Cola [${clienteId}]: "${nueva.titulo}" por "${nueva.nombre}" · Fila: ${cola.length}`);

    // Confirmar al cliente que hizo la solicitud
    socket.emit('cancion_confirmada', { titulo: nueva.titulo });

    // Intentar auto-iniciar si no hay nada reproduciendo.
    // Si ya había algo, solo difundir la cola actualizada.
    if (!intentarReproducir()) {
      io.emit('cola_actualizada', { cola, reproduciendo });
    }
  });

  // ── 3. BAR → Señal de que la canción actual terminó ──────────
  //    bar.html lo emite cuando el YouTubePlayer dispara ENDED.
  //    El servidor avanza la cola y notifica a todos.
  socket.on('siguiente_cancion', () => {
    if (cola.length > 0) {
      reproduciendo = cola.shift();
      console.log(`\n[►] Siguiente → "${reproduciendo.titulo}" (${reproduciendo.nombre})`);
      io.emit('nueva_reproduccion', reproduciendo);
    } else {
      // Cola vacía: pantalla del bar queda en estado idle o pasa al Auto-DJ si lo implementaste en el front
      reproduciendo = null;
      console.log('[■] Cola vacía — esperando más canciones');
    }
    // Actualizar estado en todos los clientes conectados
    io.emit('cola_actualizada', { cola, reproduciendo });
  });

  // ── 4. Solicitud explícita de estado (útil en reconexión) ───
  socket.on('solicitar_estado', () => {
    socket.emit('estado_inicial', { cola, reproduciendo });
  });

  // ── 5. Desconexión del cliente ───────────────────────────────
  socket.on('disconnect', (reason) => {
    console.log(`[-] Desconectado [${clienteId}] · Razón: ${reason}`);
  });
});

// ─────────────────────────────────────────────────────────────
//   INICIO DEL SERVIDOR
// ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║    🎵  JUKEBOX DIGITAL — Servidor activo     ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`   ➜  Pantalla del Bar : http://localhost:${PORT}/bar.html`);
  console.log(`   ➜  App del Cliente  : http://localhost:${PORT}/cliente.html`);
  console.log('──────────────────────────────────────────────');
  console.log('   Estado: Cola vacía · Listo para recibir pedidos\n');
});
