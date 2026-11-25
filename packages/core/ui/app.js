(function () {
  "use strict";
  var token = new URLSearchParams(location.search).get("token") || "";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var badge = function (t, k) { return '<span class="badge ' + (k || "") + '">' + esc(t) + "</span>"; };
  var TR = [["needs >= 22", "hace falta 22 o superior"], ["not found on PATH (only needed if a stage uses it)", "no encontrado (solo hace falta si una etapa lo usa)"], ["not found on PATH", "no encontrado"], ["not installed. Run: npx playwright install chromium", "no instalado. Ejecuta: npx playwright install chromium"]];
  var tr = function (s) { TR.forEach(function (p) { s = s.replace(p[0], p[1]); }); return s; };
  var STAGES = [["discover", "Descubrir", "Rutas y modales → estados"], ["flows", "Flujos", "Recorridos del usuario"], ["mocks", "Mocks", "Respuestas del backend con tipos"], ["repair", "Reparar", "Corrige errores de validación"]];
  var project = {}, ai = null, update = null, lastCompare = null;

  function api(path, method, body) {
    return fetch(path + (path.indexOf("?") < 0 ? "?" : "&") + "token=" + token, {
      method: method || "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); });
  }
  // Runs a background job and streams its log into <pre id=logId>.
  function job(path, body, logId) {
    var pre = $(logId); pre.hidden = false; pre.textContent = "";
    return api(path, "POST", body).then(function (r) {
      return new Promise(function (resolve) {
        var es = new EventSource("/api/jobs/" + r.job + "/events?token=" + token);
        es.onmessage = function (e) { pre.textContent += JSON.parse(e.data) + "\n"; pre.scrollTop = pre.scrollHeight; };
        es.addEventListener("end", function (e) { es.close(); api("/api/jobs/" + r.job).then(function (j) { resolve({ status: JSON.parse(e.data), result: j.result }); }); });
      });
    });
  }
  function busy(btn, fn) {
    btn.disabled = true;
    var done = function () { btn.disabled = false; };
    fn().then(done, function (e) { done(); alert(e.message); });
  }

  // ---------- tabs ----------
  function show(tab) {
    document.querySelectorAll("#tabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === tab); });
    document.querySelectorAll(".tab").forEach(function (t) { t.hidden = t.id !== tab; });
    if (tab === "ia") renderIa();
    if (tab === "informes") renderReports();
    if (tab === "actualizar") renderUpdate();
  }
  document.querySelectorAll("[data-tab]").forEach(function (b) { b.addEventListener("click", function () { show(b.dataset.tab); }); });

  // ---------- banner ----------
  function renderBanner() {
    var b = $("banner");
    if (!update || !update.available) { b.hidden = true; $("ver").innerHTML = "v" + esc(project.version || ""); return; }
    $("ver").innerHTML = "v" + esc(project.version) + " " + badge(update.latest + " disponible", "wa");
    b.hidden = false; b.className = "banner";
    b.innerHTML = "<strong>Versión nueva " + esc(update.latest) + (update.prerelease ? " (candidata)" : "") + '</strong><span class="grow">Se instala con un clic y se reinicia chip-chop.</span><button class="btn p" id="bn">Actualizar ahora</button>';
    $("bn").onclick = function () { show("actualizar"); };
  }
  function checkUpdate() {
    return api("/api/update").then(function (u) { update = u; renderBanner(); return u; }).catch(function (e) { update = { error: e.message, available: false }; renderBanner(); return update; });
  }

  // ---------- Proyecto ----------
  function step(n, title, sub, status, action) {
    return '<div class="card step"><span class="num">' + n + '</span><div class="grow"><b>' + title + '</b><span class="mut">' + sub + "</span></div>" + status + action + "</div>";
  }
  function renderProject() {
    var c = $("proyecto"), p = project, k = p.counts || {};
    $("app").textContent = p.appDir || ""; $("app").title = p.appDir || "";
    var generated = k.states > 1 || k.mocks > 0;
    var disc = ai && ai.stages && ai.stages.discover ? ai.stages.discover.provider + (ai.stages.discover.model ? " · " + ai.stages.discover.model : "") : "tu IA";
    var s1 = p.hasCatalog
      ? step(1, "Crear carpeta .chipchop", "Configuración, estados y guías para la IA.", badge("Hecho", "ok"), "")
      : step(1, "Crear carpeta .chipchop", "Configuración, estados y guías para la IA.", badge("Pendiente"), '<label class="f">Framework<select id="fw"><option>angularjs</option><option>angular</option><option>react</option><option>other</option></select></label><button class="btn p" id="init">Crear</button>');
    var s2 = step(2, "Generar con IA", esc(disc) + " lee el código y escribe estados, flujos y mocks.", p.hasCatalog ? (generated ? badge(k.states + " estados · " + k.mocks + " mocks", "ok") : badge("Pendiente")) : badge("Falta el paso 1", "wa"), '<button class="btn p" id="gen"' + (p.hasCatalog ? "" : " disabled") + ">" + (generated ? "Volver a generar" : "Generar con IA") + "</button>");
    var s3 = step(3, "Validar", "Comprueba que todo lo generado es coherente.", '<span id="valst">' + badge("Sin comprobar") + "</span>", '<button class="btn" id="val"' + (p.hasCatalog ? "" : " disabled") + ">Validar</button>");
    c.innerHTML = '<div><h1>Preparar la app</h1><p class="sub">Tres pasos. Puedes repetir cualquiera cuando cambie el código.</p></div>' + s1 + s2 + s3 +
      '<pre class="log" id="log1" hidden></pre><div class="card"><h2>Entorno</h2><div id="env" class="mut">Comprobando…</div></div>';
    if ($("init")) $("init").onclick = function () { api("/api/init", "POST", { framework: $("fw").value }).then(load); };
    $("gen").onclick = function () { busy(this, function () { return job("/api/ai/run", {}, "log1").then(function (r) { return load().then(function () { if (r.status === "failed") alert("La generación falló. Revisa el registro."); }); }); }); };
    $("val").onclick = function () {
      busy(this, function () { return api("/api/validate", "POST").then(function (r) {
        var errs = r.issues.filter(function (i) { return i.severity === "error"; }).length, warns = r.issues.length - errs;
        $("valst").innerHTML = errs ? badge(errs + " errores", "er") : warns ? badge(warns + " avisos", "wa") : badge("Todo bien", "ok");
        var pre = $("log1"); pre.hidden = !r.text; pre.textContent = r.text;
      }); });
    };
    api("/api/doctor").then(function (cs) {
      $("env").innerHTML = cs.map(function (x) { return '<div class="kv"><span>' + esc(x.name) + '</span><span>' + esc(tr(x.detail)) + " " + (x.ok ? badge("OK", "ok") : badge(x.required ? "Falta" : "No encontrado", x.required ? "er" : "wa")) + "</span></div>"; }).join("");
    });
  }

  // ---------- IA ----------
  function renderIa() {
    api("/api/ai").then(function (cfg) {
      ai = cfg; var names = Object.keys(cfg.providers);
      var rows = STAGES.map(function (s) {
        var sc = cfg.stages[s[0]] || { provider: names[0] };
        return '<tr><td><b>' + s[1] + '</b><div class="mut small">' + s[2] + '</div></td><td><select data-s="' + s[0] + '" data-k="provider" aria-label="Proveedor de ' + s[1] + '">' + names.map(function (n) { return "<option" + (n === sc.provider ? " selected" : "") + ">" + esc(n) + "</option>"; }).join("") + '</select></td><td><input type="text" data-s="' + s[0] + '" data-k="model" value="' + esc(sc.model || "") + '" placeholder="modelo del CLI" aria-label="Modelo de ' + s[1] + '"></td><td><div class="row"><button class="btn" data-test="' + s[0] + '">Probar</button><span data-res="' + s[0] + '"></span></div></td></tr>';
      }).join("");
      $("ia").innerHTML = '<div><h1>Modelos por etapa</h1><p class="sub">Cada etapa puede usar otro proveedor y otro modelo. El nombre del modelo se pasa tal cual al CLI.</p></div><div class="card"><table><tr><th>Etapa</th><th>Proveedor</th><th>Modelo</th><th></th></tr>' + rows + '</table><div class="row" style="margin-top:16px"><label class="f">Reintentos de reparación<input type="number" id="maxr" min="0" max="10" value="' + cfg.settings.maxRepairs + '" style="width:90px"></label><span class="grow"></span><span id="saved"></span><button class="btn p" id="save">Guardar</button></div></div><p class="mut small">Comandos y argumentos avanzados: archivo .chipchop/ai.yaml (por app) o la carpeta de usuario (para todas).</p>';
      var root = $("ia");
      root.querySelectorAll("[data-test]").forEach(function (b) {
        b.onclick = function () {
          var s = b.dataset.test, res = root.querySelector('[data-res="' + s + '"]');
          res.innerHTML = '<span class="mut">probando…</span>';
          busy(b, function () { return api("/api/ai/test", "POST", { provider: root.querySelector('select[data-s="' + s + '"]').value, model: root.querySelector('input[data-s="' + s + '"]').value || undefined }).then(function (r) { res.innerHTML = r.ok ? badge("Funciona", "ok") : badge("Falla", "er") + ' <span class="small">' + esc(r.output).slice(0, 120) + "</span>"; }); });
        };
      });
      $("save").onclick = function () {
        var stages = {};
        STAGES.forEach(function (s) { var o = { provider: root.querySelector('select[data-s="' + s[0] + '"]').value }, m = root.querySelector('input[data-s="' + s[0] + '"]').value.trim(); if (m) o.model = m; stages[s[0]] = o; });
        api("/api/ai", "PUT", { providers: cfg.providers, stages: stages, settings: { maxRepairs: Number($("maxr").value) } }).then(function () { $("saved").innerHTML = badge("Guardado", "ok"); return api("/api/ai").then(function (c) { ai = c; }); }).catch(function (e) { $("saved").innerHTML = badge("Error: " + e.message, "er"); });
      };
    });
  }

  // ---------- Comparar ----------
  var CH = [["identical", "Idénticos", "ok"], ["visualOnly", "Solo visual", "in"], ["structural", "Estructural", "wa"], ["added", "Añadidos", "in"], ["removed", "Eliminados", ""], ["failed", "Fallidos", "er"]];
  function renderCompare() {
    var refs = (project.refs ? project.refs.branches.concat(project.refs.tags) : []);
    var opts = function (sel) { return refs.map(function (r, i) { return "<option" + (i === sel ? " selected" : "") + ">" + esc(r) + "</option>"; }).join(""); };
    $("comparar").innerHTML = '<div><h1>Comparar dos ramas</h1><p class="sub">Se compila cada rama aparte; tu carpeta de trabajo no se toca.</p></div>' +
      '<div class="card"><div class="row" style="align-items:flex-end"><label class="f">Base<select id="base">' + opts(0) + '</select></label><label class="f">Cabeza<select id="head">' + opts(refs.length > 1 ? 1 : 0) + '</select></label>' +
      '<div class="f"><span>Modo</span><div class="seg" role="radiogroup" aria-label="Modo"><label><input type="radio" name="mode" value="restyle" checked><span>Restyle</span></label><label><input type="radio" name="mode" value="flow-audit"><span>Auditar flujos</span></label></div></div><span class="grow"></span><button class="btn p" id="cmp">Comparar</button></div>' +
      '<p class="small mut" style="margin:12px 0 0">Restyle: solo pueden cambiar los píxeles. Auditar flujos: se esperan pantallas nuevas.</p></div>' +
      '<pre class="log" id="log2" hidden></pre><div id="result"></div>';
    if (!project.hasCatalog) $("result").innerHTML = '<div class="banner wa"><strong>Primero prepara la app</strong><span class="grow">Falta la carpeta .chipchop (pestaña Proyecto).</span></div>';
    $("cmp").onclick = function () {
      var base = $("base").value, head = $("head").value, mode = document.querySelector('input[name="mode"]:checked').value;
      $("result").innerHTML = "";
      busy(this, function () { return job("/api/compare", { base: base, head: head, mode: mode }, "log2").then(function (r) {
        if (r.status !== "done") { $("result").innerHTML = '<div class="banner er"><strong>No se pudo comparar.</strong><span class="grow">Mira el registro de arriba: dice qué falló.</span></div>'; return; }
        lastCompare = r.result; showResult(r.result);
      }); });
    };
  }
  function showResult(r) {
    var chips = CH.map(function (c) { return '<div class="chip"><b>' + (r.summary[c[0]] || 0) + "</b>" + badge(c[1], c[2]) + "</div>"; }).join("");
    var ok = !r.reasons.length;
    $("result").innerHTML = '<div class="chips">' + chips + '</div><div class="banner ' + (ok ? "" : "wa") + '" style="margin-top:20px"><strong>' + (ok ? "Pasa." : "No pasa:") + '</strong><span class="grow">' + (ok ? "Sin cambios que bloqueen en este modo." : esc(r.reasons.join(" · "))) + '</span><button class="btn p" id="open">Abrir informe</button></div>';
    $("open").onclick = function () { window.open("/reports/" + encodeURIComponent(r.dir) + "/report.html", "_blank"); };
  }

  // ---------- Informes ----------
  function renderReports() {
    api("/api/reports").then(function (list) {
      var body = list.length ? list.map(function (r) {
        var s = r.summary, bs = [];
        if (s.structural) bs.push(badge(s.structural + " estructural", "wa"));
        if (s.visualOnly) bs.push(badge(s.visualOnly + " solo visual", "in"));
        if (s.added) bs.push(badge(s.added + " añadidos", "in"));
        if (s.removed) bs.push(badge(s.removed + " eliminados"));
        if (s.failed) bs.push(badge(s.failed + " fallidos", "er"));
        bs.push(badge(s.identical + " idénticos", "ok"));
        return '<div class="card"><div class="row"><div class="grow"><b style="font-size:16px">' + esc(r.base) + " → " + esc(r.head) + '</b><div class="mut small">' + esc(new Date(r.generatedAt).toLocaleString()) + " · " + (r.mode === "restyle" ? "Restyle" : "Auditar flujos") + '</div></div><div class="row" style="gap:6px">' + bs.join("") + '</div><a class="btn" style="display:inline-flex;align-items:center;text-decoration:none" href="/reports/' + encodeURIComponent(r.dir) + '/report.html" target="_blank" rel="noopener">Abrir</a></div></div>';
      }).join("") : '<div class="card mut">Aún no hay informes. Haz una comparación y aparecerá aquí.</div>';
      $("informes").innerHTML = '<div><h1>Informes</h1><p class="sub">Los últimos primero. Se guardan dentro de .chipchop/reports de tu app.</p></div>' + body;
    });
  }

  // ---------- Actualizar ----------
  function renderUpdate() {
    var el = $("actualizar");
    el.innerHTML = '<div><h1>Actualizaciones</h1><p class="sub">chip-chop lee las versiones publicadas en GitHub.</p></div><div class="card" id="upcard">Buscando…</div><div class="card"><h2>Canal</h2><label class="radio"><input type="radio" name="canal" value="stable"><span><b>Solo estables</b><br><span class="mut small">Solo versiones finales. Ignora las candidatas (rc).</span></span></label><label class="radio"><input type="radio" name="canal" value="latest"><span><b>Últimas</b><br><span class="mut small">Siempre la más reciente, sea candidata (rc) o final. La final gana a sus candidatas.</span></span></label></div><pre class="log" id="log3" hidden></pre>';
    el.querySelectorAll('input[name="canal"]').forEach(function (r) { r.onchange = function () { api("/api/update/channel", "POST", { channel: r.value }).then(fill); }; });
    fill();
    function fill() {
      checkUpdate().then(function (u) {
        var rd = el.querySelector('input[value="' + (u.channel || "stable") + '"]'); if (rd) rd.checked = true;
        var info = u.error ? '<div class="banner er"><strong>No se pudo comprobar.</strong><span class="grow">' + esc(u.error) + "</span></div>" :
          u.available ? '<div class="small mut">Al actualizar se descarga el paquete de tu sistema y se instala encima. Después hay que reiniciar chip-chop.' + (u.note ? " <b>" + esc(u.note) + "</b>" : "") + ' <a href="' + esc(u.url) + '" target="_blank" rel="noopener">Ver cambios en GitHub</a></div>' : '<div class="small mut">Estás al día.</div>';
        $("upcard").innerHTML = '<div class="row"><div class="grow"><div class="small mut">Instalada</div><b style="font-size:24px">' + esc(u.current || project.version) + '</b></div><div class="grow"><div class="small mut">Disponible en tu canal</div><b style="font-size:24px">' + (u.latest ? esc(u.latest) + " " + (u.available ? badge(u.prerelease ? "Candidata" : "Versión final", u.prerelease ? "wa" : "ok") : badge("Al día", "ok")) : "—") + '</b></div><button class="btn" id="chk">Buscar ahora</button><button class="btn p" id="upd"' + (u.available && !u.note ? "" : " disabled") + '>Actualizar</button></div><div style="margin-top:16px">' + info + "</div>";
        $("chk").onclick = function () { busy(this, function () { return Promise.resolve(fill()); }); };
        $("upd").onclick = function () { busy(this, function () { return job("/api/update/install", {}, "log3").then(function (r) { if (r.status === "done") $("upcard").insertAdjacentHTML("beforeend", '<div class="banner" style="margin-top:16px"><strong>Listo.</strong><span class="grow">Cierra chip-chop (Ctrl+C) y ábrelo de nuevo para usar la nueva versión.</span></div>'); }); }); };
      });
    }
  }

  // ---------- start ----------
  function load() {
    return api("/api/project").then(function (p) { project = p; return api("/api/ai").then(function (c) { ai = c; }, function () {}); }).then(function () { renderProject(); renderCompare(); renderBanner(); });
  }
  load().then(checkUpdate).catch(function (e) { document.body.insertAdjacentHTML("beforeend", '<main><div class="banner er"><strong>No se pudo conectar.</strong><span class="grow">' + esc(e.message) + " Abre el enlace que imprime chip-chop ui.</span></div></main>"); });
})();
