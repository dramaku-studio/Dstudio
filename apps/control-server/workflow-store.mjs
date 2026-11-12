import { mkdir, readFile, open, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { parseScreenplay } from "../../packages/domain/src/creative.mjs";
const clone = structuredClone;
const bad = (code, status = 422) =>
  Object.assign(new Error(code), { code, status });
const hash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const id = () => randomBytes(12).toString("hex");
const txt = (v, n, empty = false) => {
  if (
    typeof v !== "string" ||
    v.length > n ||
    (!empty && !v.trim()) ||
    v.includes("\0")
  )
    throw bad("WORKFLOW_FIELD_INVALID");
  return v.trim();
};
const arr = (v, n) => {
  if (!Array.isArray(v) || v.length > n) throw bad("WORKFLOW_FIELD_INVALID");
  return v;
};
const key = (v) => {
  const result = txt(v, 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(result))
    throw bad("WORKFLOW_FIELD_INVALID");
  return result;
};
function draft(name = "Proyek baru") {
  return {
    title: name,
    brief: "",
    target: {
      duration: 180,
      ratio: "9:16",
      resolution: "1080 × 1920",
      layout: "single",
    },
    knowledge: "Gabungan",
    research: "",
    step: 0,
    assets: [],
    scenes: [],
    shots: [],
    hardGoals: [],
    rubric: [],
    scores: [],
    hardChecks: [],
    researchSources: [],
    model: "",
    documents: [],
    reviewer: "",
    qcSource: null,
  };
}
export function validateWorkflow(v) {
  const d = clone(v);
  d.title = txt(d.title, 120);
  d.brief = txt(d.brief, 24000, true);
  d.knowledge = txt(d.knowledge, 80);
  d.research = txt(d.research, 2000, true);
  d.reviewer = txt(d.reviewer || "", 120, true);
  if (
    !d.target ||
    !Number.isInteger(d.target.duration) ||
    d.target.duration < 1 ||
    d.target.duration > 3600 ||
    !["9:16", "16:9", "1:1", "4:3", "3:4", "21:9", "48:9"].includes(
      d.target.ratio,
    ) ||
    !["single", "full-triple"].includes(d.target.layout)
  )
    throw bad("WORKFLOW_TARGET_INVALID");
  d.target = {
    duration: d.target.duration,
    ratio: d.target.ratio,
    resolution: txt(d.target.resolution, 80),
    layout: d.target.layout,
  };
  if (!Number.isInteger(d.step) || d.step < 0 || d.step > 5)
    throw bad("WORKFLOW_FIELD_INVALID");
  d.model = txt(d.model || "", 160, true);
  const unique = (items) => {
    if (new Set(items.map((x) => x.id)).size !== items.length)
      throw bad("WORKFLOW_DUPLICATE_ID");
    return items;
  };
  d.assets = unique(
    arr(d.assets, 80).map((a) => ({
      id: key(a.id),
      name: txt(a.name, 120),
      kind: ["character", "environment", "prop", "audio"].includes(a.kind)
        ? a.kind
        : "prop",
      description: txt(a.description || "", 1200, true),
      choice: ["existing", "create"].includes(a.choice) ? a.choice : "",
      assetId: a.assetId ? txt(a.assetId, 24) : null,
      sha256: a.sha256 ? txt(a.sha256, 64) : null,
    })),
  );
  d.scenes = unique(
    arr(d.scenes, 80).map((s) => ({
      id: key(s.id),
      title: txt(s.title, 180),
      summary: txt(s.summary || "", 4000, true),
    })),
  );
  const assetIds = new Set(d.assets.map((a) => a.id)),
    sceneIds = new Set(d.scenes.map((a) => a.id));
  d.shots = unique(
    arr(d.shots, 120).map((s) => {
      if (
        !sceneIds.has(s.sceneId) ||
        !Number.isInteger(s.duration) ||
        s.duration < 1 ||
        s.duration > 60
      )
        throw bad("WORKFLOW_SHOT_INVALID");
      if (
        s.start !== undefined &&
        s.start !== null &&
        (!Number.isInteger(s.start) || s.start < 0 || s.start > 3600)
      )
        throw bad("WORKFLOW_SHOT_INVALID");
      if (s.lane !== undefined && !["FULL", "L", "C", "R"].includes(s.lane))
        throw bad("WORKFLOW_SHOT_INVALID");
      const refs = arr(s.assetIds || [], 20).map(key);
      if (
        new Set(refs).size !== refs.length ||
        refs.some((a) => !assetIds.has(a))
      )
        throw bad("WORKFLOW_ASSET_LINK_INVALID");
      return {
        id: key(s.id),
        sceneId: s.sceneId,
        title: txt(s.title || s.id, 160),
        description: txt(s.description, 4000),
        duration: s.duration,
        dialogue: txt(s.dialogue || "", 2500, true),
        camera: txt(s.camera || "", 1200, true),
        audio: txt(s.audio || "", 1000, true),
        start: s.start === null || s.start === undefined ? null : s.start,
        lane: s.lane || "FULL",
        assetIds: refs,
        storyboardAssetId: s.storyboardAssetId
          ? txt(s.storyboardAssetId, 24)
          : null,
        prompt: txt(s.prompt || "", 4000, true),
      };
    }),
  );
  d.hardGoals = unique(
    arr(d.hardGoals, 40).map((g) => ({
      id: key(g.id),
      text: txt(g.text, 1500),
    })),
  );
  d.rubric = unique(
    arr(d.rubric, 10).map((r) => ({ id: key(r.id), text: txt(r.text, 1500) })),
  );
  d.scores = arr(d.scores, 10).map((r) => {
    if (
      !d.rubric.some((c) => c.id === r.id) ||
      !Number.isFinite(r.score) ||
      r.score < 0 ||
      r.score > 10
    )
      throw bad("WORKFLOW_QC_INVALID");
    return { id: r.id, score: r.score, evidence: txt(r.evidence, 2000) };
  });
  if (new Set(d.scores.map((s) => s.id)).size !== d.scores.length)
    throw bad("WORKFLOW_QC_INVALID");
  d.hardChecks = arr(d.hardChecks, 40).map((c) => {
    if (!d.hardGoals.some((g) => g.id === c.id) || typeof c.pass !== "boolean")
      throw bad("WORKFLOW_QC_INVALID");
    return { id: c.id, pass: c.pass, evidence: txt(c.evidence, 2000) };
  });
  if (new Set(d.hardChecks.map((s) => s.id)).size !== d.hardChecks.length)
    throw bad("WORKFLOW_QC_INVALID");
  d.researchSources = arr(d.researchSources || [], 20).map((r) => ({
    title: txt(r.title, 160),
    url: txt(r.url, 1500),
    note: txt(r.note, 2000),
  }));
  if (d.researchSources.some((r) => !/^https?:\/\//i.test(r.url)))
    throw bad("WORKFLOW_SOURCE_INVALID");
  d.documents = arr(d.documents || [], 10).map((r) => ({
    id: txt(r.id, 24),
    name: txt(r.name, 180),
    sha256: txt(r.sha256, 64),
  }));
  d.qcSource = ["operator", "aiide"].includes(d.qcSource) ? d.qcSource : null;
  return d;
}
function promptFor(s, d) {
  const refs = s.assetIds
    .map((a) => d.assets.find((v) => v.id === a))
    .filter(Boolean);
  return [
    "Visual direction: " + d.knowledge,
    "Shot " + s.id + " · " + s.duration + " seconds · target " + d.target.ratio,
    s.description,
    s.camera ? "Camera and blocking: " + s.camera : "",
    s.dialogue ? "Planned dialogue (preserve wording): " + s.dialogue : "",
    s.audio ? "Audio: " + s.audio : "",
    refs.length
      ? "References: " +
        refs.map((a) => a.name + " — " + a.description).join(" | ")
      : "",
    d.hardGoals.length
      ? "Continuity: " + d.hardGoals.map((g) => g.text).join(" | ")
      : "",
    "End with a usable reaction or action hold for editing. Preserve approved identities, wardrobe, props and screen direction.",
  ]
    .filter(Boolean)
    .join("\n");
}
export function localWorkflowPlan(d) {
  const story = parseScreenplay(d.brief, { maxScenes: 60 });
  const assets = story.characters.map((n) => ({
    id: id(),
    name: n,
    kind: "character",
    description: "Lengkapi identitas dan kostum.",
    choice: "",
    assetId: null,
    sha256: null,
  }));
  const scenes = story.scenes.map((s) => ({
    id: s.id,
    title: s.heading,
    summary: s.action || s.dialogue.map((x) => x.line).join(" "),
  }));
  if (d.target.duration < story.scenes.length)
    throw bad("WORKFLOW_TARGET_INVALID");
  const total = Math.min(
    120,
    d.target.duration,
    Math.max(story.scenes.length, Math.ceil(d.target.duration / 8)),
  );
  const shots = [];
  for (const [i, scene] of story.scenes.entries()) {
    const n =
      Math.floor(total / story.scenes.length) +
      (i < total % story.scenes.length ? 1 : 0);
    const lines = scene.action.split(/(?<=[.!?])\s+/).filter(Boolean);
    for (let j = 0; j < n; j++) {
      const idx = shots.length,
        base = Math.floor(d.target.duration / total);
      shots.push({
        id: "SH-" + String(idx + 1).padStart(3, "0"),
        sceneId: scene.id,
        title: scene.heading + " · " + (j + 1),
        duration: base + (idx < d.target.duration % total ? 1 : 0),
        description:
          lines
            .slice(
              Math.floor((j * lines.length) / n),
              Math.floor(((j + 1) * lines.length) / n),
            )
            .join(" ") || "Jeda atau reaksi untuk ditinjau dari adegan ini.",
        dialogue: scene.dialogue
          .filter((_, k) => k % n === j)
          .map((x) => x.character + ": " + x.line)
          .join("\n"),
        camera: "Tentukan framing, arah pandang dan posisi kamera.",
        audio: "Tentukan dialog, ambience dan kebutuhan editing.",
        assetIds: assets
          .filter((a) => scene.dialogue.some((v) => v.character === a.name))
          .map((a) => a.id),
        storyboardAssetId: null,
        prompt: "",
      });
    }
  }
  return {
    ...d,
    assets,
    scenes,
    shots,
    hardGoals: [],
    scores: [],
    hardChecks: [],
    qcSource: null,
  };
}
export function workflowTimeline(data) {
  let cursor = 0;
  const positioned = data.shots.map((s) => {
    const start = s.start ?? cursor;
    cursor = Math.max(cursor, start + s.duration);
    return { ...s, start, end: start + s.duration };
  });
  const ends = positioned.map((s) => s.end),
    duration = Math.max(0, ...ends),
    points = [
      ...new Set([0, ...positioned.flatMap((s) => [s.start, s.end])]),
    ].sort((a, b) => a - b);
  let valid = duration === data.target.duration && positioned.length > 0;
  for (let i = 0; i < points.length - 1; i++) {
    const active = positioned.filter(
        (s) => s.start < points[i + 1] && s.end > points[i],
      ),
      lanes = active
        .map((s) => s.lane || "FULL")
        .sort()
        .join(",");
    if (
      data.target.layout === "single"
        ? lanes !== "FULL"
        : !["FULL", "C,L,R"].includes(lanes)
    )
      valid = false;
  }
  return { duration, valid, positioned };
}
export function createWorkflowStore({ root, workspace, assets, submitVideo }) {
  let chain = Promise.resolve();
  const serial = (fn) => {
    const p = chain.then(fn);
    chain = p.catch(() => {});
    return p;
  };
  async function scope() {
    const w = await workspace.read();
    return {
      id: w?.projectId || "local-draft",
      name: w?.workspace?.input?.projectName || "Proyek baru",
    };
  }
  async function load(scopeId) {
    try {
      const r = JSON.parse(
        await readFile(join(root, scopeId + ".json"), "utf8"),
      );
      if (r.schema !== 1) throw bad("WORKFLOW_CORRUPT");
      return r;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      return null;
    }
  }
  async function persist(key, r) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const dest = join(root, key + ".json"),
      temp = dest + "." + id() + ".tmp",
      h = await open(temp, "wx", 0o600);
    try {
      await h.writeFile(JSON.stringify(r));
      await h.sync();
    } finally {
      await h.close();
    }
    await rename(temp, dest);
  }
  async function current() {
    const s = await scope();
    return {
      key: s.id,
      record: (await load(s.id)) || {
        schema: 1,
        projectId: s.id,
        revision: 0,
        data: draft(s.name),
        approval: null,
        history: [],
        dispatches: [],
      },
    };
  }
  const contentHash = (d) => hash({ ...d, step: 0 });
  const qcInputHash = (d) =>
    hash({
      ...d,
      step: 0,
      scores: [],
      hardChecks: [],
      qcSource: null,
      reviewer: "",
    });
  function readiness(r) {
    const d = r.data,
      issues = [];
    if (d.brief.length < 12) issues.push("Lengkapi brief.");
    if (!d.shots.length) issues.push("Susun mapping dan shot.");
    if (!workflowTimeline(d).valid)
      issues.push("Periksa durasi, overlap dan celah pada susunan shot.");
    const needed = new Set(d.shots.flatMap((s) => s.assetIds));
    for (const a of d.assets.filter((a) => needed.has(a.id))) {
      const f = assets.resolveAsset(a.assetId);
      if (
        !f ||
        f.sha256 !== a.sha256 ||
        (f.projectId && f.projectId !== r.projectId)
      )
        issues.push("Master belum tersedia: " + a.name);
    }
    if (
      d.shots.some((s) => {
        const a = assets.resolveAsset(s.storyboardAssetId);
        return (
          !a ||
          a.kind !== "image" ||
          (a.projectId && a.projectId !== r.projectId)
        );
      })
    )
      issues.push("Lengkapi gambar storyboard setiap shot.");
    if (d.rubric.length !== 10 || d.scores.length !== 10)
      issues.push("Lengkapi 10 fundamental dan bukti QC.");
    const average =
      d.scores.length === 10
        ? d.scores.reduce((n, s) => n + s.score, 0) / 10
        : null;
    if (average !== null && average < 8.5)
      issues.push("Rata-rata QC di bawah 8,5.");
    if (
      d.hardChecks.length !== d.hardGoals.length ||
      d.hardChecks.some((c) => !c.pass)
    )
      issues.push("Hard Goals perlu diperiksa dan lulus.");
    return { issues, average, ready: !issues.length };
  }
  const pub = (r) => ({
    ...clone(r),
    readiness: readiness(r),
    contentHash: contentHash(r.data),
    approvalValid:
      !!r.approval &&
      r.approval.hash === contentHash(r.data) &&
      readiness(r).ready,
  });
  async function update(input, fn) {
    return serial(async () => {
      const { key, record: r } = await current();
      if (input.projectId !== key || input.expectedRevision !== r.revision)
        throw bad("WORKFLOW_CHANGED_RELOAD", 409);
      if (
        input.expectedProjectId !== undefined &&
        input.expectedProjectId !== key
      )
        throw bad("WORKFLOW_CHANGED_RELOAD", 409);
      const next = clone(r);
      await fn(next, key);
      if (
        contentHash(next.data) !== contentHash(r.data) &&
        next.history.length === r.history.length &&
        JSON.stringify(next.history) === JSON.stringify(r.history)
      ) {
        next.history.unshift({
          id: id(),
          at: new Date().toISOString(),
          note: "Perubahan master atau storyboard",
          data: r.data,
        });
        next.history = next.history.slice(0, 30);
      }
      next.revision++;
      next.updatedAt = new Date().toISOString();
      await persist(key, next);
      return pub(next);
    });
  }
  return {
    async state() {
      await chain;
      const { record } = await current();
      return pub(record);
    },
    async save(input) {
      return update(input, async (r) => {
        const next = validateWorkflow(input.data);
        if (qcInputHash(next) !== qcInputHash(r.data)) {
          next.scores = [];
          next.hardChecks = [];
          next.qcSource = null;
        }
        const changed = contentHash(next) !== contentHash(r.data);
        if (changed) {
          r.history.unshift({
            id: id(),
            at: new Date().toISOString(),
            note: txt(input.note || "Edit draf", 1000),
            data: r.data,
          });
          r.history = r.history.slice(0, 30);
          r.approval = null;
        }
        r.data = next;
      });
    },
    async approve(input) {
      return update(input, async (r) => {
        if (!readiness(r).ready) throw bad("WORKFLOW_NOT_READY", 409);
        const name = txt(input.reviewer, 120);
        r.approval = {
          hash: contentHash(r.data),
          at: new Date().toISOString(),
          reviewer: name,
        };
      });
    },
    async rollback(input) {
      return update(input, async (r) => {
        if (input.confirm !== true) throw bad("WORKFLOW_ROLLBACK_CONFIRM", 409);
        const old = r.history.find((h) => h.id === input.versionId);
        if (!old) throw bad("WORKFLOW_VERSION_MISSING", 404);
        r.history.unshift({
          id: id(),
          at: new Date().toISOString(),
          note: "Sebelum rollback",
          data: r.data,
        });
        r.history = r.history.slice(0, 30);
        r.data = validateWorkflow(old.data);
        r.approval = null;
      });
    },
    async attachMaster(input) {
      return update(input, async (r, key) => {
        const a = r.data.assets.find((a) => a.id === input.requirementId);
        if (!a) throw bad("WORKFLOW_ASSET_LINK_INVALID");
        const master = assets.resolveAsset(input.assetId);
        if (!master || (master.projectId && master.projectId !== key))
          throw bad("WORKFLOW_MASTER_MISSING");
        await assets.inspectAsset(master.id);
        await assets.pinMaster(master.id, key === "local-draft" ? null : key);
        a.assetId = master.id;
        a.sha256 = master.sha256;
        a.choice = "existing";
        r.data.scores = [];
        r.data.hardChecks = [];
        r.approval = null;
      });
    },
    async setStoryboard(input) {
      return update(input, async (r, key) => {
        const s = r.data.shots.find((s) => s.id === input.shotId),
          a = assets.resolveAsset(input.assetId);
        if (
          !s ||
          !a ||
          a.kind !== "image" ||
          (a.projectId && a.projectId !== key)
        )
          throw bad("WORKFLOW_MASTER_MISSING");
        await assets.inspectAsset(a.id);
        await assets.pinMaster(a.id, key === "local-draft" ? null : key);
        s.storyboardAssetId = a.id;
        r.data.scores = [];
        r.data.hardChecks = [];
        r.approval = null;
      });
    },
    async dispatch(input) {
      return serial(async () => {
        const { key, record: r } = await current();
        if (
          typeof input.token !== "string" ||
          !/^[a-f0-9]{24}$/.test(input.token)
        )
          throw bad("WORKFLOW_DISPATCH_TOKEN");
        for (const entry of r.dispatches) {
          if (entry.jobId) {
            const current = submitVideo.status?.(entry.jobId);
            if (current) entry.status = current.status;
          }
        }
        const prior = r.dispatches.find((d) => d.token === input.token);
        if (prior) {
          if (prior.shotId !== input.shotId)
            throw bad("WORKFLOW_DISPATCH_TOKEN");
          return pub(r);
        }
        if (input.projectId !== key || input.expectedRevision !== r.revision)
          throw bad("WORKFLOW_CHANGED_RELOAD", 409);
        if (!pub(r).approvalValid) throw bad("WORKFLOW_APPROVAL_REQUIRED", 409);
        const s = r.data.shots.find((s) => s.id === input.shotId);
        if (!s) throw bad("WORKFLOW_SHOT_INVALID");
        if (
          r.dispatches.some(
            (v) =>
              v.shotId === s.id &&
              v.hash === contentHash(r.data) &&
              (!["failed", "ready", "cancelled", "expired"].includes(
                v.status,
              ) ||
                input.newTake !== true),
          )
        )
          throw bad("WORKFLOW_ALREADY_DISPATCHED", 409);
        if (input.consent !== "I_ACCEPT_PROVIDER_CHARGES")
          throw bad("AIIDE_COST_CONSENT_REQUIRED", 403);
        if (r.dispatches.length >= 500) throw bad("WORKFLOW_HISTORY_FULL", 409);
        // Validate before making a durable dispatch claim.
        const request = await submitVideo.prepare(s, r.data, input.settings);
        const entry = {
          token: input.token,
          shotId: s.id,
          hash: contentHash(r.data),
          status: "submission_unknown",
          jobId: null,
          at: new Date().toISOString(),
        };
        r.dispatches.unshift(entry);
        r.revision++;
        await persist(key, r);
        try {
          const j = await submitVideo.send(
            request,
            key === "local-draft" ? null : key,
          );
          entry.jobId = j.id;
          entry.status = j.status;
        } catch (e) {
          entry.errorCode = e.code || "WORKFLOW_DISPATCH_UNKNOWN";
        }
        r.revision++;
        await persist(key, r);
        return pub(r);
      });
    },
    promptFor,
    validate: validateWorkflow,
  };
}
