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

  const inlineStyles = [
    ...content.matchAll(/\sstyle\s*=/gi)
  ];

  if (inlineStyles.length > 0) {
    errors.push(
      `${fileName}: contiene ${inlineStyles.length} atributo(s) style inline.`
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

const jsDir = path.join(publicDir, 'js');
const zeroInnerHtmlFiles = new Set([
  'bar-loader.js',
  'bar.js'
]);

for (const fileName of fs.readdirSync(jsDir)) {
  if (!fileName.endsWith('.js')) continue;

  const filePath = path.join(jsDir, fileName);
  const content = fs.readFileSync(filePath, 'utf8');

  const markupStyleAttributes = [
    ...content.matchAll(/\bstyle\s*=/gi)
  ];

  if (markupStyleAttributes.length > 0) {
    errors.push(
      `js/${fileName}: genera ${markupStyleAttributes.length} atributo(s) style inline.`
    );
  }

  if (
    zeroInnerHtmlFiles.has(fileName) &&
    /\.innerHTML\b/.test(content)
  ) {
    errors.push(
      `js/${fileName}: no debe volver a usar innerHTML; usa APIs DOM seguras.`
    );
  }

  const nativeDialogs = [
    ...content.matchAll(/(?:^|[^.\w])(alert|confirm|prompt)\s*\(/gm)
  ];

  if (nativeDialogs.length > 0) {
    errors.push(
      `js/${fileName}: usa ${nativeDialogs.length} diálogo(s) nativo(s) alert/confirm/prompt.`
    );
  }
}

if (errors.length > 0) {
  console.error('Auditoría HTML pública falló:');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(
  `Auditoría pública OK: ${htmlFiles.length} HTML y scripts de primer nivel revisados.`
);
