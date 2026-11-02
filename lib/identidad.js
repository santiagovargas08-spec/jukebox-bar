'use strict';

// Identidad musical por título y artista. Los metadatos del canal solo se usan
// como pista cuando parecen corresponder al intérprete; nunca se compara artista
// por sí solo para declarar dos canciones iguales.

function normalizarTexto(valor) {
  return String(valor || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['’\`´]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

const RUIDO = new Set([
  'official','oficial','video','videoclip','clip','music','musica','audio',
  'lyrics','lyric','letra','letras','hd','hq','4k','1080p','720p','8k',
  'remaster','remastered','remasterizado','remasterizada','version','visualizer',
  'visualiser','karaoke','topic','vevo','live','subtitulado','subtitulada',
  'sub','espanol','spanish','english','ingles','full','completo','completa',
  'cover','en','de','la','el','los','las','y','the','and','a','con','with',
  'by','prod','records','record','recordings','entertainment','ft','feat',
  'featuring','original','audio','estereo','stereo'
]);

const CANALES_GENERICOS = /\b(lyrics?|letras?|salsa hits|music latino|musica latina|mix|radio|playlist|karaoke|fan|fans|topic|vevo|records?)\b/i;

function tokens(texto) {
  return normalizarTexto(texto).split(' ')
    .filter(t => t && !RUIDO.has(t) && (t.length > 1 || /\d/.test(t)));
}

function limpiarEtiquetas(titulo) {
  let texto = String(titulo || '');
  texto = texto.replace(/\(([^)]*)\)|\[([^\]]*)\]/g, (_, a, b) => {
    const contenido = normalizarTexto(a !== undefined ? a : b);
    if (!contenido) return ' ';
    const palabras = contenido.split(' ');
    const soloEtiqueta = palabras.every(t =>
      RUIDO.has(t) || /^(19|20)\d{2}$/.test(t) || /^\d{2,4}p?$/.test(t) ||
      ['estreno','nuevo','nueva','new','unplugged','acustico','acustica','acoustic','radio','edit','extended','single','sencillo','song','cancion','tema','officially','channel','canal'].includes(t)
    );
    return soloEtiqueta ? ' ' : ' ' + (a !== undefined ? a : b) + ' ';
  });
  texto = texto.replace(/\b(?:ft|feat|featuring)\b\.?\s+.+$/i, ' ');
  return texto.replace(/\s+/g, ' ').trim();
}

function nombreArtista(video) {
  if (!video) return '';
  const directo = String(video.artista || video.artist || '').trim();
  if (directo) return directo;
  const canal = String(video.author && video.author.name || '').trim();
  if (!canal || CANALES_GENERICOS.test(canal)) return '';
  return canal.replace(/(?:official|vevo|topic)$/i, '').trim();
}

function separarTitulo(titulo) {
  const limpio = limpiarEtiquetas(titulo);
  const partes = limpio.split(/\s+(?:[-–—|]|::?)\s+/).map(x => x.trim()).filter(Boolean);
  return partes.length > 1 ? partes : [limpio];
}

function crearHuella(video) {
  const crudo = String(video && (video.titulo || video.title) || '');
  const partes = separarTitulo(crudo);
  const artistaMeta = nombreArtista(video);
  const metaTokens = new Set(tokens(artistaMeta));
  const parteTokens = partes.map(p => tokens(p));
  let indiceArtista = -1;

  if (metaTokens.size) {
    indiceArtista = parteTokens.findIndex(ts => ts.some(t => metaTokens.has(t)));
  }

  // Cuando el título usa el formato habitual Artista - Canción y no hay
  // metadatos útiles, la primera parte se considera artista.
  if (indiceArtista < 0 && partes.length > 1) indiceArtista = 0;

  let artistaTitulo = [];
  let artista = artistaMeta;
  if (indiceArtista >= 0) {
    artistaTitulo = parteTokens[indiceArtista];
    if (!artista) artista = partes[indiceArtista];
  }

  let tituloPrincipal = partes.length === 1
    ? partes[0]
    : partes.filter((_, i) => i !== indiceArtista).join(' ');
  if (!tituloPrincipal) tituloPrincipal = limpio;

  const tituloTokens = new Set(tokens(tituloPrincipal));
  const variantes = [];
  const agregarVariante = (ts, conservarParteArtista = false) => {
    const filtrados = ts.filter(t => !metaTokens.has(t) && (conservarParteArtista || !artistaTitulo.includes(t)));
    const key = [...new Set(filtrados)].sort().join(' ');
    if (key && !variantes.includes(key)) variantes.push(key);
  };
  agregarVariante([...tituloTokens]);
  // El orden invertido Canción - Artista es habitual en resultados de YouTube.
  // Se conservan segmentos alternativos, pero la comparación exige título
  // distintivo si los artistas detectados son diferentes.
  if (partes.length > 1) parteTokens.forEach(ts => agregarVariante(ts, true));

  const todos = new Set(partes.flatMap(x => tokens(x)));
  const artistaSet = new Set([...metaTokens, ...artistaTitulo]);
  const tituloKey = [...tituloTokens].sort().join(' ');
  return {
    videoId: video && video.videoId ? String(video.videoId) : '',
    titulo: crudo,
    artista: artista || '',
    artistaKey: [...artistaSet].sort().join(' '),
    artistaTokens: artistaSet,
    tituloTokens,
    tituloKey,
    variantes,
    todos,
    clave: tituloKey
  };
}

function jaccard(a, b) {
  let comunes = 0;
  a.forEach(x => { if (b.has(x)) comunes++; });
  const union = a.size + b.size - comunes;
  return union ? comunes / union : 0;
}

function tokensDeClave(clave) {
  return new Set(String(clave || '').split(' ').filter(Boolean));
}

function tituloDistintivo(ts) {
  if (!ts || !ts.size) return false;
  return ts.size >= 3 || (ts.size === 2 && [...ts].some(t => t.length >= 8)) ||
    (ts.size === 1 && [...ts][0].length >= 8);
}

function mismaHuella(a, b, detalle) {
  if (!a || !b) return false;
  if (a.videoId && a.videoId === b.videoId) {
    if (detalle) detalle.metodo = 'mismo-videoId';
    return true;
  }
  const variantesA = (a.variantes && a.variantes.length ? a.variantes : [a.clave]).map(tokensDeClave).filter(s => s.size);
  const variantesB = (b.variantes && b.variantes.length ? b.variantes : [b.clave]).map(tokensDeClave).filter(s => s.size);
  if (!variantesA.length || !variantesB.length) return false;

  const artistasA = a.artistaTokens || tokensDeClave(a.artistaKey);
  const artistasB = b.artistaTokens || tokensDeClave(b.artistaKey);
  const ambosArtistas = artistasA.size && artistasB.size;
  const mismoArtista = ambosArtistas && (
    a.artistaKey === b.artistaKey ||
    jaccard(artistasA, artistasB) >= 0.75 ||
    [...artistasA].every(t => artistasB.has(t)) ||
    [...artistasB].every(t => artistasA.has(t))
  );
  const artistasDistintos = ambosArtistas && !mismoArtista;

  for (const ta of variantesA) {
    for (const tb of variantesB) {
      const exacto = [...ta].sort().join(' ') === [...tb].sort().join(' ');
      if (exacto) {
        if (artistasDistintos && !tituloDistintivo(ta)) continue;
        if (detalle) detalle.metodo = artistasDistintos ? 'titulo-exacto-version-otro-artista' : 'titulo-identico';
        return true;
      }
      if (artistasDistintos) continue;
      if (Math.min(ta.size, tb.size) >= 3 && jaccard(ta, tb) >= 0.84) {
        if (detalle) detalle.metodo = 'alta-similitud-titulo';
        return true;
      }
    }
  }
  return false;
}

function mismaCancion(a, b) {
  return mismaHuella(crearHuella(a), crearHuella(b));
}

const REGEX_NO_CANCION = /\b(mix|enganchad[oa]s?|compilaci[oó]n|playlist|[áa]lbum completo|full album|\d+\s*(horas?|hours?|hrs?)|top\s*\d+|las mejores|los mejores|grandes [eé]xitos|lo mejor de|concierto completo)\b/i;
const MAX_SEGUNDOS_CANCION = 12 * 60;
const MIN_SEGUNDOS_CANCION = 60;

function pareceCancion(video) {
  const titulo = String(video && (video.title || video.titulo) || '');
  if (!titulo || REGEX_NO_CANCION.test(titulo)) return false;
  const seg = Number(video && (video.seconds || video.duracionSegundos || (video.duration && video.duration.seconds)) || 0);
  if (seg > 0 && (seg > MAX_SEGUNDOS_CANCION || seg < MIN_SEGUNDOS_CANCION)) return false;
  return true;
}

module.exports = {
  normalizarTexto, crearHuella, mismaHuella, mismaCancion, nombreArtista, pareceCancion
};
