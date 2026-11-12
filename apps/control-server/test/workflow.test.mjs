import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWorkflowStore,
  localWorkflowPlan,
  workflowTimeline,
} from "../workflow-store.mjs";
import { extractWorkflowDocument } from "../workflow-documents.mjs";
import { runWorkflowLlm } from "../workflow-llm.mjs";
const fixture = new URL(
  "../../../examples/workflow-romcom.json",
  import.meta.url,
);
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "workflow-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let project = "project-a",
    posts = 0,
    pins = 0;
  const files = new Map([
    [
      "a".repeat(24),
      {
        id: "a".repeat(24),
        kind: "image",
        projectId: "project-a",
        sha256: "b".repeat(64),
      },
    ],
    [
      "c".repeat(24),
      {
        id: "c".repeat(24),
        kind: "image",
        projectId: "project-b",
        sha256: "d".repeat(64),
      },
    ],
  ]);
  const assets = {
    resolveAsset: (id) => files.get(id),
    inspectAsset: async (id) => files.get(id),
    pinMaster: async () => {
      pins++;
    },
  };
  const workspace = {
    read: async () => ({
      projectId: project,
      workspace: { input: { projectName: project } },
    }),
  };
  const submitVideo = {
    prepare: async () => ({}),
    send: async () => {
      posts++;
      return { id: "job-fixture", status: "submitted" };
    },
  };
  const make = () =>
    createWorkflowStore({ root, workspace, assets, submitVideo });
  const store = make(),
    save = async (data) => {
      const r = await store.state();
      return store.save({
        projectId: r.projectId,
        expectedRevision: r.revision,
        data,
      });
    };
  return {
    store,
    make,
    save,
    files,
    setProject: (v) => (project = v),
    posts: () => posts,
    pins: () => pins,
  };
}
async function ready(x) {
  let data = JSON.parse(await readFile(fixture, "utf8"));
  for (const a of data.assets) {
    a.assetId = "a".repeat(24);
    a.sha256 = "b".repeat(64);
    a.choice = "existing";
  }
  for (const s of data.shots) s.storyboardAssetId = "a".repeat(24);
  data.rubric = Array.from({ length: 10 }, (_, i) => ({
    id: "QC" + i,
    text: "User criterion " + i,
  }));
  await x.save(data);
  data = (await x.store.state()).data;
  data.scores = data.rubric.map((r) => ({
    id: r.id,
    score: 8.5,
    evidence: "SC03-SH03 · approved storyboard evidence.",
  }));
  data.hardChecks = data.hardGoals.map((g) => ({
    id: g.id,
    pass: true,
    evidence: "Reviewed storyboard snapshot.",
  }));
  data.qcSource = "operator";
  return x.save(data);
}
test("workflow persists per project, detects stale writes and preserves the former snapshot", async (t) => {
  const x = await setup(t);
  const initial = await x.store.state();
  let d = initial.data;
  d.title = "First version";
  const saved = await x.save(d);
  assert.equal(saved.revision, 1);
  await assert.rejects(
    x.store.save({ projectId: "project-a", expectedRevision: 0, data: d }),
    { code: "WORKFLOW_CHANGED_RELOAD" },
  );
  const reloaded = await x.make().state();
  assert.equal(reloaded.data.title, "First version");
  x.setProject("project-b");
  assert.equal((await x.store.state()).revision, 0);
  await assert.rejects(
    x.store.save({ projectId: "project-a", expectedRevision: 0, data: d }),
    { code: "WORKFLOW_CHANGED_RELOAD" },
  );
  x.setProject("project-a");
  assert.equal((await x.store.state()).revision, 1);
});
test("local mapping preserves total duration and covers uneven scene allocation", async (t) => {
  const x = await setup(t);
  const d = (await x.store.state()).data;
  d.brief = Array.from(
    { length: 5 },
    (_, i) => "INT. ROOM " + i + " - DAY\nPerson waits.",
  ).join("\n");
  d.target.duration = 60;
  const plan = localWorkflowPlan(d);
  assert.equal(
    plan.shots.reduce((n, s) => n + s.duration, 0),
    60,
  );
  for (const scene of plan.scenes)
    assert(plan.shots.some((s) => s.sceneId === scene.id));
  assert.equal(plan.shots.length, 8);
});
test("approval requires all evidence, exact duration, available masters and passing hard goals", async (t) => {
  const x = await setup(t);
  let r = await x.store.state();
  await assert.rejects(
    x.store.approve({
      ...r,
      expectedRevision: r.revision,
      reviewer: "Operator",
    }),
    { code: "WORKFLOW_NOT_READY" },
  );
  r = await ready(x);
  assert.equal(r.readiness.average, 8.5);
  assert.equal(r.readiness.ready, true);
  let d = r.data;
  d.scores[0].score = 8.4;
  r = await x.save(d);
  assert.equal(r.readiness.ready, false);
  d = r.data;
  d.scores[0].score = 8.5;
  d.hardChecks[0].pass = false;
  r = await x.save(d);
  assert.equal(r.readiness.ready, false);
});
test("approved version invalidates on prompt edit, asset deletion and rollback", async (t) => {
  const x = await setup(t);
  let r = await ready(x);
  r = await x.store.approve({
    projectId: r.projectId,
    expectedRevision: r.revision,
    reviewer: "Editor",
  });
  assert(r.approvalValid);
  const d = r.data;
  d.shots[0].description += " Revised beat.";
  r = await x.save(d);
  assert.equal(r.approvalValid, false);
  assert.equal(r.data.scores.length, 0);
  const version = r.history.find((v) => v.data.scores.length === 10);
  await assert.rejects(
    x.store.rollback({
      projectId: r.projectId,
      expectedRevision: r.revision,
      versionId: version.id,
    }),
    { code: "WORKFLOW_ROLLBACK_CONFIRM" },
  );
  r = await x.store.rollback({
    projectId: r.projectId,
    expectedRevision: r.revision,
    versionId: version.id,
    confirm: true,
  });
  assert.equal(r.approvalValid, false);
  x.files.delete("a".repeat(24));
  assert.equal((await x.store.state()).readiness.ready, false);
});
test("cross-project masters cannot be attached or grant readiness", async (t) => {
  const x = await setup(t);
  let r = await ready(x);
  await assert.rejects(
    x.store.attachMaster({
      projectId: r.projectId,
      expectedRevision: r.revision,
      requirementId: r.data.assets[0].id,
      assetId: "c".repeat(24),
    }),
    { code: "WORKFLOW_MASTER_MISSING" },
  );
  r.data.assets[0].assetId = "c".repeat(24);
  r.data.assets[0].sha256 = "d".repeat(64);
  assert(
    (await x.save(r.data)).readiness.issues.some((i) => i.includes("Master")),
  );
});
test("dispatch consent, approval, double click and restart maintain one submission", async (t) => {
  const x = await setup(t);
  let r = await ready(x);
  r = await x.store.approve({
    projectId: r.projectId,
    expectedRevision: r.revision,
    reviewer: "Reviewer",
  });
  const input = {
    projectId: r.projectId,
    expectedRevision: r.revision,
    shotId: r.data.shots[0].id,
    token: "e".repeat(24),
    settings: {},
  };
  await assert.rejects(x.store.dispatch(input), {
    code: "AIIDE_COST_CONSENT_REQUIRED",
  });
  assert.equal(x.posts(), 0);
  const request = { ...input, consent: "I_ACCEPT_PROVIDER_CHARGES" };
  await Promise.all([x.store.dispatch(request), x.store.dispatch(request)]);
  assert.equal(x.posts(), 1);
  await x.make().dispatch(request);
  assert.equal(x.posts(), 1);
  const current = await x.store.state();
  await assert.rejects(
    x.store.dispatch({
      ...request,
      token: "f".repeat(24),
      expectedRevision: current.revision,
    }),
    { code: "WORKFLOW_ALREADY_DISPATCHED" },
  );
});
test("workflow requires snapshot evidence for every QC value", async (t) => {
  const x = await setup(t);
  let r = await ready(x);
  r.data.scores[0].evidence = "";
  await assert.rejects(x.save(r.data), { code: "WORKFLOW_FIELD_INVALID" });
});
function docx(xml) {
  const name = Buffer.from("word/document.xml"),
    raw = Buffer.from(xml);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt32LE(raw.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt32LE(raw.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + raw.length, 16);
  return Buffer.concat([local, name, raw, central, name, end]);
}
test("DOCX extraction preserves screenplay paragraphs and rejects invalid XML entities", async () => {
  const bytes = docx(
    "<w:document><w:p><w:r><w:t>INT. ROOM — DAY</w:t></w:r></w:p><w:p><w:r><w:t>Naya &amp; Dimas.</w:t></w:r></w:p></w:document>",
  );
  assert.equal(
    await extractWorkflowDocument(bytes, "naskah.docx"),
    "INT. ROOM — DAY\nNaya & Dimas.",
  );
  await assert.rejects(
    extractWorkflowDocument(docx("<!DOCTYPE foo><w:p>Text</w:p>"), "bad.docx"),
    { code: "DOCUMENT_INVALID" },
  );
  await assert.rejects(
    extractWorkflowDocument(Buffer.from("bad"), "bad.docx"),
    { code: "DOCUMENT_INVALID" },
  );
});
test("LLM planning requires consent and valid active catalog; mock sends no actual traffic", async () => {
  let count = 0;
  const args = {
    data: {
      brief: "A complete screenplay goes here.",
      target: { duration: 180 },
    },
    model: "deepseek-v4-pro",
    keyPools: {
      preview: async () => ({ selected: { id: "key" } }),
      getForInternalTask: async () => "fixture-not-a-real-api-key",
    },
    activation: {
      status: async () => ({
        ready: true,
        keyId: "key",
        catalogModels: ["deepseek-v4-pro"],
      }),
    },
    fetchImpl: async (url, opts) => {
      count++;
      assert.equal(url, "https://api.aiide.com/v1/chat/completions");
      assert.equal(opts.method, "POST");
      return Response.json({
        choices: [
          {
            message: {
              content: '{"scenes":[],"shots":[],"assets":[],"hardGoals":[]}',
            },
          },
        ],
      });
    },
  };
  await assert.rejects(runWorkflowLlm(args), { code: "WORKFLOW_LLM_CONSENT" });
  assert.equal(count, 0);
  assert.deepEqual(
    (await runWorkflowLlm({ ...args, consent: "I_ACCEPT_PROVIDER_CHARGES" }))
      .shots,
    [],
  );
  assert.equal(count, 1);
});

test("timeline computes concurrent panels once and rejects missing panels, overlap and gaps", () => {
  const data = {
    target: { duration: 15, layout: "full-triple" },
    shots: [
      { id: "A", duration: 5, lane: "FULL", start: 0 },
      ...["L", "C", "R"].map((lane) => ({
        id: lane,
        duration: 10,
        start: 5,
        lane,
      })),
    ],
  };
  assert.equal(workflowTimeline(data).duration, 15);
  assert.equal(workflowTimeline(data).valid, true);
  assert.equal(
    workflowTimeline({ ...data, shots: data.shots.slice(0, 3) }).valid,
    false,
  );
  assert.equal(
    workflowTimeline({
      ...data,
      shots: [
        ...data.shots,
        { id: "overlap", duration: 3, start: 6, lane: "L" },
      ],
    }).valid,
    false,
  );
  assert.equal(
    workflowTimeline({
      ...data,
      shots: data.shots.map((s) => (s.lane === "C" ? { ...s, start: 6 } : s)),
    }).valid,
    false,
  );
});
