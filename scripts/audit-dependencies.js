'use strict';

const { execFileSync } = require('node:child_process');

const HIGH_SEVERITIES = new Set(['high', 'critical']);

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
      result.push(...collectLeafAdvisories(audit, via, seen));
      continue;
    }
    const id = advisoryId(via);
    if (id) result.push(id);
  }
  return [...new Set(result)];
}

function readAudit() {
  try {
    const stdout = execFileSync(
      'npm',
      ['audit', '--omit=dev', '--omit=optional', '--json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return JSON.parse(stdout);
  } catch (error) {
    const stdout =
      typeof error.stdout === 'string'
        ? error.stdout
        : error.stdout?.toString('utf8');
    if (!stdout) throw error;
    return JSON.parse(stdout);
  }
}

function main() {
  const audit = readAudit();
  const blocking = [];

  for (const [name, vulnerability] of Object.entries(audit.vulnerabilities || {})) {
    if (!HIGH_SEVERITIES.has(vulnerability.severity)) continue;
    blocking.push({
      name,
      severity: vulnerability.severity,
      advisories: collectLeafAdvisories(audit, name)
    });
  }

  if (blocking.length > 0) {
    console.error('Se encontraron vulnerabilidades runtime high/critical:');
    for (const item of blocking) {
      console.error(
        '- ' + item.name + ' [' + item.severity + '] → ' +
        (item.advisories.join(', ') || 'sin advisory resoluble')
      );
    }
    process.exit(1);
  }

  console.log(
    'Auditoría de dependencias runtime aprobada sin excepciones high/critical.'
  );
}

main();
