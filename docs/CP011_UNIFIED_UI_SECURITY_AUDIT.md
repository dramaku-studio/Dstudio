# CP-011 — Cross-check and live readiness

**Decision:** Local pilot GO; public live deployment and paid generation NO-GO.

## Verified offline

- All non-PostgreSQL unit/integration tests passed, including a new HTTP one-origin test confirming all 13 sections live under `/`.
- Authentication and CSRF remain required for workspace save, credentials, video requests and fixture workflow operations.
- Workspace input is validated server-side (lengths, role names, shot limits, DNA matching). Invalid data returns 422; model-specific limits are still enforced by the Seedance request compiler.
- Saved drafts are written under the ignored `.local-private/` parent in mode 0600; source ZIP excludes all `.local-private` and `.env` files with real secrets.
- The offline workflow `plan` now consumes last saved project inputs when present. Preview plans do not count as human production approval.
- No live submit endpoint is enabled; non-authorized or unsupported jobs remain blocked.

## Known blockers / gaps

1. **Real PostgreSQL tests unavailable** in this environment; concurrent budget reservations, outbox delivery and worker recovery under failure have not been verified against a real DB.
2. **Provider capability, pricing, OAuth, and media staging unverified.** Seedance keys stored in the local vault are not invoked.
3. **No production RBAC**, audit-signoff service, object-store security, or formal release approval.
4. **Image/voice studio screens are preparatory**. No native paid image/TTS generation is wired. Motion is routed to Video Studio's supported request modes.
5. **Offline render** is a repeatedly encoded fixture; not a genuine AI-generated video or final editorial assembly.
6. **Browser E2E unavailable**: Chromium policy blocked both HTTP loopback and file URL navigation, so browser interaction was not claimed as tested.
7. **Only last saved local project draft** is stored. Full multi-project/multi-tenant database workflow is a future implementation, not implied by this UI integration.

## Remaining production gates

PostgreSQL migrations and transaction integration; persistent queue/lease reconciliation with real provider; cloud object storage; role/tenant auth; audited human approvals; budget dry-run versus invoice reconciliation; media/QA and consent; social OAuth; real browser E2E, security scan, and deployment staging tests.
