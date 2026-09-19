# Security Policy

## Supported branch

Security fixes for the commercial version are prepared on `hardening-comercializacion` and merged into `comercializacion` only after CI passes.

## Reporting a vulnerability

Do not publish credentials, tokens, private customer data or exploit details in a public issue.

If you discover a vulnerability:

1. Record the affected route, component and reproduction steps.
2. Remove secrets, personal data and production identifiers from the report.
3. Contact the repository owner privately through the configured GitHub account or another agreed private channel.
4. Do not test destructive actions against production data.
5. Wait for confirmation before publishing technical details.

## Secret handling

Never commit:

- `DATABASE_URL`;
- `OPERATOR_TOKEN_SECRET`;
- `MASTER_ADMIN_TOKEN_SECRET`;
- `ADMIN_API_KEY`;
- payment-provider secrets;
- private keys or production session tokens.

Production secrets belong in the deployment platform environment, not in source control.

If a secret may have been exposed, rotate it immediately. Rotating an operator or Master Admin signing secret invalidates existing sessions and should be planned accordingly.

## Production security baseline

Before deployment:

- `NODE_ENV=production`;
- `APP_URL` must use HTTPS;
- operator and Master Admin signing secrets must be distinct and at least 32 characters;
- `ENABLE_LEGACY_COMMERCIAL_API=false` unless a documented legacy integration requires it;
- `ENABLE_BEARER_ADMIN_AUTH=false` unless explicitly required;
- PostgreSQL migrations must be applied with `prisma migrate deploy`;
- `npm run check` and the complete test suite must pass;
- Render readiness must point to `/ready`.

## Dependency exceptions

Runtime dependency exceptions must be narrow, documented and time-bounded. The current temporary exception around the `yt-search` dependency chain is tracked separately and must not be generalized to unrelated advisories.

## Multi-instance deployments

The current in-memory rate limiters and caches are designed for a single application instance. Do not scale horizontally until the shared-state work tracked in the repository is completed.

## Audit data

Administrative mutations are recorded in `AdminAuditLog`. Audit metadata must never include passwords, raw tokens, cookies or signing secrets. Retention should follow the configured maintenance policy.
