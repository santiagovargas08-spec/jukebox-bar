'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GitHubHistoryStore } = require('../lib/github-history-store');

function crearGitHubFalso() {
  const archivos = new Map();
  let revision = 0;
  const json = (data, status = 200) => new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json' }
  });
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url);
    if (u.pathname === '/repos/propietario/datos') {
      return json({ private: true });
    }
    const base = '/repos/propietario/datos/contents/';
    if (!u.pathname.startsWith(base)) return json({ message: 'Not found' }, 404);
    const path = decodeURIComponent(u.pathname.slice(base.length));
    if (options.method === 'PUT') {
      const body = JSON.parse(options.body);
      const previo = archivos.get(path);
      if (previo && body.sha !== previo.sha) return json({ message: 'sha mismatch' }, 409);
      if (!previo && body.sha) return json({ message: 'file not found' }, 404);
      const sha = 'sha-' + (++revision);
      const content = Buffer.from(body.content, 'base64').toString('utf8');
      archivos.set(path, { sha, content });
      return json({ content: { sha } });
    }
    if (path === 'history') {
      const items = [...archivos.keys()].filter(k => k.startsWith('history/')).map(k => ({
        type: 'file', name: k.split('/').pop()
      }));
      return items.length ? json(items) : json({ message: 'Not found' }, 404);
    }
    const file = archivos.get(path);
    if (!file) return json({ message: 'Not found' }, 404);
    return json({
      sha: file.sha,
      encoding: 'base64',
      content: Buffer.from(file.content, 'utf8').toString('base64')
    });
  };
  return { fetchImpl, archivos };
}

test('Carga y recupera el historial remoto, y confirma cada append', async () => {
  const fake = crearGitHubFalso();
  const store = new GitHubHistoryStore({
    token: 'test-token', repo: 'propietario/datos', fetchImpl: fake.fetchImpl,
    log: { log() {}, error() {} }
  });
  assert.deepEqual(await store.cargar(), []);
  await store.append({ videoId: 'a', titulo: 'Tema A', artista: 'Artista A' });
  await store.append({ videoId: 'b', titulo: 'Tema B', artista: 'Artista B' });
  const store2 = new GitHubHistoryStore({
    token: 'test-token', repo: 'propietario/datos', fetchImpl: fake.fetchImpl,
    log: { log() {}, error() {} }
  });
  const registros = await store2.cargar();
  assert.deepEqual(registros.map(r => r.videoId), ['a', 'b']);
});

test('Rota a un nuevo segmento al alcanzar 100 registros', async () => {
  const fake = crearGitHubFalso();
  const store = new GitHubHistoryStore({
    token: 'test-token', repo: 'propietario/datos', fetchImpl: fake.fetchImpl,
    log: { log() {}, error() {} }
  });
  await store.cargar();
  for (let i = 0; i < 101; i++) {
    await store.append({ videoId: 'v' + i, titulo: 'Tema ' + i });
  }
  const paths = [...fake.archivos.keys()].sort();
  assert.deepEqual(paths, ['history/historial-canciones-000001.jsonl', 'history/historial-canciones-000002.jsonl']);
  const store2 = new GitHubHistoryStore({
    token: 'test-token', repo: 'propietario/datos', fetchImpl: fake.fetchImpl,
    log: { log() {}, error() {} }
  });
  assert.equal((await store2.cargar()).length, 101);
});

test('Rechaza credenciales ausentes y repositorios públicos', async () => {
  assert.throws(() => new GitHubHistoryStore({ token: '', repo: 'propietario/datos' }), /GITHUB_TOKEN/);
  const store = new GitHubHistoryStore({
    token: 'test-token', repo: 'propietario/datos',
    fetchImpl: async () => new Response(JSON.stringify({ private: false }), { status: 200 }),
    log: { log() {}, error() {} }
  });
  await assert.rejects(() => store.cargar(), /debe existir y ser privado/);
});
