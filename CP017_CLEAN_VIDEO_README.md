# Dramasaku Studio — CP-017 Clean Video UI (rollback of CP-018 interface)

**Scope:** Restore the simple CP-017 video workflow, remove the CP-018 output shelves and AIIDE asset-registration UI, and fix automatic display of video results. **No new studio features.** All other studios remain part of the same application.

## What changed

- One compact Video form on the left and **one MP4 preview on the right**. Clear **Hasilkan Video** button, download button shown only after file is verified.
- Automatic polling of an **existing** AIIDE job while the Video Studio is open; polling calls only the local status endpoint, which issues provider GET requests. **No automatic repeat of a paid generation POST**.
- Preserves CP-017 recovery by **Task ID** inside a small optional section. Existing AIIDE jobs can be imported without making a new generation.
- Corrected AIIDE response handling for `data.result_url`, `data.data.result.video_url`, and documented `download_url`/`metadata` variants. Result domains still require explicit verification via allowlist.
- Fixed `Content-Security-Policy`: adds `media-src 'self'`, needed to play local MP4 and MP3 without allowing third-party media.
- Removed CP-018's additional per-studio result shelves, reference policy panels, and AIIDE asset upload/register workflow from the installed project. No remote data or existing local secrets are deleted by the update.
- For safety, **live AIIDE in this build remains Text-to-Video only**. Other modes are not offered as working paid actions. The exact Seedance payload used by AIIDE must still be verified on the owner's account.

## Install safely on Windows

1. Stop the existing server using `Ctrl + C` in PowerShell.
2. Back up your `dramasaku-studio` directory, **especially `.local-private/`**. Do not paste keys in chat or commit them.
3. Extract the ZIP into a fresh directory, and copy your own existing `.local-private/` folder into the new `dramasaku-studio` folder (do not expose those files).
4. From the actual project folder, run `node -v`, `ffprobe -version`, `npm install --ignore-scripts` (if dependencies absent).
5. To import an **already paid** AIIDE video without generating another task:

```powershell
$env:DRAMASAKU_AIIDE_READ_ONLY = "YES"
npm run dev
```

Open `http://127.0.0.1:4184/#video-studio`. Open **Sudah punya video dari AIIDE?**, select the original AIIDE account, paste its Task ID, choose **Ambil video**. Once download succeeds, the MP4 should appear on the right. If the CDN hostname is blocked, **verify the hostname** and restart the app with `DRAMASAKU_AIIDE_MEDIA_HOSTS=verified.example.com` (exact host only). `Muat ulang` rechecks an existing task using GET; it does not submit a paid request.

6. Only after **personally verifying** the AIIDE model contract and accepting cost, use the separate live opt-in flags:

```powershell
$env:DRAMASAKU_AIIDE_READ_ONLY = "YES"
$env:DRAMASAKU_AIIDE_VIDEO_MODEL_VERIFIED = "YES"
$env:DRAMASAKU_AIIDE_VIDEO_LIVE_TEST = "I_ACCEPT_PROVIDER_CHARGES"
npm run dev
```

**Do not set MODEL_VERIFIED=YES unless the real Seedance request fields and model entitlement are confirmed with AIIDE.** This flag does not perform provider verification; it records operator assertion. One paid submission per UTC day; task status is polled at intervals, no auto paid retry. A billing cost cap is not implemented in this local pilot.

## Testing / known limitations

- Local Node.js tests run using `npm test`; two PostgreSQL integration tests require an actual database.
- A local HTTP smoke test confirms the dashboard can start and the CSP permits same-origin media.
- The screenshot preview supplied alongside this ZIP is a **static rendering**, not proof of logged-in browser E2E. In the current runner, Chromium navigation to localhost returns `ERR_BLOCKED_BY_ADMINISTRATOR`.
- A mock HTTP test confirms API task import -> status -> MP4 verification with **zero paid POST**. **No actual AIIDE API key or paid provider was used here.**
- If provider status returns `AIIDE_POLL_UNAVAILABLE`, verify key privileges, exact Task ID, and supported route. Do not initiate a second generation solely to resolve a polling error.
