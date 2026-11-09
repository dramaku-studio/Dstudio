# CP-003 HTTP Video Bridge Contract (provider-neutral, proposed)

**This is NOT a Google/Veo, Kling, Runway, or other vendor's current API specification.** It is the internal contract for an explicitly owned/trusted bridge that implements adapters for a provider after capability, price, policy and access checks. No bridge credentials or vendor mappings are packaged.

Base URL: single HTTPS origin (`http://127.0.0.1:<port>` permitted only for explicit tests). Bearer token (`Authorization: Bearer ...`) stored server-side. No URL user input can change the host. The bridge must be idempotent by `idempotency-key`, retain key→provider task association and expose safe status lookup/reconciliation for lost POST responses.

1. `POST /v1/video/tasks` with JSON `{ "prompt": "...", "model": "..." }` and stable `idempotency-key`. Accepted: HTTP 2xx, JSON `{ "outcome": "accepted", "task_id": "safe-id" }`. Definitely rejected: HTTP 400 or 422, JSON `{ "definitely_not_accepted": true, "code": "..." }`, *only* if the bridge can prove no chargeable request reached provider. Every other response/timeout is ambiguous; NEVER resubmit automatically.
2. `GET /v1/video/tasks/{safe-id}` returns JSON `{ "state": "queued|processing|succeeded|failed|canceled", "actual_minor": 125 }`. `actual_minor` is mandatory for `succeeded` and must represent a verified provider settlement in the run's pinned minor-unit currency. On failure, billing must be manually reconciled; do not assume zero charge.
3. `GET /v1/video/tasks/{safe-id}/file` returns HTTP 200 `video/mp4` with a streamed MP4. No redirect or arbitrary download URL is accepted. Media must be authenticated and bound to task ID. File size/duration/dimensions and SHA-256 are checked at ingest.

For production, bridge backend must implement: signed idempotency lookup (`GET /by-client-reference/...` for reconciliation), price versioning and receipts, rate limits, upload/asset expiring authorization, provider TOS/consent, tenant isolation, request traces, and forced HTTPS + egress restrictions. Those implementations are **not** included in CP-003.

Example development-only env:
```
PAID_GENERATION_ENABLED=false
PROVIDER_BRIDGE_URL=https://bridge.example.com
PROVIDER_BRIDGE_TOKEN=<provided-separately>
ALLOW_LOCAL_ASSET_STORE=false
MEDIA_PRIVATE_ROOT=/private-media
DATABASE_URL=postgresql://...
```

The current `worker:production` command deliberately refuses to start unless paid-generation flag, credentials and local store dev override are set. **Do not enable in public production**: object store, login, data lineage, and live integration gates are outstanding.
