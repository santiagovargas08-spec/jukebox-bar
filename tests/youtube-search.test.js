'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  searchYoutube,
  clearSearchCache,
  MAX_SEARCH_RESULTS
} = require('../services/youtubeSearchService.js');

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

    assert.deepEqual(result, {
      videos: [],
      cached: false,
      status: 'EMPTY_QUERY'
    });
  });
});
