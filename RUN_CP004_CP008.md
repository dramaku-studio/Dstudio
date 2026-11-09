# Dramasaku Studio CP004–CP008 · Local Operator Console

## Status
**Runnable local engineering prototype** for story/DNA/DAG, simulated QA and approvals, approved manifest, playable FFmpeg fixture render, and **publishing dry-run only**. Not a production deployment, not a paid AI provider integration, not a substitute for PRD v1.0 or v1.1 signoff.

## Quick start (Node.js >=22 and FFmpeg installed)

1. Unzip, open a terminal in `dramasaku-studio/`.
2. `npm test` (local tests; PostgreSQL integration requires running database).
3. `npm run console:start`
4. Open `http://127.0.0.1:4184` on the SAME computer.
5. Paste the **operator token shown in your terminal** into `Operator Login`. Never share this token.
6. In **API & Credentials**, choose Story/LLM, Image, Video, Voice or Publishing; paste API key; press **Save to Encrypted Vault**.
7. Run the demo actions in sequence to see story → DNA → shots → QA → manifest → MP4 fixture → publishing envelope. The demo uses the **same bundled FFmpeg fixture** for multiple shots and does not call real AI providers or publish posts.

API key storage: `.local-private/credentials.enc.json` is AES-256-GCM encrypted; master key and local operator token are generated once in `.local-private/local-console-operator.json` (permissions 0600; gitignored). These files exist only on your machine. Keep them private and backed up securely; loss of the master key makes stored API keys unreadable. Rotate/revoke keys if local machine is compromised. Do not copy these files to GitHub or attach them here.

**Do not paste real credentials into the standalone HTML preview or this chat.** Only the locally running console performs encrypted storage. Never port-forward the local console, bind it to 0.0.0.0, or expose it to internet. For staging/production, move to organization-scoped auth/RBAC + managed secret store/HSM, HTTPS, audit, and dedicated infrastructure before onboarding paid credentials.

### UI labels / provider contract
Slots are **credential placeholders**, not verified API connectors. There are no current Google/Veo/OpenAI/Runway/Blotato endpoints embedded or claimed. Connecting a provider requires capability validation, entitlement, model/version/pricing snapshot, rate limits, response reconciliation, policy review, and test generation. Merely storing a key never dispatches a request. Service code and database schema need further integration to support multiple providers/accounts per org and secure secret references.

## Technical test status
`npm test` includes domain, vault, request auth/CSRF, HTTP fixture mock and export tests. PostgreSQL tests are SKIPPED unless `DRAMASAKU_INTEGRATION_TEST=1` and `DATABASE_URL` point to a test database with migrations 001–003 applied. Do not run integration tests against production DB.

## Limits / cross-check blockers
- Mock screenplay parser handles simple scene headings and character dialogue; not professional screenplay interchange / screenplay-aware multilingual parser.
- QA measures deterministic fixture metadata; identity/dialogue/creative QA not verified by a real model. **DIALOGUE_UNVERIFIED** triggers human-exception path in mock. Never approve automatically in production.
- UI login is single local operator with in-memory session, not multi-tenant RBAC, and cannot go public.
- Encrypted local file vault is NOT a managed production secret store.
- R4 DAG domain and schema are not yet tied into real transactionally persisted run execution, job leases, queue and paid provider.
- FFmpeg assembles repeated local fixture only; no film editing timeline, asset-based scene cuts, real voice/audio mix.
- R6 produces a dry-run publish envelope only. No OAuth, account verification, posting, metrics or retry/reconciliation.
- No real PostgreSQL migration execution, 2-worker race, S3 durability, stress test or security penetration test has been completed.

## Deployment gate
**NO-GO for public/paid live** until all items in `docs/CP004_CP008_SECURITY_AUDIT.md` are cleared with evidence. GitHub upload and paid API tests require owner's explicit confirmation.
