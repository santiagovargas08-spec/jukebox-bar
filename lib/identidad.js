'use strict';

// ═══════════════════════════════════════════════════════════════
//   IDENTIDAD MUSICAL
//   Decide si dos videos de YouTube son "la misma canción", aunque
//   tengan distinto videoId, canal o etiquetas en el título.
//
//   Principio: ante la duda se considera repetida (es preferible
//   perder un candidato que repetir una canción en el bar), pero dos
//   canciones distintas del mismo artista NUNCA se confunden solo por
//   compartir artista: deben coincidir las palabras de la canción.
// ═══════════════════════════════════════════════════════════════

function normalizarTexto(valor) {
  return String(valor || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['’`´]/g, '')            // pa' -> pa, don't -> dont
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Etiquetas que describen la publicación, no la canción.
const RUIDO = new Set([
  'official', 'oficial', 'video', 'videoclip', 'clip', 'music', 'musica', 'audio',
  'lyrics', 'lyric', 'letra', 'letras', 'hd', 'hq', '4k', '1080p', '720p', '8k',
  'remaster', 'remastered', 'remasterizado', 'remasterizada', 'version', 'visualizer',
  'visualiser', 'karaoke', 'topic', 'vevo', 'live', 'subtitulado', 'subtitulada',
  'sub', 'espanol', 'spanish', 'english', 'ingles', 'full', 'completo', 'completa',
  'remix', 'cover', 'en', 'de', 'la', 'el', 'los', 'las', 'y', 'the', 'and', 'a', 'con',
  'with', 'by', 'prod', 'records', 'record', 'recordings', 'entertainment',
  'ft', 'feat', 'featuring'
]);

// Palabras que solo son etiqueta cuando van entre paréntesis/corchetes, p. ej.
// "(Radio Edit)" o "[Nuevo]"; fuera de ellos pueden ser parte del título real.
const RUIDO_AGRUPADO = new Set([...RUIDO, 'estreno', 'nuevo', 'nueva', 'new', 'unplugged', 'acustico', 'acustica', 'acoustic', 'radio', 'edit',
  'extended', 'original', 'single', 'sencillo', 'song', 'cancion', 'tema', 'oficialmente', 'channel', 'canal']);

function tokens(texto) {
  return normalizarTexto(texto).replace(/\ben vivo\b/g, ' ').split(' ')
    .filter(t => t && !RUIDO.has(t) && (t.length > 1 || /\d/.test(t)));
}

// Procesa los textos entre paréntesis/corchetes: se descartan si solo
// describen la publicación; si traen la lista de invitados se separan;
// si aportan palabras reales (p. ej. "(Salsa)") se conservan.
function limpiarAgrupados(titulo, extraArtistas) {
  return titulo.replace(/\(([^)]*)\)|\[([^\]]*)\]/g, (_, a, b) => {
    const contenido = a !== undefined ? a : b;
    const norm = normalizarTexto(contenido);
    if (!norm) return ' ';
    if (/^(ft|feat|featuring|con|with|prod|by)\b/.test(norm)) {
      tokens(norm.replace(/^(ft|feat|featuring|con|with|prod|by)\b/, '')).forEach(t => extraArtistas.add(t));
      return ' ';
    }
    if (norm.split(' ').every(t => RUIDO_AGRUPADO.has(t) || /^\d{2,4}p?$/.test(t))) return ' ';
    return ' ' + contenido + ' ';
  });
}

function nombreArtista(video) {
  return String(
    video && (video.artista || video.artist || (video.author && video.author.name)) || ''
  ).trim();
}

function tokensCanal(nombre) {
  // "LuisFonsiVEVO" / "Shakira - Topic" / "Karol G Official"
  let n = normalizarTexto(nombre);
  n = n.replace(/(vevo|topic)$/g, '').trim();
  return tokens(n);
}

// Huella reutilizable: se calcula una vez por canción y se compara muchas veces.
function crearHuella(video) {
  const crudo = String((video && (video.titulo || video.title)) || '');
  const extra = new Set();               // invitados (feat.)
  let t = limpiarAgrupados(crudo, extra);

  // "... ft. Daddy Yankee" fuera de paréntesis: lo que sigue son invitados.
  const m = t.match(/\b(?:ft|feat|featuring)\b\.?/i);
  if (m) {
    const resto = t.slice(m.index + m[0].length);
    t = t.slice(0, m.index);
    tokens(resto.split(/\s[-–—|]\s/)[0]).forEach(x => extra.add(x));
  }

  const canal = new Set(tokensCanal(nombreArtista(video)));
  const partes = t.split(/\s[-–—|]\s|\s[-–—|]$|^[-–—|]\s/)
    .map(p => p.trim()).filter(Boolean)
    .map(p => ({ texto: p, tok: tokens(p) }))
    .filter(p => p.tok.length > 0);       // descarta partes que eran solo ruido

  const artistaTitulo = new Set();
  const todos = new Set();
  partes.forEach(p => p.tok.forEach(x => todos.add(x)));

  if (partes.length >= 2) {
    // "Artista - Canción": si una parte coincide con el canal, esa es el artista;
    // si no, se asume el orden habitual (artista primero).
    let idxArtista = 0;
    const idxCanal = partes.findIndex(p => p.tok.some(x => canal.has(x)));
    if (idxCanal >= 0) idxArtista = idxCanal;
    partes[idxArtista].tok.forEach(x => artistaTitulo.add(x));
  }
  extra.forEach(x => { artistaTitulo.add(x); todos.add(x); });

  const artistas = new Set([...canal, ...artistaTitulo]);
  const squash = [...artistas].join('');
  const canalSquash = tokensCanal(nombreArtista(video)).join('');

  return {
    videoId: video && video.videoId ? String(video.videoId) : '',
    titulo: crudo,
    artista: nombreArtista(video),
    todos,                // todas las palabras relevantes del título
    artistaTitulo,        // artista(s) escritos dentro del título
    artistas,             // artista del título + canal
    squash: squash + canalSquash,
    clave: [...todos].sort().join(' ')
  };
}

const interseccion = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };

function subconjunto(chico, grande) {
  for (const x of chico) if (!grande.has(x)) return false;
  return true;
}

function jaccard(a, b) {
  let comunes = 0;
  a.forEach(x => { if (b.has(x)) comunes++; });
  const union = a.size + b.size - comunes;
  return union ? comunes / union : 0;
}

// ¿Son la misma canción? Recibe huellas (crearHuella).
function mismaHuella(a, b, detalle) {
  if (!a || !b) return false;
  if (a.videoId && a.videoId === b.videoId) return true;
  if (!a.todos.size || !b.todos.size) return false;      // sin información: no se puede afirmar

  // Compuerta de artista: si AMBOS videos traen su artista escrito en el título y
  // son claramente otros artistas ("Maná - Amor" vs "Juanes - Amor"), no es la misma.
  if (a.artistaTitulo.size && b.artistaTitulo.size) {
    const cruza = interseccion(a.artistaTitulo, b.artistaTitulo) ||
      interseccion(a.artistaTitulo, b.todos) || interseccion(b.artistaTitulo, a.todos);
    if (!cruza) return false;
  }

  // 1) Mismas palabras en el título completo (cubre el orden invertido).
  if (a.clave === b.clave) { if (detalle) detalle.metodo = 'titulo-identico'; return true; }

  const artistasUnidos = new Set([...a.artistas, ...b.artistas]);

  // 2) Misma canción una vez quitado el artista. La similitud se mide SOLO sobre las
  //    palabras de la canción: dos temas del mismo artista no se parecen por compartir
  //    su nombre. Un título largo tolera una palabra suelta de diferencia.
  const sa = new Set([...a.todos].filter(x => !artistasUnidos.has(x)));
  const sb = new Set([...b.todos].filter(x => !artistasUnidos.has(x)));
  if (sa.size && sb.size) {
    if ([...sa].sort().join(' ') === [...sb].sort().join(' ')) {
      if (detalle) detalle.metodo = 'cancion-identica';
      return true;
    }
    if (Math.min(sa.size, sb.size) >= 4 && jaccard(sa, sb) >= 0.8) {
      if (detalle) detalle.metodo = 'alta-similitud';
      return true;
    }
  }

  // 3) Uno contiene al otro y lo que sobra es solo el artista/invitados
  //    (p. ej. "Despacito" del canal de Luis Fonsi vs "Luis Fonsi - Despacito ft. Daddy Yankee").
  const [chico, grande] = a.todos.size <= b.todos.size ? [a, b] : [b, a];
  if (subconjunto(chico.todos, grande.todos)) {
    const squash = a.squash + '|' + b.squash;
    const sobrantes = [...grande.todos].filter(x => !chico.todos.has(x));
    const explicado = sobrantes.every(x =>
      artistasUnidos.has(x) || (x.length >= 3 && squash.includes(x)));
    // Debe quedar al menos una palabra que NO sea del artista (la canción en sí).
    const propias = [...chico.todos].filter(x => !artistasUnidos.has(x));
    if (explicado && (propias.length >= 1 || chico.todos.size >= 2)) {
      if (detalle) detalle.metodo = 'contenida-por-artista';
      return true;
    }
  }
  return false;
}

// Compatibilidad con llamadas directas sobre objetos video/canción.
function mismaCancion(a, b) {
  return mismaHuella(crearHuella(a), crearHuella(b));
}

// Videos que no son una canción individual (mixes, compilaciones, álbumes completos).
const REGEX_NO_CANCION = /\b(mix|enganchad[oa]s?|compilaci[oó]n|playlist|[áa]lbum completo|full album|\d+\s*(horas?|hours?|hrs?)|top\s*\d+|las mejores|los mejores|grandes [eé]xitos|lo mejor de|en vivo concierto completo|concierto completo)\b/i;
const MAX_SEGUNDOS_CANCION = 12 * 60;
const MIN_SEGUNDOS_CANCION = 60;

function pareceCancion(video) {
  const titulo = String((video && (video.title || video.titulo)) || '');
  if (REGEX_NO_CANCION.test(titulo)) return false;
  const seg = Number(video && (video.seconds || (video.duration && video.duration.seconds)) || 0);
  if (seg > 0 && (seg > MAX_SEGUNDOS_CANCION || seg < MIN_SEGUNDOS_CANCION)) return false;
  return true;
}

module.exports = {
  normalizarTexto,
  crearHuella,
  mismaHuella,
  mismaCancion,
  nombreArtista,
  pareceCancion
};
