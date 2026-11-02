'use strict';

// ═══════════════════════════════════════════════════════════════
//   MEMORIA PERSISTENTE DE CANCIONES REPRODUCIDAS
//   - Archivo JSONL (una canción por línea), solo se AÑADE: sobrevive a
//     reinicios y un corte de luz solo puede dañar la última línea.
//   - Sin límite de tamaño: recuerda TODAS las canciones reproducidas.
//   - Índice por videoId y por palabra en RAM para comparar rápido.
//   - Sin dependencias nativas (funciona en cualquier hosting con Node).
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { crearHuella, mismaHuella } = require('./identidad');

class MemoriaCanciones {
  constructor({ archivo, log = console } = {}) {
    this.archivo = archivo || null;       // null => solo en RAM (pruebas)
    this.log = log;
    this.huellas = [];                    // todas las canciones registradas
    this.ids = new Set();                 // videoId ya reproducidos
    this.porToken = new Map();            // palabra -> índices en this.huellas
    this.persistente = false;
    if (this.archivo) this._cargar();
  }

  get total() { return this.huellas.length; }

  _cargar() {
    try {
      fs.mkdirSync(path.dirname(this.archivo), { recursive: true });
      if (fs.existsSync(this.archivo)) {
        const texto = fs.readFileSync(this.archivo, 'utf8');
        let invalidas = 0;
        texto.split('\n').forEach(linea => {
          if (!linea.trim()) return;
          try {
            const r = JSON.parse(linea);
            if (r && r.videoId) this._indexar({ videoId: r.videoId, titulo: r.titulo, artista: r.artista });
            else invalidas++;
          } catch (e) { invalidas++; }
        });
        // Si el archivo quedó sin salto de línea final (corte a mitad de escritura),
        // se cierra la línea para que la siguiente canción no se pegue a ella.
        if (texto.length && !texto.endsWith('\n')) fs.appendFileSync(this.archivo, '\n');
        this.log.log(`[MEMORIA] ${this.huellas.length} canciones recordadas desde ${this.archivo}` +
          (invalidas ? ` (${invalidas} líneas dañadas ignoradas)` : ''));
      } else {
        fs.writeFileSync(this.archivo, '');
        this.log.log(`[MEMORIA] Archivo nuevo: ${this.archivo}`);
      }
      this.persistente = true;
    } catch (error) {
      this.persistente = false;
      this.log.error(`[MEMORIA] ⚠️ No se pudo usar el archivo (${error.message}). ` +
        'El historial SOLO vivirá en RAM hasta que se reinicie el servidor.');
    }
  }

  _indexar(cancion) {
    const huella = crearHuella(cancion);
    const i = this.huellas.length;
    this.huellas.push(huella);
    this.ids.add(huella.videoId);
    huella.todos.forEach(t => {
      let lista = this.porToken.get(t);
      if (!lista) { lista = []; this.porToken.set(t, lista); }
      lista.push(i);
    });
    return huella;
  }

  // Registra una canción que empezó a sonar. Devuelve true si era nueva.
  registrar(cancion) {
    if (!cancion || !cancion.videoId) return false;
    const id = String(cancion.videoId);
    if (this.ids.has(id)) return false;
    const registro = {
      videoId: id,
      titulo: String(cancion.titulo || cancion.title || ''),
      artista: String(cancion.artista || cancion.artist || (cancion.author && cancion.author.name) || '')
    };
    this._indexar(registro);
    if (this.persistente) {
      try {
        fs.appendFileSync(this.archivo, JSON.stringify({ ...registro, t: Date.now() }) + '\n');
      } catch (error) {
        this.log.error(`[MEMORIA] ⚠️ No se pudo guardar "${registro.titulo}": ${error.message}`);
      }
    }
    return true;
  }

  // ¿Esta canción (o una versión de ella) ya sonó? => { repetida, motivo, con }
  buscarRepetida(video) {
    if (!video) return { repetida: false };
    const id = video.videoId ? String(video.videoId) : '';
    if (id && this.ids.has(id)) return { repetida: true, motivo: 'mismo-videoId', con: id };

    const huella = crearHuella(video);
    const vistos = new Set();
    for (const t of huella.todos) {
      const lista = this.porToken.get(t);
      if (!lista) continue;
      for (const i of lista) {
        if (vistos.has(i)) continue;
        vistos.add(i);
        const detalle = {};
        if (mismaHuella(huella, this.huellas[i], detalle)) {
          return { repetida: true, motivo: 'misma-cancion:' + (detalle.metodo || ''), con: this.huellas[i].titulo };
        }
      }
    }
    return { repetida: false };
  }
}

module.exports = { MemoriaCanciones };
