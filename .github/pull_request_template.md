## Summary

Describe the change and why it is needed.

## Risk

- [ ] No database/schema change
- [ ] Database/schema change reviewed
- [ ] Authentication/authorization change
- [ ] Tenant-isolation change
- [ ] Payment/license change
- [ ] Socket.IO behavior change
- [ ] Frontend-only change

## Validation

- [ ] `npm run check`
- [ ] `npm test`
- [ ] Prisma migration tested on disposable PostgreSQL if applicable
- [ ] Manual smoke test completed for affected flow
- [ ] No secrets or production identifiers added

## Security

- [ ] Authorization is enforced server-side
- [ ] User-controlled output uses safe DOM/text handling
- [ ] Sensitive responses are not cached
- [ ] Logs do not contain passwords, tokens, cookies or secrets
- [ ] Multi-tenant queries remain scoped by `barId`

## Deployment notes

List new environment variables, migration requirements, rollback constraints, or state changes. Write "None" when not applicable.
