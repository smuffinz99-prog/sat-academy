/* SAT Reading & Writing, website version.
   The app's own Python engine runs inside the browser (Pyodide), so the website needs no server.
   Progress is a small SQLite file kept in this browser's storage (IndexedDB).
   The Gemini key stays in this browser (localStorage) and goes only to Google. */
(function () {
  "use strict";
  var BUILD = document.documentElement.getAttribute("data-build") || "1";
  var DB_PATH = "/data/study.db";
  var GEMINI = "https://generativelanguage.googleapis.com/v1beta";
  var MODELS = [{ id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (free tier, recommended)" },
                { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (fastest, free tier)" }];
  var FALLBACK = ["gemini-flash-latest", "gemini-flash-lite-latest"];   // if Google retires the chosen model

  function localDate() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  // ---------------------------------------------------------------- storage
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open("sat-academy", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("files"); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbDo(mode, fn) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction("files", mode), req = fn(tx.objectStore("files"));
        tx.oncomplete = function () { res(req && req.result); };
        tx.onerror = tx.onabort = function () { rej(tx.error); };
      });
    });
  }
  function settings() { try { return JSON.parse(localStorage.getItem("sat.gemini") || "{}") || {}; } catch (e) { return {}; } }
  function saveSettings(s) { try { localStorage.setItem("sat.gemini", JSON.stringify(s)); } catch (e) { } }
  function geminiBase() { try { return localStorage.getItem("sat.geminiBase") || GEMINI; } catch (e) { return GEMINI; } }

  // ---------------------------------------------------------------- loading screen
  function status(text, failed) {
    var el = document.getElementById("boot");
    if (!el) return;
    el.querySelector(".boot-msg").textContent = text;
    if (failed) el.classList.add("failed");
  }

  // ---------------------------------------------------------------- start the engine
  var py = null, webapi = null;
  var ready = (async function () {
    if (!window.loadPyodide || !window.indexedDB || !window.WebAssembly) throw new Error("This browser is too old for the app. Update Safari and try again.");
    status("Starting the app…");
    py = await window.loadPyodide({ indexURL: new URL("pyodide/", document.baseURI).href });
    status("Loading your lessons…");
    var zip = await fetch("py.zip?v=" + BUILD);
    if (!zip.ok) throw new Error("Couldn't load the app's files (" + zip.status + ").");
    py.unpackArchive(await zip.arrayBuffer(), "zip", { extractDir: "/app" });
    py.FS.mkdirTree("/data");
    var saved = null;
    try { saved = await idbDo("readonly", function (st) { return st.get("study.db"); }); } catch (e) { }
    if (saved) py.FS.writeFile(DB_PATH, new Uint8Array(saved));
    py.runPython("import sys\nsys.path.insert(0, '/app')\nimport webapi");
    webapi = py.pyimport("webapi");
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { }
    var boot = document.getElementById("boot");
    if (boot) boot.remove();
  })();
  ready.catch(function (e) { status(e.message || String(e), true); });

  // Save the progress file to the browser right after anything changes it (one write at a time).
  // (The file is small, so it's simply saved whole; SQLite doesn't always change its size or date.)
  var saving = null, again = false;
  function persist() {
    if (!py) return Promise.resolve();
    if (saving) { again = true; return saving; }
    var copy;
    try { copy = py.FS.readFile(DB_PATH).slice().buffer; } catch (e) { return Promise.resolve(); }
    saving = idbDo("readwrite", function (st) { return st.put(copy, "study.db"); }).catch(function (e) {
      console.error("Couldn't save progress", e);
    }).then(function () {
      saving = null;
      if (again) { again = false; return persist(); }
    });
    return saving;
  }
  function schedulePersist() { persist(); }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") persist(); });

  // ---------------------------------------------------------------- the tutor (Gemini, called from the browser)
  function tutorView() {
    var s = settings();
    return { provider: "gemini", model: s.model || MODELS[0].id, hasKey: !!s.key, keyHint: s.key ? "…" + s.key.slice(-4) : "",
             instructions: s.instructions || "", models: { gemini: MODELS } };
  }
  function saveTutor(b) {
    var s = settings();
    var key = String(b.apiKey || "").trim();
    if (key) s.key = key;
    if (b.clearKey) delete s.key;
    if (MODELS.some(function (m) { return m.id === b.model; })) s.model = b.model;
    if ("instructions" in b) s.instructions = String(b.instructions || "").slice(0, 4000);
    saveSettings(s);
    return tutorView();
  }
  function friendly(code, detail) {
    var d = String(detail || "").toLowerCase();
    if (code === 401 || code === 403 || d.indexOf("api_key_invalid") >= 0 || d.indexOf("api key not valid") >= 0)
      return "That API key was rejected. Check it in Tutor setup (no spaces, the whole key).";
    if (d.indexOf("referer") >= 0 || d.indexOf("referrer") >= 0)
      return "Your key is restricted to other websites. In Google AI Studio, allow this site or remove the website restriction.";
    if (code === 429 || d.indexOf("resource_exhausted") >= 0 || d.indexOf("quota") >= 0)
      return "You've hit the tutor's rate limit. Wait a minute and try again.";
    if (code === 404) return "That model isn't available for your key. Pick another model in Tutor setup.";
    return "The AI service returned an error (HTTP " + code + ").";
  }
  async function gemini(body) {
    var s = settings();
    if (!s.key) return { ok: false, error: "not_configured" };
    var first = s.model || MODELS[0].id;
    var models = [first].concat(FALLBACK.filter(function (m) { return m !== first; }));
    for (var i = 0; i < models.length; i++) {
      var r;
      try {
        r = await fetch(geminiBase() + "/models/" + models[i] + ":generateContent", {
          method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": s.key }, body: body });
      } catch (e) {
        return { ok: false, error: "network", detail: "Couldn't reach the AI service. Check your internet connection." };
      }
      if (r.status === 404 && i < models.length - 1) continue;
      var text = await r.text(), data = {};
      try { data = JSON.parse(text); } catch (e) { }
      if (!r.ok) return { ok: false, error: "api_error", detail: friendly(r.status, text) };
      var cands = data.candidates || [];
      if (!cands.length) return { ok: false, error: "api_error", detail: "The tutor couldn't answer that (" + ((data.promptFeedback || {}).blockReason || "no answer") + "). Try rephrasing." };
      var reply = ((cands[0].content || {}).parts || []).filter(function (p) { return !p.thought; })
        .map(function (p) { return p.text || ""; }).join("").trim();
      if (!reply) return { ok: false, error: "api_error", detail: "The tutor returned an empty answer. Try again." };
      return { ok: true, reply: reply };
    }
  }
  async function ask(b) {
    var s = settings();
    if (!s.key) return { ok: false, error: "not_configured" };
    var thread = String(b.threadId || "main"), message = String(b.message || "").trim().slice(0, 6000);
    var body = webapi.tutor_prepare(thread, message, b.image || null, JSON.stringify(b.context || {}), localDate(), s.instructions || "");
    var r = await gemini(body);
    if (r.ok) { webapi.tutor_save(thread, message, !!b.image, r.reply); schedulePersist(); }
    return r;
  }
  function testTutor() {
    return gemini(JSON.stringify({ systemInstruction: { parts: [{ text: "You are a helpful assistant." }] },
      contents: [{ role: "user", parts: [{ text: "Reply with exactly: Tutor connected." }] }],
      generationConfig: { maxOutputTokens: 1024 } }));
  }

  // ---------------------------------------------------------------- the API the app calls
  async function api(path, opts) {
    opts = opts || {};
    await ready;
    var body = opts.body !== undefined ? JSON.stringify(opts.body) : null;
    var method = opts.method || (body ? "POST" : "GET");
    var p = path.split("?")[0];
    if (p === "settings/tutor") return method === "GET" ? tutorView() : saveTutor(opts.body || {});
    if (p === "tutor/status") { var t = tutorView(); return { configured: t.hasKey, model: t.model, provider: "gemini" }; }
    if (p === "tutor/test") return testTutor();
    if (p === "tutor/ask") return ask(opts.body || {});
    var res = JSON.parse(webapi.handle(method, path, body, localDate()));
    schedulePersist();
    if (res.status >= 400) throw new Error((res.body && res.body.error) || ("Request failed (" + res.status + ")"));
    var out = res.body;
    if (p === "home") out.tutor = !!settings().key;
    if (p === "config") out.tutorConfigured = !!settings().key;
    return out;
  }

  async function downloadBackup() {
    await ready;
    var blob = new Blob([webapi.export_backup()], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sat-academy-backup-" + localDate() + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  window.SATWeb = { api: api, downloadBackup: downloadBackup, ready: ready, persist: persist };
})();
