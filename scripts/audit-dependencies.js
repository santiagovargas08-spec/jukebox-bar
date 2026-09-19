'use strict';

const { execFileSync } = require('node:child_process');

const HIGH_SEVERITIES = new Set(['high', 'critical']);

// Excepción temporal y documentada:
// yt-search 2.x incluye node-fzf/redstar para su CLI. El servidor usa únicamente
// la API programática de búsqueda y no invoca esa CLI. Estas tres alertas de
// minimatch quedan permitidas de forma temporal mientras se reemplaza/actualiza
// la dependencia de búsqueda.
const ALLOWED_ADVISORIES = new Set([
  'GHSA-3ppc-4f35-3m26',
  'GHSA-7r86-cg39-jmmj',
  'GHSA-23c5-xmqv-rm74'
]);

const ALLOWED_CHAIN = new Set([
  'minimatch',
  'redstar',
  'node-fzf',
  'yt-search'
]);

const ALLOWLIST_EXPIRES_AT = Date.parse('2026-10-31T23:59:59Z');

function advisoryId(via) {
  if (!via || typeof via !== 'object') return null;

  const url = String(via.url || '');
  const match = url.match(/GHSA-[a-z0-9-]+/i);

  return match ? match[0].toUpperCase() : null;
}

function collectLeafAdvisories(audit, packageName, seen = new Set()) {
  if (seen.has(packageName)) return [];

  seen.add(packageName);

  const vulnerability = audit.vulnerabilities?.[packageName];
  if (!vulnerability) return [];

  const result = [];

  for (const via of vulnerability.via || []) {
    if (typeof via === 'string') {
      result.push(
        ...collectLeafAdvisories(audit, via, seen)
      );
      continue;
    }

    const id = advisoryId(via);
    if (id) result.push(id);
  }

  return [...new Set(result)];
}

function isTemporarilyAllowed(audit, packageName) {
  if (!ALLOWED_CHAIN.has(packageName)) return false;

  if (Date.now() > ALLOWLIST_EXPIRES_AT) {
    return false;
  }

  const advisories =
    collectLeafAdvisories(audit, packageName);

  return (
    advisories.length > 0 &&
    advisories.every((id) =>
      ALLOWED_ADVISORIES.has(id)
    )
  );
}

function readAudit() {
  try {
    const stdout = execFileSync(
      'npm',
      [
        'audit',
        '--omit=dev',
        '--omit=optional',
        '--json'
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    return JSON.parse(stdout);
  } catch (error) {
    const stdout =
      typeof error.stdout === 'string'
        ? error.stdout
        : error.stdout?.toString('utf8');

    if (!stdout) {
      throw error;
    }

    return JSON.parse(stdout);
  }
}

function main() {
  const audit = readAudit();
  const blocking = [];
  const allowed = [];

  for (const [name, vulnerability] of Object.entries(
    audit.vulnerabilities || {}
  )) {
    if (!HIGH_SEVERITIES.has(vulnerability.severity)) {
      continue;
    }

    if (isTemporarilyAllowed(audit, name)) {
      allowed.push({
        name,
        severity: vulnerability.severity,
        advisories: collectLeafAdvisories(
          audit,
          name
        )
      });
      continue;
    }

    blocking.push({
      name,
      severity: vulnerability.severity,
      advisories: collectLeafAdvisories(
        audit,
        name
      )
    });
  }

  if (allowed.length > 0) {
    console.warn(
      'Dependencias con excepción temporal conocida:'
    );

    for (const item of allowed) {
      console.warn(
        `- ${item.name} [${item.severity}] → ${item.advisories.join(', ')}`
      );
    }

    console.warn(
      'La excepción vence el 2026-10-31 y debe revisarse antes de esa fecha.'
    );
  }

  if (blocking.length > 0) {
    console.error(
      'Se encontraron vulnerabilidades high/critical no permitidas:'
    );

    for (const item of blocking) {
      console.error(
        `- ${item.name} [${item.severity}] → ${item.advisories.join(', ') || 'sin advisory resoluble'}`
      );
    }

    process.exit(1);
  }

  console.log(
    'Auditoría de dependencias runtime aprobada.'
  );
}

main();
