# CP-016 — AIIDE Video Generator integration (local pilot)

**Status: local contract tests pass; Seedance AIIDE paid production request is NOT verified.**

## Official AIIDE documentation used

- Video task creation: https://aiide.apifox.cn/464722031e0 and https://aiide.apifox.cn/464722028e0 — documented `POST https://www.aiide.com/v1/videos` (examples for Sora/Veo models).
- Task polling: https://aiide.apifox.cn/464722033e0 — documented `GET https://www.aiide.com/v1/video/generations/{task_id}`; response status can be `SUBMITTED`, `IN_PROGRESS`, `SUCCESS`, etc.; a video URL may be nested in `data.data.video_url`.
- AIIDE Seedance asset model catalog: https://aiide.apifox.cn/english/9241613m0 — documents doubao/dreamina Seedance 2.0/2.5 IDs and asset capabilities. **This does NOT document a Seedance-specific `POST /v1/videos` JSON payload.**

**Compatibility warning:** The adapter uses the documented generic `POST /v1/videos` body with `model`, `prompt`, `seconds`, `video_config.aspect_ratio` and `video_config.resolution_name`; the example in AIIDE docs is for Sora. Whether the same JSON fields accept `doubao-seedance-2-0-fast-260128` or `doubao-seedance-2-5-260628` is unverified. Never present this as confirmed Seedance integration without an account-scoped successful request or exact documented example.

## What was implemented

- Video Generate > **Penyedia Video**: AIIDE / Volcengine direct.
- Reads existing encrypted Multi-Key Manager entry with `group=video`, `provider=aiide`; does not expose the plaintext credential to browser or GitHub.
- AIIDE API adapter for video creation, task polling and controlled result URL extraction.
- Durable one-per-UTC-day local paid-job ledger; explicit operator opt-in and consent, no automatic paid POST retry.
- Polling uses the exact key ID that submitted the original task.
- HTTPS MP4 ingest with exact host allowlist, redirect disabled, download size limit, FFprobe validation and SHA-256 media storage.
- Authenticated preview/download endpoints under `/api/aiide-video/jobs/{id}/media`.
- Mock HTTP end-to-end tests verify key routing, submit, poll, MP4 ingest and authenticated download.

## Before turning on the paid pilot

1. Confirm with AIIDE docs/account support that `doubao-seedance-2-0-fast-260128` is accessible to your account via `POST /v1/videos` and accepts the exact `seconds` + `video_config` JSON fields; check `GET /v1/video/generations/{task_id}` status and response.
2. Check exact cost and quota for **4 seconds, 480p**, and make sure you consent to paying for one test. Local limit is **count-based, not an actual money cap**.
3. Ensure your existing AIIDE key is enabled in `Pengaturan Kunci API > Video > AIIDE`.
4. Back up `.local-private` securely, without uploading its contents to cloud repositories.

Once the previous steps are truly verified, start from PowerShell (inside `dramasaku-studio`):

```powershell
$env:DRAMASAKU_AIIDE_VIDEO_MODEL_VERIFIED = 'YES'
$env:DRAMASAKU_AIIDE_VIDEO_LIVE_TEST = 'I_ACCEPT_PROVIDER_CHARGES'
npm run dev
```

Open `http://127.0.0.1:4184` > **Buat Video AI** > Provider **AIIDE**, choose Text-to-Video / Seedance 2.0 Fast / 4 sec / 480p / 9:16, write prompt, click **Hasilkan Video** and explicitly consent. One billable submission at most per UTC day. After task is submitted, use **Periksa Hasil** on the *same task*. **Do not resubmit if the status is uncertain.**

If the result succeeds but cannot download, its exact CDN hostname is shown as `resultHost`. Only after independently verifying that this hostname belongs to the legitimate AIIDE result provider, stop the server and add it to the exact-host allowlist:

```powershell
$env:DRAMASAKU_AIIDE_MEDIA_HOSTS = 'trusted-video-cdn.example.com' # REPLACE with verified resultHost
npm run dev
```

Then **Periksa Hasil** on the same task to safely retry status GET + media GET, not billable POST. Downloads from unapproved hosts remain blocked. Never set the value to localhost, an IP address, or unknown domains.

## Blockers / security

- **Paid API video with the owner's real AIIDE key has NOT been executed in this environment.** The credential is stored on the user's local PC.
- Seedance-specific AIIDE request mapping and account entitlement are not confirmed. A validation flag is an operator declaration, not automated provider verification.
- Image-to-video, multimodal reference uploads, automatic scheduling and production budgets are out of scope for this local pilot.
- Browser automation could not access localhost from this sandbox; use dashboard manual smoke test on Windows.
- CI/local test mocks cannot establish actual AIIDE availability or pricing.
- The worker has no transactional shared database; local pilot only. Do not bind the console publicly.
