'use strict';

// Historial persistente JSONL. Cada reproducción se escribe antes de emitirla
// al televisor. Los registros antiguos (solo videoId/titulo/artista) siguen
// siendo compatibles y el perfil se reconstruye desde el archivo al arrancar.

const fs = require('fs');
const path = require('path');
const { crearHuella, mismaHuella, normalizarTexto } = require('./identidad');

class MemoriaCanciones {
  constructor({ archivo, log = console, strictPersistence = false } = {}) {
    this.archivo = archivo || null;
    this.log = log;
    this.strictPersistence = strictPersistence;
    this.huellas = [];
    this.registros = [];
    this.ids = new Set();
    this.porToken = new Map();
    this.porClave = new Map();
    this.persistente = false;
    this.errorPersistencia = null;
    if (this.archivo) this._cargar();
  }

  get total() { return this.registros.length; }

  _cargar() {
    try {
      fs.mkdirSync(path.dirname(this.archivo), { recursive: true });
      if (!fs.existsSync(this.archivo)) fs.writeFileSync(this.archivo, '');
      const texto = fs.readFileSync(this.archivo, 'utf8');
      let invalidas = 0;
      texto.split('\n').forEach(linea => {
        if (!linea.trim()) return;
        try {
          const r = JSON.parse(linea);
          if (r && r.videoId && (r.titulo || r.title)) this._indexar(this._normalizarRegistro(r));
          else invalidas++;
        } catch (_) { invalidas++; }
      });
      if (texto.length && !texto.endsWith('\n')) fs.appendFileSync(this.archivo, '\n');
      if (invalidas && this.strictPersistence) {
        throw new Error('El historial contiene ' + invalidas + ' línea(s) ilegible(s); se bloquea el inicio para no olvidar canciones.');
      }
      this.persistente = true;
      this.errorPersistencia = null;
      this.log.log('[MEMORIA] ' + this.registros.length + ' reproducciones recuperadas desde ' + this.archivo +
        (invalidas ? ' (' + invalidas + ' líneas dañadas ignoradas)' : ''));
    } catch (error) {
      this.persistente = false;
      this.errorPersistencia = error.message;
      this.log.error('[MEMORIA] No se pudo abrir el historial: ' + error.message);
      if (this.strictPersistence) throw new Error('No se puede iniciar con historial persistente: ' + error.message);
    }
  }

  _normalizarRegistro(cancion) {
    const huella = crearHuella(cancion);
    return {
      videoId: String(cancion.videoId),
      titulo: String(cancion.titulo || cancion.title || ''),
      artista: String(cancion.artista || cancion.artist || (cancion.author && cancion.author.name) || huella.artista || ''),
      generos: Array.isArray(cancion.generos) ? [...new Set(cancion.generos.map(String))] : [],
      epoca: Number.isFinite(Number(cancion.epoca)) ? Number(cancion.epoca) || null : null,
      duracionSegundos: Number(cancion.duracionSegundos || cancion.seconds || 0) || null,
      origen: String(cancion.origen || 'solicitud'),
      nombreSolicitante: String(cancion.nombreSolicitante || cancion.nombre || ''),
      reproducidaEn: Number(cancion.reproducidaEn || cancion.t || Date.now())
    };
  }

  _indexar(registro) {
    const huella = crearHuella(registro);
    const i = this.huellas.length;
    this.huellas.push(huella);
    this.registros.push(registro);
    this.ids.add(huella.videoId);
    if (huella.clave) {
      let exactos = this.porClave.get(huella.clave);
      if (!exactos) { exactos = []; this.porClave.set(huella.clave, exactos); }
      exactos.push(i);
    }
    huella.todos.forEach(t => {
      if (t.length < 2) return;
      let lista = this.porToken.get(t);
      if (!lista) { lista = []; this.porToken.set(t, lista); }
      lista.push(i);
    });
    return huella;
  }

  registrar(cancion) {
    if (!cancion || !cancion.videoId) return false;
    const id = String(cancion.videoId);
    if (this.ids.has(id)) return false;

    const registro = this._normalizarRegistro(cancion);
    // Write-ahead: en modo estricto no se anuncia una reproducción si no se
    // pudo guardar primero. Así un error de disco no borra silenciosamente memoria.
    if (this.archivo && this.strictPersistence && !this.persistente) {
      throw new Error('Historial no disponible: ' + (this.errorPersistencia || 'almacenamiento no persistente'));
    }
    if (this.archivo && this.persistente) {
      try {
        const fd = fs.openSync(this.archivo, 'a');
        try {
          fs.writeSync(fd, JSON.stringify(registro) + '\n', null, 'utf8');
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
      } catch (error) {
        this.persistente = false;
        this.errorPersistencia = error.message;
        this.log.error('[MEMORIA] Falló la escritura del historial: ' + error.message);
        if (this.strictPersistence) throw new Error('No se inicia la canción porque no se pudo guardar el historial: ' + error.message);
      }
    }
    this._indexar(registro);
    return true;
  }

  buscarRepetida(video) {
    if (!video) return { repetida: false };
    const id = video.videoId ? String(video.videoId) : '';
    if (id && this.ids.has(id)) return { repetida: true, motivo: 'mismo-videoId', con: id };

    const huella = crearHuella(video);
    if (huella.clave) {
      const exactos = this.porClave.get(huella.clave) || [];
      for (let j = exactos.length - 1; j >= 0; j--) {
        const i = exactos[j];
        const detalle = {};
        if (mismaHuella(huella, this.huellas[i], detalle)) {
          return { repetida: true, motivo: 'misma-cancion:' + (detalle.metodo || 'titulo'), con: this.huellas[i].titulo };
        }
      }
    }

    // Comparar primero contra el token menos frecuente evita recorrer todas las
    // canciones antiguas cuando el historial ya tiene miles de entradas.
    const listas = [...huella.todos]
      .map(t => this.porToken.get(t))
      .filter(Boolean)
      .sort((a, b) => a.length - b.length);
    const vistos = new Set();
    for (const candidatos of listas) {
      for (let j = candidatos.length - 1; j >= 0; j--) {
        const i = candidatos[j];
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

  obtenerRecientes(limite = 60) {
    const n = Math.max(0, Number(limite) || 0);
    return this.registros.slice(-n).reverse().map(r => ({ ...r, generos: [...(r.generos || [])] }));
  }

  resumenMusical() {
    const artistas = new Map();
    const generos = new Map();
    const epocas = new Map();
    for (const r of this.registros) {
      const artista = normalizarTexto(r.artista);
      if (artista) artistas.set(artista, (artistas.get(artista) || 0) + 1);
      for (const genero of r.generos || []) {
        generos.set(genero, (generos.get(genero) || 0) + 1);
      }
      if (r.epoca) epocas.set(r.epoca, (epocas.get(r.epoca) || 0) + 1);
    }
    const ordenar = mapa => [...mapa.entries()].sort((a, b) => b[1] - a[1]);
    return {
      total: this.total,
      artistas: ordenar(artistas),
      generos: ordenar(generos),
      epocas: ordenar(epocas),
      recientes: this.obtenerRecientes(40)
    };
  }

  estado() {
    return {
      total: this.total,
      persistente: this.persistente,
      archivo: this.archivo,
      error: this.errorPersistencia
    };
  }
}

module.exports = { MemoriaCanciones };
