# CP-011 — Single Dramasaku Studio UI (CP-001 → CP-010)

Date: 2026-11-05. Based on the user-approved CP-010 snapshot, not an unapproved redesign of video controls.

## What changed

- **One canonical dashboard:** `apps/control-server/ui.html` + `app.css` + `app.js` served by `apps/control-server/server.mjs` on loopback port 4184. `npm run dev` and `npm run console:start` both start this same UI. The CP-001 Next scaffold is retained as historical source, **not the active dashboard**.
- **One sidebar / one origin:** Overview; Projects & Story; Storyboard & DNA; Image Studio; Video Generate; Motion Studio; Voice Studio; Film & Render; Automation Workflow; Approvals; History; API & Credentials; Security & Live Gates.
- **Unified creative data flow:** `Projects & Story → /api/workspace/preview or /save → deterministic story/DNA/shot DAG → Storyboard → Use prompt in Video Generate Studio`. Local saved project input is also read by the offline workflow demo `plan` action. When no project is saved, the fixture story is used.
- **Existing CP-010 controls unchanged:** 1-second duration increments per Seedance model, capability-driven native ratios, disabled unsupported ratios, attachment library and draft request inspector; no real paid API submission.
- **CP-002–008:** offline mock workflow (review, QA, render fixture, publish dry-run) and API credential vault remain in same application, not on separate dashboards.
- **CP-001 visual identity:** reused the original Dramasaku logo and black/red BoardUI palette.

## Run

1. Install Node.js 22+ and FFmpeg (needed only for fixture render).
2. Unzip the package, change directory to `dramasaku-studio`.
3. Run `npm run dev` **or** `npm run console:start` (same application).
4. Open `http://127.0.0.1:4184`; copy the operator token printed in the terminal to the login form. Do not share it.
5. Go to Projects & Story → Save Local Project → Storyboard & DNA → Use prompt in Video Generate. Workflow uses the last saved project when planning a **new** offline run. Reset an existing run before starting a new plan.

No npm install required for the unified local UI. Other legacy packages remain for future production work.

## Scope / restrictions

- Local pilot only; one operator token, local encrypted vault, local workspace JSON (0600). No tenant access control or production approvals.
- Project planning is deterministic and preview-only, not LLM story generation. Image and voice providers remain unconnected. Film render uses only a bundled video fixture. Publishing remains a dry-run.
- The UI now has one navigation shell; **this does not mean CP-001–010 are fully production-deployed**.
- PostgreSQL integration tests require a real database; they are skipped here. Chromium browser navigation is blocked by this execution environment; use offline UI preview for visual review, actual local dashboard for real testing.
- No repository changes pushed and no paid provider API calls made.
