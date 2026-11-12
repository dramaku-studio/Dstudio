/* Project workflow. Provider calls occur only through authenticated server endpoints and explicit consent. */
(() => {
  const root = document.getElementById("workflow-app");
  if (!root) return;
  const stages = [
    "Cerita",
    "Target",
    "Aset",
    "Rencana",
    "Review",
    "Final prompt",
  ];
  const h = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const uid = () =>
    [...crypto.getRandomValues(new Uint8Array(12))]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
  const q = (s) => root.querySelector(s);
  const keyBody = () => ({
    projectId: record.projectId,
    expectedRevision: record.revision,
  });
  const opt = (values, selected) =>
    values
      .map(
        (v) =>
          '<option value="' +
          h(typeof v === "string" ? v : v.id) +
          '" ' +
          ((typeof v === "string" ? v : v.id) === selected ? "selected" : "") +
          ">" +
          h(typeof v === "string" ? v : v.label) +
          "</option>",
      )
      .join("");
  let record = null,
    data = null,
    catalog = null,
    media = [],
    live = null,
    llmModels = [],
    dirty = false,
    change = 0,
    saveChain = Promise.resolve(),
    timer = null,
    busy = false,
    reviewTab = "story",
    selectedShot = "",
    selectedScene = "",
    settings = {
      model: "",
      mode: "text_to_video",
      resolution: "provider_default",
      generateAudio: false,
      ratio: "",
    },
    loadBusy = false,
    conflict = false,
    docText = "";
  function status(s) {
    const el = q("#wf-status");
    if (el) el.textContent = s;
  }
  function error(e) {
    const messages = {
      WORKFLOW_OPERATION_RUNNING:
        "Analisis versi ini sedang berjalan. Tunggu hasilnya sebelum mencoba lagi.",
      WORKFLOW_CHANGED_RELOAD:
        "Proyek atau draf berubah di tab lain. Isian tetap terlihat. Salin yang diperlukan lalu Muat ulang.",
      WORKFLOW_NOT_READY: "Selesaikan kebutuhan pada Review sebelum approval.",
      WORKFLOW_APPROVAL_REQUIRED: "Versi ini memerlukan QC dan approval.",
      WORKFLOW_DURATION_MISMATCH:
        "Durasi hasil analisis belum sama dengan target. Periksa rencana dan susun ulang.",
      WORKFLOW_TARGET_INVALID: "Periksa durasi, rasio dan susunan target.",
      WORKFLOW_ALREADY_DISPATCHED:
        "Shot versi ini sudah memiliki pengiriman. Periksa status hasilnya.",
      WORKFLOW_REFERENCES_REQUIRED:
        "Shot ini memakai master. Pilih mode referensi yang mendukung lampirannya.",
      WORKFLOW_MASTER_MISSING:
        "Master tidak tersedia pada proyek aktif. Pilih atau unggah kembali.",
      WORKFLOW_RUBRIC_REQUIRED: "Masukkan sepuluh fundamental terlebih dahulu.",
      DOCUMENT_DOC_CONVERT_TO_DOCX:
        "DOC lama belum dapat dibaca. Simpan sebagai DOCX atau tempel teksnya.",
      DOCUMENT_MAX_5MB: "Dokumen maksimal 5 MB.",
      DOCUMENT_FORMAT: "Pilih DOC, DOCX atau TXT.",
      DOCUMENT_TEXT_INVALID:
        "Teks dokumen kosong, rusak atau melebihi 24.000 karakter.",
      DOCUMENT_INVALID:
        "Dokumen DOCX tidak dapat dibaca. Periksa file atau tempel teksnya.",
      WORKFLOW_LLM_MODEL: "Pilih model teks yang tersedia pada akun AIIDE.",
      WORKFLOW_LLM_OFFLINE: "Analisis AIIDE belum aktif pada backend ini.",
      WORKFLOW_LLM_INVALID:
        "Jawaban model belum memenuhi struktur. Draf sebelumnya tetap tersimpan.",
      WORKFLOW_LLM_UNAVAILABLE:
        "Jawaban AIIDE tidak diterima. Periksa penggunaan akun sebelum mencoba lagi; draf tetap tersimpan.",
      WORKFLOW_LLM_FAILED:
        "Analisis AIIDE gagal. Periksa koneksi atau akun sebelum mencoba lagi.",
      WORKFLOW_PROVIDER_BALANCE: "AIIDE menolak permintaan terkait saldo.",
      WORKFLOW_FIELD_INVALID:
        "Ada isian kosong atau terlalu panjang. Periksa data draf.",
      WORKFLOW_QC_INVALID: "Setiap kriteria memerlukan skor 0–10 dan bukti.",
      AUTH_REQUIRED:
        "Masuk kembali untuk melanjutkan. Isian yang belum tersimpan tetap terlihat.",
    };
    if (e.message === "WORKFLOW_CHANGED_RELOAD") conflict = true;
    return (
      messages[e.message] ||
      (typeof studioError === "function" ? studioError(e) : e.message)
    );
  }
  function mark() {
    dirty = true;
    change++;
    if (record?.approval) record.approval = null;
    clearTimeout(timer);
    timer = setTimeout(() => flush().catch((e) => status(error(e))), 700);
    summary();
  }
  async function flush(note = "Edit draf") {
    clearTimeout(timer);
    const task = async () => {
      if (!dirty || !record) return;
      if (conflict) throw Error("WORKFLOW_CHANGED_RELOAD");
      const version = change,
        payload = structuredClone(data);
      status("Menyimpan…");
      const saved = await api("/api/workflow/save", {
        method: "POST",
        body: { ...keyBody(), data: payload, note },
      });
      record = saved;
      if (version === change) {
        data.scores = structuredClone(saved.data.scores);
        data.hardChecks = structuredClone(saved.data.hardChecks);
        data.qcSource = saved.data.qcSource;
        dirty = false;
      }
      status("Tersimpan · versi " + saved.revision);
      summary();
    };
    const promise = saveChain.then(task);
    saveChain = promise.catch(() => {});
    await promise;
    if (dirty && !busy) return flush(note);
  }
  async function load(force = false) {
    if (loadBusy || !csrf) return;
    if ((dirty || busy) && !force) return;
    loadBusy = true;
    try {
      const [r, c, m] = await Promise.all([
        api("/api/workflow"),
        api("/api/aiide-video/catalog"),
        api("/api/seedance/assets"),
      ]);
      record = r;
      data = structuredClone(r.data);
      catalog = c;
      media = m.assets;
      live = r.live;
      llmModels = r.llmModels || [];
      conflict = false;
      dirty = false;
      if (!selectedShot || !data.shots.some((s) => s.id === selectedShot))
        selectedShot = data.shots[0]?.id || "";
      if (!settings.model) {
        settings.model =
          live.availableModels?.[0] || catalog.models[0]?.id || "";
        const model = catalog.models.find((m) => m.id === settings.model);
        settings.resolution = model?.resolutions[0] || "provider_default";
      }
      render();
    } catch (e) {
      status(error(e));
    } finally {
      loadBusy = false;
    }
  }
  async function run(fn) {
    if (busy) return;
    busy = true;
    root.setAttribute("aria-busy", "true");
    root
      .querySelectorAll("button,input,textarea,select")
      .forEach((b) => (b.disabled = true));
    try {
      await flush();
      await fn();
    } catch (e) {
      status(error(e));
    } finally {
      busy = false;
      root.removeAttribute("aria-busy");
      if (record) render(false);
    }
  }
  function apply(r) {
    record = r;
    data = structuredClone(r.data);
    dirty = false;
    change++;
    summary();
  }
  function duration() {
    let cursor = 0;
    for (const shot of data.shots)
      cursor = Math.max(cursor, (shot.start ?? cursor) + shot.duration);
    return cursor;
  }
  function summary() {
    const el = q("#wf-summary");
    if (!el || !record) return;
    const seconds = duration();
    el.innerHTML =
      "<h3>" +
      h(data.title) +
      "</h3><dl><dt>Target</dt><dd>" +
      data.target.duration +
      " detik · " +
      h(data.target.ratio) +
      "</dd><dt>Mapping</dt><dd>" +
      data.scenes.length +
      " adegan · " +
      data.shots.length +
      " shot · " +
      seconds +
      " detik</dd><dt>Master ditautkan</dt><dd>" +
      data.assets.filter((a) => a.assetId).length +
      " / " +
      data.assets.length +
      "</dd><dt>Review</dt><dd>" +
      (!data.rubric.length
        ? "Menunggu rubrik"
        : record.approval && !dirty
          ? "Versi disetujui"
          : "Perlu ditinjau") +
      '</dd></dl><p class="helptext">Draf tersimpan pada proyek ' +
      h(
        record.projectId === "local-draft"
          ? "awal"
          : record.projectId.slice(0, 8),
      ) +
      ".</p>";
  }
  function bind(id, get, set) {
    const el = q(id);
    if (!el) return;
    el.addEventListener("input", () => {
      set(
        el.type === "number"
          ? Number(el.value)
          : el.type === "checkbox"
            ? el.checked
            : el.value,
      );
      mark();
    });
  }
  function footer() {
    return (
      '<div class="wf-actions">' +
      (data.step
        ? '<button type="button" id="wf-back" class="ghost">Kembali</button>'
        : "") +
      '<span class="helptext">Langkah ' +
      (data.step + 1) +
      " dari 6</span>" +
      (data.step < 5
        ? '<button type="button" id="wf-next" class="red">Lanjut ke ' +
          stages[data.step + 1] +
          "</button>"
        : "") +
      "</div>"
    );
  }
  function selected() {
    return data.shots.find((s) => s.id === selectedShot) || data.shots[0];
  }
  function llmPicker() {
    return (
      '<label for="wf-llm">Model teks AIIDE</label><select id="wf-llm">' +
      opt(
        [
          { id: "", label: "Pilih model" },
          ...llmModels.map((id) => ({ id, label: id })),
        ],
        data.model,
      ) +
      '</select><p class="helptext">Analisis dan QC AIIDE mengirim konteks proyek melalui API berbayar setelah konfirmasi.</p>'
    );
  }
  function render(resetMessage = true) {
    if (!data) return;
    const before = resetMessage ? "" : q("#wf-status")?.textContent || "";
    root.innerHTML =
      '<div class="wf-head"><div><h3>Siapkan karya dari cerita</h3><p class="helptext">Simpan keputusan, tinjau shot, lalu pilih cara produksi.</p></div><div class="work-actions"><button type="button" id="wf-example" class="ghost">Muat contoh romcom</button><button type="button" id="wf-reload" class="ghost">Muat ulang</button><a href="/api/workflow/export" download>Ekspor draf</a></div></div><nav class="wf-steps" aria-label="Tahap produksi">' +
      stages
        .map(
          (s, i) =>
            '<button type="button" data-wf-step="' +
            i +
            '" ' +
            (data.step === i ? 'aria-current="step"' : "") +
            ">" +
            s +
            "</button>",
        )
        .join("") +
      '</nav><div class="wf-layout"><div class="wf-editor" id="wf-editor"></div><aside id="wf-summary"></aside></div><p id="wf-status" role="status" aria-live="polite">' +
      h(before) +
      "</p>";
    const panel = q("#wf-editor");
    if (data.step === 0) {
      panel.innerHTML =
        '<h3>Ceritakan yang ingin kamu produksi</h3><label for="wf-title">Nama proyek</label><input id="wf-title" maxlength="120" value="' +
        h(data.title) +
        '"><button type="button" id="wf-fromproject" class="ghost">Ambil naskah dari Proyek & Cerita</button><label for="wf-brief">Brief / Screenplay</label><textarea id="wf-brief" rows="10" maxlength="24000" placeholder="Tulis brief atau tempel naskah…">' +
        h(data.brief) +
        '</textarea><label for="wf-doc">Lampiran dokumen · maksimal 5 MB</label><input id="wf-doc" type="file" accept=".doc,.docx,.txt"><div id="wf-doc-preview">' +
        data.documents
          .map(
            (d) =>
              '<button type="button" class="ghost" data-wf-doc="' +
              h(d.id) +
              '">' +
              h(d.name) +
              "</button>",
          )
          .join("") +
        (docText
          ? '<label>Teks hasil pembacaan<textarea id="wf-extracted" rows="8" readonly>' +
            h(docText) +
            '</textarea></label><button type="button" id="wf-acceptdoc" class="ghost">Ganti kolom brief</button><button type="button" id="wf-appenddoc" class="ghost">Tambahkan ke brief</button>'
          : "") +
        '</div><details><summary>Teknik visual dan riset</summary><label for="wf-knowledge">Acuan sinematografi</label><select id="wf-knowledge">' +
        opt(
          [
            "Gabungan",
            "Teknik visual · Melies",
            "Gerak kamera · AIShotStudio",
            "Manual",
          ],
          data.knowledge,
        ) +
        '</select><label for="wf-research">Topik /deepsearch atau catatan riset</label><textarea id="wf-research" rows="3" maxlength="2000">' +
        h(data.research) +
        '</textarea><p class="helptext">Catat topik dan temuan yang sudah ditinjau. Pencarian web otomatis belum terhubung. Tautan sumber diteruskan ke analisis sebagai acuan.</p><label for="wf-sources">Sumber diterima · judul | URL | ringkasan per baris</label><textarea id="wf-sources" rows="3">' +
        h(
          data.researchSources
            .map((s) => [s.title, s.url, s.note].join(" | "))
            .join("\n"),
        ) +
        "</textarea>" +
        llmPicker() +
        "</details>" +
        footer();
      q("#wf-fromproject").onclick = () =>
        run(async () => {
          const source = await api("/api/workspace");
          const input = source.saved?.workspace?.input;
          if (!input)
            throw Error("Belum ada naskah tersimpan pada Proyek & Cerita.");
          if (
            data.brief &&
            !confirm(
              "Gunakan versi naskah dari Proyek & Cerita untuk draf Workflow ini?",
            )
          )
            return;
          data.title = input.projectName;
          data.brief = input.screenplay;
          mark();
          await flush("Ambil naskah Proyek & Cerita");
        });
      bind("#wf-title", null, (v) => (data.title = v));
      bind("#wf-brief", null, (v) => (data.brief = v));
      bind("#wf-knowledge", null, (v) => (data.knowledge = v));
      bind("#wf-research", null, (v) => (data.research = v));
      bind("#wf-llm", null, (v) => (data.model = v));
      q("#wf-sources").onchange = () => {
        try {
          data.researchSources = q("#wf-sources")
            .value.split("\n")
            .filter((s) => s.trim())
            .map((s) => {
              const [title, url, ...note] = s.split("|").map((s) => s.trim());
              if (!title || !url || !note.join("|"))
                throw Error("Isi judul, URL dan ringkasan.");
              return { title, url, note: note.join("|") };
            });
          mark();
        } catch (e) {
          status(e.message);
        }
      };
      q("#wf-doc").onchange = () =>
        run(async () => {
          const file = q("#wf-doc").files[0];
          if (!file) return;
          if (file.size > 5 * 1024 * 1024) throw Error("DOCUMENT_MAX_5MB");
          const bytes = new Uint8Array(await file.arrayBuffer());
          let binary = "";
          for (let i = 0; i < bytes.length; i += 8192)
            binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
          const result = await api("/api/workflow/documents", {
            method: "POST",
            body: { ...keyBody(), name: file.name, base64: btoa(binary) },
          });
          apply(result.state);
          docText = result.text;
          render();
          status("Lampiran tersimpan. Pilih cara memakai teksnya.");
        });
      root.querySelectorAll("[data-wf-doc]").forEach(
        (el) =>
          (el.onclick = () =>
            run(async () => {
              docText = (
                await api("/api/workflow/documents/" + el.dataset.wfDoc)
              ).text;
            })),
      );
      for (const [selector, append] of [
        ["#wf-acceptdoc", false],
        ["#wf-appenddoc", true],
      ])
        q(selector)?.addEventListener("click", () =>
          run(async () => {
            if (
              !append &&
              data.brief &&
              !confirm("Ganti teks brief dengan hasil dokumen?")
            )
              return;
            data.brief = append
              ? (data.brief + "\n\n" + docText).trim()
              : docText;
            docText = "";
            mark();
            await flush("Teks dokumen diterima");
          }),
        );
    } else if (data.step === 1) {
      panel.innerHTML =
        '<h3>Seperti apa hasil akhirnya?</h3><div class="work-row"><div><label for="wf-duration">Durasi master (detik)</label><input id="wf-duration" type="number" min="1" max="3600" value="' +
        data.target.duration +
        '"></div><div><label for="wf-ratio">Rasio master</label><select id="wf-ratio">' +
        opt(
          ["9:16", "16:9", "1:1", "4:3", "3:4", "21:9", "48:9"],
          data.target.ratio,
        ) +
        '</select></div></div><label for="wf-resolution">Resolusi master</label><input id="wf-resolution" maxlength="80" value="' +
        h(data.target.resolution) +
        '"><label for="wf-layout">Susunan layar</label><select id="wf-layout">' +
        opt(
          [
            { id: "single", label: "Satu layar" },
            { id: "full-triple", label: "FULL → tiga panel serentak" },
          ],
          data.target.layout,
        ) +
        '</select><p class="helptext">Target master menjadi acuan editing. Parameter dan durasi sumber diperiksa kembali terhadap model sebelum dikirim. Untuk panel serentak, pilih lajur L/C/R dan isi waktu mulai yang sama di Rencana.</p>' +
        footer();
      for (const [id, k] of [
        ["duration", "duration"],
        ["ratio", "ratio"],
        ["resolution", "resolution"],
        ["layout", "layout"],
      ])
        bind("#wf-" + id, null, (v) => (data.target[k] = v));
    } else if (data.step === 2) {
      panel.innerHTML =
        '<h3>Master asetnya sudah ada?</h3><p class="helptext">Pilih file untuk kebutuhan yang sudah tersedia. Perlu dibuat menyiapkan brief aset dan mengizinkan mapping draf.</p>' +
        data.assets
          .map(
            (a) =>
              '<article class="wf-asset"><div><strong>' +
              h(a.name) +
              "</strong><small>" +
              h(a.description) +
              '</small></div><select data-wf-choice="' +
              h(a.id) +
              '" aria-label="Sumber ' +
              h(a.name) +
              '">' +
              opt(
                [
                  { id: "", label: "Pilih sumber" },
                  { id: "existing", label: "Sudah ada" },
                  { id: "create", label: "Perlu dibuat" },
                ],
                a.choice,
              ) +
              '</select><div class="wf-asset-controls"><label>Brief kebutuhan<textarea rows="2" maxlength="1200" data-wf-desc="' +
              h(a.id) +
              '">' +
              h(a.description) +
              '</textarea></label><label>Pilih dari Aset<select data-wf-link="' +
              h(a.id) +
              '">' +
              opt(
                [
                  { id: "", label: "Pilih master" },
                  ...media.map((m) => ({ id: m.id, label: m.name })),
                ],
                a.assetId,
              ) +
              '</select></label><label>Unggah master<input type="file" data-wf-file="' +
              h(a.id) +
              '" accept="' +
              (a.kind === "audio" ? "audio/*" : "image/*,video/mp4") +
              '"></label><p class="helptext">' +
              (a.assetId
                ? "Master ditautkan dan disimpan sepanjang proyek."
                : "Master belum ditautkan.") +
              '</p><button type="button" data-wf-copyasset="' +
              h(a.id) +
              '" class="ghost">Salin brief aset</button></div></article>',
          )
          .join("") +
        (data.assets.length
          ? ""
          : '<p class="notice">Tambahkan kebutuhan aset atau susun kerangka dari naskah terlebih dahulu.</p>') +
        '<div class="work-row"><input id="wf-newasset" maxlength="120" placeholder="Nama karakter, lokasi atau properti"><select id="wf-newkind">' +
        opt(["character", "environment", "prop", "audio"], "character") +
        '</select><button type="button" id="wf-addasset" class="ghost">Tambahkan kebutuhan</button></div><details><summary>Susun dari brief</summary><p class="helptext">Kerangka lokal memecah screenplay berdasarkan penanda adegan. AIIDE dapat menyusun usulan kebutuhan dan shot dari brief bebas.</p>' +
        llmPicker() +
        '<div class="work-actions"><button type="button" id="wf-local" class="ghost">Buat kerangka lokal</button><button type="button" id="wf-analyse">Analisis brief · AIIDE</button></div></details>' +
        footer();
      bind("#wf-llm", null, (v) => (data.model = v));
      root.querySelectorAll("[data-wf-choice]").forEach(
        (el) =>
          (el.onchange = () => {
            data.assets.find((a) => a.id === el.dataset.wfChoice).choice =
              el.value;
            mark();
          }),
      );
      root.querySelectorAll("[data-wf-desc]").forEach(
        (el) =>
          (el.oninput = () => {
            data.assets.find((a) => a.id === el.dataset.wfDesc).description =
              el.value;
            mark();
          }),
      );
      root.querySelectorAll("[data-wf-link]").forEach(
        (el) =>
          (el.onchange = () =>
            run(async () => {
              if (!el.value) return;
              apply(
                await api("/api/workflow/master", {
                  method: "POST",
                  body: {
                    ...keyBody(),
                    requirementId: el.dataset.wfLink,
                    assetId: el.value,
                  },
                }),
              );
            })),
      );
      root.querySelectorAll("[data-wf-file]").forEach(
        (el) =>
          (el.onchange = () =>
            run(async () => {
              const f = el.files[0];
              if (!f) return;
              const asset = await upload(f);
              apply(
                await api("/api/workflow/master", {
                  method: "POST",
                  body: {
                    ...keyBody(),
                    requirementId: el.dataset.wfFile,
                    assetId: asset.id,
                  },
                }),
              );
            })),
      );
      root.querySelectorAll("[data-wf-copyasset]").forEach(
        (el) =>
          (el.onclick = () =>
            run(async () => {
              const a = data.assets.find(
                (a) => a.id === el.dataset.wfCopyasset,
              );
              await copy(
                a.name +
                  "\n" +
                  a.description +
                  "\nVisual direction: " +
                  data.knowledge,
              );
              status(
                "Brief aset disalin. Gunakan pada Studio Gambar atau layanan yang dipilih.",
              );
            })),
      );
      q("#wf-addasset").onclick = () =>
        run(async () => {
          const name = q("#wf-newasset").value.trim();
          if (!name) throw Error("Isi nama kebutuhan aset.");
          data.assets.push({
            id: uid(),
            name,
            kind: q("#wf-newkind").value,
            description: "",
            choice: "",
            assetId: null,
            sha256: null,
          });
          mark();
          await flush("Tambah kebutuhan aset");
        });
      q("#wf-local").onclick = () => analyse(false);
      q("#wf-analyse").onclick = () => analyse(true);
    } else if (data.step === 3) {
      const total = duration();
      if (!data.scenes.some((s) => s.id === selectedScene))
        selectedScene = data.scenes[0]?.id || "";
      panel.innerHTML =
        '<h3>Periksa rencana produksinya</h3><p class="' +
        (total === data.target.duration ? "helptext" : "notice") +
        '">' +
        data.scenes.length +
        " adegan · " +
        data.shots.length +
        " shot · " +
        total +
        " / " +
        data.target.duration +
        ' detik</p><label for="wf-scene-filter">Adegan yang ditinjau</label><select id="wf-scene-filter">' +
        opt(
          data.scenes.map((s) => ({ id: s.id, label: s.title })),
          selectedScene,
        ) +
        '</select><div class="wf-table"><table><thead><tr><th>Shot</th><th>Aksi dan dialog</th><th>Durasi</th></tr></thead><tbody>' +
        data.shots
          .filter((s) => s.sceneId === selectedScene)
          .map(
            (s) =>
              "<tr><td>" +
              h(s.id) +
              "<br>" +
              h(s.title) +
              "</td><td>" +
              h(
                s.description.length > 220
                  ? s.description.slice(0, 220) + "…"
                  : s.description,
              ) +
              "<small>" +
              h(s.dialogue) +
              '</small><button type="button" data-wf-edit="' +
              h(s.id) +
              '" class="ghost">Edit shot</button></td><td>' +
              s.duration +
              " dtk<br>" +
              h(s.lane || "FULL") +
              (s.start === null || s.start === undefined
                ? ""
                : " · mulai " + s.start) +
              "</td></tr>",
          )
          .join("") +
        '</tbody></table></div><div class="work-actions"><button type="button" id="wf-addshot" class="ghost">Tambah shot</button><button type="button" id="wf-local" class="ghost">Susun kerangka lokal</button></div><details><summary>Hard Goals</summary><p class="helptext">Satu aturan wajib per baris. Mengubahnya memerlukan review QC baru.</p><textarea id="wf-goals" rows="5">' +
        h(data.hardGoals.map((g) => g.text).join("\n")) +
        "</textarea></details><details><summary>Analisis ulang dengan AIIDE</summary>" +
        llmPicker() +
        '<button type="button" id="wf-analyse">Susun usulan mapping</button></details><div id="wf-shotedit"></div>' +
        footer();
      bind("#wf-llm", null, (v) => (data.model = v));
      q("#wf-goals").onchange = () => {
        data.hardGoals = q("#wf-goals")
          .value.split("\n")
          .filter((s) => s.trim())
          .map((text, i) => ({ id: "HG" + (i + 1), text }));
        mark();
      };
      q("#wf-scene-filter").onchange = () => {
        selectedScene = q("#wf-scene-filter").value;
        selectedShot =
          data.shots.find((s) => s.sceneId === selectedScene)?.id || "";
        render();
      };
      q("#wf-local").onclick = () => analyse(false);
      q("#wf-analyse").onclick = () => analyse(true);
      q("#wf-addshot").onclick = () =>
        run(async () => {
          if (!data.scenes.length)
            data.scenes.push({ id: "SC1", title: "Adegan 1", summary: "" });
          const s = {
            id: "SH-" + uid().slice(0, 8),
            sceneId: data.scenes.at(-1).id,
            title: "Shot baru",
            description: "Lengkapi aksi.",
            duration: 5,
            dialogue: "",
            camera: "",
            audio: "",
            assetIds: [],
            storyboardAssetId: null,
            prompt: "",
          };
          data.shots.push(s);
          selectedShot = s.id;
          mark();
          await flush("Tambah shot");
        });
      root.querySelectorAll("[data-wf-edit]").forEach(
        (el) =>
          (el.onclick = () => {
            selectedShot = el.dataset.wfEdit;
            editShot();
          }),
      );
      if (selectedShot) editShot();
    } else if (data.step === 4) {
      panel.innerHTML =
        '<h3>Tinjau storyboard dan temuan</h3><div class="wf-tabs"><button type="button" id="wf-storytab" class="' +
        (reviewTab === "story" ? "red" : "ghost") +
        '">Storyboard</button><button type="button" id="wf-qctab" class="' +
        (reviewTab === "qc" ? "red" : "ghost") +
        '">QC & approval</button></div><div id="wf-review"></div>' +
        footer();
      q("#wf-storytab").onclick = () => {
        reviewTab = "story";
        render();
      };
      q("#wf-qctab").onclick = () => {
        reviewTab = "qc";
        render();
      };
      if (reviewTab === "story") storyboard();
      else qc();
    } else final();
    summary();
    wire();
  }
  function wire() {
    q("#wf-reload").onclick = () => {
      if (
        dirty &&
        !confirm(
          "Muat ulang draf tersimpan dan lepaskan isian yang belum disimpan?",
        )
      )
        return;
      dirty = false;
      load(true);
    };
    q("#wf-example").onclick = () =>
      run(async () => {
        if (
          !confirm(
            "Ganti draf Workflow proyek ini dengan contoh romcom 180 detik? Versi sebelumnya tersimpan di riwayat.",
          )
        )
          return;
        data = await api("/api/workflow/example");
        mark();
        await flush("Muat contoh romcom");
        selectedShot = data.shots[0]?.id || "";
      });
    const go = (i) =>
      run(async () => {
        if (i > data.step && data.step === 0 && data.brief.length < 12)
          throw Error(
            "Masukkan brief minimal 12 karakter atau terima teks dokumen.",
          );
        data.step = i;
        mark();
        await flush();
        render();
      });
    q("#wf-next")?.addEventListener("click", () => go(data.step + 1));
    q("#wf-back")?.addEventListener("click", () => go(data.step - 1));
    root
      .querySelectorAll("[data-wf-step]")
      .forEach((el) => (el.onclick = () => go(Number(el.dataset.wfStep))));
  }
  async function analyse(paid) {
    return run(async () => {
      if (
        data.shots.length &&
        !confirm(
          "Susun ulang mapping? Perubahan tersimpan sebagai versi baru untuk ditinjau.",
        )
      )
        return;
      if (
        paid &&
        !confirm(
          "Kirim naskah dan acuan proyek ke model teks AIIDE? Provider dapat mengenakan biaya.",
        )
      )
        return;
      status(paid ? "AIIDE menyusun usulan…" : "Menyusun kerangka lokal…");
      apply(
        await api("/api/workflow/analyse", {
          method: "POST",
          body: {
            ...keyBody(),
            mode: paid ? "aiide" : "local",
            model: data.model,
            consent: paid ? "I_ACCEPT_PROVIDER_CHARGES" : null,
          },
        }),
      );
      status(
        paid
          ? "Usulan AIIDE tersimpan. Tinjau aset, timing dan kontinuitas."
          : "Kerangka lokal tersimpan. Lengkapi keputusan kreatif pada setiap shot.",
      );
    });
  }
  function editShot() {
    const s = selected();
    if (!s) return;
    const box = q("#wf-shotedit");
    box.innerHTML =
      '<div class="panel-inner"><h3>Edit ' +
      h(s.id) +
      '</h3><label>Nama shot<input id="wf-shot-title" maxlength="160" value="' +
      h(s.title) +
      '"></label><label>Adegan<select id="wf-shot-scene">' +
      opt(
        data.scenes.map((x) => ({ id: x.id, label: x.title })),
        s.sceneId,
      ) +
      '</select></label><label>Durasi editorial (detik)<input id="wf-shot-duration" type="number" min="1" max="60" value="' +
      s.duration +
      '"></label><div class="work-row"><label>Panel / lajur<select id="wf-shot-lane">' +
      opt(["FULL", "L", "C", "R"], s.lane || "FULL") +
      '</select></label><label>Mulai (detik), kosong = berurutan<input id="wf-shot-start" type="number" min="0" max="3600" value="' +
      (s.start ?? "") +
      '"></label></div>' +
      ["description", "dialogue", "camera", "audio"]
        .map(
          (k, i) =>
            "<label>" +
            [
              "Aksi / blocking",
              "Dialog",
              "Kamera / framing",
              "Audio / editing",
            ][i] +
            '<textarea id="wf-shot-' +
            k +
            '" rows="3" maxlength="' +
            (k === "description"
              ? 4000
              : k === "dialogue"
                ? 2500
                : k === "camera"
                  ? 1200
                  : 1000) +
            '">' +
            h(s[k]) +
            "</textarea></label>",
        )
        .join("") +
      "<label>Master yang dipakai</label>" +
      data.assets
        .map(
          (a) =>
            '<label class="wf-check"><input type="checkbox" data-shot-ref="' +
            h(a.id) +
            '" ' +
            (s.assetIds.includes(a.id) ? "checked" : "") +
            ">" +
            h(a.name) +
            "</label>",
        )
        .join("") +
      '<button type="button" id="wf-removeshot" class="ghost">Hapus shot</button></div>';
    q("#wf-shot-start").oninput = () => {
      s.start =
        q("#wf-shot-start").value === ""
          ? null
          : Number(q("#wf-shot-start").value);
      mark();
    };
    bind("#wf-shot-lane", null, (v) => (s.lane = v));
    bind("#wf-shot-title", null, (v) => (s.title = v));
    bind("#wf-shot-scene", null, (v) => (s.sceneId = v));
    bind("#wf-shot-duration", null, (v) => (s.duration = v));
    for (const k of ["description", "dialogue", "camera", "audio"])
      bind("#wf-shot-" + k, null, (v) => (s[k] = v));
    root.querySelectorAll("[data-shot-ref]").forEach(
      (el) =>
        (el.onchange = () => {
          s.assetIds = [
            ...root.querySelectorAll("[data-shot-ref]:checked"),
          ].map((e) => e.dataset.shotRef);
          mark();
        }),
    );
    q("#wf-removeshot").onclick = () =>
      run(async () => {
        if (!confirm("Hapus " + s.id + " dari rencana versi baru?")) return;
        data.shots = data.shots.filter((v) => v.id !== s.id);
        selectedShot = data.shots[0]?.id || "";
        mark();
        await flush("Hapus shot");
      });
  }
  function storyboard() {
    const s = selected(),
      box = q("#wf-review");
    if (!s) {
      box.textContent = "Susun mapping terlebih dahulu.";
      return;
    }
    box.innerHTML =
      '<label for="wf-shot-select">Shot</label><select id="wf-shot-select">' +
      opt(
        data.shots.map((s) => ({ id: s.id, label: s.id + " · " + s.title })),
        s.id,
      ) +
      '</select><div class="wf-board">' +
      (s.storyboardAssetId
        ? '<img src="/api/seedance/assets/' +
          encodeURIComponent(s.storyboardAssetId) +
          '/media" alt="Storyboard ' +
          h(s.id) +
          '">'
        : "<p>Unggah gambar storyboard atau pilih aset proyek.</p>") +
      "</div><p>" +
      h(s.description) +
      '</p><p class="helptext">' +
      s.duration +
      " detik · " +
      h(s.camera) +
      '</p><label for="wf-boardfile">Unggah gambar storyboard</label><input id="wf-boardfile" type="file" accept="image/*"><label for="wf-boardexisting">Pilih gambar di Aset</label><select id="wf-boardexisting">' +
      opt(
        [
          { id: "", label: "Pilih gambar" },
          ...media
            .filter((a) => a.kind === "image")
            .map((a) => ({ id: a.id, label: a.name })),
        ],
        s.storyboardAssetId,
      ) +
      '</select><details><summary>Prompt gambar / pengarahan</summary><pre class="wf-prompt">' +
      h(
        s.description +
          "\n" +
          s.camera +
          "\nAcuan master: " +
          s.assetIds
            .map((id) => data.assets.find((a) => a.id === id)?.name)
            .join(", "),
      ) +
      '</pre><button type="button" id="wf-copyimage" class="ghost">Salin prompt gambar</button></details><label for="wf-revision">Instruksi revisi shot</label><textarea id="wf-revision" rows="3" placeholder="Bagian mana yang perlu diubah?"></textarea><button type="button" id="wf-revise" class="ghost">Simpan catatan ke shot</button><details><summary>Riwayat versi & rollback</summary>' +
      record.history
        .slice(0, 12)
        .map(
          (v) =>
            '<div class="activity-item"><span>' +
            h(v.note) +
            " · " +
            h(new Date(v.at).toLocaleString()) +
            '</span><button type="button" data-wf-rollback="' +
            h(v.id) +
            '" class="ghost">Pulihkan versi</button></div>',
        )
        .join("") +
      "</details>";
    q("#wf-shot-select").onchange = () => {
      selectedShot = q("#wf-shot-select").value;
      storyboard();
    };
    q("#wf-boardfile").onchange = () =>
      run(async () => {
        const f = q("#wf-boardfile").files[0];
        if (!f) return;
        const a = await upload(f);
        apply(
          await api("/api/workflow/storyboard", {
            method: "POST",
            body: { ...keyBody(), shotId: s.id, assetId: a.id },
          }),
        );
      });
    q("#wf-boardexisting").onchange = () =>
      run(async () => {
        if (!q("#wf-boardexisting").value) return;
        apply(
          await api("/api/workflow/storyboard", {
            method: "POST",
            body: {
              ...keyBody(),
              shotId: s.id,
              assetId: q("#wf-boardexisting").value,
            },
          }),
        );
      });
    q("#wf-copyimage").onclick = () =>
      run(async () => copy(s.description + "\n" + s.camera));
    q("#wf-revise").onclick = () =>
      run(async () => {
        const note = q("#wf-revision").value.trim();
        if (!note) throw Error("Tuliskan instruksi revisi.");
        s.description = (s.description + "\nArahan revisi: " + note).slice(
          0,
          4000,
        );
        mark();
        await flush("Revisi " + s.id + ": " + note.slice(0, 150));
      });
    root.querySelectorAll("[data-wf-rollback]").forEach(
      (el) =>
        (el.onclick = () =>
          run(async () => {
            const version = record.history.find(
              (v) => v.id === el.dataset.wfRollback,
            );
            if (
              !confirm(
                "Pulihkan versi " +
                  new Date(version.at).toLocaleString() +
                  "? Prompt, shot, aset tertaut dan target kembali ke snapshot ini. Approval perlu ditinjau ulang.",
              )
            )
              return;
            apply(
              await api("/api/workflow/rollback", {
                method: "POST",
                body: { ...keyBody(), versionId: version.id, confirm: true },
              }),
            );
          })),
    );
  }
  function qc() {
    const box = q("#wf-review"),
      readiness = record.readiness;
    box.innerHTML =
      '<p class="helptext">Agen menilai naskah dan breakdown teks. Gambar, akting dan gerak perlu pemeriksaan visual oleh reviewer. Rata-rata memakai bobot sama, target minimal 8,5.</p><label for="wf-rubric">Sepuluh fundamental · satu kriteria per baris</label><textarea id="wf-rubric" rows="7">' +
      h(data.rubric.map((r) => r.text).join("\n")) +
      '</textarea><button type="button" id="wf-setrubric" class="ghost">Simpan rubrik</button>' +
      (!data.rubric.length
        ? '<p class="notice">Menunggu sepuluh fundamental dari pemilik produksi.</p>'
        : "") +
      data.rubric
        .map((r) => {
          const score = data.scores.find((s) => s.id === r.id);
          return (
            '<article class="wf-qc"><strong>' +
            h(r.text) +
            '</strong><label>Skor 0–10<input type="number" min="0" max="10" step="0.1" data-wf-score="' +
            h(r.id) +
            '" value="' +
            (score?.score ?? "") +
            '"></label><label>Bukti · shot / frame / kutipan<textarea rows="2" data-wf-evidence="' +
            h(r.id) +
            '">' +
            h(score?.evidence || "") +
            "</textarea></label></article>"
          );
        })
        .join("") +
      (data.hardGoals.length ? "<h3>Periksa Hard Goals</h3>" : "") +
      data.hardGoals
        .map((g) => {
          const c = data.hardChecks.find((v) => v.id === g.id);
          return (
            '<article class="wf-qc"><strong>' +
            h(g.text) +
            '</strong><select data-wf-pass="' +
            h(g.id) +
            '">' +
            opt(
              [
                { id: "", label: "Belum diperiksa" },
                { id: "yes", label: "Lulus" },
                { id: "no", label: "Perlu diperbaiki" },
              ],
              c ? (c.pass ? "yes" : "no") : "",
            ) +
            '</select><textarea rows="2" data-wf-hardproof="' +
            h(g.id) +
            '" placeholder="Bukti pemeriksaan">' +
            h(c?.evidence || "") +
            "</textarea></article>"
          );
        })
        .join("") +
      '<button type="button" id="wf-savescores" class="ghost">Simpan pemeriksaan operator</button><details><summary>Usulan QC teks dari agen AIIDE</summary>' +
      llmPicker() +
      '<button type="button" id="wf-agentqc">Minta review AIIDE</button></details><div class="notice">' +
      h(readiness.issues.join(" ") || "Materi siap untuk keputusan reviewer.") +
      '</div><label for="wf-reviewer">Nama reviewer</label><input id="wf-reviewer" maxlength="120" value="' +
      h(data.reviewer) +
      '"><div class="work-actions"><button type="button" id="wf-approve" ' +
      (!readiness.ready ? "disabled" : "") +
      '>Approve versi ini</button></div><p class="helptext">Skor tersimpan: ' +
      (readiness.average === null
        ? "Belum lengkap"
        : readiness.average.toFixed(2)) +
      " · " +
      h(
        data.qcSource === "aiide"
          ? "Usulan QC teks AIIDE"
          : data.qcSource === "operator"
            ? "Pemeriksaan operator"
            : "Belum dinilai",
      ) +
      "</p>";
    bind("#wf-reviewer", null, (v) => (data.reviewer = v));
    bind("#wf-llm", null, (v) => (data.model = v));
    q("#wf-setrubric").onclick = () =>
      run(async () => {
        const rows = q("#wf-rubric")
          .value.split("\n")
          .filter((v) => v.trim());
        if (rows.length !== 10) throw Error("Masukkan tepat 10 fundamental.");
        data.rubric = rows.map((text, i) => ({ id: "QC" + (i + 1), text }));
        mark();
        await flush("Rubrik QC diperbarui");
      });
    q("#wf-savescores").onclick = () =>
      run(async () => {
        const scores = data.rubric.map((r) => {
          const el = q('[data-wf-score="' + r.id + '"]');
          if (el.value === "")
            throw Error("Lengkapi skor dan bukti setiap kriteria.");
          return {
            id: r.id,
            score: Number(el.value),
            evidence: q('[data-wf-evidence="' + r.id + '"]').value,
          };
        });
        const checks = data.hardGoals.map((g) => {
          const value = q('[data-wf-pass="' + g.id + '"]').value;
          if (!value) throw Error("Periksa setiap Hard Goal.");
          return {
            id: g.id,
            pass: value === "yes",
            evidence: q('[data-wf-hardproof="' + g.id + '"]').value,
          };
        });
        data.scores = scores;
        data.hardChecks = checks;
        data.qcSource = "operator";
        mark();
        await flush("Pemeriksaan operator");
      });
    q("#wf-agentqc").onclick = () =>
      run(async () => {
        if (
          !confirm(
            "Kirim naskah, breakdown dan rubrik ke AIIDE untuk usulan QC teks berbayar?",
          )
        )
          return;
        apply(
          await api("/api/workflow/analyse", {
            method: "POST",
            body: {
              ...keyBody(),
              operation: "qc",
              model: data.model,
              consent: "I_ACCEPT_PROVIDER_CHARGES",
            },
          }),
        );
      });
    q("#wf-approve").onclick = () =>
      run(async () => {
        if (!data.reviewer.trim()) throw Error("Isi nama reviewer.");
        if (
          !confirm("Setujui versi materi dan hasil QC yang sedang ditampilkan?")
        )
          return;
        apply(
          await api("/api/workflow/approve", {
            method: "POST",
            body: { ...keyBody(), reviewer: data.reviewer },
          }),
        );
      });
  }
  function final() {
    const panel = q("#wf-editor"),
      s = selected();
    panel.innerHTML =
      "<h3>Final prompt dan pengiriman</h3>" +
      (!s
        ? "<p>Susun mapping terlebih dahulu.</p>"
        : '<label for="wf-finalshot">Shot / job</label><select id="wf-finalshot">' +
          opt(
            data.shots.map((s) => ({
              id: s.id,
              label: s.id + " · " + s.duration + " detik",
            })),
            s.id,
          ) +
          '</select><p class="helptext">' +
          (record.approvalValid
            ? "Versi disetujui."
            : "Draf · " + h(record.readiness.issues.join(" "))) +
          '</p><label for="wf-finalprompt">Prompt video detail</label><textarea rows="10" maxlength="4000" id="wf-finalprompt">' +
          h(s.prompt || defaultPrompt(s)) +
          '</textarea><div class="work-actions"><button type="button" id="wf-saveprompt" class="ghost">Simpan prompt shot</button><button type="button" id="wf-copyprompt" class="ghost">Salin prompt</button><button type="button" id="wf-video" class="ghost">Buka di Buat Video</button></div><details><summary>Auto Generate Video dari Workflow</summary><label for="wf-vmodel">Model</label><select id="wf-vmodel">' +
          opt(
            catalog.models.map((m) => ({ id: m.id, label: m.label })),
            settings.model,
          ) +
          '</select><label for="wf-vmode">Mode</label><select id="wf-vmode"></select><label for="wf-vratio">Rasio sumber provider</label><select id="wf-vratio"></select><label for="wf-vres">Resolusi provider</label><select id="wf-vres"></select><label class="wf-check"><input type="checkbox" id="wf-vaudio" ' +
          (settings.generateAudio ? "checked" : "") +
          '>Generate audio jika didukung model</label><p class="helptext">Master target ' +
          h(data.target.resolution) +
          " · " +
          h(data.target.ratio) +
          ". Durasi shot " +
          s.duration +
          ' detik. Parameter dan URL lampiran harus didukung model aktif.</p><button type="button" id="wf-send" ' +
          (!record.approvalValid ? "disabled" : "") +
          ">Generate shot ini · berbayar</button></details>") +
      '<h3>Hasil dari Workflow</h3><div id="wf-results">' +
      record.dispatches
        .map((d) => {
          const j = d.job;
          return (
            '<article class="wf-result"><strong>' +
            h(d.shotId) +
            "</strong><p>" +
            h(j?.status || d.status) +
            (d.errorCode ? " · " + h(d.errorCode) : "") +
            "</p>" +
            (j?.status === "ready"
              ? '<video controls playsinline preload="metadata" src="/api/aiide-video/jobs/' +
                j.id +
                '/media"></video><a href="/api/aiide-video/jobs/' +
                j.id +
                '/media?download=1" download>Unduh MP4</a>'
              : j?.status === "download_pending"
                ? '<button type="button" class="ghost" data-wf-retry="' +
                  j.id +
                  '">Ambil ulang hasil</button>'
                : "") +
            (d.status === "submission_unknown" && !d.jobId
              ? '<p class="helptext">Pengiriman belum pasti. Cek task AIIDE sebelum membuat permintaan baru.</p>'
              : "") +
            "</article>"
          );
        })
        .join("") +
      '</div><button type="button" id="wf-results-refresh" class="ghost">Periksa hasil</button>' +
      footer();
    q("#wf-results-refresh").onclick = () => load(true);
    root.querySelectorAll("[data-wf-retry]").forEach(
      (el) =>
        (el.onclick = () =>
          run(async () => {
            await api(
              "/api/aiide-video/jobs/" + el.dataset.wfRetry + "/check",
              { method: "POST", body: {} },
            );
            await load(true);
          })),
    );
    if (!s) return;
    q("#wf-finalshot").onchange = () => {
      selectedShot = q("#wf-finalshot").value;
      render();
    };
    q("#wf-saveprompt").onclick = () =>
      run(async () => {
        s.prompt = q("#wf-finalprompt").value;
        mark();
        await flush("Prompt " + s.id + " diperbarui");
      });
    q("#wf-copyprompt").onclick = () =>
      run(async () => {
        await copy(q("#wf-finalprompt").value);
        status("Prompt disalin.");
      });
    q("#wf-video").onclick = () =>
      run(async () => {
        transferVideoPrompt(q("#wf-finalprompt").value, "sd-plan-status");
      });
    q("#wf-vmodel").onchange = () => {
      settings.model = q("#wf-vmodel").value;
      videoOptions();
    };
    videoOptions();
    q("#wf-vratio").onchange = () => (settings.ratio = q("#wf-vratio").value);
    q("#wf-vmode").onchange = () => (settings.mode = q("#wf-vmode").value);
    q("#wf-vres").onchange = () => (settings.resolution = q("#wf-vres").value);
    q("#wf-vaudio").onchange = () =>
      (settings.generateAudio = q("#wf-vaudio").checked);
    q("#wf-send").onclick = () =>
      run(async () => {
        if (q("#wf-finalprompt").value !== (s.prompt || defaultPrompt(s)))
          throw Error(
            "Simpan perubahan prompt lalu lakukan review versi baru sebelum kirim.",
          );
        const prior = record.dispatches.find(
          (d) => d.shotId === s.id && d.hash === record.contentHash,
        );
        const newTake =
          !!prior &&
          ["ready", "failed", "cancelled", "expired"].includes(
            prior.job?.status || prior.status,
          );
        const token = uid();
        if (
          !confirm(
            (newTake ? "Buat take baru untuk " : "Kirim ") +
              s.id +
              " (" +
              s.duration +
              " detik, " +
              settings.ratio +
              ", " +
              settings.resolution +
              ") ke " +
              settings.model +
              "? AIIDE mengenakan biaya sesuai akun.",
          )
        )
          return;
        apply(
          await api("/api/workflow/dispatch", {
            method: "POST",
            body: {
              ...keyBody(),
              shotId: s.id,
              token,
              newTake,
              settings,
              consent: "I_ACCEPT_PROVIDER_CHARGES",
            },
          }),
        );
        await load(true);
      });
  }
  function videoOptions() {
    const m = catalog.models.find((m) => m.id === settings.model);
    if (!m) return;
    if (!m.modes.includes(settings.mode)) settings.mode = m.modes[0];
    if (!m.resolutions.includes(settings.resolution))
      settings.resolution = m.resolutions[0];
    if (!m.ratioOptions.includes(settings.ratio))
      settings.ratio = m.ratioOptions.includes(data.target.ratio)
        ? data.target.ratio
        : m.ratioOptions[0];
    q("#wf-vratio").innerHTML = opt(m.ratioOptions, settings.ratio);
    q("#wf-vmode").innerHTML = opt(m.modes, settings.mode);
    q("#wf-vres").innerHTML = opt(m.resolutions, settings.resolution);
  }
  function defaultPrompt(s) {
    const refs = s.assetIds
      .map((id) => data.assets.find((a) => a.id === id))
      .filter(Boolean);
    return [
      "Visual direction: " + data.knowledge,
      "Shot " +
        s.id +
        " · " +
        s.duration +
        " seconds · target " +
        data.target.ratio,
      s.description,
      s.camera ? "Camera and blocking: " + s.camera : "",
      s.dialogue ? "Planned dialogue (preserve wording): " + s.dialogue : "",
      s.audio ? "Audio: " + s.audio : "",
      refs.length
        ? "References: " +
          refs.map((a) => a.name + " — " + a.description).join(" | ")
        : "",
      data.hardGoals.length
        ? "Continuity: " + data.hardGoals.map((g) => g.text).join(" | ")
        : "",
      "End with a usable reaction or action hold for editing. Preserve approved identities, wardrobe, props and screen direction.",
    ]
      .filter(Boolean)
      .join("\n");
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      root.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
  }
  async function upload(file) {
    const response = await fetch("/api/seedance/assets", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-dramasaku-csrf": csrf,
        "x-asset-name": encodeURIComponent(file.name),
      },
      body: file,
      credentials: "same-origin",
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    await api("/api/seedance/assets/" + result.asset.id + "/inspect", {
      method: "POST",
      body: {},
    });
    media = (await api("/api/seedance/assets")).assets;
    return result.asset;
  }
  const previousRefresh = refresh;
  refresh = async function () {
    await previousRefresh();
    if (csrf) await load();
  };
  window.addEventListener("hashchange", () => {
    if (location.hash === "#workflow") load();
  });
  window.addEventListener("beforeunload", (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  setInterval(() => {
    if (
      location.hash === "#workflow" &&
      record?.dispatches.some(
        (d) =>
          d.jobId &&
          !["ready", "failed", "expired", "cancelled"].includes(d.job?.status),
      ) &&
      !dirty &&
      !busy
    )
      load();
  }, 10000);
  if (csrf) load();
})();
