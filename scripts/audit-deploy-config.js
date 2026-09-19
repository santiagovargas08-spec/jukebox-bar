'use strict';

const fs = require('node:fs');
const path = require('node:path');

const filePath =
  path.join(__dirname, '..', 'render.yaml');

const content =
  fs.readFileSync(filePath, 'utf8');

const required = [
  'buildCommand: npm ci --include=dev && npm run build',
  'startCommand: npx --no-install prisma migrate deploy && npm start',
  'healthCheckPath: /ready',
  'key: ENABLE_LEGACY_COMMERCIAL_API',
  'value: "false"'
];

const errors = [];

for (const value of required) {
  if (!content.includes(value)) {
    errors.push(
      `render.yaml debe contener: ${value}`
    );
  }
}

if (content.includes('key: ADMIN_API_KEY')) {
  errors.push(
    'render.yaml no debe aprovisionar ADMIN_API_KEY mientras la API legacy esté deshabilitada.'
  );
}

if (!content.includes('key: DATABASE_URL')) {
  errors.push(
    'render.yaml debe configurar DATABASE_URL.'
  );
}

if (!content.includes('key: APP_URL')) {
  errors.push(
    'render.yaml debe declarar APP_URL.'
  );
}

if (errors.length > 0) {
  console.error(
    'Auditoría de despliegue falló:'
  );

  for (const error of errors) {
    console.error(`- ${error}`);
  }

  process.exit(1);
}

console.log(
  'Auditoría de despliegue OK.'
);
