# Local runbook — Dramasaku CP-013

Requirements: Node.js 22+, a local computer, local port 4184 available.
1. Extract the single unified ZIP. Open a terminal in `dramasaku-studio`.
2. Run `npm test` and inspect failures.
3. Run `npm run dev`.
4. Open `http://127.0.0.1:4184`. Sign in using the operator token shown ONLY in your terminal.
5. In Kunci API / API & Credentials, configure the Volcengine LAS key (never in chat, GitHub, or a screenshot).
6. Create a text-to-video draft and check model, duration, aspect ratio, and estimated cost with provider documentation.
7. Do not enable the paid pilot until the account model entitlement and exact API contract have been confirmed independently.

For an explicitly approved ONE-REQUEST paid test ONLY, and ONLY once provider capability verification has been established, the local operator may start the console with BOTH environment settings:
`DRAMASAKU_LIVE_TEST=I_ACCEPT_PROVIDER_CHARGES`
`DRAMASAKU_PROVIDER_CAPABILITY_VERIFIED=YES`
Then click “Uji Video Asli (Berbayar)” and confirm the browser dialog. A locally tracked maximum of 1 submission per UTC day applies. It is NOT a monetary ceiling or a real-time provider quota.

The machine stores task status before posting. An ambiguous provider response becomes `submission_unknown` and MUST NOT be retried automatically. Reconcile with the provider portal manually. Poll only a confirmed provider task ID. A download is only accepted from a restricted HTTPS media domain list and is verified and stored locally.

Do NOT use localhost tunnels, port forwarding, reverse proxies, remote desktop access for untrusted clients, or expose this local console to the internet. The current operator token/session model is SINGLE-USER development only.

Stop with Ctrl+C. Runtime keys are in `.local-private/` (ignored by Git). Do not archive or share that folder.
