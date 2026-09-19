# Commercial Release Checklist

Use this checklist before merging a release candidate into `comercializacion`.

## Automated gates

- [ ] GitHub Actions is green on the exact commit being released.
- [ ] `npm run check` passes.
- [ ] Full `npm test` passes against a disposable PostgreSQL database.
- [ ] `npx prisma validate` passes.
- [ ] `npx prisma migrate deploy` succeeds on a staging database.
- [ ] Runtime dependency audit has no unapproved high/critical findings.
- [ ] Repository secret audit passes.

## Configuration

- [ ] `NODE_ENV=production`.
- [ ] `APP_URL` is the final HTTPS origin.
- [ ] `DATABASE_URL` targets the intended production database.
- [ ] `OPERATOR_TOKEN_SECRET` and `MASTER_ADMIN_TOKEN_SECRET` are distinct.
- [ ] `ENABLE_LEGACY_COMMERCIAL_API=false` unless explicitly required.
- [ ] `ENABLE_BEARER_ADMIN_AUTH=false` unless explicitly required.
- [ ] Render health check is `/ready`.

## Database and data safety

- [ ] Production backup exists and restore procedure has been verified.
- [ ] New migrations were reviewed manually.
- [ ] No migration uses destructive SQL without an explicit recovery plan.
- [ ] Audit-log retention settings are documented.
- [ ] Payment/idempotency behavior was tested if license code changed.

## Tenant isolation

With two disposable bars:

- [ ] operator A cannot read or control bar B;
- [ ] operator B cannot read or control bar A;
- [ ] queue operations remain isolated by `barId`;
- [ ] playback state remains isolated by `barId`;
- [ ] administrative Socket.IO actions require an authorized operator.

## Manual smoke test

- [ ] Client page loads from a QR URL.
- [ ] Song search returns results.
- [ ] Client can add one song.
- [ ] Bar display receives the queue update.
- [ ] Operator can reorder/remove/skip.
- [ ] Playback state survives reconnect.
- [ ] Operator logout revokes the session.
- [ ] Master Admin login works.
- [ ] License activation with the same idempotency key does not duplicate payment/extension.
- [ ] Audit events appear for administrative mutations.

## Security review

- [ ] No credentials or tokens are visible in browser storage.
- [ ] Cookies are `HttpOnly`, `Secure` in production and `SameSite=Strict`.
- [ ] CSP is present on public HTML.
- [ ] Admin/bar pages send `X-Robots-Tag: noindex`.
- [ ] Sensitive API responses use `Cache-Control: no-store`.
- [ ] Rate limits behave correctly for login, search, requests and operator actions.
- [ ] `SECURITY.md` and open security issues were reviewed.

## Operational verification

- [ ] `GET /health` returns 200.
- [ ] `GET /ready` returns 200 with PostgreSQL healthy.
- [ ] Structured request logs contain `requestId`.
- [ ] Sensitive log fields are redacted.
- [ ] Alerting/monitoring destination is known.
- [ ] On-call/incident owner is known for the release window.

## Known boundaries

Before approving multiple application instances:

- [ ] rate limits use shared storage;
- [ ] search/QR caches are appropriate for multi-instance deployment;
- [ ] Socket.IO uses a shared adapter such as Redis;
- [ ] multi-instance tenant-isolation tests pass.

The current documented architecture supports a single application instance until those items are completed.
