'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mismaCancion, pareceCancion } = require('../lib/identidad');

const v = (id, title, canal, extra = {}) => ({ videoId: id, title, author: { name: canal }, ...extra });

test('MISMA canción: distintos IDs, canales y etiquetas', () => {
  const casos = [
    ['Oficial vs. canal del artista sin artista en el título',
      v('a1', 'Luis Fonsi - Despacito ft. Daddy Yankee', 'LuisFonsiVEVO'),
      v('a2', 'Despacito', 'Luis Fonsi')],
    ['Video oficial vs. lyric video',
      v('b1', 'Luis Fonsi - Despacito (Official Video)', 'Luis Fonsi'),
      v('b2', 'Luis Fonsi - Despacito (Lyric Video)', 'Lyrics Latino')],
    ['Canal de letras que solo escribe el nombre de la canción',
      v('c1', 'Marc Anthony - Vivir Mi Vida', 'Marc Anthony'),
      v('c2', 'Vivir Mi Vida (Letra / Lyrics)', 'Salsa Hits Letras')],
    ['Orden invertido "Canción - Artista"',
      v('d1', 'Luis Fonsi - Despacito', 'Luis Fonsi'),
      v('d2', 'Despacito - Luis Fonsi', 'Musica Latina HD')],
    ['Imagen estática / audio / HD / remastered',
      v('e1', 'Joe Arroyo - La Rebelión', 'Joe Arroyo'),
      v('e2', 'Joe Arroyo - La Rebelión (Audio HD Remastered)', 'Discos Fuentes')],
    ['Versión en vivo de la misma canción',
      v('f1', 'Carlos Vives - La Gota Fría', 'Carlos Vives'),
      v('f2', 'Carlos Vives - La Gota Fría (En Vivo)', 'Carlos Vives')],
    ['Mayúsculas, acentos y apóstrofes',
      v('g1', "KAROL G - Mi Cama", 'KAROL G'),
      v('g2', 'Karol G – Mi Cámá [Official Audio]', 'Karol G Topic')],
    ['Nombre del artista más largo en una de las versiones',
      v('s1', 'Binomio de Oro - Sin Medir Distancias', 'Binomio de Oro'),
      v('s2', 'Binomio de Oro de América - Sin Medir Distancias', 'Binomio de Oro de América')],
    ['Remix con invitado vs original',
      v('t1', 'Silvestre Dangond - Materialista', 'Silvestre Dangond'),
      v('t2', 'Silvestre Dangond - Materialista (Remix) ft. Nicky Jam', 'Silvestre Dangond')],
    ['Invitado en distinto lugar',
      v('h1', 'Bad Bunny - Tití Me Preguntó', 'Bad Bunny'),
      v('h2', 'Titi Me Pregunto - Bad Bunny (Letra)', 'Letras Urbanas')],
    ['Canal VEVO pegado',
      v('i1', 'Shakira - Chantaje ft. Maluma', 'ShakiraVEVO'),
      v('i2', 'Chantaje', 'Shakira')]
  ];
  for (const [nombre, a, b] of casos) {
    assert.equal(mismaCancion(a, b), true, `Debía detectar duplicado: ${nombre}`);
    assert.equal(mismaCancion(b, a), true, `Debía ser simétrico: ${nombre}`);
  }
});

test('Canciones DISTINTAS no se confunden (sin falsos positivos)', () => {
  const casos = [
    ['Mismo artista, otra canción',
      v('j1', 'Juanes - La Camisa Negra', 'Juanes'),
      v('j2', 'Juanes - A Dios Le Pido', 'Juanes')],
    ['Mismo artista, títulos que comparten una palabra',
      v('k1', 'Karol G - Mi Cama', 'Karol G'),
      v('k2', 'Karol G - Mi Ex Tenía Razón', 'Karol G')],
    ['Mismo título corto, artistas distintos escritos en el título',
      v('l1', 'Maná - Amor', 'Maná'),
      v('l2', 'Juanes - Amor', 'Juanes')],
    ['Título contenido en otro pero con palabras propias extra',
      v('m1', 'Amor', 'Juanes'),
      v('m2', 'Amor Eterno', 'Juanes')],
    ['Canal sin artista en el título, otra canción',
      v('n1', 'Vivir Mi Vida', 'Marc Anthony'),
      v('n2', 'Valió la Pena', 'Marc Anthony')],
    ['Artista en el título contra canción solo con canal, distinta canción',
      v('o1', 'Carlos Vives - La Bicicleta', 'Carlos Vives'),
      v('o2', 'Fantasía', 'Carlos Vives')],
    ['Mismo artista, una palabra extra en el título (otra canción)',
      v('q1', 'Karol G - Mi Cama', 'Karol G'),
      v('q2', 'Karol G - Mi Cama Rota', 'Karol G')],
    ['Mismo título corto, otro artista escrito en el título',
      v('r1', 'Rosalía - Despechá', 'Rosalía'),
      v('r2', 'Karol G - Despechá', 'Karol G')],
    ['Mismas dos palabras de artista, distinta canción',
      v('p1', 'Marc Anthony - Flor Pálida', 'Marc Anthony'),
      v('p2', 'Marc Anthony - Tu Amor Me Hace Bien', 'Marc Anthony')]
  ];
  for (const [nombre, a, b] of casos) {
    assert.equal(mismaCancion(a, b), false, `No debía marcar duplicado: ${nombre}`);
    assert.equal(mismaCancion(b, a), false, `No debía marcar duplicado (inverso): ${nombre}`);
  }
});

test('El mismo videoId siempre es duplicado', () => {
  assert.equal(mismaCancion(v('z', 'Una', 'A'), v('z', 'Otra totalmente distinta', 'B')), true);
});

test('Sin información suficiente no se afirma que sean iguales', () => {
  assert.equal(mismaCancion(v('x1', '(Official Video)', 'A'), v('x2', '[Lyrics]', 'B')), false);
});

test('Mixes y compilaciones no cuentan como canción', () => {
  assert.equal(pareceCancion({ title: '1 HORA de Vallenatos Románticos Mix', seconds: 3600 }), false);
  assert.equal(pareceCancion({ title: 'Salsa Mix 2024 Enganchados' }), false);
  assert.equal(pareceCancion({ title: 'Joe Arroyo - La Rebelión', seconds: 480 }), true);
  assert.equal(pareceCancion({ title: 'Clip corto', seconds: 20 }), false);
});

test('No confunde sufijos distintos de una letra dentro del título', () => {
  const a = v('ta', 'Artista - Tema A', 'Artista');
  const b = v('tb', 'Artista - Tema B', 'Artista');
  assert.equal(mismaCancion(a, b), false);
});
