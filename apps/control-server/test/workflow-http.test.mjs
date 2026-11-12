import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalConsole } from "../server.mjs";
test("Workflow HTTP checks auth/CSRF, restores document text, persists drafts and rejects stale analysis", async () => {
  const root = await mkdtemp(join(tmpdir(), "workflow-http-"));
  let calls = 0;
  const app = createLocalConsole({
    port: 37500 + Math.floor(Math.random() * 10000),
    adminToken: "workflow-http-fixture-token",
    vaultKey: randomBytes(32).toString("base64"),
    vaultFile: join(root, "vault"),
    workflowLlmFetchImpl: async () => {
      calls++;
      throw Error("No remote calls allowed");
    },
  });
  await app.listen();
  const origin = "http://127.0.0.1:" + app.server.address().port;
  let cookie = "",
    csrf = "";
  async function call(path, body, withCsrf = true) {
    const r = await fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        cookie,
        origin,
        "content-type": "application/json",
        ...(withCsrf ? { "x-dramasaku-csrf": csrf } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const data = await r.json();
    if (data.csrf) csrf = data.csrf;
    return { status: r.status, data };
  }
  try {
    assert.equal((await call("/api/workflow")).status, 401);
    await call("/api/login", { token: "workflow-http-fixture-token" });
    let r = (await call("/api/workflow")).data;
    const data = {
      ...r.data,
      brief: "INT. APARTMENT - DAY\nNaya and Dimas wait by the door.",
    };
    assert.equal(
      (
        await call(
          "/api/workflow/save",
          { projectId: r.projectId, expectedRevision: r.revision, data },
          false,
        )
      ).status,
      403,
    );
    r = (
      await call("/api/workflow/save", {
        projectId: r.projectId,
        expectedRevision: r.revision,
        data,
      })
    ).data;
    assert.equal(r.data.brief, data.brief);
    const doc = await call("/api/workflow/documents", {
      projectId: r.projectId,
      expectedRevision: r.revision,
      name: "brief.txt",
      base64: Buffer.from("EXT. COURTYARD - DAY\nTwo adults talk.").toString(
        "base64",
      ),
    });
    assert.equal(doc.status, 201);
    const stored = doc.data.state.data.documents[0];
    assert.equal(
      (await call("/api/workflow/documents/" + stored.id)).data.text,
      doc.data.text,
    );
    assert.equal(
      (await call("/api/workflow/documents/" + "0".repeat(24))).status,
      404,
    );
    const stale = await call("/api/workflow/analyse", {
      projectId: r.projectId,
      expectedRevision: r.revision,
      mode: "aiide",
      model: "deepseek-v4-pro",
      consent: "I_ACCEPT_PROVIDER_CHARGES",
    });
    assert.equal(stale.status, 409);
    assert.equal(calls, 0);
    r = doc.data.state;
    const analysed = await call("/api/workflow/analyse", {
      projectId: r.projectId,
      expectedRevision: r.revision,
      mode: "local",
    });
    assert.equal(analysed.status, 200);
    assert.equal(
      analysed.data.data.shots.reduce((n, s) => n + s.duration, 0),
      180,
    );
    assert.equal(calls, 0);
    const persisted = JSON.parse(
      await readFile(join(root, "workflow", "local-draft.json"), "utf8"),
    );
    assert.equal(persisted.data.shots.length, 23);
  } finally {
    await new Promise((r) => app.server.close(r));
    await rm(root, { recursive: true, force: true });
  }
});

test("approved Workflow HTTP dispatch uses existing AIIDE engine once and receives playable mock MP4", async () => {
  const root = await mkdtemp(join(tmpdir(), "workflow-video-http-"));
  let posts = 0,
    polls = 0;
  const video = await readFile(
    new URL("../../../fixtures/fixture-video.mp4", import.meta.url),
  );
  const task = "workflow-existing-engine-fixture";
  const app = createLocalConsole({
    port: 37500 + Math.floor(Math.random() * 10000),
    adminToken: "workflow-video-fixture-token",
    vaultKey: randomBytes(32).toString("base64"),
    vaultFile: join(root, "vault"),
    aiideVideoEnabled: true,
    aiideVideoCapabilityVerified: true,
    aiideVideoFetchImpl: async (url, opts) => {
      if (opts.method === "POST") {
        posts++;
        return Response.json({ task_id: task });
      }
      if (url.endsWith("/" + task)) {
        polls++;
        return Response.json({
          data: {
            status: "SUCCESS",
            result_url:
              "https://ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com/fixture.mp4",
          },
        });
      }
      return new Response(video, { headers: { "content-type": "video/mp4" } });
    },
  });
  await app.listen();
  const origin = "http://127.0.0.1:" + app.server.address().port;
  let cookie = "",
    csrf = "";
  async function call(path, body) {
    const res = await fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        cookie,
        origin,
        "content-type": "application/json",
        "x-dramasaku-csrf": csrf,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const data = await res.json();
    if (data.csrf) csrf = data.csrf;
    return { status: res.status, data };
  }
  try {
    await app.keyPools.add({
      group: "video",
      provider: "aiide",
      label: "Mock video account",
      secret: "workflow-mock-only-key",
    });
    const png = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082",
      "hex",
    );
    const a = await app.seedance.addAsset(png, "storyboard.png");
    let r = await app.workflow.state(),
      d = r.data;
    d.brief = "INT. ROOM - DAY\nAn adult woman waits by the door.";
    d.target.duration = 5;
    d.scenes = [{ id: "SC1", title: "Waiting", summary: "She waits." }];
    d.shots = [
      {
        id: "SH1",
        sceneId: "SC1",
        title: "Waiting",
        description: "An adult woman waits by the door.",
        duration: 5,
        dialogue: "",
        camera: "Locked medium shot.",
        audio: "Room ambience.",
        assetIds: [],
        storyboardAssetId: a.id,
        prompt: "An adult woman waits by the door. Locked medium shot.",
      },
    ];
    d.rubric = Array.from({ length: 10 }, (_, i) => ({
      id: "QC" + i,
      text: "Fixture criterion " + i,
    }));
    r = await app.workflow.save({
      projectId: r.projectId,
      expectedRevision: r.revision,
      data: d,
    });
    d = r.data;
    d.scores = d.rubric.map((c) => ({
      id: c.id,
      score: 9,
      evidence: "Fixture reviewed storyboard.",
    }));
    r = await app.workflow.save({
      projectId: r.projectId,
      expectedRevision: r.revision,
      data: d,
    });
    r = await app.workflow.approve({
      projectId: r.projectId,
      expectedRevision: r.revision,
      reviewer: "Fixture operator",
    });
    await call("/api/login", { token: "workflow-video-fixture-token" });
    const request = {
      projectId: r.projectId,
      expectedRevision: r.revision,
      shotId: "SH1",
      token: "a".repeat(24),
      settings: {
        model: "doubao-seedance-2-0-fast-260128",
        mode: "text_to_video",
        resolution: "provider_default",
        generateAudio: false,
      },
      consent: "I_ACCEPT_PROVIDER_CHARGES",
    };
    const sent = await call("/api/workflow/dispatch", request);
    assert.equal(sent.status, 200);
    assert.equal(posts, 1);
    assert.equal((await call("/api/workflow/dispatch", request)).status, 200);
    assert.equal(posts, 1);
    const jobId = sent.data.dispatches[0].jobId;
    assert.ok(jobId);
    const checked = await call("/api/aiide-video/jobs/" + jobId + "/check", {});
    assert.equal(checked.data.job.status, "ready");
    assert.equal(polls, 1);
    const state = (await call("/api/workflow")).data;
    assert.equal(state.dispatches[0].job.status, "ready");
    assert.ok(state.dispatches[0].job.assetId);
    const media = await fetch(
      origin + "/api/aiide-video/jobs/" + jobId + "/media?download=1",
      { headers: { cookie } },
    );
    assert.equal(media.status, 200);
    assert.deepEqual(Buffer.from(await media.arrayBuffer()), video);
  } finally {
    await new Promise((r) => app.server.close(r));
    await rm(root, { recursive: true, force: true });
  }
});
