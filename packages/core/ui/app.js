(function () {
  var token = new URLSearchParams(location.search).get("token") || "";
  var $ = function (id) { return document.getElementById(id); };
  var logEl = $("log");
  function api(path, method, body) {
    return fetch(path + (path.indexOf("?") < 0 ? "?" : "&") + "token=" + token, {
      method: method || "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); });
  }
  function el(html) { var d = document.createElement("div"); d.innerHTML = html; return d; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function watch(jobId, done) {
    logEl.textContent = "";
    var es = new EventSource("/api/jobs/" + jobId + "/events?token=" + token);
    es.onmessage = function (e) { logEl.textContent += JSON.parse(e.data) + "\n"; logEl.scrollTop = logEl.scrollHeight; };
    es.addEventListener("end", function (e) { es.close(); if (done) done(JSON.parse(e.data)); });
  }
  function start(path, body, button) {
    button.disabled = true;
    return api(path, "POST", body).then(function (r) { watch(r.job, function () { button.disabled = false; loadProject(); }); })
      .catch(function (e) { button.disabled = false; logEl.textContent = "error: " + e.message; });
  }

  document.querySelectorAll("nav button").forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll("nav button").forEach(function (x) { x.classList.toggle("on", x === b); });
      document.querySelectorAll(".tab").forEach(function (t) { t.hidden = t.id !== b.dataset.tab; });
    };
  });

  var project = {};
  function loadProject() {
    return api("/api/project").then(function (p) { project = p; $("app").textContent = p.appDir; renderProject(); renderRun(); renderReports(); });
  }

  function renderProject() {
    var c = $("project"); c.innerHTML = "";
    if (!project.hasCatalog) {
      var d = el('<div class="card"><b>No .chipchop/ folder yet.</b><div class="row"><select id="fw"><option>angularjs</option><option>angular</option><option>react</option><option>other</option></select><button class="primary" id="init">Create .chipchop/</button></div></div>');
      c.appendChild(d); d.querySelector("#init").onclick = function () { api("/api/init", "POST", { framework: d.querySelector("#fw").value }).then(loadProject); };
    } else {
      var v = el('<div class="card"><div class="row"><button id="val" class="primary">Validate</button><span class="mut">checks config, states, flows and mocks</span></div><pre id="valout" hidden></pre></div>');
      c.appendChild(v);
      v.querySelector("#val").onclick = function () { api("/api/validate", "POST").then(function (r) { var o = v.querySelector("#valout"); o.hidden = false; o.textContent = r.text || "No problems found."; }); };
    }
    var dr = el('<div class="card"><div class="row"><button id="doc">Check environment</button></div><div id="docout"></div></div>');
    c.appendChild(dr);
    dr.querySelector("#doc").onclick = function () {
      api("/api/doctor").then(function (cs) {
        dr.querySelector("#docout").innerHTML = "<table>" + cs.map(function (x) { return "<tr><td class='" + (x.ok ? "ok" : "bad") + "'>" + (x.ok ? "OK" : x.required ? "MISSING" : "not found") + "</td><td>" + esc(x.name) + "</td><td class='mut'>" + esc(x.detail) + "</td></tr>"; }).join("") + "</table>";
      });
    };
  }

  var STAGES = ["discover", "flows", "mocks", "repair"];
  function loadAi() {
    api("/api/ai").then(function (cfg) {
      var c = $("ai"); c.innerHTML = "";
      var names = Object.keys(cfg.providers);
      var html = '<div class="card"><h2>Stages</h2><p class="mut">Each stage can use its own provider and model. Model names are free text, passed to the CLI untouched.</p><table><tr><th>Stage</th><th>Provider</th><th>Model</th><th></th></tr>';
      STAGES.forEach(function (s) {
        var sc = cfg.stages[s] || { provider: names[0] };
        html += "<tr><td>" + s + "</td><td><select data-s='" + s + "' data-k='provider'>" + names.map(function (n) { return "<option" + (n === sc.provider ? " selected" : "") + ">" + esc(n) + "</option>"; }).join("") + "</select></td><td><input data-s='" + s + "' data-k='model' value='" + esc(sc.model || "") + "' placeholder='CLI default'></td><td><button data-test='" + s + "'>Test</button> <span data-res='" + s + "'></span></td></tr>";
      });
      html += "</table><div class='row'><label>Max repair attempts <input id='maxr' type='number' min='0' max='10' value='" + cfg.settings.maxRepairs + "' style='width:70px'></label><button class='primary' id='save'>Save to .chipchop/ai.yaml</button></div></div>";
      html += '<div class="card"><h2>Providers</h2><pre>' + esc(JSON.stringify(cfg.providers, null, 2)) + "</pre><p class='mut'>Edit commands, extra args and env in .chipchop/ai.yaml (or ~/.chipchop/ai.yaml for global defaults).</p></div>";
      c.innerHTML = html;
      c.querySelectorAll("[data-test]").forEach(function (b) {
        b.onclick = function () {
          var s = b.dataset.test, prov = c.querySelector("select[data-s=" + s + "]").value, model = c.querySelector("input[data-s=" + s + "]").value;
          var out = c.querySelector("[data-res=" + s + "]"); out.textContent = "testing…"; out.className = "mut";
          api("/api/ai/test", "POST", { provider: prov, model: model || undefined }).then(function (r) { out.textContent = r.ok ? "works" : "failed: " + r.output; out.className = r.ok ? "ok" : "bad"; });
        };
      });
      c.querySelector("#save").onclick = function () {
        var stages = {};
        STAGES.forEach(function (s) {
          var o = { provider: c.querySelector("select[data-s=" + s + "]").value }, m = c.querySelector("input[data-s=" + s + "]").value.trim();
          if (m) o.model = m; stages[s] = o;
        });
        api("/api/ai", "PUT", { providers: cfg.providers, stages: stages, settings: { maxRepairs: Number(c.querySelector("#maxr").value) } })
          .then(function () { logEl.textContent = "saved"; }).catch(function (e) { logEl.textContent = "error: " + e.message; });
      };
    });
  }

  function renderRun() {
    var c = $("run"); c.innerHTML = "";
    var opts = project.refs ? project.refs.branches.concat(project.refs.tags).map(function (r) { return "<option>" + esc(r) + "</option>"; }).join("") : "";
    var d = el('<div class="card"><h2>Generate the catalog with AI</h2><div class="row"><label>Stages <select id="ast"><option value="">discover + flows + mocks</option><option>discover</option><option>flows</option><option>mocks</option><option>repair</option></select></label><label><input type="checkbox" id="dry"> dry run</label><button class="primary" id="airun">Run</button></div><textarea id="extra" rows="2" style="width:100%" placeholder="Extra instructions for the AI (optional)"></textarea></div>' +
      '<div class="card"><h2>Compare two refs</h2><div class="row"><label>Base <select id="base">' + opts + '</select></label><label>Head <select id="head">' + opts + '</select></label><label>Mode <select id="mode"><option>restyle</option><option>flow-audit</option></select></label><button class="primary" id="cmp">Compare</button></div></div>');
    c.appendChild(d);
    if (project.refs && project.refs.branches.length > 1) d.querySelector("#head").selectedIndex = 1;
    d.querySelector("#airun").onclick = function () { var s = d.querySelector("#ast").value; start("/api/ai/run", { stages: s ? [s] : undefined, extra: d.querySelector("#extra").value, dryRun: d.querySelector("#dry").checked }, this); };
    d.querySelector("#cmp").onclick = function () { start("/api/compare", { base: d.querySelector("#base").value, head: d.querySelector("#head").value, mode: d.querySelector("#mode").value }, this); };
  }

  function renderReports() {
    var c = $("reports"); c.innerHTML = "";
    if (!project.reports || !project.reports.length) { c.innerHTML = '<p class="mut">No reports yet. Run a comparison first.</p>'; return; }
    var sel = el('<div class="row"><select id="rsel">' + project.reports.map(function (r) { return "<option>" + esc(r) + "</option>"; }).join("") + '</select></div><iframe id="rf"></iframe>');
    c.appendChild(sel);
    function show() { c.querySelector("#rf").src = "/reports/" + encodeURIComponent(c.querySelector("#rsel").value) + "/report.html?token=" + token; }
    c.querySelector("#rsel").onchange = show; show();
  }

  document.querySelector('[data-tab="ai"]').addEventListener("click", loadAi);
  loadProject().catch(function (e) { document.body.insertAdjacentHTML("beforeend", "<p class='bad'>" + esc(e.message) + " (open the link printed by chip-chop ui)</p>"); });
})();
