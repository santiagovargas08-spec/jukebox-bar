'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  searchYoutube,
  clearSearchCache,
  MAX_SEARCH_RESULTS
} = require('../services/youtubeSearchService.js');

const {
  canonicalSearchKey,
  approximateQueryScore
} = require('../services/searchCacheService.js');

const {
  searchWithYoutubeProvider
} = require('../services/youtubeSearchProvider.js');

describe('youtube search service', () => {
  it('devuelve los primeros resultados tal como los entrega yt-search', async () => {
    clearSearchCache();

    const source = Array.from(
      { length: 30 },
      (_, index) => ({
        videoId:
          `Video${String(index).padStart(6, '0')}`,
        title:
          `Resultado ${index}`,
        author: {
          name: 'Canal'
        }
      })
    );

    const result = await searchYoutube(
      'artista canción',
      {
        usePersistentCache: false, useKnownSongs: false,
        searchFn: async () => ({
          videos: source
        })
      }
    );

    assert.equal(
      result.status,
      'OK'
    );

    assert.equal(
      result.videos.length,
      MAX_SEARCH_RESULTS
    );

    assert.deepEqual(
      result.videos,
      source.slice(
        0,
        MAX_SEARCH_RESULTS
      )
    );
  });

  it('cachea búsquedas exitosas durante la sesión del servidor', async () => {
    clearSearchCache();

    let calls = 0;

    const searchFn = async () => {
      calls += 1;

      return {
        videos: [
          {
            videoId: 'abc123XYZ09',
            title: 'Canción',
            author: {
              name: 'Artista'
            }
          }
        ]
      };
    };

    const first = await searchYoutube(
      'misma búsqueda',
      { searchFn, usePersistentCache: false, useKnownSongs: false }
    );

    const second = await searchYoutube(
      'misma búsqueda',
      { searchFn, usePersistentCache: false, useKnownSongs: false }
    );

    assert.equal(calls, 1);
    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.equal(second.videos.length, 1);
  });

  it('comparte una sola consulta para búsquedas idénticas concurrentes', async () => {
    clearSearchCache();

    let calls = 0;

    const searchFn = async () => {
      calls += 1;

      await new Promise(
        (resolve) =>
          setTimeout(resolve, 20)
      );

      return {
        videos: [
          {
            videoId: 'abc123XYZ09',
            title: 'Concurrente',
            author: {
              name: 'Canal'
            }
          }
        ]
      };
    };

    const [first, second] =
      await Promise.all([
        searchYoutube(
          'consulta concurrente',
          { searchFn, usePersistentCache: false, useKnownSongs: false }
        ),
        searchYoutube(
          'consulta concurrente',
          { searchFn, usePersistentCache: false, useKnownSongs: false }
        )
      ]);

    assert.equal(calls, 1);
    assert.equal(first.videos.length, 1);
    assert.equal(second.videos.length, 1);
  });

  it('devuelve NO_RESULTS cuando yt-search responde sin videos', async () => {
    clearSearchCache();

    const result = await searchYoutube(
      'sin resultados',
      {
        usePersistentCache: false, useKnownSongs: false,
        searchFn: async () => ({
          videos: []
        })
      }
    );

    assert.deepEqual(
      {
        videos: result.videos,
        cached: result.cached,
        status: result.status
      },
      {
        videos: [],
        cached: false,
        status: 'NO_RESULTS'
      }
    );
  });

  it('devuelve PROVIDER_ERROR cuando yt-search lanza una excepción', async () => {
    clearSearchCache();

    const result = await searchYoutube(
      'error proveedor',
      {
        usePersistentCache: false, useKnownSongs: false,
        searchFn: async () => {
          throw new Error(
            'fallo yt-search'
          );
        }
      }
    );

    assert.equal(
      result.status,
      'PROVIDER_ERROR'
    );

    assert.deepEqual(
      result.videos,
      []
    );
  });

  it('una búsqueda vacía no llama a yt-search', async () => {
    clearSearchCache();

    let calls = 0;

    const result = await searchYoutube(
      '   ',
      {
        usePersistentCache: false, useKnownSongs: false,
        searchFn: async () => {
          calls += 1;
          return {
            videos: []
          };
        }
      }
    );

    assert.equal(calls, 0);

    assert.deepEqual(
      {
        videos: result.videos,
        cached: result.cached,
        status: result.status
      },
      {
        videos: [],
        cached: false,
        status: 'EMPTY_QUERY'
      }
    );

    assert.equal(
      typeof result.timings?.totalMs,
      'number'
    );
  });

  it('normaliza el orden de palabras para reutilizar cache', () => {
    assert.equal(
      canonicalSearchKey(
        'Karol G Provenza'
      ),
      canonicalSearchKey(
        'provenza karol g'
      )
    );
  });

  it('acepta coincidencias aproximadas fuertes y rechaza coincidencias débiles', () => {
    assert.ok(
      approximateQueryScore(
        'karol provenza',
        'karol g provenza'
      ) >= 0.72
    );

    assert.ok(
      approximateQueryScore(
        'bad bunny dtmf',
        'bad bunny monaco'
      ) < 0.72
    );
  });

  it('evita repetir inmediatamente una consulta que ya devolvió cero resultados', async () => {
    clearSearchCache();

    let calls = 0;

    const searchFn = async () => {
      calls += 1;
      return {
        videos: []
      };
    };

    const options = {
      searchFn,
      usePersistentCache: false,
      useKnownSongs: false
    };

    const first =
      await searchYoutube(
        'consulta inexistente',
        options
      );

    const second =
      await searchYoutube(
        'consulta inexistente',
        options
      );

    assert.equal(
      first.status,
      'NO_RESULTS'
    );

    assert.equal(
      second.cacheLayer,
      'negative-memory'
    );

    assert.equal(calls, 1);
  });


  it('corta una búsqueda del proveedor que supera el timeout configurado', async () => {
    const startedAt = Date.now();

    await assert.rejects(
      searchWithYoutubeProvider(
        'proveedor lento',
        {
          timeoutMs: 25,
          searchFn: async () =>
            new Promise(() => {})
        }
      ),
      (error) =>
        error?.code ===
        'YOUTUBE_SEARCH_TIMEOUT'
    );

    assert.ok(
      Date.now() - startedAt < 500,
      'el timeout del proveedor debe responder rápidamente'
    );
  });

  it('incluye tiempos por capa en una búsqueda exitosa', async () => {
    clearSearchCache();

    const result = await searchYoutube(
      'latencia por capas',
      {
        usePersistentCache: false,
        useKnownSongs: false,
        searchFn: async () => ({
          videos: [
            {
              videoId: 'abc123XYZ09',
              title: 'Canción',
              author: {
                name: 'Artista'
              }
            }
          ]
        })
      }
    );

    assert.equal(result.status, 'OK');
    assert.equal(
      typeof result.timings?.memoryMs,
      'number'
    );
    assert.equal(
      typeof result.timings?.youtubeMs,
      'number'
    );
    assert.equal(
      typeof result.timings?.totalMs,
      'number'
    );
  });

});
