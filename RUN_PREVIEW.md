# Dramasaku Studio CP-002 — Run & Inspect

**Status:** Interactive offline mock demo, not a live production app.

## Option A: Open interactive standalone HTML

Open `preview/index.html` in your browser without any installation. The UI runs a **browser-only simulation** of the stages; it does not call source domain functions in this mode.

## Option B: Run actual CP-002 domain guards in a local preview server

Requirements: Node.js >=22. No `npm install` required for this preview.

```bash
npm run preview
```

Open `http://127.0.0.1:4173` in your browser. The preview's local HTTP backend imports source implementations of `validateDag`, `hashSnapshot`, `BudgetEnvelope`, `canDispatch`, `evaluateQuality`, `approveFinal`, `requireApprovedExport`, and `createMockVideoProvider`.

Use buttons in sequence:

1. Validate Plan
2. Approve — simulated reviewer; not a real auth system
3. Run Mock Jobs — 3 mock shot jobs, no video files
4. Approve Takes — simulated reviewer actions
5. Export — mock JSON manifest only

To inspect machine-readable state: `GET /api/health`, `GET /api/state`, `GET /api/manifest` (manifest available only after export).

## Separate from Next.js app

The historical `apps/web` frontend is a **Next.js 15 scaffold** (not the active CP-011 UI). It is not launched by `npm run preview`. To run it with an internet-capable environment:

```bash
npm install
npm run dev  # now runs the CP-011 unified local dashboard
```

The original frontend does not have functioning production workflows, and the backend still needs PostgreSQL integration validation. Don't assume that a green CP-002 test report means live production is operational.

## Limitations

- No real PostgreSQL, Redis/BullMQ, authentication, budget settlement, provider calls, AI video generation, MP4 ingest, or social-media posting.
- Preview state is memory-only and reset when the process restarts.
- Mock costs are fixture units, not real prices.
- No real human approval authentication; preview actions only exercise domain guards.
- For actual deployment, implement CP-003 and required production gates before enabling paid operations.
