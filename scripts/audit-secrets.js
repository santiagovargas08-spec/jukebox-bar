'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const files = execFileSync(
  'git',
  ['ls-files'],
  { encoding: 'utf8' }
)
  .split('\n')
  .map((value) => value.trim())
  .filter(Boolean);

const ignoredPrefixes = [
  'tests/',
  '.github/workflows/'
];

const ignoredFiles = new Set([
  '.env.example',
  'package-lock.json'
]);

const patterns = [
  {
    name: 'Private key',
    regex:
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
  },
  {
    name: 'GitHub token',
    regex:
      /\bgh[pousr]_[A-Za-z0-9]{30,}\b/
  },
  {
    name: 'Google API key',
    regex:
      /\bAIza[0-9A-Za-z_-]{35}\b/
  },
  {
    name: 'AWS access key',
    regex:
      /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/
  },
  {
    name: 'Stripe live secret',
    regex:
      /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/
  },
  {
    name: 'Slack token',
    regex:
      /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/
  },
  {
    name: 'Generic JWT',
    regex:
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/
  }
];

function isIgnored(file) {
  return (
    ignoredFiles.has(file) ||
    ignoredPrefixes.some((prefix) =>
      file.startsWith(prefix)
    )
  );
}

function looksBinary(buffer) {
  const sample =
    buffer.subarray(
      0,
      Math.min(buffer.length, 8000)
    );

  return sample.includes(0);
}

const findings = [];

for (const file of files) {
  if (isIgnored(file)) continue;

  let buffer;

  try {
    buffer = fs.readFileSync(file);
  } catch {
    continue;
  }

  if (looksBinary(buffer)) continue;

  const text = buffer.toString('utf8');

  for (const pattern of patterns) {
    if (pattern.regex.test(text)) {
      findings.push({
        file,
        type: pattern.name
      });
    }
  }

  for (const name of [
    'OPERATOR_TOKEN_SECRET',
    'MASTER_ADMIN_TOKEN_SECRET',
    'ADMIN_API_KEY'
  ]) {
    const regex = new RegExp(
      `^${name}\\s*=\\s*(.+)$`,
      'mi'
    );

    const match = text.match(regex);

    if (
      match &&
      match[1].trim() &&
      !/process\.env|example|placeholder/i.test(
        match[1]
      )
    ) {
      findings.push({
        file,
        type:
          `Hard-coded ${name}`
      });
    }
  }
}

if (findings.length > 0) {
  console.error(
    'Posibles secretos encontrados en archivos versionados:'
  );

  for (const finding of findings) {
    console.error(
      `- ${finding.file}: ${finding.type}`
    );
  }

  process.exit(1);
}

console.log(
  `Auditoría de secretos OK: ${files.length} archivo(s) rastreados.`
);
