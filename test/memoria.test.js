'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MemoriaCanciones } = require('../lib/memoria');

const silencio = { log() {}, error() {}, warn() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jukebox-mem-'));
const v = (id, title, canal) => ({ videoId: id, titulo: title, title, author: { name: canal } });

test('Recuerda canciones tras reiniciar (nueva instancia, mismo archivo)', () => {
  const archivo = path.join(tmp(), 'historial.jsonl');
  const m1 = new MemoriaCanciones({ archivo, log: silencio });
  m1.registrar(v('id1', 'Joe Arroyo - La Rebelión', 'Joe Arroyo'));
  m1.registrar(v('id2', 'Grupo Niche - Cali Pachanguero', 'Grupo Niche'));

  const m2 = new MemoriaCanciones({ archivo, log: silencio });   // "reinicio"
  assert.equal(m2.total, 2);
  assert.equal(m2.buscarRepetida(v('id1', 'x', 'y')).repetida, true, 'mismo videoId');
  assert.equal(m2.buscarRepetida(v('otro', 'La Rebelión (Audio)', 'Joe Arroyo')).repetida, true, 'otra subida de la misma canción');
  assert.equal(m2.buscarRepetida(v('otro2', 'Joe Arroyo - En Barranquilla Me Quedo', 'Joe Arroyo')).repetida, false, 'otra canción del mismo artista');
});

test('No tiene límite de 10/20/60 canciones', () => {
  const m = new MemoriaCanciones({ archivo: path.join(tmp(), 'h.jsonl'), log: silencio });
  for (let i = 0; i < 3000; i++) m.registrar(v('vid' + i, `Artista${i % 50} - Tema único número ${i}x`, 'Canal'));
  assert.equal(m.total, 3000);
  assert.equal(m.buscarRepetida(v('nuevo', 'Artista0 - Tema único número 0x', 'Otro canal')).repetida, true, 'la primera sigue recordada');
  assert.equal(m.buscarRepetida(v('nuevo2', 'Artista0 - Tema único número 3001x', 'Otro canal')).repetida, false);
});

test('No duplica registros del mismo videoId', () => {
  const archivo = path.join(tmp(), 'h.jsonl');
  const m = new MemoriaCanciones({ archivo, log: silencio });
  assert.equal(m.registrar(v('a', 'Tema A', 'X')), true);
  assert.equal(m.registrar(v('a', 'Tema A', 'X')), false);
  assert.equal(fs.readFileSync(archivo, 'utf8').trim().split('\n').length, 1);
});

test('Tolera un archivo dañado / cortado a mitad de línea y sigue guardando', () => {
  const archivo = path.join(tmp(), 'h.jsonl');
  fs.writeFileSync(archivo, JSON.stringify({ videoId: 'ok1', titulo: 'Tema Bueno', artista: 'A' }) + '\n{"videoId":"cor');
  const m = new MemoriaCanciones({ archivo, log: silencio });
  assert.equal(m.total, 1);
  m.registrar(v('nuevo', 'Otro Tema', 'B'));
  const m2 = new MemoriaCanciones({ archivo, log: silencio });
  assert.equal(m2.total, 2, 'la línea nueva no debe pegarse a la dañada');
});

test('Si el disco no se puede usar, sigue funcionando en RAM', () => {
  const archivo = path.join(tmp(), 'archivo-es-un-directorio');
  fs.mkdirSync(archivo);                       // fuerza error al leer/escribir
  const m = new MemoriaCanciones({ archivo, log: silencio });
  assert.equal(m.persistente, false);
  m.registrar(v('a', 'Tema A', 'X'));
  assert.equal(m.buscarRepetida(v('b', 'Tema A (Audio)', 'Y')).repetida, true);
});
