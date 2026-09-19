'use strict';

const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const htmlFiles = fs
  .readdirSync(publicDir)
  .filter((name) => name.endsWith('.html'));

const errors = [];

for (const fileName of htmlFiles) {
  const filePath = path.join(publicDir, fileName);
  const content = fs.readFileSync(filePath, 'utf8');

  if (/^\s*```/.test(content) || /```\s*$/.test(content)) {
    errors.push(`${fileName}: contiene fences Markdown alrededor del HTML.`);
  }

  const inlineScripts = [
    ...content.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>/gi)
  ];

  if (inlineScripts.length > 0) {
    errors.push(
      `${fileName}: contiene ${inlineScripts.length} bloque(s) <script> inline.`
    );
  }

  const inlineHandlers = [
    ...content.matchAll(/\son[a-z]+\s*=/gi)
  ];

  if (inlineHandlers.length > 0) {
    errors.push(
      `${fileName}: contiene ${inlineHandlers.length} manejador(es) de evento inline.`
    );
  }

  for (const match of content.matchAll(/<(?:script|link)[^>]+(?:src|href)="(\/[^"]+)"[^>]*>/gi)) {
    const assetPath = match[1].split('?')[0];
    if (
      assetPath.startsWith('/js/') ||
      assetPath.startsWith('/css/') ||
      assetPath === '/style.css'
    ) {
      const diskPath = path.join(publicDir, assetPath.replace(/^\//, ''));
      if (!fs.existsSync(diskPath)) {
        errors.push(`${fileName}: referencia un recurso inexistente ${assetPath}.`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error('Auditoría HTML pública falló:');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(
  `Auditoría HTML pública OK: ${htmlFiles.length} archivo(s) revisado(s).`
);
