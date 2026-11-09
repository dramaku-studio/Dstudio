# CP-015 — Generate Actions per Studio

Dramasaku Studio stays a single app and dashboard. This change fixes missing primary Generate buttons.

## User-facing behavior

- Storyboard: **Susun Storyboard** compiles a local shot plan, with no paid API.
- Image: **Hasilkan Gambar** is visible; the status explains the image provider is not connected. It does not create a fake image or spend credits.
- Video: **Hasilkan Video** is visible even when disabled server-side; the action checks the live API gate and returns an actionable message. When activated with a verified Volcengine key, Text-to-Video only and within the one-job daily pilot limit, asks for explicit confirmation before paid dispatch. Can poll an existing job, preview ready MP4 and download it. **AIIDE keys are not interchangeable with Volcengine keys.** No automatic paid retry on ambiguous submit.
- Motion: **Hasilkan Gerakan** navigates to Image-to-Video settings; **motion generation is not live** until references can be securely staged.
- Voice: **Hasilkan Suara** is always visible, but only sends a paid request if provider and TTS key are configured and verified. Preview, download and attach use the existing TTS implementation.
- Film: **Hasilkan Film Contoh** runs the existing trusted offline FFmpeg fixture renderer only after its demo approval/export state. It does **not** create a real final film from generated shots.

## Validation

- Automated Node.js test suite: 124 passed, 0 failed, 2 PostgreSQL tests skipped locally.
- UI action and authenticated image status tests added.
- HTTP tests do not connect to paid providers.
- Browser automation could not navigate to localhost in this environment (`ERR_BLOCKED_BY_ADMINISTRATOR`), so Windows browser E2E remains to be confirmed by the operator.

## Windows runbook

1. Back up `dramasaku-studio` (especially `.local-private`, which may contain credentials).
2. Use the full CP-015 project folder; restore `.local-private` to the same project path without sharing its contents.
3. Run `npm run dev` from PowerShell in the project root.
4. Open `http://127.0.0.1:4184`, sign in, and choose Video / Voice / Image Studio.
5. `Hasilkan Video` checks direct Volcengine readiness; your **AIIDE key alone is not a verified live Seedance connection**.
6. No API key or operator token should be committed to GitHub or sent via chat.

## Still to build before real AI generation in all studios

- Live image provider adapter with budget and account permission gates.
- Authenticated cloud asset staging plus provider capability validation for motion/reference modes.
- Final film assembly from **approved real takes**, not FFmpeg fixture.
- Verification of AIIDE's video task submit / status API contract before routing an AIIDE key.
