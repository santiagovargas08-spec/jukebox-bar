'use strict';

// Almacenamiento remoto por segmentos en un repositorio GitHub privado.
// Se serializan las escrituras para evitar conflictos entre reproducciones.
// Cada segmento contiene como máximo 100 registros, evitando archivos grandes.
const SEGMENTO_MAX_REGISTROS = 100;
const API = 'https://api.github.com';

class GitHubHistoryStore {
  constructor({
    token = process.env.GITHUB_TOKEN,
    repo = process.env.GITHUB_HISTORY_REPO,
    branch = process.env.GITHUB_HISTORY_BRANCH || 'main',
    directory = process.env.GITHUB_HISTORY_DIRECTORY || 'history',
    fetchImpl = global.fetch,
    log = console
  } = {}) {
    this.token = String(token || '').trim();
    this.repo = String(repo || '').trim();
    this.branch = String(branch || 'main').trim();
    this.directory = String(directory || 'history').replace(/^\\/+|\\/+$/g, '');
    this.fetch = fetchImpl;
    this.log = log;
    this.segmentos = [];
    this.colaEscrituras = Promise.resolve();
    if (!this.token) throw new Error('Falta GITHUB_TOKEN para el historial remoto.');
    if (!/^[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+$/.test(this.repo)) {
      throw new Error('GITHUB_HISTORY_REPO debe tener el formato propietario/repositorio.');
    }
    if (typeof this.fetch !== 'function') throw new Error('Este Node.js no dispone de fetch para GitHub.');
  }

  _url(path = '') {
    return API + '/repos/' + this.repo + '/contents/' + path.split('/').map(encodeURIComponent).join('/');
  }

  async _request(url, options = {}) {
    const response = await this.fetch(url, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + this.token,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers || {})
      }
    });
    let data = null;
    const raw = await response.text();
    if (raw) {
      try { data = JSON.parse(raw); } catch (_) { data = { message: raw.slice(0, 500) }; }
    }
    if (!response.ok) {
      const error = new Error('GitHub API (' + response.status + '): ' +
        (data && data.message ? data.message : response.statusText));
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async _listarSegmentos() {
    try {
      const data = await this._request(this._url(this.directory) + '?ref=' + encodeURIComponent(this.branch));
      if (!Array.isArray(data)) throw new Error('GitHub devolvió un listado de historial inválido.');
      return data.filter(x => x && x.type === 'file' && /^part-\\d{6}\\.jsonl$/.test(x.name))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      if (error.status === 404) return [];
      throw error;
    }
  }

  async _leerSegmento(item) {
    const data = await this._request(this._url(this.directory + '/' + item.name) +
      '?ref=' + encodeURIComponent(this.branch));
    if (!data || data.encoding !== 'base64' || typeof data.content !== 'string') {
      throw new Error('El segmento ' + item.name + ' no tiene contenido base64 válido.');
    }
    const content = Buffer.from(data.content.replace(/\\n/g, ''), 'base64').toString('utf8');
    const records = [];
    const lines = content.split('\\n');
    let invalidas = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (record && record.videoId && (record.titulo || record.title)) records.push(record);
        else invalidas++;
      } catch (_) { invalidas++; }
    }
    if (invalidas) throw new Error('El segmento ' + item.name + ' contiene ' + invalidas + ' línea(s) ilegible(s).');
    return { name: item.name, sha: data.sha, content, records };
  }

  async cargar() {
    const items = await this._listarSegmentos();
    const segmentos = [];
    for (const item of items) segmentos.push(await this._leerSegmento(item));
    this.segmentos = segmentos;
    const records = segmentos.flatMap(s => s.records);
    this.log.log('[GITHUB-HISTORY] ' + records.length + ' reproducciones recuperadas desde ' +
      this.repo + '/' + this.directory + ' (' + segmentos.length + ' segmento(s)).');
    return records;
  }

  async _guardarSegmento(segmento, registro) {
    const nuevaLinea = JSON.stringify(registro) + '\\n';
    let content = segmento ? segmento.content : '';
    let sha = segmento ? segmento.sha : undefined;
    const name = segmento ? segmento.name : 'part-' + String(this.segmentos.length + 1).padStart(6, '0') + '.jsonl';

    // Reintenta conflictos de SHA leyendo la versión remota antes de volver a escribir.
    for (let intento = 0; intento < 3; intento++) {
      const siguiente = content + nuevaLinea;
      const body = {
        message: 'Guardar reproducción de Jukebox Bar',
        content: Buffer.from(siguiente, 'utf8').toString('base64'),
        branch: this.branch
      };
      if (sha) body.sha = sha;
      try {
        const result = await this._request(this._url(this.directory + '/' + name), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        return { name, sha: result.content.sha, content: siguiente, records: (segmento ? segmento.records : []).concat(registro) };
      } catch (error) {
        if (error.status !== 409 && error.status !== 422) throw error;
        const actual = await this._request(this._url(this.directory + '/' + name) +
          '?ref=' + encodeURIComponent(this.branch));
        if (!actual || actual.encoding !== 'base64' || !actual.sha) throw error;
        sha = actual.sha;
        content = Buffer.from(actual.content.replace(/\\n/g, ''), 'base64').toString('utf8');
        if (!content.endsWith('\\n') && content) content += '\\n';
        // Recalcula los registros del segmento tras una escritura concurrente.
        const records = content.split('\\n').filter(Boolean).map(line => JSON.parse(line));
        segmento = { name, sha, content, records };
      }
    }
    throw new Error('No se pudo resolver un conflicto al guardar el historial en GitHub.');
  }

  append(registro) {
    const operacion = this.colaEscrituras.then(async () => {
      const actual = this.segmentos[this.segmentos.length - 1];
      const destino = actual && actual.records.length < SEGMENTO_MAX_REGISTROS ? actual : null;
      const guardado = await this._guardarSegmento(destino, registro);
      if (destino) this.segmentos[this.segmentos.length - 1] = guardado;
      else this.segmentos.push(guardado);
      return true;
    });
    this.colaEscrituras = operacion.catch(() => {});
    return operacion;
  }

  async cerrar() {
    await this.colaEscrituras;
  }
}

module.exports = { GitHubHistoryStore };
