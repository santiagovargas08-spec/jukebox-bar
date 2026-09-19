'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  searchYoutube,
  clearSearchCache,
  normalizeYoutubeResult
} = require('../services/youtubeSearchService.js');

describe('youtube search service', () => {
  it('normaliza un resultado válido', () => {
    const result = normalizeYoutubeResult({
      videoId: 'abc123',
      title: '  Canción demo  ',
      author: { name: '  Canal Demo ' },
      thumbnail: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg'
    });

    assert.equal(result.videoId, 'abc123');
    assert.equal(result.title, 'Canción demo');
    assert.equal(result.author.name, 'Canal Demo');
    assert.match(result.thumbnail, /i\.ytimg\.com/);
  });

  it('descarta resultados sin videoId', () => {
    assert.equal(normalizeYoutubeResult({ title: 'Sin id' }), null);
  });

  it('usa valores seguros cuando faltan metadatos', () => {
    const result = normalizeYoutubeResult({
      videoId: 'abc123',
      title: '',
      author: null,
      thumbnail: ''
    });

    assert.equal(result.title, 'Sin título');
    assert.equal(result.author.name, 'Canal desconocido');
    assert.equal(result.thumbnail, null);
  });

  it('una búsqueda vacía no llama a YouTube y devuelve cero resultados', async () => {
    clearSearchCache();
    const result = await searchYoutube('   ');

    assert.deepEqual(result, {
      videos: [],
      cached: false
    });
  });
});
