/* SAT Reading & Writing Academy: front end (no build step, no dependencies). */
(function () {
  "use strict";

  var app = document.getElementById("app");
  var CONFIG = null;
  var LETTERS = ["A", "B", "C", "D"];

  // ------------------------------------------------------------------ utils
  function localDate() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  var loadedDay = localDate();

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // The website version (GitHub Pages) runs the same engine in the browser; web.js provides SATWeb.
  var WEB = !!window.SATWeb;

  function api(path, opts) {
    if (WEB) return window.SATWeb.api(path, opts);
    opts = opts || {};
    var headers = { "X-Local-Date": localDate() };
    var body;
    if (opts.body !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.body); }
    return fetch("/api/" + path, { method: opts.method || (body ? "POST" : "GET"), headers: headers, body: body })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error(j.error || ("Request failed (" + r.status + ")"));
          return j;
        });
      });
  }

  function el(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }

  function each(list, fn) { Array.prototype.forEach.call(list, fn); }

  function fmtDay(day) {
    var today = localDate();
    if (day === today) return "Today";
    var d = new Date(day + "T12:00:00"), t = new Date(today + "T12:00:00");
    var diff = Math.round((d - t) / 86400000);
    if (diff === 1) return "Tomorrow";
    if (diff === -1) return "Yesterday";
    if (diff < 0) return Math.abs(diff) + " days ago";
    if (diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function dc(unit) { return CONFIG && CONFIG.units[unit] ? "d-" + CONFIG.units[unit].domain : ""; }

  // Small, safe Markdown subset.
  function inline(s) {
    s = esc(s);
    s = s.replace(/\[u\]([\s\S]*?)\[\/u\]/g, "<u>$1</u>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>");
    s = s.replace(/_{4,}/g, '<span class="blank" aria-label="blank"></span>');
    return s;
  }

  function md(text) {
    var lines = String(text || "").replace(/\r/g, "").split("\n");
    var out = [], i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (!line.trim()) { i++; continue; }
      var hm = line.match(/^(#{1,4})\s+(.*)$/);
      if (hm) { out.push("<h3>" + inline(hm[2]) + "</h3>"); i++; continue; }
      if (/^\s*\|/.test(line)) {
        var rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
        var html = "<table>";
        rows.map(function (r) { return r.trim().replace(/^\||\|$/g, "").split("|").map(function (c) { return c.trim(); }); })
          .forEach(function (c, ri) {
            if (ri === 1 && c.every(function (x) { return /^:?-+:?$/.test(x); })) return;
            var tag = ri === 0 ? "th" : "td";
            html += "<tr>" + c.map(function (x) { return "<" + tag + ">" + inline(x) + "</" + tag + ">"; }).join("") + "</tr>";
          });
        out.push(html + "</table>");
        continue;
      }
      if (/^\s*[-•*]\s+/.test(line)) {
        var items = [];
        while (i < lines.length && /^\s*[-•*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-•*]\s+/, "")); i++; }
        out.push("<ul>" + items.map(function (x) { return "<li>" + inline(x) + "</li>"; }).join("") + "</ul>");
        continue;
      }
      if (/^\s*\d+[.)]\s+/.test(line)) {
        var oitems = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { oitems.push(lines[i].replace(/^\s*\d+[.)]\s+/, "")); i++; }
        out.push("<ol>" + oitems.map(function (x) { return "<li>" + inline(x) + "</li>"; }).join("") + "</ol>");
        continue;
      }
      var para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*\||\s*[-•*]\s+|\s*\d+[.)]\s+)/.test(lines[i])) { para.push(lines[i]); i++; }
      out.push("<p>" + inline(para.join("\n")).replace(/\n/g, "<br>") + "</p>");
    }
    return out.join("");
  }

  // ------------------------------------------------------------------ icons
  var ICONS = {
    play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5z"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/>',
    bookmark: '<path d="M6 3h11a2 2 0 0 1 2 2v16l-7-4-7 4V5a2 2 0 0 1 1-2z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    next: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1.1 1.4 1.1 2.2h5c0-.8.5-1.7 1.1-2.2A6 6 0 0 0 12 3z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
    alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.5"/>',
    video: '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.5M4.5 12h.5M4.5 18h.5"/>',
    pencil: '<path d="M4 20l4-1L19 8l-3-3L5 16z"/>',
    printer: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
    flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
    redo: '<path d="M20 7v5h-5"/><path d="M20 12a8 8 0 1 1-2.3-5.7L20 9"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
    back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'
  };
  function ico(name) { return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + "</svg>"; }

  // ------------------------------------------------------------------ charts
  var SERIES_COLORS = ["#3B5BDB", "#E8890C", "#2F9E44", "#AE3EC9"];

  function chart(data) {
    if (!data) return "";
    var title = '<div class="title">' + esc(data.title || "") + "</div>";
    if (data.type === "table") {
      var t = "<table><tr>" + data.columns.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") + "</tr>";
      data.rows.forEach(function (r) { t += "<tr>" + r.map(function (c) { return "<td>" + esc(c) + "</td>"; }).join("") + "</tr>"; });
      return '<div class="chart">' + title + t + "</table></div>";
    }
    var cats = data.categories, series = data.series, unit = data.unit || "";
    var max = 0;
    series.forEach(function (s) { s.values.forEach(function (v) { if (v > max) max = v; }); });
    var step = max <= 10 ? 2 : max <= 50 ? 10 : max <= 100 ? 20 : Math.ceil(max / 5 / 10) * 10;
    var top = Math.ceil(max / step) * step || 1;
    var W = 460, H = 230, L = 40, B = 34, T = 12, R = 10, pw = W - L - R, ph = H - B - T;
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="' + esc(data.title) + '">';
    for (var g = 0; g <= top; g += step) {
      var y = T + ph - (g / top) * ph;
      svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" stroke="currentColor" stroke-opacity=".15"/>';
      svg += '<text x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + (unit === "$" ? "$" + g : g + (unit === "%" ? "%" : "")) + "</text>";
    }
    var bw = pw / cats.length;
    cats.forEach(function (c, ci) { svg += '<text x="' + (L + bw * ci + bw / 2) + '" y="' + (H - 12) + '" text-anchor="middle">' + esc(c) + "</text>"; });
    if (data.type === "bar") {
      var gw = bw * 0.72, sw = gw / series.length;
      series.forEach(function (s, si) {
        s.values.forEach(function (v, ci) {
          var hgt = (v / top) * ph, x = L + bw * ci + (bw - gw) / 2 + sw * si;
          svg += '<rect x="' + x + '" y="' + (T + ph - hgt) + '" width="' + (sw - 2) + '" height="' + hgt + '" rx="2" fill="' + SERIES_COLORS[si] + '"><title>' + esc(s.name + ", " + cats[ci] + ": " + v + unit) + "</title></rect>";
          svg += '<text x="' + (x + (sw - 2) / 2) + '" y="' + (T + ph - hgt - 3) + '" text-anchor="middle" style="font-size:10px">' + v + "</text>";
        });
      });
    } else {
      series.forEach(function (s, si) {
        var pts = s.values.map(function (v, ci) { return [L + bw * ci + bw / 2, T + ph - (v / top) * ph, v]; });
        svg += '<polyline fill="none" stroke="' + SERIES_COLORS[si] + '" stroke-width="2.5" points="' + pts.map(function (p) { return p[0] + "," + p[1]; }).join(" ") + '"/>';
        pts.forEach(function (p) {
          svg += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3.5" fill="' + SERIES_COLORS[si] + '"/>';
          svg += '<text x="' + p[0] + '" y="' + (p[1] - 7) + '" text-anchor="middle" style="font-size:10px">' + p[2] + "</text>";
        });
      });
    }
    svg += "</svg>";
    var legend = '<div class="legend">' + series.map(function (s, si) { return '<span><i style="background:' + SERIES_COLORS[si] + '"></i>' + esc(s.name) + "</span>"; }).join("") + "</div>";
    return '<div class="chart">' + title + svg + legend + "</div>";
  }

  // ------------------------------------------------------------------ tutor context
  var tutorCtx = {};
  function setTutorContext(ctx) {
    tutorCtx = ctx || {};
    var label = document.getElementById("drawerCtx");
    var parts = [];
    if (ctx && ctx.unit && CONFIG && CONFIG.units[ctx.unit]) parts.push(CONFIG.units[ctx.unit].title);
    if (ctx && ctx.questionId) parts.push(ctx.submitted ? "your answer" : "this question");
    label.textContent = parts.length ? "Sees: " + parts.join(", ") : "";
    if (Drawer && Drawer.follow) Drawer.follow();
  }

  function err(container) {
    return function (e) {
      container.innerHTML = '<div class="notice">Something went wrong: ' + esc(e.message) + ". Is the app still running?</div>";
    };
  }

  // ------------------------------------------------------------------ keyboard shortcuts for questions
  var activeKeys = null;
  document.addEventListener("keydown", function (e) {
    if (!activeKeys || !document.querySelector(".qrun") || e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
    if (t && t.closest && t.closest("#drawer")) return;      // typing to the tutor
    var k = e.key;
    var map = { a: "A", b: "B", c: "C", d: "D", "1": "A", "2": "B", "3": "C", "4": "D" };
    if (map[k.toLowerCase()]) { e.preventDefault(); activeKeys.pick(map[k.toLowerCase()]); }
    else if (k === "Enter") {
      if (tag === "A" || (tag === "BUTTON" && !t.classList.contains("pick"))) return;   // let focused buttons work normally
      e.preventDefault(); activeKeys.enter();
    }
    else if (k === "ArrowRight") { e.preventDefault(); activeKeys.next(); }
    else if (k === "ArrowLeft") { e.preventDefault(); activeKeys.prev(); }
  });

  // ------------------------------------------------------------------ question runner
  /* opts: ids, context, sessionId, startIndex, answered (qid -> {selected, correct, tries, solved}),
     onIndex(i), onAnswer(qid, state), onDone(results), label, doneLabel.
     A wrong pick is crossed off with no explanation; keep going until it's right.
     Only the first pick counts toward the score. */
  function QuestionRunner(container, opts) {
    var ids = opts.ids, idx = Math.min(opts.startIndex || 0, Math.max(0, ids.length - 1)), questions = {};
    var state = opts.answered || {};
    Object.keys(state).forEach(function (id) {      // answers saved before retries existed
      var st = state[id];
      if (st && st.solved === undefined) { st.solved = true; st.tries = st.correct ? [] : [st.selected]; }
    });

    function results() {
      var r = {};
      ids.forEach(function (id) { if (state[id]) r[id] = !!state[id].correct; });
      return r;
    }
    function done() { if (opts.onDone) opts.onDone(results()); }

    function load() {
      if (!ids.length) { container.innerHTML = '<div class="empty">Nothing here right now.</div>'; done(); return; }
      container.innerHTML = '<div class="loading">Loading…</div>';
      api("questions?ids=" + ids.join(",")).then(function (list) {
        list.forEach(function (q) { questions[q.id] = q; });
        ids = ids.filter(function (id) { return questions[id]; });
        show();
      }).catch(err(container));
    }

    function go(i) {
      if (i >= ids.length) { done(); return; }
      idx = Math.max(0, i);
      show();
    }

    function show() {
      if (opts.onIndex) opts.onIndex(idx);
      render(questions[ids[idx]]);
    }

    function navHTML() {
      var dots = ids.map(function (id, i) {
        var st = state[id], cls = i === idx ? "cur " : "";
        if (st) cls += st.correct ? "ok" : st.solved ? "no" : "part";
        return '<button type="button" data-i="' + i + '" class="' + cls + '" aria-label="Question ' + (i + 1) + '"' +
          (i === idx ? ' aria-current="true"' : "") + ">" + (i + 1) + "</button>";
      }).join("");
      return '<div class="qnav"><button class="btn small ghost" type="button" data-nav="prev"' + (idx === 0 ? " disabled" : "") +
        ' aria-label="Previous question">' + ico("back") + '</button><div class="qdots">' + dots + '</div>' +
        '<button class="btn small ghost" type="button" data-nav="next" aria-label="' + (idx + 1 < ids.length ? "Next question" : esc(opts.doneLabel || "Continue")) + '">' +
        ico("next") + "</button></div>";
    }

    function render(q) {
      var st = state[q.id] || null;
      var selected = null, struck = {}, busy = false;
      var hasPassage = !!(q.passage || q.data);
      var root = el('<div class="qrun ' + dc(q.unit) + '" data-qid="' + esc(q.id) + '"></div>');
      root.innerHTML = navHTML() +
        '<div class="qwrap' + (hasPassage ? "" : " single") + '">' +
        (hasPassage ? '<div class="qpassage">' + chart(q.data) + md(q.passage) + "</div>" : "") +
        '<div class="qside">' +
        '<div class="qmeta"><span class="qcount">' + (idx + 1) + " / " + ids.length + "</span>" +
        '<span class="chip dom">' + esc(q.unitTitle) + "</span>" +
        '<span class="chip">' + ["", "Easy", "Medium", "Hard"][q.difficulty] + "</span></div>" +
        '<div class="qtext">' + md(q.question) + "</div>" +
        '<div class="choices"></div><div class="tryslot" aria-live="polite"></div>' +
        '<div class="qactions"><button class="btn primary" data-act="submit" disabled>Check answer</button>' +
        '<span class="spacer"></span><button class="btn small" data-act="ask">' + ico("chat") + "Ask tutor</button></div>" +
        '<div class="keyhint"><kbd>A</kbd>–<kbd>D</kbd> to pick, <kbd>Enter</kbd> to check, <kbd>←</kbd> <kbd>→</kbd> to move</div>' +
        "</div></div>";
      var choicesEl = root.querySelector(".choices"), trySlot = root.querySelector(".tryslot");
      var fbSlot = el("<div></div>");
      root.appendChild(fbSlot);
      q.choices.forEach(function (c, i) {
        var L = LETTERS[i];
        var ch = el('<div class="choice" data-l="' + L + '"><button class="pick" type="button"><span class="letter">' + L +
          '</span><span>' + inline(c) + '</span></button><button class="strike" type="button" title="Cross out" aria-label="Cross out ' + L + '">' + ico("x") + "</button></div>");
        ch.querySelector(".pick").onclick = function () {
          if (solved() || tried(L) || busy) return;
          selected = L; struck[L] = false; refresh();
        };
        ch.querySelector(".strike").onclick = function () {
          if (solved() || tried(L)) return;
          struck[L] = !struck[L];
          if (struck[L] && selected === L) selected = null;
          refresh();
        };
        choicesEl.appendChild(ch);
      });
      each(root.querySelectorAll(".qdots button"), function (b) { b.onclick = function () { go(+b.getAttribute("data-i")); }; });
      root.querySelector('[data-nav="prev"]').onclick = function () { if (idx > 0) go(idx - 1); };
      root.querySelector('[data-nav="next"]').onclick = function () { go(idx + 1); };
      root.querySelector('[data-act="ask"]').onclick = function () { Drawer.open(); };
      container.innerHTML = "";
      container.appendChild(root);
      window.scrollTo(0, 0);

      function solved() { return !!(st && st.solved); }
      function tried(L) { return !!(st && st.tries && st.tries.indexOf(L) >= 0); }

      function refresh() {
        each(choicesEl.children, function (ch) {
          var l = ch.getAttribute("data-l");
          ch.classList.toggle("sel", selected === l && !solved());
          ch.classList.toggle("out", !!struck[l] && !solved() && !tried(l));
          ch.classList.toggle("tried", tried(l));
        });
        var sb = root.querySelector('[data-act="submit"]');
        if (sb) { sb.disabled = !selected || busy; sb.textContent = "Check answer"; }
        setTutorContext({ unit: q.unit, questionId: q.id, selected: selected, tries: st ? st.tries : [], solved: solved(),
          submitted: solved(), where: opts.label || "practice" });
      }

      function updateNav() {
        var nav = root.querySelector(".qnav");
        var fresh = el(navHTML());
        nav.querySelector(".qdots").innerHTML = fresh.querySelector(".qdots").innerHTML;
        each(nav.querySelectorAll(".qdots button"), function (b) { b.onclick = function () { go(+b.getAttribute("data-i")); }; });
      }

      function tryBox(lead) {
        var left = 4 - st.tries.length;
        trySlot.innerHTML = '<div class="tryagain">' + ico("x") + "<span><b>" + lead + "</b> " + (left > 1 ? "Try another choice." : "One left.") +
          '</span><span class="spacer"></span><button class="linkbtn" type="button" data-act="hint">' + ico("bulb") + " Hint</button></div>";
        trySlot.querySelector('[data-act="hint"]').onclick = function () {
          this.remove();
          trySlot.insertAdjacentHTML("beforeend", '<div class="hintbox">' + inline(q.hint) + "</div>");
        };
      }

      function wrongNow(L) {
        selected = null;
        tryBox(st.tries.length === 1 ? "Not quite." : "Not that one either.");
        refresh();
        updateNav();
        var c = choicesEl.querySelector('[data-l="' + L + '"]');
        if (c) { c.classList.remove("shake"); void c.offsetWidth; c.classList.add("shake"); }
      }

      function showSolved(res) {
        each(choicesEl.children, function (ch) {
          var l = ch.getAttribute("data-l");
          ch.classList.add("locked");
          ch.classList.remove("sel", "out");
          if (l === res.answer) ch.classList.add("correct");
        });
        trySlot.innerHTML = "";
        var qa = root.querySelector(".qactions");
        if (qa) qa.remove();          // the explanation below has its own tutor button
        var kh = root.querySelector(".keyhint");
        if (kh) kh.innerHTML = "<kbd>Enter</kbd> for the next question, <kbd>←</kbd> <kbd>→</kbd> to move";
        refresh();
        updateNav();
        fbSlot.innerHTML = "";
        var last = idx + 1 >= ids.length;
        fbSlot.appendChild(Feedback(res, function () { go(idx + 1); }, last ? (opts.doneLabel || "Continue") : "Next question"));
      }

      activeKeys = {
        pick: function (L) {
          var b = choicesEl.querySelector('[data-l="' + L + '"] .pick');
          if (b) b.click();
        },
        enter: function () {
          var nb = fbSlot.querySelector('[data-act="next"]');
          if (solved() && nb) { nb.click(); return; }
          var sb = root.querySelector('[data-act="submit"]');
          if (sb && !sb.disabled) sb.click();
        },
        prev: function () { if (idx > 0) go(idx - 1); },
        next: function () { go(idx + 1); }
      };

      root.querySelector('[data-act="submit"]').onclick = function () {
        if (!selected || busy || solved()) return;
        busy = true;
        var L = selected, first = !st;
        var req = first
          ? api("answer", { body: { questionId: q.id, selected: L, context: opts.context, sessionId: opts.sessionId } })
          : api("retry", { body: { questionId: q.id, selected: L, sessionId: opts.sessionId, first: st.selected, tries: st.tries } });
        req.then(function (res) {
          busy = false;
          if (first) st = state[q.id] = { selected: L, correct: !!res.correct, tries: [], solved: !!res.correct, journal: res.journal };
          if (res.solved) {
            st.solved = true;
            if (st.journal && !res.journal) res.journal = st.journal;
            st.res = res;
            if (opts.onAnswer) opts.onAnswer(q.id, st);
            showSolved(res);
            fbSlot.scrollIntoView({ behavior: "smooth", block: "nearest" });
          } else {
            if (st.tries.indexOf(L) < 0) st.tries.push(L);
            if (opts.onAnswer) opts.onAnswer(q.id, st);
            wrongNow(L);
          }
        }).catch(function (e) { busy = false; err(fbSlot)(e); });
      };

      if (solved()) {
        if (st.res) showSolved(st.res);
        else api("reveal/" + q.id).then(function (full) {
          full.selected = st.selected; full.correct = !!st.correct; full.tries = st.tries || []; full.solved = true;
          st.res = full;
          showSolved(full);
        }).catch(err(fbSlot));
      } else {
        if (st && st.tries && st.tries.length) tryBox("Keep going.");
        refresh();
      }
    }

    load();
  }

  // Feedback once the right answer is found: each wrong pick explained in the
  // order it was tried, then why the right answer is right.
  function Feedback(res, onNext, nextLabel) {
    var tries = res.tries || [];
    var firstTry = !tries.length;
    var p = el('<div class="fb ' + (firstTry ? "is-good" : "is-bad") + '"></div>');
    var html = '<div class="verdict"><span class="badge">' + ico(firstTry ? "check" : "redo") + "</span>" +
      (firstTry ? "Correct, first try" : "Got it on try " + (tries.length + 1) + ". It's " + esc(res.answer) + ".") + "</div>";
    if (!firstTry) {
      html += '<ol class="whyorder">' + tries.map(function (L, i) {
        return '<li class="no"><span class="l">' + L + '</span><span><b>' + (i === 0 ? "Your first pick" : "Then") + ":</b> " +
          inline(res.why[LETTERS.indexOf(L)]) + "</span></li>";
      }).join("") +
        '<li class="ok"><span class="l">' + esc(res.answer) + '</span><span><b>Why ' + esc(res.answer) + " is right:</b> " + inline(res.explanation) + "</span></li></ol>";
    } else {
      html += '<div class="why"><b>Why ' + esc(res.answer) + ":</b> " + inline(res.explanation) + "</div>";
    }
    html += '<div class="tipline">' + ico("bulb") + "<span><b>Next time:</b> " + inline(res.tip) + "</span></div>";
    var others = LETTERS.filter(function (L) { return L !== res.answer && tries.indexOf(L) < 0; });
    if (others.length) {
      html += '<details><summary>' + (firstTry ? "Why the others are wrong" : "The choices you didn't pick") + '</summary><ul class="whylist">' + others.map(function (L) {
        return '<li><span class="l">' + L + "</span><span>" + inline(res.why[LETTERS.indexOf(L)]) + "</span></li>";
      }).join("") + "</ul></details>";
    }
    if (res.vocab && res.vocab.length) {
      html += "<details><summary>Vocabulary</summary><p>" + res.vocab.map(function (v) { return "<strong>" + esc(v[0]) + "</strong>: " + esc(v[1]); }).join("<br>") + "</p></details>";
    }
    html += '<div class="fb-actions"><span class="jslot"></span><button class="btn" data-act="ask">' + ico("chat") + "Ask tutor</button>" +
      '<span class="spacer"></span><button class="btn primary" data-act="next">' + esc(nextLabel) + ico("next") + "</button></div>" +
      '<div class="catslot"></div>';
    p.innerHTML = html;

    var jslot = p.querySelector(".jslot"), catslot = p.querySelector(".catslot");
    function showSaved(mistake, note) {
      jslot.innerHTML = '<span class="btn good" aria-live="polite">' + ico("check") + "In Mistake Journal" + (note ? '<span class="small">' + esc(note) + "</span>" : "") + "</span>";
      if (!firstTry && CONFIG) {
        var cats = el('<div class="cats"><span class="q">Why did you miss it?</span></div>');
        CONFIG.categories.forEach(function (c) {
          var b = el('<button type="button" title="' + esc(c.desc) + '">' + esc(c.label) + "</button>");
          if (mistake && c.id === mistake.category) b.classList.add("on");
          b.onclick = function () {
            api("mistakes/" + res.id + "/category", { body: { category: c.id } }).then(function () {
              each(cats.querySelectorAll("button"), function (x) { x.classList.remove("on"); });
              b.classList.add("on");
            });
          };
          cats.appendChild(b);
        });
        catslot.innerHTML = "";
        catslot.appendChild(cats);
      }
    }
    if (res.inJournal) {
      var note = res.journal === "missed_again" ? "· back tomorrow" : res.journal === "rescheduled" && res.mistake ? "· next review " + fmtDay(res.mistake.dueDay).toLowerCase() : "";
      showSaved(res.mistake, note);
    } else {
      var add = el('<button class="btn' + (firstTry ? "" : " primary") + '" data-act="save">' + ico("bookmark") + (firstTry ? "I guessed. Save it" : "Add to Mistake Journal") + "</button>");
      if (!firstTry) p.querySelector('[data-act="next"]').classList.remove("primary");
      add.onclick = function () {
        add.disabled = true;
        api("mistakes/add", { body: { questionId: res.id, selected: firstTry ? res.answer : tries[0] } }).then(function (r) {
          res.inJournal = true; res.mistake = r.mistake;
          showSaved(r.mistake, "· review tomorrow");
          if (!firstTry) p.querySelector('[data-act="next"]').classList.add("primary");
        }).catch(function () { add.disabled = false; });
      };
      jslot.appendChild(add);
    }
    p.querySelector('[data-act="ask"]').onclick = function () { Drawer.open(); };
    p.querySelector('[data-act="next"]').onclick = onNext;
    return p;
  }

  // ------------------------------------------------------------------ lesson pieces
  function videoHTML(v, unit) {
    if (!v) return '<div class="video"><div class="video-missing">Video not found. Make sure the <b>videos</b> folder is inside <b>static</b>.</div></div>';
    return '<div class="video"><video controls playsinline preload="metadata"' + (v.poster ? ' poster="' + v.poster + '"' : "") + ">" +
      '<source src="' + v.src + '" type="video/mp4">' +
      (v.captions ? '<track kind="captions" src="' + v.captions + '" srclang="en" label="English">' : "") +
      "</video></div>" +
      '<div class="vbar">' +
      (v.chapters && v.chapters.length ? '<span class="chaps"><span class="muted small">Jump to</span>' + v.chapters.map(function (c) {
        return '<button type="button" data-t="' + c.t + '">' + esc(c.label) + "</button>";
      }).join("") + "</span>" : "") +
      '<span class="rates"><span class="muted small">Speed</span>' + [1, 1.25, 1.5].map(function (r) {
        return '<button type="button" data-rate="' + r + '">' + r + "×</button>";
      }).join("") + "</span></div>" +
      (v.transcript ? '<details class="transcript"><summary>Transcript</summary>' + vttText(v.transcript) + "</details>" : "");
  }

  function vttText(vtt) {
    return vtt.split(/\n\n+/).map(function (b) {
      var lines = b.split("\n").filter(function (l) { return l && l !== "WEBVTT" && l.indexOf("-->") < 0; });
      return lines.length ? "<p>" + esc(lines.join(" ")) + "</p>" : "";
    }).join("");
  }

  function wireVideo(box, unit) {
    var v = box.querySelector("video");
    if (!v) return;
    v.addEventListener("ended", function () { api("masterclass/" + unit + "/section", { body: { section: "video" } }); });
    var rate = 1;
    try { rate = parseFloat(localStorage.getItem("videoRate")) || 1; } catch (e) { }
    function setRate(r) {
      rate = r;
      v.playbackRate = r;
      v.defaultPlaybackRate = r;
      each(box.querySelectorAll(".vbar [data-rate]"), function (b) { b.classList.toggle("on", parseFloat(b.getAttribute("data-rate")) === r); });
      try { localStorage.setItem("videoRate", String(r)); } catch (e) { }
    }
    each(box.querySelectorAll(".vbar [data-rate]"), function (b) { b.onclick = function () { setRate(parseFloat(b.getAttribute("data-rate"))); }; });
    v.addEventListener("loadedmetadata", function () { v.playbackRate = rate; });
    setRate(rate);
    // Chapter buttons: jump straight to the method, the worked example or the notes page.
    var chaps = box.querySelectorAll(".vbar [data-t]");
    each(chaps, function (b) {
      b.onclick = function () {
        v.currentTime = parseFloat(b.getAttribute("data-t")) + 0.05;
        var pr = v.play();
        if (pr && pr.catch) pr.catch(function () { });
      };
    });
    if (chaps.length) v.addEventListener("timeupdate", function () {
      var cur = null;
      each(chaps, function (b) { if (v.currentTime + 0.1 >= parseFloat(b.getAttribute("data-t"))) cur = b; });
      each(chaps, function (b) { b.classList.toggle("on", b === cur && v.currentTime > 0); });
    });
  }

  function attackHTML(s) {
    return '<ol class="attack">' + s.attack.map(function (a) {
      return '<li><span class="h">' + inline(a[0]) + '</span><span class="d">' + inline(a[1]) + "</span></li>";
    }).join("") + '</ol><div class="mantra"><span class="swipe">' + esc(s.mantra) + "</span></div>";
  }

  function rulesHTML(s) {
    return '<div class="rules">' + s.rules.map(function (r) {
      return '<div class="rule"><div class="n">' + inline(r.name) + "</div>" +
        (r.text ? '<div class="t">' + inline(r.text) + "</div>" : "") +
        (r.bad ? '<div class="ex bad"><span class="m">' + ico("x") + "</span><span>" + inline(r.bad) + "</span></div>" : "") +
        (r.good ? '<div class="ex good"><span class="m">' + ico("check") + "</span><span>" + inline(r.good) + "</span></div>" : "") +
        "</div>";
    }).join("") + "</div>";
  }

  function trapsHTML(s) {
    return '<div class="traps">' + s.traps.map(function (t) {
      return '<div class="trap"><b>' + ico("alert") + inline(t[0]) + "</b>" + inline(t[1]) + "</div>";
    }).join("") + "</div>";
  }

  function spotHTML(s) {
    return '<div class="spotlist">' + s.spot.map(function (c) { return "<span>" + inline(c[0]) + "</span>"; }).join("") + "</div>";
  }

  function rulesTitle(s) { return s.rules_title || "Rules"; }

  // Which notebook pages have been copied into the student's book (this browser only).
  function copiedSet() {
    try { return JSON.parse(localStorage.getItem("notesCopied") || "[]"); } catch (e) { return []; }
  }
  function setCopied(unit, on) {
    var list = copiedSet().filter(function (u) { return u !== unit; });
    if (on) list.push(unit);
    try { localStorage.setItem("notesCopied", JSON.stringify(list)); } catch (e) { }
  }
  function wireCopied(root) {
    each(root.querySelectorAll("[data-copied]"), function (b) {
      b.onclick = function () {
        var u = b.getAttribute("data-copied"), on = b.getAttribute("aria-pressed") !== "true";
        setCopied(u, on);
        b.setAttribute("aria-pressed", String(on));
        b.innerHTML = (on ? ico("check") : "") + (on ? "In my book" : "Copied it?");
        each(document.querySelectorAll('.notes-jump a[href="#note-' + u + '"]'), function (a) { a.classList.toggle("copied", on); });
      };
    });
  }

  // One notebook page per question type: what to copy into your book.
  function noteCardHTML(unit, opts) {
    var n = CONFIG.notes[unit], u = CONFIG.units[unit];
    if (!n) return "";
    opts = opts || {};
    return '<article class="notecard ' + dc(unit) + (opts.dim ? " dim" : "") + '" id="note-' + unit + '">' +
      '<header><div><div class="nc-dom">' + esc(u.domainTitle) + '</div><h3>' + esc(u.title) + '</h3></div>' +
      '<span class="nc-mantra">' + esc(n.mantra) + "</span>" +
      (function () {
        var on = copiedSet().indexOf(unit) >= 0;
        return '<button type="button" class="nc-copied" data-copied="' + unit + '" aria-pressed="' + on + '">' + (on ? ico("check") + "In my book" : "Copied it?") + "</button>";
      })() + "</header>" +
      '<div class="nc-cols"><div>' +
      '<div class="nc-k">Spot it</div><p>' + esc(n.spot) + "</p>" +
      '<div class="nc-k">Steps</div><ol>' + n.steps.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ol>" +
      '</div><div>' +
      '<div class="nc-k">Remember</div><ul>' + n.remember.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" +
      '<div class="nc-k">Trap</div><p class="nc-trap">' + esc(n.trap) + "</p>" +
      "</div></div></article>";
  }

  function WorkedExample(container, ex, onNext, nextLabel, unit) {
    var picked = null;
    setTutorContext({ unit: unit, exampleId: ex.id, where: "Worked example: " + ex.title });
    var hasPassage = !!(ex.passage || ex.data);
    var root = el('<div class="' + dc(unit) + '"></div>');
    root.innerHTML =
      '<div class="qwrap' + (hasPassage ? "" : " single") + '">' +
      (hasPassage ? '<div class="qpassage">' + chart(ex.data) + md(ex.passage) + "</div>" : "") +
      '<div class="qside"><div class="qmeta"><span class="chip dom">' + esc(ex.title) + '</span></div><div class="qtext">' + md(ex.question) + '</div><div class="choices"></div>' +
      '<div class="qactions"><button class="btn primary" data-act="reveal">' + ico("play") + 'Show me how</button><span class="muted small">Or pick an answer first.</span></div></div></div>' +
      '<div class="walkslot"></div>';
    var ch = root.querySelector(".choices");
    ex.choices.forEach(function (c, i) {
      var d = el('<div class="choice"><button class="pick" type="button"><span class="letter">' + LETTERS[i] + "</span><span>" + inline(c) + "</span></button></div>");
      d.querySelector(".pick").onclick = function () {
        if (root.querySelector(".walk")) return;
        picked = LETTERS[i];
        each(ch.children, function (x, j) { x.classList.toggle("sel", j === i); });
      };
      ch.appendChild(d);
    });
    root.querySelector('[data-act="reveal"]').onclick = function () {
      root.querySelector(".qactions").remove();
      each(ch.children, function (x, j) {
        x.classList.remove("sel"); x.classList.add("locked");
        if (LETTERS[j] === ex.answer) x.classList.add("correct"); else if (LETTERS[j] === picked) x.classList.add("wrong");
      });
      var good = picked === ex.answer;
      var w = el('<div class="fb walk ' + (picked ? (good ? "is-good" : "is-bad") : "") + '"></div>');
      w.innerHTML =
        (picked ? '<div class="verdict"><span class="badge">' + ico(good ? "check" : "x") + "</span>" + (good ? "You got it." : "It's " + ex.answer + ". Here's why.") + "</div>" : "") +
        "<ol>" + ex.steps.map(function (s) { return "<li>" + inline(s) + "</li>"; }).join("") + "</ol>" +
        '<div class="tipline">' + ico("alert") + "<span><b>Trap:</b> " + inline(ex.traps[0]) + "</span></div>" +
        '<details><summary>Every choice explained</summary><ul class="whylist">' + ex.why.map(function (t, i) {
          return '<li class="' + (LETTERS[i] === ex.answer ? "ok" : "") + '"><span class="l">' + LETTERS[i] + "</span><span>" + inline(t) + "</span></li>";
        }).join("") + "</ul></details>" +
        '<div class="fb-actions"><span class="spacer"></span><button class="btn primary" data-act="next">' + esc(nextLabel) + ico("next") + "</button></div>";
      w.querySelector('[data-act="next"]').onclick = onNext;
      root.querySelector(".walkslot").appendChild(w);
      w.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    container.innerHTML = "";
    container.appendChild(root);
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------------ nav
  function setNav(name) {
    each(document.querySelectorAll(".mainnav a"), function (a) {
      a.classList.toggle("active", a.getAttribute("data-nav") === name);
    });
  }

  // ------------------------------------------------------------------ home
  var KIND_LABEL = { "new": "New", reinforce: "Second look", review: "Refresh" };

  function topicChips(topics) {
    return topics.map(function (t) {
      return '<span class="tchip d-' + t.domain + '"><i></i>' + esc(t.title) + (t.kind !== "new" ? '<em>' + esc(KIND_LABEL[t.kind]) + "</em>" : "") + "</span>";
    }).join("");
  }

  function dayLabel(day, i) {
    if (i === 0) return "Today";
    if (i === 1) return "Tomorrow";
    return new Date(day + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  }

  function lengthPicker(minutes, locked) {
    return '<div class="lenpick" role="radiogroup" aria-label="Study length">' + [30, 60].map(function (m) {
      return '<button type="button" role="radio" data-min="' + m + '" aria-checked="' + (m === minutes) + '" class="' + (m === minutes ? "on" : "") + '"' + (locked ? " disabled" : "") + ">" +
        '<b>' + m + ' min</b><span>' + (m === 30 ? "1 topic" : "2 topics") + "</span></button>";
    }).join("") + "</div>";
  }

  function shortDay(day) {
    return new Date(day + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  }

  function weekHTML(days) {
    return '<ol class="week">' + days.map(function (d, i) {
      var mark = d.status === "done" ? '<span class="wk-done" title="Done">' + ico("check") + "</span>" :
        d.status === "in_progress" ? '<span class="chip">In progress</span>' : '<span class="wk-open">' + ico("next") + "</span>";
      return '<li class="' + (i === 0 ? "is-today" : "") + (d.status === "done" ? " is-done" : "") + '" data-i="' + i + '">' +
        '<button type="button" class="wk-row" aria-expanded="false"><span class="wk-day">' + esc(dayLabel(d.day, i)) + "</span>" +
        '<span class="wk-topics">' + topicChips(d.topics) + "</span>" +
        '<span class="wk-meta">' + d.minutes + " min" + (d.reviews ? " · " + d.reviews + " review" + (d.reviews > 1 ? "s" : "") : "") + "</span>" + mark + "</button></li>";
    }).join("") + "</ol>";
  }

  function dayDetailHTML(d, canStart) {
    var practice = d.questions - d.reviews;
    return '<div class="wk-detail">' + d.topics.map(function (t) {
      var sh = CONFIG.short[t.unit] || {};
      return '<div class="wk-lesson d-' + t.domain + '"><div class="nm">' + esc(t.title) +
        (t.kind !== "new" ? ' <span class="chip">' + esc(KIND_LABEL[t.kind]) + "</span>" : "") + "</div>" +
        '<div class="tg">' + esc(sh.tagline || "") + "</div>" +
        (t.reason ? '<div class="rs">' + esc(t.reason) + "</div>" : "") +
        '<a class="linkbtn small" href="#/notes?u=' + t.unit + '">Preview the notes</a></div>';
    }).join("") +
      '<div class="wk-sum">Video lesson' + (d.topics.length > 1 ? "s" : "") + ", worked example" + (d.minutes > 30 ? "s" : "") + ", " +
      practice + " questions" + (d.reviews ? " + " + d.reviews + " mistake review" + (d.reviews > 1 ? "s" : "") : "") + "</div>" +
      (canStart ? '<button class="btn primary" data-act="ahead">' + ico("play") + "Start it now</button>" :
        d.aheadHint ? '<p class="muted small" style="margin:10px 0 0">' + esc(d.aheadHint) + "</p>" : "") +
      (d.sessionId && d.status === "done" ? '<a class="btn" href="#/session/' + d.sessionId + '">' + ico("list") + "Look back</a>" : "") +
      "</div>";
  }

  function courseHTML(c, minutes) {
    var pct = Math.round(c.taught / c.total * 100);
    var f = c.finish || {};
    var line = c.taught >= c.total ? "Every question type taught. Now it's all review and mastery." :
      "All " + c.total + " by <b>" + esc(f[String(minutes)] ? shortDay(f[String(minutes)]) : "soon") + "</b> at " + minutes + " min a day" +
      (f[minutes === 30 ? "60" : "30"] ? " (" + esc(shortDay(f[minutes === 30 ? "60" : "30"])) + " at " + (minutes === 30 ? 60 : 30) + " min)" : "") + ".";
    return '<div class="course"><div class="course-bar" role="img" aria-label="' + c.taught + " of " + c.total + ' question types taught"><i style="width:' + pct + '%"></i></div>' +
      '<div class="course-text"><b>' + c.taught + " of " + c.total + "</b> question types taught. " + line + "</div></div>";
  }

  function pageHome() {
    setNav("home");
    setTutorContext({});
    app.innerHTML = '<div class="loading">Loading…</div>';
    api("home").then(function (h) {
      var st = h.status, minutes = h.minutes;
      var dateLine = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
      var locked = st.status === "in_progress" || st.status === "carried_over";
      var ahead = st.ahead || {};
      app.innerHTML =
        '<section class="today"><div class="today-date">' + esc(dateLine) + "</div>" +
        (st.status === "complete" ? '<div style="margin:14px 0 6px"><span class="done-mark">' + ico("check") + "Today's practice is done</span></div>" : "") +
        '<div id="hero"></div></section>' +
        '<section class="block"><div class="row"><h2>Your plan</h2><span class="spacer"></span>' +
        '<span id="lenslot" class="row"></span></div>' +
        '<div id="course"></div>' +
        '<p class="muted small" style="margin:4px 0 12px">Tap a day to see its lessons. The plan changes with the length you pick and how you do.</p><div id="week"><div class="loading">Planning…</div></div></section>' +
        '<div class="tiles three block">' +
        '<a class="tile d-SEC" href="#/journal">' + ico("bookmark") + '<span class="big">' + h.upcoming[0].count + '</span><span><span class="t">Mistakes due</span><br><span class="s">' + (h.upcoming[0].count ? "Review them now" : "Nothing due today") + "</span></span></a>" +
        '<a class="tile d-II" href="#/notes">' + ico("pencil") + '<span><span class="t">Notes</span><br><span class="s">Every lesson on one page</span></span></a>' +
        '<a class="tile" href="#/tutor">' + ico("chat") + '<span><span class="t">' + (h.tutor ? "Ask the tutor" : "Set up your tutor") + '</span><br><span class="s">' + (h.tutor ? "Stuck? Ask anything." : "Free with a Gemini key") + "</span></span></a></div>";

      function startAhead(btn) {
        if (btn) btn.disabled = true;
        api("session/start", { body: { minutes: minutes, ahead: true } }).then(function (s) { location.hash = "#/session/" + s.id; }).catch(err(app));
      }

      function draw(plan) {
        var today = plan.days[0];
        var hero = document.getElementById("hero");
        var label = st.status === "complete" ? "Done today" : st.status === "ready" ? "Today's lessons" : "In progress";
        var action;
        if (st.status === "ready") action = '<button class="btn primary big" data-act="start">' + ico("play") + '<span>Start <span class="n">' + minutes + "</span>-minute session</span></button>";
        else if (locked) action = '<a class="btn primary big" href="#/session">' + ico("play") + "Resume today's practice</a>" +
          (st.status === "carried_over" ? '<p class="muted small" style="margin-top:10px">Unfinished from ' + esc(fmtDay(st.session.day).toLowerCase()) + ". Finish it first.</p>" : "");
        else {
          var aheadBtn = "";
          if (ahead.status === "in_progress") aheadBtn = '<a class="btn primary" href="#/session/' + ahead.sessionId + '">' + ico("play") +
            (ahead.day === plan.days[1].day ? "Resume tomorrow's session" : "Resume the " + esc(shortDay(ahead.day)) + " session") + "</a>";
          else if (ahead.status === "ready") aheadBtn = '<button class="btn primary" data-act="ahead">' + ico("next") + (ahead.day === plan.days[1].day ? "Do tomorrow's now" : "Do " + esc(shortDay(ahead.day)) + " now") + "</button>";
          action = '<div class="row">' + aheadBtn + '<a class="btn" href="#/session">' + ico("list") + 'Look back at today</a><a class="btn" href="#/practice?mode=extra">' + ico("redo") + "Keep practising</a></div>";
        }
        hero.innerHTML = '<div class="muted" style="font-weight:700">' + label + "</div>" +
          '<h1 class="today-topic">' + today.topics.map(function (t) { return '<span class="d-' + t.domain + '"><span class="swipe">' + esc(t.title) + "</span></span>"; }).join('<span class="plus"> + </span>') + "</h1>" +
          (st.status === "complete" ? '<p class="today-why"></p>' : '<p class="today-why">' + esc(today.topics[0].reason || "") + "</p>") +
          (st.status === "ready" ? lengthPicker(minutes, false) : "") + '<div style="margin-top:18px">' + action + "</div>";
        document.getElementById("lenslot").innerHTML = st.status === "ready" ? "" : '<span class="muted small">Plan with</span>' + lengthPicker(minutes, false);
        document.getElementById("course").innerHTML = plan.course ? courseHTML(plan.course, minutes) : "";
        var week = document.getElementById("week");
        week.innerHTML = weekHTML(plan.days);
        each(week.querySelectorAll(".week li"), function (li) {
          var i = +li.getAttribute("data-i"), d = plan.days[i], row = li.querySelector(".wk-row");
          row.onclick = function () {
            var open = li.querySelector(".wk-detail");
            if (open) { open.remove(); row.setAttribute("aria-expanded", "false"); li.classList.remove("open"); return; }
            var canStart = st.status === "complete" && ahead.status === "ready" && d.day === ahead.day;
            d.aheadHint = !canStart && i === 1 && st.status !== "complete" && d.status !== "done" ?
              "Want to do this one early? Finish today's session first, then it can start straight away." : "";
            li.insertAdjacentHTML("beforeend", dayDetailHTML(d, canStart));
            row.setAttribute("aria-expanded", "true"); li.classList.add("open");
            var b = li.querySelector('[data-act="ahead"]');
            if (b) b.onclick = function () { startAhead(b); };
          };
        });
        each(app.querySelectorAll(".lenpick button"), function (b) {
          b.onclick = function () {
            var m = +b.getAttribute("data-min");
            if (m === minutes) return;
            minutes = m;
            api("settings/minutes", { body: { minutes: m } });
            week.style.opacity = .5;
            api("plan?minutes=" + m).then(function (p) { week.style.opacity = 1; draw(p); });
          };
        });
        var sb = hero.querySelector('[data-act="start"]');
        if (sb) sb.onclick = function () {
          sb.disabled = true;
          api("session/start", { body: { minutes: minutes } }).then(function () { location.hash = "#/session"; }).catch(err(app));
        };
        var ab = hero.querySelector('[data-act="ahead"]');
        if (ab) ab.onclick = function () { startAhead(ab); };
      }
      api("plan?minutes=" + minutes).then(draw).catch(err(document.getElementById("week")));
    }).catch(err(app));
  }

  // ------------------------------------------------------------------ daily session
  var STAGE_NAMES = { review: "Review", lesson: "Lesson", examples: "Examples", practice: "Practice", mixed: "Mixed", summary: "Finish" };

  function pageSession(id) {
    setNav("home");
    app.innerHTML = '<div class="loading">Loading…</div>';
    if (id) { api("session/" + id).then(runSession).catch(err(app)); return; }
    api("home").then(function (h) {
      var st = h.status;
      if (st.status === "ready") return api("session/start", { body: { minutes: h.minutes } }).then(runSession);
      runSession(st.session);
    }).catch(err(app));
  }

  function runSession(s) {
    var stages = s.plan.stages;
    var answers = s.state.answers = s.state.answers || {};
    var stageIdx = s.status === "complete" ? stages.length - 1 : Math.min(s.state.stage, stages.length - 1);
    var seen = Math.max(s.state.max || 0, stageIdx);

    function save(stage, index) {
      if (s.status === "complete") return;
      s.state.stage = stage; s.state.index = index;
      api("session/" + s.id + "/advance", { body: { stage: stage, index: index } });
    }
    function answeredIn(stg) { return (stg.questions || []).filter(function (q) { return answers[q]; }).length; }
    function isDone(i) {
      var stg = stages[i];
      if (stg.type === "summary") return s.status === "complete";
      if (stg.questions) return stg.questions.length > 0 && answeredIn(stg) === stg.questions.length;
      return i < seen || s.status === "complete";
    }
    function firstOpen(stg) {
      var qs = stg.questions || [];
      for (var k = 0; k < qs.length; k++) if (!answers[qs[k]]) return k;
      return 0;
    }

    function frame() {
      var stg = stages[stageIdx];
      var unit = stg.unit || (stages.filter(function (x) { return x.unit; })[0] || {}).unit;
      var steps = stages.map(function (x, i) {
        var label = x.type === "lesson" ? esc(CONFIG.units[x.unit].title) : STAGE_NAMES[x.type];
        var count = x.questions ? '<small>' + answeredIn(x) + "/" + x.questions.length + "</small>" : "";
        var cls = (i === stageIdx ? "cur " : "") + (isDone(i) ? "done " : "") + (x.unit ? dc(x.unit) : "");
        return '<button type="button" data-i="' + i + '" class="' + cls + '"' + (i === stageIdx ? ' aria-current="step"' : "") + ">" +
          (isDone(i) ? ico("check") : x.type === "lesson" ? '<i class="dot"></i>' : "") + "<span>" + label + "</span>" + count + "</button>";
      }).join("");
      app.innerHTML =
        '<div class="' + (unit ? dc(unit) : "") + '"><div class="sess-head"><h1><span class="swipe">' +
        esc(stg.unit ? CONFIG.units[stg.unit].title : stg.type === "summary" ? "Finish" : stg.title) + "</span></h1>" +
        '<span class="chip">' + (s.plan.minutes || 30) + " min</span>" + (s.day > localDate() ? '<span class="chip dom">' + esc(fmtDay(s.day)) + "'s session, early</span>" : s.day < localDate() && s.status !== "complete" ? '<span class="chip">From ' + esc(fmtDay(s.day).toLowerCase()) + "</span>" : "") +
        (s.status === "complete" ? '<span class="chip good">Done</span>' : "") + "</div>" +
        '<nav class="steps" aria-label="Today\'s steps">' + steps + '</nav><div id="stage"></div></div>';
      each(app.querySelectorAll(".steps button"), function (b) {
        b.onclick = function () { jump(+b.getAttribute("data-i")); };
      });
      var cur = app.querySelector(".steps .cur");
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest", inline: "center" });
      return document.getElementById("stage");
    }

    function jump(i) {
      stageIdx = i; seen = Math.max(seen, i);
      var idx = stages[i].questions ? firstOpen(stages[i]) : 0;
      save(i, idx);
      go(idx);
    }
    function next() { if (stageIdx + 1 < stages.length) jump(stageIdx + 1); }

    function go(startAt) {
      var stg = stages[stageIdx];
      var box = frame();
      var nextName = stageIdx + 1 < stages.length ? (stages[stageIdx + 1].type === "lesson" ? CONFIG.units[stages[stageIdx + 1].unit].title : STAGE_NAMES[stages[stageIdx + 1].type]) : "";
      setTutorContext({ unit: stg.unit || s.unit, where: "Daily practice: " + stg.title });
      if (stg.questions) {
        var qbox = el("<div></div>");
        box.appendChild(qbox);
        QuestionRunner(qbox, {
          ids: stg.questions, context: stg.type === "review" ? "review" : "daily", sessionId: s.id,
          startIndex: startAt !== undefined ? startAt : (stageIdx === s.state.stage ? s.state.index : 0),
          answered: answers, label: STAGE_NAMES[stg.type], doneLabel: "Next: " + nextName,
          onIndex: function (i) { if (s.state.index !== i || s.state.stage !== stageIdx) save(stageIdx, i); },
          onAnswer: function () { frameCounts(); },
          onDone: next
        });
        return;
      }
      if (stg.type === "lesson") {
        api("masterclass/" + stg.unit).then(function (d) {
          var sh = d.short, banner = "";
          if (stg.mode === "reteach") banner = '<div class="notice"><b>Second look.</b> Watch again, then go slowly through the steps.</div>';
          if (stg.mode === "revision") banner = '<div class="notice"><b>Quick refresh.</b> You\'ve mastered this. Skim your notes and the rules.</div>';
          var vid = stg.mode === "revision" ? '<details><summary>Watch the video again</summary>' + videoHTML(d.video, stg.unit) + "</details>" : videoHTML(d.video, stg.unit);
          var exRules = sh.rules.filter(function (r) { return r.good || r.bad; });
          box.innerHTML = banner + vid +
            '<div class="block"><div class="row nc-head"><h2>' + ico("pencil") + "Write this down</h2><span class=\"muted small\">Copy it into your book. It's the whole lesson on one page.</span></div>" + noteCardHTML(stg.unit) + "</div>" +
            (exRules.length ? '<div class="block"><h2>' + ico("list") + esc(rulesTitle(sh)) + " with examples</h2>" + rulesHTML({ rules: exRules }) + "</div>" : "") +
            '<details class="block more"><summary>More detail: the method step by step, and every trap</summary>' +
            attackHTML(sh) + (exRules.length < sh.rules.length ? rulesHTML({ rules: sh.rules.filter(function (r) { return !(r.good || r.bad); }) }) : "") + trapsHTML(sh) + "</details>" +
            '<div class="next-row"><button class="btn primary big" data-act="n">Next: ' + esc(nextName) + ico("next") + "</button></div>";
          wireVideo(box, stg.unit);
          wireCopied(box);
          box.querySelector('[data-act="n"]').onclick = next;
          window.scrollTo(0, 0);
        }).catch(err(box));
        return;
      }
      if (stg.type === "examples") {
        api("worked/" + stg.unit).then(function (all) {
          var list = stg.examples ? all.filter(function (e) { return stg.examples.indexOf(e.id) >= 0; }) : all;
          if (!list.length) { box.innerHTML = '<div class="empty">No worked example for this one.</div><div class="next-row"><button class="btn primary" data-act="n">Next: ' + esc(nextName) + "</button></div>"; box.querySelector('[data-act="n"]').onclick = next; return; }
          var i = 0;
          (function showEx() {
            WorkedExample(box, list[i], function () { i++; if (i < list.length) showEx(); else next(); },
              i + 1 < list.length ? "Next example" : "Next: " + nextName, stg.unit);
          })();
        }).catch(err(box));
        return;
      }
      if (stg.type === "summary") {
        if (s.status === "complete") return renderSummary(box, s);
        var left = stages.reduce(function (n, x) { return n + (x.questions ? x.questions.length - answeredIn(x) : 0); }, 0);
        box.innerHTML = '<div class="panel"><h2>' + (left ? left + " question" + (left > 1 ? "s" : "") + " not answered yet" : "All done. Nice work.") + "</h2>" +
          '<p class="muted" style="margin:8px 0 16px">' + (left ? "Go back with the steps above, or finish now." : "Finish to save it and set up the next day.") + "</p>" +
          '<button class="btn primary big" data-act="finish">' + ico("check") + (s.day > localDate() ? "Finish this session" : "Finish today's session") + "</button></div>";
        box.querySelector('[data-act="finish"]').onclick = function () {
          this.disabled = true;
          api("session/" + s.id + "/complete", { body: {} }).then(function (done) {
            s.status = done.status; s.summary = done.summary; s.completedDay = done.completedDay;
            renderSummary(frame(), s);
          }).catch(err(box));
        };
      }
    }
    function frameCounts() {
      each(app.querySelectorAll(".steps button"), function (b) {
        var i = +b.getAttribute("data-i"), x = stages[i], sm = b.querySelector("small");
        if (sm && x.questions) sm.textContent = answeredIn(x) + "/" + x.questions.length;
        if (isDone(i) && !b.classList.contains("done")) { b.classList.add("done"); var d = b.querySelector(".dot"); if (d) d.remove(); b.insertAdjacentHTML("afterbegin", ico("check")); }
      });
    }
    go();
  }

  function renderSummary(box, s) {
    var m = s.summary;
    function stat(label, acc, n) {
      if (!n) return "";
      return '<div class="stat"><div class="v">' + Math.round(acc * n) + "/" + n + '</div><div class="k">' + label + "</div></div>";
    }
    var topics = m.topics || [{ unitTitle: m.unitTitle, accuracy: m.practiceAccuracy, answered: m.practiceAnswered, level: m.level, mantra: m.mantra, unit: m.unit }];
    var unsaved = m.unsaved || [];
    box.innerHTML =
      '<div class="done-mark">' + ico("check") + "Session complete</div>" +
      '<div class="stats">' + stat("Review", m.reviewAccuracy, m.reviewAnswered) + stat("Mixed", m.mixedAccuracy, m.mixedAnswered) + "</div>" +
      '<div class="block"><h2>' + ico("target") + "Today's topics</h2>" + topics.map(function (t) {
        return '<div class="topic-row ' + dc(t.unit) + '"><div><div class="nm">' + esc(t.unitTitle) + '</div><div class="mantra"><span class="swipe">' + esc(t.mantra) + "</span></div></div>" +
          '<span class="spacer"></span>' + (t.answered ? '<span class="chip">' + Math.round(t.accuracy * t.answered) + "/" + t.answered + " right</span>" : "") +
          '<span class="chip">' + esc(t.level) + "</span></div>";
      }).join("") + "</div>" +
      (unsaved.length ? '<div class="block notice"><div class="row"><span><b>' + unsaved.length + " missed question" + (unsaved.length > 1 ? "s" : "") +
        " not in your journal.</b></span><span class=\"spacer\"></span><button class=\"btn primary\" data-act=\"saveall\">" + ico("bookmark") + "Add " + (unsaved.length > 1 ? "all " + unsaved.length : "it") + "</button></div></div>" : "") +
      '<div class="block notes-nudge">' + ico("pencil") + "<span><b>Notes copied?</b> Today's " + (topics.length > 1 ? "pages are" : "page is") + " on the Notes page.</span>" +
      topics.map(function (t) { return '<a class="btn small" href="#/notes?u=' + t.unit + '">' + esc(CONFIG.units[t.unit] ? CONFIG.units[t.unit].title : t.unitTitle) + "</a>"; }).join("") + "</div>" +
      '<div class="block" id="tmr"></div>' +
      '<div class="next-row"><a class="btn primary" href="#/">' + ico("check") + 'Back to home</a><a class="btn" href="#/practice?mode=extra">' + ico("redo") + "Keep practising</a></div>";
    var sa = box.querySelector('[data-act="saveall"]');
    if (sa) sa.onclick = function () {
      sa.disabled = true;
      api("mistakes/add-many", { body: { items: unsaved.map(function (u) { return { questionId: u.id, selected: u.selected }; }) } }).then(function () {
        sa.outerHTML = '<span class="btn good">' + ico("check") + "Added</span>";
      });
    };
    Promise.all([api("plan"), api("home")]).then(function (r) {
      var p = r[0], ahead = (r[1].status || {}).ahead || {};
      var t = p.days.filter(function (d) { return d.day > s.day && d.status !== "done"; })[0];
      if (!t) return;
      var early = r[1].status.status === "complete" && ahead.status === "ready" && ahead.day === t.day;
      var tmr = box.querySelector("#tmr");
      tmr.innerHTML = '<div class="panel"><div class="label">Next · ' + esc(fmtDay(t.day)) + " · " + t.minutes + ' min</div><div class="wk-topics">' + topicChips(t.topics) +
        '</div><p class="muted small" style="margin:8px 0 0">' + (t.reviews ? t.reviews + " mistake review" + (t.reviews > 1 ? "s" : "") + " first. " : "") +
        'Change the length on the home page.</p>' +
        (early ? '<button class="btn" data-act="ahead" style="margin-top:14px">' + ico("next") + (fmtDay(t.day) === "Tomorrow" ? "Do tomorrow's now" : "Do " + esc(fmtDay(t.day)) + "'s now") + "</button>" : "") + "</div>";
      var ab = tmr.querySelector('[data-act="ahead"]');
      if (ab) ab.onclick = function () {
        ab.disabled = true;
        api("session/start", { body: { minutes: t.minutes, ahead: true } }).then(function (ns) { location.hash = "#/session/" + ns.id; }).catch(err(tmr));
      };
    });
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------------ generic practice
  function pagePractice(params) {
    setNav(params.mode === "due" ? "journal" : "home");
    var title, path, ctx = "drill";
    if (params.mode === "due") { title = "Due mistakes"; ctx = "review"; }
    else if (params.mode === "extra") { title = "Extra practice"; path = "drill?unit=mixed&n=10"; ctx = "extra"; }
    else { title = CONFIG.units[params.unit].title; path = "drill?unit=" + encodeURIComponent(params.unit) + "&n=10"; }
    app.innerHTML = '<div class="' + (params.unit ? dc(params.unit) : "d-II") + '"><div class="sess-head"><h1><span class="swipe">' + esc(title) + "</span></h1>" +
      (params.mode === "extra" ? '<span class="chip">Won\'t change tomorrow</span>' : "") + '</div><div id="pr"></div></div>';
    var box = document.getElementById("pr");
    var load = params.mode === "due"
      ? api("mistakes?status=due").then(function (r) { return r.mistakes.map(function (m) { return m.questionId; }); })
      : api(path).then(function (r) { return r.questions; });
    load.then(function (ids) {
      QuestionRunner(box, {
        ids: ids, context: ctx, label: title, doneLabel: "Finish",
        onDone: function (results) {
          var n = Object.keys(results).length, c = Object.keys(results).filter(function (k) { return results[k]; }).length;
          box.innerHTML = '<div class="stats"><div class="stat"><div class="v">' + (n ? c + "/" + n : "0") + '</div><div class="k">' + (n ? "Correct" : "Nothing to practise") + "</div></div></div>" +
            '<div class="next-row">' + (params.unit ? '<a class="btn primary" href="#/practice?unit=' + params.unit + '">' + ico("redo") + 'Another set</a><a class="btn" href="#/">Home</a>' :
              '<a class="btn primary" href="#/">Home</a><a class="btn" href="#/journal">Mistake Journal</a>') + "</div>";
        }
      });
    }).catch(err(box));
  }

  // ------------------------------------------------------------------ notes
  function pageNotes(params) {
    params = params || {};
    setNav("notes");
    setTutorContext({});
    app.innerHTML = '<div class="loading">Loading…</div>';
    api("notes").then(function (r) {
      var taught = r.units.filter(function (x) { return x.taught; }), later = r.units.filter(function (x) { return !x.taught; });
      app.innerHTML =
        '<div class="row notes-head"><h1>Notes</h1><span class="spacer"></span><button class="btn" data-act="print">' + ico("printer") + "Print</button></div>" +
        '<p class="muted" style="margin:6px 0 20px">One page per question type. Copy each one into your book after its lesson.</p>' +
        '<nav class="notes-jump">' + r.units.map(function (x) {
          return '<a href="#note-' + x.unit + '" class="' + dc(x.unit) + (x.taught ? "" : " later") + (copiedSet().indexOf(x.unit) >= 0 ? " copied" : "") + '"><i></i>' + esc(CONFIG.units[x.unit].title) + "</a>";
        }).join("") + "</nav>" +
        (taught.length ? '<h2 class="notes-sec">Taught so far</h2>' + taught.map(function (x) { return noteCardHTML(x.unit); }).join("")
          : '<div class="empty">Your first lesson adds its page here.</div>') +
        (later.length ? '<h2 class="notes-sec">Coming up</h2>' + later.map(function (x) { return noteCardHTML(x.unit, { dim: true }); }).join("") : "");
      app.querySelector('[data-act="print"]').onclick = function () { window.print(); };
      wireCopied(app);
      if (params.u && document.getElementById("note-" + params.u)) {
        var target = document.getElementById("note-" + params.u);
        target.classList.add("flash");
        setTimeout(function () { target.scrollIntoView({ block: "start" }); }, 30);
      }
      each(app.querySelectorAll(".notes-jump a"), function (a) {
        a.onclick = function (e) {
          e.preventDefault();
          var t = document.getElementById(a.getAttribute("href").slice(1));
          if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
        };
      });
    }).catch(err(app));
  }

  // ------------------------------------------------------------------ journal
  var journalState = { unit: "", status: "due" };

  function pageJournal() {
    setNav("journal");
    setTutorContext({});
    app.innerHTML = '<div class="loading">Loading…</div>';
    var q = "mistakes?status=" + journalState.status + (journalState.unit ? "&unit=" + journalState.unit : "");
    api(q).then(function (r) {
      var unitOpts = '<option value="">All question types</option>' + CONFIG.sequence.slice().sort(function (a, b) {
        return CONFIG.units[a].title.localeCompare(CONFIG.units[b].title);
      }).map(function (u) { return '<option value="' + u + '"' + (u === journalState.unit ? " selected" : "") + ">" + esc(CONFIG.units[u].title) + "</option>"; }).join("");
      var tabs = [["due", "Due now"], ["upcoming", "Upcoming"], ["all", "All"]].map(function (t) {
        return '<button data-s="' + t[0] + '" class="' + (journalState.status === t[0] ? "on" : "") + '">' + t[1] + "</button>";
      }).join("");
      var cats = {};
      CONFIG.categories.forEach(function (c) { cats[c.id] = c.label; });
      app.innerHTML =
        '<div class="row"><h1>Mistake Journal</h1><span class="spacer"></span>' +
        (r.due ? '<a class="btn primary big" href="#/practice?mode=due">' + ico("play") + "Practise " + r.due + " due</a>" : "") + "</div>" +
        '<p class="muted" style="margin-top:6px">Saved questions come back after 1, 3, 7, 14, 30 and 60 days.</p>' +
        '<div class="filters"><select id="fu" aria-label="Question type">' + unitOpts + '</select><div class="tabs" id="ft">' + tabs + "</div></div>" +
        '<div id="ml">' + (r.mistakes.length ? "" : '<div class="empty">' + (journalState.status === "due" ? "Nothing due. Nice." : "No saved mistakes here yet. Use “Add to Mistake Journal” after a question.") + "</div>") + "</div>";
      document.getElementById("fu").onchange = function () { journalState.unit = this.value; pageJournal(); };
      each(document.querySelectorAll("#ft button"), function (b) { b.onclick = function () { journalState.status = b.getAttribute("data-s"); pageJournal(); }; });
      var ml = document.getElementById("ml");
      r.mistakes.forEach(function (m) {
        var due = m.dueDay <= localDate();
        var item = el('<div class="mistake ' + dc(m.unit) + '"><div class="mistake-head" role="button" tabindex="0">' +
          '<span class="nm">' + esc(m.unitTitle) + '</span><span class="sk">' + esc(m.skill) + '</span><span class="spacer"></span>' +
          (m.unsure ? '<span class="chip">Guessed</span>' : '<span class="chip">' + esc(cats[m.category] || m.category) + "</span>") +
          '<span class="chip">Missed ' + m.timesWrong + "×</span>" +
          '<span class="chip ' + (due ? "bad" : "") + '">' + (due ? "Due now" : esc(fmtDay(m.dueDay))) + "</span></div></div>");
        var head = item.querySelector(".mistake-head");
        function toggle() {
          var open = item.querySelector(".mistake-body");
          if (open) { open.remove(); return; }
          var fq = m.question;
          var body = el('<div class="mistake-body"></div>');
          var catBtns = CONFIG.categories.map(function (c) { return '<button data-c="' + c.id + '" class="' + (c.id === m.category ? "on" : "") + '" title="' + esc(c.desc) + '">' + esc(c.label) + "</button>"; }).join("");
          body.innerHTML =
            '<div class="qwrap"><div class="qpassage">' + chart(fq.data) + md(fq.passage) + '</div><div class="qside"><div class="qtext">' + md(fq.question) + "</div>" +
            '<div class="choices">' + fq.choices.map(function (c, i) {
              var l = LETTERS[i];
              return '<div class="choice locked ' + (l === fq.answer ? "correct" : l === m.selected ? "wrong" : "") + '"><span class="pick"><span class="letter">' + l + "</span><span>" + inline(c) + "</span></span></div>";
            }).join("") + "</div></div></div>" +
            (m.whyWrong && m.selected !== fq.answer ? '<div class="yours"><b>Your pick (' + esc(m.selected) + "):</b> " + inline(m.whyWrong) + "</div>" : "") +
            '<div class="why"><b>Why ' + fq.answer + " is right:</b> " + inline(fq.explanation) + "</div>" +
            '<div class="tipline">' + ico("bulb") + "<span><b>Rule:</b> " + inline(m.concept) + "</span></div>" +
            '<div class="cats"><span class="q">Mistake type</span>' + catBtns + "</div>" +
            '<div class="fb-actions"><a class="btn" href="#/practice?unit=' + m.unit + '">' + ico("redo") + 'Practise this type</a>' +
            '<button class="btn" data-act="ask">' + ico("chat") + 'Ask tutor</button><span class="spacer"></span><button class="linkbtn" data-act="rm">Remove</button></div>';
          each(body.querySelectorAll(".cats button"), function (b) {
            b.onclick = function () {
              api("mistakes/" + m.questionId + "/category", { body: { category: b.getAttribute("data-c") } }).then(function () {
                m.category = b.getAttribute("data-c");
                each(body.querySelectorAll(".cats button"), function (x) { x.classList.toggle("on", x === b); });
              });
            };
          });
          body.querySelector('[data-act="ask"]').onclick = function () {
            setTutorContext({ unit: m.unit, questionId: m.questionId, selected: m.selected, submitted: true, where: "Mistake Journal" });
            Drawer.open();
          };
          body.querySelector('[data-act="rm"]').onclick = function () {
            if (!confirm("Remove this from your Mistake Journal?")) return;
            api("mistakes/" + m.questionId, { method: "DELETE" }).then(function () { item.remove(); });
          };
          item.appendChild(body);
        }
        head.onclick = toggle;
        head.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } };
        ml.appendChild(item);
      });
    }).catch(err(app));
  }

  // ------------------------------------------------------------------ tutor
  // One chat per thing you're looking at (a question, a worked example, a lesson), so the tutor
  // never mixes up two questions. Stored per browser; the messages themselves live on the server.
  var memThreads = {};
  function tutorSubject() {
    var c = tutorCtx || {};
    return c.questionId ? "q:" + c.questionId : c.exampleId ? "x:" + c.exampleId : c.unit ? "u:" + c.unit : "general";
  }
  function threadMap() {
    try { return JSON.parse(localStorage.getItem("tutorThreads") || "{}") || {}; } catch (e) { return memThreads; }
  }
  function saveThreadMap(m) {
    var keys = Object.keys(m);
    if (keys.length > 200) keys.slice(0, keys.length - 200).forEach(function (k) { delete m[k]; });
    memThreads = m;
    try { localStorage.setItem("tutorThreads", JSON.stringify(m)); } catch (e) { }
  }
  function threadId() {
    var m = threadMap(), k = tutorSubject();
    if (!m[k]) { m[k] = "t" + Date.now() + Math.floor(Math.random() * 1000); saveThreadMap(m); }
    return m[k];
  }
  function newThread() {
    var m = threadMap();
    delete m[tutorSubject()];
    saveThreadMap(m);
  }

  function TutorSetup(container, onSaved) {
    container.innerHTML = '<div class="loading">Loading…</div>';
    api("settings/tutor").then(function (s) {
      function modelOpts(p) {
        return s.models[p].map(function (m) { return '<option value="' + m.id + '"' + (m.id === s.model ? " selected" : "") + ">" + esc(m.label) + "</option>"; }).join("");
      }
      container.innerHTML =
        '<div class="setup">' +
        '<h2>' + ico("key") + (s.hasKey ? " Tutor setup" : " Set up your tutor") + "</h2>" +
        '<ol class="steps"><li>Get a free key: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener"><b>Google AI Studio</b></a> → Create API key.</li><li>Paste it below and press Save.</li></ol>' +
        '<label class="field"' + (WEB ? " hidden" : "") + '><span>Service</span><select data-f="provider"><option value="gemini"' + (s.provider === "gemini" ? " selected" : "") + '>Google Gemini</option>' + (s.models.anthropic ? '<option value="anthropic"' + (s.provider === "anthropic" ? " selected" : "") + ">Anthropic Claude</option>" : "") + "</select></label>" +
        '<label class="field"><span>API key</span><input type="password" data-f="key" autocomplete="off" placeholder="' + (s.hasKey ? "Saved (" + esc(s.keyHint) + "). Paste a new one to replace it." : "Paste your key") + '"></label>' +
        '<label class="field"><span>Model</span><select data-f="model">' + modelOpts(s.provider) + "</select></label>" +
        '<details' + (s.instructions ? " open" : "") + '><summary>Your own tutor instructions (optional)</summary><label class="field"><textarea data-f="instr" placeholder="Paste the instructions from a tutor you made before. They\'re added on top of the SAT tutor\'s rules.">' + esc(s.instructions) + "</textarea></label></details>" +
        '<div class="row"><button class="btn primary" data-act="save">Save</button><button class="btn" data-act="test">Test it</button><span class="small" data-f="status" aria-live="polite"></span></div>' +
        '<p class="muted small">' + (WEB ? "Your key is saved only in this browser, on this device. It goes only to Google, when you ask the tutor something." :
          "Your key is stored only in this app\'s folder on your Mac (config.json) and never sent to the browser.") + "</p></div>";
      var prov = container.querySelector('[data-f="provider"]'), model = container.querySelector('[data-f="model"]'), status = container.querySelector('[data-f="status"]');
      prov.onchange = function () { model.innerHTML = s.models[prov.value].map(function (m) { return '<option value="' + m.id + '">' + esc(m.label) + "</option>"; }).join(""); };
      container.querySelector('[data-act="save"]').onclick = function () {
        status.textContent = "Saving…";
        api("settings/tutor", { body: { provider: prov.value, apiKey: container.querySelector('[data-f="key"]').value, model: model.value,
          instructions: container.querySelector('[data-f="instr"]').value } }).then(function (n) {
          s = n;
          status.textContent = n.hasKey ? "Saved. Testing…" : "Saved, but there's no key yet.";
          container.querySelector('[data-f="key"]').value = "";
          if (n.hasKey) test(true);
        }).catch(function (e) { status.textContent = e.message; });
      };
      function test(thenDone) {
        status.textContent = "Testing…";
        api("tutor/test", { body: {} }).then(function (r) {
          status.textContent = r.ok ? "✓ Connected" : r.detail || "Didn't work.";
          if (r.ok && thenDone && onSaved) setTimeout(onSaved, 700);
        }).catch(function (e) { status.textContent = e.message; });
      }
      container.querySelector('[data-act="test"]').onclick = function () { test(false); };
    }).catch(err(container));
  }

  function suggestionsFor(ctx) {
    ctx = ctx || {};
    var unit = ctx.unit && CONFIG.units[ctx.unit] ? CONFIG.units[ctx.unit].title : null;
    if (ctx.questionId && !ctx.solved) {
      var out = ["Give me a hint", "Which step of the method do I use here?", "What type of question is this?"];
      if (ctx.tries && ctx.tries.length) out.unshift("Why was " + ctx.tries[ctx.tries.length - 1] + " wrong?");
      return out;
    }
    if (ctx.questionId) {
      return (ctx.tries && ctx.tries.length ? ["Why was my first pick wrong?"] : []).concat(
        ["Explain it a different way", "Give me a similar question", "What should I write in my notes?"]);
    }
    if (unit) return ["Explain the " + unit + " method simply", "Quiz me with one question", "What's the most common trap?"];
    return ["What should I focus on next?", "Quiz me on my weakest topic", "Explain one grammar rule"];
  }
  function followUpsFor(ctx) {
    ctx = ctx || {};
    if (ctx.questionId && !ctx.solved) return ["Another hint", "Explain it differently", "Which step of the method am I on?"];
    return ["Explain it differently", "Go deeper", "Give me a similar question"];
  }

  function ChatView(container) {
    container.innerHTML = '<div class="loading">Loading…</div>';
    api("tutor/status").then(function (st) {
      if (!st.configured) { TutorSetup(container, function () { ChatView(container); }); return; }
      var tid = threadId(), image = null;
      container.innerHTML = '<div class="chat"></div><div class="suggest"></div><div class="attach-preview"></div>' +
        '<div class="composer"><button class="iconbtn" data-act="img" title="Attach a screenshot" aria-label="Attach a screenshot">' + ico("image") + "</button>" +
        '<textarea rows="1" placeholder="Ask anything…"></textarea>' +
        '<button class="btn primary" data-act="send">Send</button></div><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>';
      var chatEl = container.querySelector(".chat"), ta = container.querySelector("textarea"), file = container.querySelector("input[type=file]");
      var prev = container.querySelector(".attach-preview"), sug = container.querySelector(".suggest");
      function chips(list) {
        sug.innerHTML = "";
        list.forEach(function (t) {
          var b = el("<button type=\"button\">" + esc(t) + "</button>");
          b.onclick = function () { ta.value = t; send(); };
          sug.appendChild(b);
        });
      }
      chips(suggestionsFor(tutorCtx));
      function add(role, text) {
        var m = el('<div class="msg ' + role + '"></div>');
        if (role === "assistant") m.innerHTML = md(text); else m.textContent = text;
        chatEl.appendChild(m);
        m.scrollIntoView({ block: "end" });
        return m;
      }
      api("tutor/thread/" + tid).then(function (r) {
        if (!r.messages.length) add("assistant", "I can see the question or lesson you're on. Ask anything, or tap a quick question.");
        r.messages.forEach(function (m) { add(m.role, m.content); });
      });
      function setImage(dataUrl, name) {
        image = dataUrl;
        prev.innerHTML = dataUrl ? "Attached: " + esc(name || "screenshot") + ' <button class="linkbtn">Remove</button>' : "";
        var b = prev.querySelector("button");
        if (b) b.onclick = function () { setImage(null); };
      }
      function readFile(f) {
        if (!f || !/^image\//.test(f.type)) return;
        if (f.size > 8 * 1024 * 1024) { alert("That image is too large (max 8 MB)."); return; }
        var rd = new FileReader();
        rd.onload = function () { setImage(rd.result, f.name); };
        rd.readAsDataURL(f);
      }
      container.querySelector('[data-act="img"]').onclick = function () { file.click(); };
      file.onchange = function () { readFile(file.files[0]); file.value = ""; };
      ta.addEventListener("paste", function (e) {
        var items = (e.clipboardData || {}).items || [];
        for (var i = 0; i < items.length; i++) if (items[i].type.indexOf("image") === 0) { readFile(items[i].getAsFile()); e.preventDefault(); }
      });
      function send() {
        var text = ta.value.trim();
        if (!text && !image) return;
        add("user", text + (image ? "\n[screenshot]" : ""));
        ta.value = "";
        var wait = add("assistant", "Thinking…");
        wait.classList.add("typing");
        var img = image;
        setImage(null);
        api("tutor/ask", { body: { threadId: tid, message: text, image: img, context: tutorCtx } }).then(function (r) {
          wait.classList.remove("typing");
          wait.innerHTML = r.ok ? md(r.reply) : md(r.error === "not_configured" ? "The tutor isn't set up yet. Open Settings." : (r.detail || "Something went wrong."));
          if (r.ok) chips(followUpsFor(tutorCtx));
          wait.scrollIntoView({ block: "end" });
        }).catch(function (e) { wait.textContent = "Error: " + e.message; });
      }
      container.querySelector('[data-act="send"]').onclick = send;
      ta.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
      setTimeout(function () { ta.focus(); }, 50);
    }).catch(err(container));
  }

  var Drawer = {
    el: document.getElementById("drawer"),
    open: function () {
      if (location.hash.indexOf("#/tutor") === 0) return;
      this.el.classList.add("open");
      this.el.setAttribute("aria-hidden", "false");
      document.body.classList.add("tutor-open");
      this.subject = tutorSubject();
      ChatView(document.getElementById("drawerBody"));
    },
    close: function () {
      this.el.classList.remove("open"); this.el.setAttribute("aria-hidden", "true");
      document.body.classList.remove("tutor-open");
    },
    // When you move to another question with the tutor open, switch to that question's chat.
    follow: function () {
      if (!this.el.classList.contains("open")) return;
      var subj = tutorSubject();
      if (subj !== this.subject) { this.subject = subj; ChatView(document.getElementById("drawerBody")); }
    }
  };
  document.getElementById("tutorFab").onclick = function () { Drawer.el.classList.contains("open") ? Drawer.close() : Drawer.open(); };
  document.getElementById("drawerClose").onclick = function () { Drawer.close(); };
  document.getElementById("drawerNew").onclick = function () {
    newThread();
    ChatView(document.getElementById("drawerBody"));
  };
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") Drawer.close(); });

  function pageTutor() {
    setNav("tutor");
    setTutorContext({});
    Drawer.close();
    app.innerHTML = '<div class="tutor-page"><div class="row"><h1>AI Tutor</h1><span class="spacer"></span><button class="linkbtn" id="newchat">New chat</button></div>' +
      '<p class="muted" style="margin:6px 0 20px">Your SAT English tutor. While you study, the <b>Ask tutor</b> button shares the question you\'re on.</p><div id="tchat"></div></div>';
    ChatView(document.getElementById("tchat"));
    document.getElementById("newchat").onclick = function () {
      newThread();
      ChatView(document.getElementById("tchat"));
    };
  }

  // ------------------------------------------------------------------ settings
  function pageSettings() {
    setNav("");
    setTutorContext({});
    var theme = "auto";
    try { theme = localStorage.getItem("theme") || "auto"; } catch (e) { }
    app.innerHTML = '<h1>Settings</h1>' +
      '<div class="panel block"><div id="tset"></div></div>' +
      '<div class="panel block"><h2 style="margin-bottom:12px">Appearance</h2><div class="tabs" id="theme">' +
      [["auto", "Match my Mac"], ["light", "Light"], ["dark", "Dark"]].map(function (t) { return '<button data-t="' + t[0] + '" class="' + (theme === t[0] ? "on" : "") + '">' + t[1] + "</button>"; }).join("") + "</div></div>" +
      '<div class="panel block"><h2 style="margin-bottom:12px">Your data</h2>' +
      '<div class="row"><a class="btn primary" href="/api/backup" download data-act="backup">' + ico("bookmark") + 'Download backup</a>' +
      '<label class="btn">' + ico("redo") + 'Restore from backup<input type="file" id="rf" accept="application/json,.json" hidden></label><span id="rmsg" class="small muted"></span></div>' +
      '<p class="muted small" style="margin-top:12px">' + (WEB ?
        "Your progress is saved in this browser on this device. If you don't open the app for a week or more, Safari can clear a website's saved data, so download a backup now and then. Restore puts it back." :
        "Saved in the app folder: data/study.db. A copy is kept every day in data/backups (last 14 days).") + "</p></div>";
    TutorSetup(document.getElementById("tset"));
    if (WEB) document.querySelector('[data-act="backup"]').onclick = function (e) { e.preventDefault(); window.SATWeb.downloadBackup(); };
    each(document.querySelectorAll("#theme button"), function (b) {
      b.onclick = function () {
        var t = b.getAttribute("data-t");
        try { localStorage.setItem("theme", t); } catch (e) { }
        if (t === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t);
        each(document.querySelectorAll("#theme button"), function (x) { x.classList.toggle("on", x === b); });
      };
    });
    document.getElementById("rf").onchange = function () {
      var f = this.files[0], msg = document.getElementById("rmsg");
      if (!f) return;
      if (!confirm("Replace all your current study data with this backup?")) return;
      var rd = new FileReader();
      rd.onload = function () {
        var data;
        try { data = JSON.parse(rd.result); } catch (e) { msg.textContent = "That file isn't a backup."; return; }
        api("restore", { body: data }).then(function () { msg.textContent = "✓ Restored"; }).catch(function (e) { msg.textContent = e.message; });
      };
      rd.readAsText(f);
    };
  }

  // ------------------------------------------------------------------ router
  function route() {
    var h = location.hash || "#/";
    var path = h.slice(1).split("?")[0], query = h.indexOf("?") >= 0 ? h.slice(h.indexOf("?") + 1) : "";
    var params = {};
    query.split("&").forEach(function (kv) { if (kv) { var p = kv.split("="); params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ""); } });
    var parts = path.split("/").filter(Boolean);
    if (Drawer.el.classList.contains("open") && parts[0] === "tutor") Drawer.close();
    if (!parts.length) return pageHome();
    if (parts[0] === "session") return pageSession(parts[1] && /^\d+$/.test(parts[1]) ? parts[1] : null);
    if (parts[0] === "journal") return pageJournal();
    if (parts[0] === "notes") return pageNotes(params);
    if (parts[0] === "tutor") return pageTutor();
    if (parts[0] === "settings" || parts[0] === "data") return pageSettings();
    if (parts[0] === "practice" && (params.mode || CONFIG.units[params.unit])) return pagePractice(params);
    pageHome();
  }

  function checkDay() {
    if (localDate() !== loadedDay) {
      loadedDay = localDate();
      if (!location.hash || location.hash === "#/" || location.hash === "#/session") route();
    }
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) checkDay(); });
  window.addEventListener("focus", checkDay);

  api("config").then(function (c) {
    CONFIG = c;
    window.addEventListener("hashchange", route);
    route();
  }).catch(err(app));
})();
