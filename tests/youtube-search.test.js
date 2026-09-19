'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  searchYoutube,
  clearSearchCache,
  normalizeYoutubeResult,
  isAcceptableYoutubeResult,
  scoreYoutubeResult,
  rankYoutubeResults,
  resetProviderCircuit,
  isProviderCircuitOpen,
  recordProviderFailure,
  PROVIDER_FAILURE_THRESHOLD
} = require('../services/youtubeSearchService.js');

describe('youtube search service', () => {
  it('normaliza un resultado válido', () => {
    const result = normalizeYoutubeResult({
      videoId: 'abc123XYZ09',
      title: '  Canción demo  ',
      author: { name: '  Canal Demo ' },
      thumbnail: 'https://i.ytimg.com/vi/abc123XYZ09/hqdefault.jpg'
    });

    assert.equal(result.videoId, 'abc123XYZ09');
    assert.equal(result.title, 'Canción demo');
    assert.equal(result.author.name, 'Canal Demo');
    assert.match(result.thumbnail, /i\.ytimg\.com/);
  });

  it('descarta resultados sin videoId', () => {
    assert.equal(normalizeYoutubeResult({ title: 'Sin id' }), null);
  });

  it('descarta directos y videos demasiado largos para el jukebox', () => {
    assert.equal(
      isAcceptableYoutubeResult({
        videoId: 'abc123XYZ09',
        duration: { seconds: 7200 },
        live: false
      }),
      false
    );

    assert.equal(
      isAcceptableYoutubeResult({
        videoId: 'abc123XYZ09',
        duration: { seconds: 240 },
        live: true
      }),
      false
    );

    assert.equal(
      isAcceptableYoutubeResult({
        videoId: 'abc123XYZ09',
        duration: { seconds: 240 },
        live: false
      }),
      true
    );
  });

  it('filtra resultados largos antes de devolver la búsqueda', async () => {
    clearSearchCache();

    const result = await searchYoutube(
      'artista canción',
      {
        searchFn: async () => ({
          videos: [
            {
              videoId: 'Long0000001',
              title: 'Mix de dos horas',
              author: { name: 'Canal' },
              thumbnail: '',
              duration: { seconds: 7200, timestamp: '2:00:00' }
            },
            {
              videoId: 'Song0000001',
              title: 'Canción',
              author: { name: 'Artista' },
              thumbnail: '',
              duration: { seconds: 210, timestamp: '3:30' }
            }
          ]
        }),
        timeoutMs: 100
      }
    );

    assert.equal(result.videos.length, 1);
    assert.equal(result.videos[0].videoId, 'Song0000001');
    assert.equal(result.videos[0].durationSeconds, 210);
  });

  it('usa valores seguros cuando faltan metadatos', () => {
    const result = normalizeYoutubeResult({
      videoId: 'abc123XYZ09',
      title: '',
      author: null,
      thumbnail: ''
    });

    assert.equal(result.title, 'Sin título');
    assert.equal(result.author.name, 'Canal desconocido');
    assert.equal(result.thumbnail, null);
  });

  it('no cachea respuestas vacías del proveedor', async () => {
    clearSearchCache();

    let calls = 0;
    const searchFn = async () => {
      calls += 1;
      return { videos: [] };
    };

    const first = await searchYoutube(
      'consulta sin resultados',
      { searchFn, timeoutMs: 200 }
    );
    const second = await searchYoutube(
      'consulta sin resultados',
      { searchFn, timeoutMs: 200 }
    );

    assert.equal(first.videos.length, 0);
    assert.equal(second.videos.length, 0);
    assert.equal(calls, 2);
  });

  it('resultados vacíos no abren el circuit breaker', async () => {
    clearSearchCache();

    const searchFn = async () => ({ videos: [] });

    for (let index = 0; index < PROVIDER_FAILURE_THRESHOLD + 2; index += 1) {
      await searchYoutube(
        `consulta vacía ${index}`,
        { searchFn, timeoutMs: 100 }
      );
    }

    assert.equal(isProviderCircuitOpen(), false);
  });

  it('coalesce búsquedas idénticas concurrentes', async () => {
    clearSearchCache();

    let calls = 0;
    const searchFn = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        videos: [
          {
            videoId: 'abc123XYZ09',
            title: 'Concurrente',
            author: { name: 'Canal' },
            thumbnail: 'https://i.ytimg.com/vi/abc123XYZ09/hqdefault.jpg'
          }
        ]
      };
    };

    const [first, second] = await Promise.all([
      searchYoutube('misma consulta', { searchFn, timeoutMs: 200 }),
      searchYoutube('misma consulta', { searchFn, timeoutMs: 200 })
    ]);

    assert.equal(calls, 1);
    assert.equal(first.videos.length, 1);
    assert.equal(second.videos.length, 1);
    assert.equal(first.videos[0].videoId, 'abc123XYZ09');
    assert.equal(second.videos[0].videoId, 'abc123XYZ09');
  });

  it('corta búsquedas bloqueadas por timeout', async () => {
    clearSearchCache();

    const result = await searchYoutube(
      'consulta que se queda esperando',
      {
        searchFn: () => new Promise(() => {}),
        timeoutMs: 15
      }
    );

    assert.deepEqual(result, {
      videos: [],
      cached: false,
      status: 'TIMEOUT'
    });
  });

  it('abre el circuit breaker tras fallos consecutivos del proveedor', async () => {
    clearSearchCache();
    resetProviderCircuit();

    for (let index = 0; index < PROVIDER_FAILURE_THRESHOLD; index += 1) {
      recordProviderFailure();
    }

    assert.equal(isProviderCircuitOpen(), true);

    let calls = 0;
    const result = await searchYoutube(
      'consulta mientras circuito está abierto',
      {
        searchFn: async () => {
          calls += 1;
          return { videos: [] };
        },
        timeoutMs: 100
      }
    );

    assert.deepEqual(result, {
      videos: [],
      cached: false,
      status: 'PROVIDER_UNAVAILABLE'
    });
    assert.equal(calls, 0);
  });

  it('una búsqueda exitosa reinicia el estado del circuit breaker', async () => {
    clearSearchCache();

    for (let index = 0; index < PROVIDER_FAILURE_THRESHOLD - 1; index += 1) {
      recordProviderFailure();
    }

    const result = await searchYoutube(
      'consulta recuperada',
      {
        searchFn: async () => ({
          videos: [
            {
              videoId: 'abc123XYZ09',
              title: 'Recuperada',
              author: { name: 'Canal' },
              thumbnail: 'https://i.ytimg.com/vi/abc123XYZ09/hqdefault.jpg'
            }
          ]
        }),
        timeoutMs: 100
      }
    );

    assert.equal(result.videos.length, 1);
    assert.equal(isProviderCircuitOpen(), false);
  });

  it('una búsqueda vacía no llama a YouTube y devuelve cero resultados', async () => {
    clearSearchCache();
    const result = await searchYoutube('   ');

    assert.deepEqual(result, {
      videos: [],
      cached: false,
      status: 'EMPTY_QUERY'
    });
  });

  it('prioriza coincidencias de canción sobre mixes y compilaciones', () => {
    const videos = [
      {
        videoId: 'Mix00000001',
        title: 'Shakira Greatest Hits Mix 2 Hours',
        author: { name: 'Music Mix' },
        duration: { seconds: 600 }
      },
      {
        videoId: 'Song0000002',
        title: 'Shakira - Antologia (Official Audio)',
        author: { name: 'Shakira' },
        duration: { seconds: 252 }
      },
      {
        videoId: 'Song0000003',
        title: 'Antologia lyrics',
        author: { name: 'Fan Lyrics' },
        duration: { seconds: 250 }
      }
    ];

    const ranked = rankYoutubeResults(
      videos,
      'shakira antologia'
    );

    assert.equal(
      ranked[0].videoId,
      'Song0000002'
    );

    assert.ok(
      scoreYoutubeResult(
        videos[1],
        'shakira antologia'
      ) >
      scoreYoutubeResult(
        videos[0],
        'shakira antologia'
      )
    );
  });
});
