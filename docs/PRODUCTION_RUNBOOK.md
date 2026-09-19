# Production Runbook

This runbook covers the single-instance commercial deployment currently supported by the project.

## Pre-deploy checklist

Run locally or in CI:

```bash
npm ci
npm run check
npm test
```

Verify:

- `APP_URL` is the final HTTPS origin;
- `DATABASE_URL` points to the intended PostgreSQL database;
- operator and Master Admin secrets are configured and distinct;
- `ENABLE_LEGACY_COMMERCIAL_API=false` unless explicitly required;
- `ENABLE_BEARER_ADMIN_AUTH=false` unless explicitly required;
- migrations in `prisma/migrations/` have been reviewed;
- no production secrets are committed.

## Deployment

Render is expected to:

1. install locked dependencies;
2. generate Prisma client;
3. run `prisma migrate deploy`;
4. start the Node.js process;
5. use `/ready` as the readiness check.

After deploy, verify:

```text
GET /health -> 200
GET /ready  -> 200 and database=ready
```

Open the four interfaces:

- client;
- bar display;
- bar admin;
- Master Admin.

Run a non-destructive smoke flow with a test bar:

1. login as operator;
2. search a song;
3. add it to the queue;
4. verify queue synchronization;
5. remove it;
6. logout.

## Database changes

Use migrations only:

```bash
npx prisma validate
npx prisma migrate deploy
```

Do not use `prisma db push` in production.

Before a migration that changes or deletes existing data:

- take a database backup;
- review the SQL migration;
- estimate lock duration on production-sized tables;
- define a rollback or forward-fix procedure.

## Rollback

Application rollback and database rollback are different operations.

For an application-only regression with no incompatible schema change:

1. redeploy the previous known-good commit;
2. verify `/ready`;
3. test operator login and queue synchronization.

For a migration-related incident:

- do not blindly reverse SQL in production;
- restore from a verified backup when data integrity is at risk;
- otherwise deploy a reviewed forward-fix migration.

## Incident response

For an authentication or secret exposure incident:

1. disable affected administrative access if needed;
2. rotate the exposed secret;
3. revoke affected sessions;
4. review `AdminAuditLog`;
5. inspect request IDs and structured logs;
6. document scope, timestamps and affected tenants.

For queue or playback inconsistencies:

1. identify the affected `barId`;
2. inspect queue and playback state in PostgreSQL;
3. avoid manual timestamp edits;
4. use the explicit queue `position` field when correcting order;
5. preserve audit evidence before destructive repair.

## Database outage

If PostgreSQL is unavailable:

- `/health` may remain alive;
- `/ready` should return 503;
- Render should stop routing traffic to an unready instance;
- avoid repeatedly restarting the service without checking the database first.

After recovery:

1. verify `/ready`;
2. inspect application logs for connection errors;
3. verify queue and playback state for active bars.

## Audit retention

Preview cleanup first:

```bash
AUDIT_RETENTION_DAYS=180 npm run maintenance:audit:plan
```

Apply only after reviewing the reported row count:

```bash
AUDIT_RETENTION_DAYS=180 npm run maintenance:audit:apply
```

## Scaling boundary

The current deployment model is single-instance. Before multiple Node.js instances are enabled, complete the Redis/shared-state work tracked in the repository and validate Socket.IO behavior across instances.
