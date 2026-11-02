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
  'visualiser','karaoke','topic','vevo','live','subtitulado','subtitulada','vivo',
  'sub','espanol','spanish','english','ingles','full','completo','completa',
  'cover','remix','en','de','la','el','los','las','y','the','and','a','con','with',
  'by','prod','records','record','recordings','entertainment','ft','feat',
  'featuring','original','audio','estereo','stereo'
]);

const CANALES_GENERICOS = /\b(lyrics?|letras?|salsa hits|music latino|musica latina|mix|radio|playlist|karaoke|fan|fans|topic|vevo|records?|canal|official|oficial|audio|video)\b/i;

function tokens(texto) {
  return normalizarTexto(texto).split(' ')
    .filter(t => t && !RUIDO.has(t) && (t.length > 1 || /\d/.test(t) || /^[a-z]$/.test(t)));
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

  const canalOriginal = String(video.author && video.author.name || '').trim();
  const canal = canalOriginal.replace(/(?:official|vevo|topic)$/i, '').trim();
  const canalGenerico = !canal || CANALES_GENERICOS.test(normalizarTexto(canal));
  const partes = separarTitulo(video.titulo || video.title || '');

  if (!canalGenerico && partes.length > 1) {
    const canalTokens = new Set(tokens(canal));
    const parteCoincidente = partes.find(parte => tokens(parte).some(t => canalTokens.has(t)));
    if (parteCoincidente) return parteCoincidente;
  }
  if (partes.length > 1) {
    const primera = tokens(partes[0]);
    const segunda = tokens(partes[1]);
    const indiceArtista = primera.length === 1 && primera[0].length >= 8 && segunda.length >= 2 ? 1 : 0;
    return partes[indiceArtista] || '';
  }
  return canalGenerico ? '' : canal;
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

  // Cuando no hay metadatos, se admite también el orden Canción - Artista.
  // Un título distintivo de una sola palabra seguido por un nombre de dos
  // palabras suele venir en ese orden inverso (p. ej. Despacito - Luis Fonsi).
  if (indiceArtista < 0 && partes.length > 1) {
    const primera = parteTokens[0] || [];
    const segunda = parteTokens[1] || [];
    indiceArtista = primera.length === 1 && primera[0].length >= 8 && segunda.length >= 2
      ? 1 : 0;
  }

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
  const agregarVariante = (ts, incluirParteArtista = false) => {
    const filtrados = ts.filter(t => incluirParteArtista || (!metaTokens.has(t) && !artistaTitulo.includes(t)));
    const key = [...new Set(filtrados)].sort().join(' ');
    if (key && !variantes.includes(key)) variantes.push(key);
  };
  agregarVariante([...tituloTokens]);
  // Se conservan los dos lados del separador para admitir el formato
  // Canción - Artista. La comparación posterior descarta coincidencias que
  // solo sean el nombre del artista en ambos videos.
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
    (ts.size === 1 && [...ts][0].length >= 11);
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
      const claveCoincidente = [...ta].sort().join(' ');
      const exacto = claveCoincidente === [...tb].sort().join(' ');
      if (exacto) {
        const esArtistaA = [...ta].every(t => artistasA.has(t));
        const esArtistaB = [...ta].every(t => artistasB.has(t));
        // Si el texto coincidente es solo el artista en ambos videos, no es
        // evidencia de que compartan canción.
        if (esArtistaA && esArtistaB) continue;
        // Si es el artista de un video, solo se acepta cuando coincide además
        // con el título principal del otro (formato invertido Artista/Canción).
        if (esArtistaA && !esArtistaB && b.clave !== claveCoincidente) continue;
        if (esArtistaB && !esArtistaA && a.clave !== claveCoincidente) continue;
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
  if (!crearHuella(video).todos.size) return false;
  const seg = Number(video && (video.seconds || video.duracionSegundos || (video.duration && video.duration.seconds)) || 0);
  if (seg > 0 && (seg > MAX_SEGUNDOS_CANCION || seg < MIN_SEGUNDOS_CANCION)) return false;
  return true;
}

module.exports = {
  normalizarTexto, crearHuella, mismaHuella, mismaCancion, nombreArtista, pareceCancion
};
