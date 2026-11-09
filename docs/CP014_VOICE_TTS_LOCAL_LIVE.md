# CP-014 — Video Live Verification + Voice TTS Studio

Date: 2026-11-05. Local single-operator pilot. **NOT production-ready.**

## New functionality

- One Voice Studio section in existing Dramasaku UI (not a separate dashboard).
- Indonesian/English UI, text, voice, speed, language, draft and request validation.
- Dedicated encrypted TTS keys: `voice` for direct OpenAI Speech, `voice_aiide` for AIIDE (unverified). Never use the Video AIIDE pool key implicitly for TTS.
- Backend endpoints: `GET /api/tts/status`, `POST /api/tts/preview`, `POST /api/tts/draft`, `POST /api/tts/generate`, `GET /api/tts/jobs/:id/audio`, `POST /api/tts/jobs/:id/attach`. Authenticated routes; POST requires same-origin + CSRF.
- MP3-only bounded response (12 MiB), media signature check, SHA-256 verification at read, private file storage, no token exposure in returned responses.
- Generated MP3 can be added to the local Video Studio reference library; this does **not** automatically mix audio into rendered video and is **not** a live Seedance audio-reference submission.
- `submission_unknown` persists before the paid POST. No automatic paid retries, even after network errors; manual reconciliation with the provider is required.

## Provider confirmation

OpenAI Speech supports `POST https://api.openai.com/v1/audio/speech` with model `gpt-4o-mini-tts`, voice and text. OpenAI documents this model as deprecated with shutdown January 6, 2027, so the adapter is a short-term integration and must be migrated before that date.

**AIIDE TTS is not verified.** AIIDE publicly documents an OpenAI-compatible gateway for chat, but its audio-speech compatibility and model availability were not independently verified. The AIIDE TTS dispatch gate is **OFF** unless explicitly enabled following successful provider capability validation. A video-pool AIIDE key in the dashboard is not a TTS key.

**AIIDE Video is not integrated** to the existing Local Live Engine; that engine still uses the dedicated Volcengine LAS credential. Until AIIDE supplies a confirmed video create/status/asset contract, sending paid AIIDE video jobs must stay blocked.

## Local use (PowerShell)

From the `dramasaku-studio` directory: `npm run dev`, then sign in at `http://127.0.0.1:4184`.

Open **Studio Suara**, select provider, paste the provider-specific key in the voice section (never share it in chat), enter text, and use **Periksa Naskah** / **Simpan Draf Suara**. These actions are free local operations.

Only after provider capability and budget are confirmed, a single paid OpenAI Speech test can be enabled in that PowerShell session:

```powershell
$env:DRAMASAKU_TTS_LIVE_TEST = 'I_ACCEPT_PROVIDER_CHARGES'
$env:DRAMASAKU_TTS_CAPABILITY_VERIFIED = 'YES'
npm run dev
```

The dashboard still requires an explicit paid confirmation. Local quota: 1 TTS request per UTC day (not actual provider balance). Request execution uses the stored key only server-side. Cost is not shown or guaranteed by Dramasaku.

For AIIDE voice, do **not** enable `DRAMASAKU_AIIDE_TTS_CAPABILITY_VERIFIED` until its precise TTS endpoint, accepted model/voice, response MIME, price and permissions are confirmed.

## Test results and release status

`npm test`: see attached test report. API and mock transport only; **no actual paid provider calls**. Windows and browser E2E of this new section remain to be tested via GitHub CI or operator laptop. PostgreSQL and provider cost tests remain required before production.

## References

- https://developers.openai.com/api/docs/guides/text-to-speech
- https://aiide.com/en
- https://docs.byteplus.com/en/docs/byteplus_las/video_gen_enhanced
