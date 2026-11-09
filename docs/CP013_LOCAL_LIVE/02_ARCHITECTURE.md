# Architecture and data flow

Unified operator UI -> Local console (127.0.0.1 only; session + CSRF) -> Video planner -> Local Pilot Gate -> Volcengine LAS Adapter -> Async task monitor -> Restricted media downloader -> Local MP4 storage.

The Creative LLM/Image key pool and Video key pool are separate; the paid Seedance pilot currently reads only the dedicated `volcengine_las` vault slot. A saved multi-key pool does NOT authorize or issue paid requests.

States: new -> submission_unknown (persisted before POST) -> submitted -> queued/running -> download_pending -> ready. If the provider POST result is ambiguous, operator reconciliation is mandatory. Failure and cancellation states are terminal for local demonstration.

Security controls: loopback-only binding, Origin/Host checks, HttpOnly SameSite cookie, CSRF on mutations, encrypted credentials at rest with local master key, request body caps, typed model validation, model capability gate, local daily submission maximum, no automatic POST retry, media host allowlist, no HTTP redirects on fetch, media validation/checksum, and no secret exposure in frontend APIs.

Gaps: payment budget cap backed by real usage, distributed reservations, external provider token/pricing verification, PostgreSQL concurrency tests, multi-user RBAC, KMS, production logging/observability, and operational alerts.
