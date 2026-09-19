# Jukebox Bar

Plataforma multi-tenant para bares: cola de canciones, búsqueda YouTube, reproducción en tiempo real, operadores, licencias y pagos.

## Arquitectura

```text
CLIENT (Vanilla JS / HTML / CSS)
        ↓
     Socket.IO
        ↓
      Express
        ↓
     Services
        ↓
      Prisma
        ↓
   PostgreSQL
```

```text
BAR
├── LICENSE
├── USERS
├── QUEUE
├── HISTORY
├── PLAYBACK
└── PAYMENTS
```

## Requisitos

- Node.js 20.x (Render: `nodeVersion: 20`)
- PostgreSQL 14+

## Instalación

```bash
npm install
cp .env.example .env
# Edita .env con tus valores
```

## Variables de entorno

Ver `.env.example`:

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | Conexión PostgreSQL |
| `DATABASE_SSL` | `true` en Render/producción |
| `ENABLE_LEGACY_COMMERCIAL_API` | Habilita la API legacy; `false` por defecto |
| `ADMIN_API_KEY` | Clave de la API legacy cuando está habilitada |
| `OPERATOR_TOKEN_SECRET` | Secreto HMAC tokens operador (≥32 chars) |
| `MASTER_ADMIN_TOKEN_SECRET` | Secreto independiente del SUPER_ADMIN (≥32 chars) |
| `APP_URL` | Uno o más orígenes HTTP(S), separados por coma; el primero genera QR/enlaces |
| `PORT` | Puerto HTTP (Render lo asigna) |
| `TEST_DATABASE_URL` | Base de datos separada para tests |

## Prisma

```bash
npx prisma generate
npx prisma migrate dev    # desarrollo
npx prisma migrate deploy # producción
npx prisma validate
```

**No uses `prisma db push` en producción.** Las migraciones viven en `prisma/migrations/`.

### Base de datos existente (creada con `db push`)

Si la base ya tiene tablas y `migrate deploy` devuelve P3005:

```bash
npx prisma db execute --file prisma/migrations/20250817180100_existing_db_upgrade/migration.sql
npx prisma migrate resolve --applied 20250817180000_initial
npx prisma migrate resolve --applied 20250817180100_existing_db_upgrade
```

En bases nuevas, `npx prisma migrate deploy` aplica ambas migraciones en orden.

## Desarrollo

```bash
npm run dev
```

## Comprobaciones locales

```bash
npm run check
```

Este comando valida sintaxis de los módulos críticos y audita el HTML público para impedir scripts/eventos inline y recursos locales inexistentes.

## Producción

```bash
npm run build
npx prisma migrate deploy
npm start
```

## Tests

Configura `TEST_DATABASE_URL` apuntando a una base **distinta** de producción (ej. `jukebox_test`):

```bash
# Crear base de test (opcional, si no existe)
node scripts/ensure-test-db.js

# Aplicar migraciones en la base de test
node --env-file=.env.test npx prisma migrate deploy

# Ejecutar tests (requiere TEST_DATABASE_URL en el entorno)
export TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/jukebox_test
npm test
```

Sin `TEST_DATABASE_URL`, `npm test` falla inmediatamente y **no** usa `DATABASE_URL`.

```bash
npm run test:db
```

## Render

| Configuración | Valor |
|---------------|-------|
| Node | 20 |
| Build | `npm ci && npm run build` |
| Start | `npx prisma migrate deploy && npm start` |
| Health check | `/ready` (incluye PostgreSQL) |
| Database | PostgreSQL (plan pagado recomendado para comercialización) |

Variables en Render: `DATABASE_URL`, `OPERATOR_TOKEN_SECRET`, `MASTER_ADMIN_TOKEN_SECRET`, `APP_URL`, `PORT`, `DATABASE_SSL=true`. La API `/api/commercial` permanece deshabilitada salvo que `ENABLE_LEGACY_COMMERCIAL_API=true`.

## Endpoints principales

- `GET /health` — liveness check
- `GET /ready` — readiness check con PostgreSQL
- `GET /api/public/bars/:slug` — info pública del bar
- `POST /api/public/bars/:slug/operator/login` — login operador
- `POST /api/public/bars/:slug/operator/logout` — revoca tokens del operador autenticado
- `/api/commercial/*` — API administrativa legacy, deshabilitada por defecto

## Cola y ordenamiento

La cola usa `QueueItem.position` como orden explícito por bar. `createdAt` conserva únicamente el momento real de creación y **no se modifica al reordenar**. Las operaciones críticas usan bloqueo transaccional por bar para evitar carreras entre altas, reproducción y reordenamiento.

## Sesiones administrativas

- Operadores y SUPER_ADMIN usan cookies `HttpOnly`, `SameSite=Strict` y `Secure` en producción.
- Las respuestas de autenticación no se cachean.
- Las acciones sensibles verifican origen y Fetch Metadata.
- Los tokens siguen siendo revocables mediante `tokenVersion`.

## Socket.IO (eventos)

- `seleccionar_bar`, `solicitar_estado`, `buscar_canciones`, `agregar_cancion`
- `siguiente_cancion`, `admin_saltar`, `admin_eliminar_cancion`, `reordenar_cola`
- `cancion_terminada`

Los operadores autenticados quedan vinculados a `token.barId`; no pueden acceder a otro tenant.

## Producción comercial

### Escalado horizontal

Actualmente el rate limiting y la caché de búsquedas viven en memoria del proceso. Esto es correcto para **una sola instancia** del servicio. Antes de ejecutar varias instancias en paralelo, mueve estos estados a un almacén compartido como Redis y configura un adaptador compartido para Socket.IO.

Para comercializar el servicio:

- Usa PostgreSQL con backups y almacenamiento adecuado (no el tier free).
- Configura monitoreo y alertas.
- Rota `OPERATOR_TOKEN_SECRET`, `MASTER_ADMIN_TOKEN_SECRET` y cualquier `ADMIN_API_KEY` legacy si pudieron exponerse.
- Define `APP_URL` con la URL real del despliegue.

## Módulos

El proyecto usa **CommonJS** (`require`/`module.exports`). Prisma Client se genera en `node_modules/@prisma/client` vía `prisma generate`.
