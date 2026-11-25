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
  function job(path, body, logId, onLine) {
    var pre = logId ? $(logId) : null; if (pre) { pre.hidden = false; pre.textContent = ""; }
    return api(path, "POST", body).then(function (r) {
      return new Promise(function (resolve) {
        var es = new EventSource("/api/jobs/" + r.job + "/events?token=" + token);
        es.onmessage = function (e) { var line = JSON.parse(e.data); if (pre) { pre.textContent += line + "\n"; pre.scrollTop = pre.scrollHeight; } if (onLine) onLine(line); };
        es.addEventListener("end", function (e) { es.close(); api("/api/jobs/" + r.job).then(function (j) { resolve({ status: JSON.parse(e.data), result: j.result }); }); });
      });
    });
  }

  // ---------- diálogos y progreso (comunes) ----------
  function dialog(o) {
    return new Promise(function (resolve) {
      var prev = document.activeElement, back = document.createElement("div"), kind = o.kind || "wa";
      var btns = o.buttons || [{ label: "Entendido", primary: true, value: true }];
      back.className = "modal-back";
      back.innerHTML = '<div class="modal ' + kind + '" role="alertdialog" aria-modal="true" aria-labelledby="mt" aria-describedby="mb"><div class="modal-h"><span class="modal-i" aria-hidden="true">' + (kind === "ok" ? "✓" : "!") + '</span><h2 id="mt">' + esc(o.title || "") + '</h2></div><div class="modal-b" id="mb">' + esc(o.message || "") + (o.detail ? '<div class="modal-d">' + esc(o.detail) + "</div>" : "") + '</div><div class="modal-f">' + btns.map(function (b, i) { return '<button class="btn' + (b.primary ? " p" : "") + '" data-i="' + i + '">' + esc(b.label) + "</button>"; }).join("") + "</div></div>";
      document.body.appendChild(back);
      var all = back.querySelectorAll("button"), first = back.querySelector(".p") || all[0];
      function close(v) { document.removeEventListener("keydown", key, true); back.remove(); if (prev && prev.focus) prev.focus(); resolve(v); }
      function key(e) {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(btns[btns.length > 1 ? 0 : 0].value); }
        else if (e.key === "Tab") { var f = all[0], l = all[all.length - 1]; if (e.shiftKey && document.activeElement === f) { e.preventDefault(); l.focus(); } else if (!e.shiftKey && document.activeElement === l) { e.preventDefault(); f.focus(); } }
      }
      document.addEventListener("keydown", key, true);
      all.forEach(function (b) { b.onclick = function () { close(btns[+b.dataset.i].value); }; });
      first.focus();
    });
  }
  // Traduce los errores técnicos más típicos a algo que se entienda.
  function friendly(m) {
    m = String(m || "").replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
    if (/another job is still running|otra tarea/i.test(m)) return "Ya hay otra tarea en marcha (captura, comparación, IA o actualización). Espera a que termine y vuelve a intentarlo.";
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(m)) return "No hay conexión con GitHub. Comprueba tu red o el proxy y vuelve a intentarlo.";
    return m;
  }
  function notify(e, title) { return dialog({ kind: "er", title: title || "No se ha podido completar", message: friendly(e && e.message ? e.message : e) }); }
  // Panel de progreso de la actualización: fases, barra, tiempo y detalle plegado. push(línea) la hace avanzar.
  var PHASES = ["Buscar", "Descargar", "Instalar", "Reiniciar"];
  function progress(host, modeManual) {
    var t0 = Date.now(), phase = 0, pct = null, ended = false, log = "";
    host.innerHTML = '<div class="prog" role="status" aria-live="polite"><div class="prog-head"><b data-r="t">Preparando…</b><span class="mut small" data-r="s">0 s</span></div><div class="bar ind" data-r="b"><i data-r="i"></i></div><ol class="phases">' + PHASES.map(function (p) { return "<li>" + p + "</li>"; }).join("") + '</ol><details><summary>Ver detalles</summary><pre class="log" data-r="l"></pre></details></div>';
    var q = function (k) { return host.querySelector('[data-r="' + k + '"]'); };
    var timer = setInterval(function () { q("s").textContent = Math.round((Date.now() - t0) / 1000) + " s"; }, 500);
    function paint(title) {
      q("t").textContent = title;
      host.querySelectorAll(".phases li").forEach(function (li, i) { li.className = i < phase ? "done" : i === phase ? "on" : ""; });
      q("b").className = "bar" + (pct == null ? " ind" : ""); q("i").style.width = pct == null ? "" : pct + "%";
    }
    paint("Buscando la versión…"); phase = 0; paint("Buscando la versión…");
    return {
      push: function (line) {
        if (ended) return; log += line + "\n"; q("l").textContent = log;
        var m;
        if ((m = /progreso:\s*(\d+)%/.exec(line))) { phase = 1; pct = +m[1]; paint("Descargando… " + pct + "%"); }
        else if (/^(downloading|descargando)/i.test(line)) { phase = 1; pct = null; paint("Descargando la nueva versión…"); }
        else if (/^installing/i.test(line)) { phase = 2; pct = null; paint("Instalando sobre la versión actual…"); }
        else if (/descargada/i.test(line)) { phase = 3; pct = null; paint("Reiniciando para terminar…"); }
      },
      end: function (ok, msg) {
        ended = true; clearInterval(timer); phase = ok ? PHASES.length : phase; pct = ok ? 100 : 0;
        host.querySelectorAll(".phases li").forEach(function (li, i) { li.className = ok ? "done" : i < phase ? "done" : ""; });
        q("b").className = "bar"; q("i").style.width = (ok ? 100 : 0) + "%"; q("t").textContent = msg; host.firstChild.classList.toggle("er", !ok);
        q("s").textContent = Math.round((Date.now() - t0) / 1000) + " s";
      }
    };
  }
  function busy(btn, fn) {
    btn.disabled = true;
    var done = function () { btn.disabled = false; };
    fn().then(done, function (e) { done(); notify(e); });
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
    return '<div class="card step"><span class="num">' + n + '</span><div><b>' + title + '</b><span class="mut">' + sub + '</span></div><div class="st">' + status + '</div><div class="act">' + action + "</div></div>";
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
    $("gen").onclick = function () { busy(this, function () { return job("/api/ai/run", {}, "log1").then(function (r) { return load().then(function () { if (r.status === "failed") notify("La generación con IA ha fallado. Revisa el registro de debajo para ver el motivo.", "La generación falló"); }); }); }); };
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
    Promise.all([api("/api/ai"), api("/api/ai/info")]).then(function (r) {
      var cfg = r[0], info = r[1]; ai = cfg;
      var missing = Object.keys(info).filter(function (n) { return !info[n].found; });
      var ex = function (s) { return '<div class="row"><button class="btn" data-test="' + s + '">Probar esta etapa</button><span data-res="' + s + '"></span></div>'; };
      $("ia").innerHTML = '<div><h1>Modelos por etapa</h1><p class="sub">Cada etapa puede usar otra herramienta y otro modelo. Elige la herramienta y el modelo de la lista; si tu CLI tiene uno que no sale, usa «Otro…».</p></div>' +
        (missing.length === Object.keys(info).length ? '<div class="banner er"><strong>No se encuentra ninguna herramienta de IA.</strong><span class="grow">Instala Claude Code o GitHub Copilot CLI e inicia sesión una vez en una terminal. chip-chop busca en el PATH y en las carpetas habituales de instalación.</span><button class="btn" id="rescan">Volver a buscar</button></div>' : '<div class="row"><span class="mut small grow">Herramientas detectadas: ' + Object.keys(info).filter(function (n) { return info[n].found; }).map(function (n) { return "<b>" + esc(n) + "</b>"; }).join(", ") + '</span><button class="btn" id="rescan">Volver a buscar</button></div>') +
        '<div class="card">' + ChipAi.rows({ stages: STAGES, cfg: cfg, info: info, extra: ex }) + '<div class="row" style="margin-top:16px;border-top:1px solid #D9C79A;padding-top:16px"><label class="f">Reintentos de reparación<input type="number" id="maxr" min="0" max="10" value="' + cfg.settings.maxRepairs + '" style="width:90px"></label><span class="grow"></span><span id="saved"></span><button class="btn p" id="save">Guardar</button></div></div><p class="mut small">Comandos y argumentos avanzados: archivo .chipchop/ai.yaml (por app) o la carpeta de usuario (para todas).</p>';
      var root = $("ia"); ChipAi.bind(root, { info: info });
      if ($("rescan")) $("rescan").onclick = function () { busy(this, function () { return api("/api/ai/info?refresh=1").then(function () { renderIa(); }); }); };
      root.querySelectorAll("[data-test]").forEach(function (b) {
        b.onclick = function () {
          var s = b.dataset.test, res = root.querySelector('[data-res="' + s + '"]'), v = ChipAi.read(root.querySelector('.ai-stage[data-stage="' + s + '"]'));
          res.innerHTML = '<span class="mut">probando…</span>';
          busy(b, function () { return api("/api/ai/test", "POST", { provider: v.provider, model: v.model }).then(function (t) { res.innerHTML = t.ok ? badge("Funciona", "ok") : badge("Falla", "er") + ' <span class="small">' + esc(t.output).slice(0, 160) + "</span>"; }); });
        };
      });
      $("save").onclick = function () {
        api("/api/ai", "PUT", { providers: cfg.providers, stages: ChipAi.collect(root), settings: { maxRepairs: Number($("maxr").value) } }).then(function () { $("saved").innerHTML = badge("Guardado", "ok"); return api("/api/ai").then(function (c) { ai = c; }); }).catch(function (e) { $("saved").innerHTML = badge("Error: " + e.message, "er"); });
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
    el.innerHTML = '<div><h1>Actualizaciones</h1><p class="sub">chip-chop lee las versiones publicadas en GitHub.</p></div><div class="card" id="upcard">Buscando…</div><div class="card"><h2>Canal</h2><label class="radio"><input type="radio" name="canal" value="stable"><span><b>Solo estables</b><br><span class="mut small">Solo versiones finales. Ignora las candidatas (rc).</span></span></label><label class="radio"><input type="radio" name="canal" value="latest"><span><b>Últimas</b><br><span class="mut small">Siempre la más reciente, sea candidata (rc) o final. La final gana a sus candidatas.</span></span></label></div><div id="upprog"></div>';
    el.querySelectorAll('input[name="canal"]').forEach(function (r) { r.onchange = function () { api("/api/update/channel", "POST", { channel: r.value }).then(fill); }; });
    fill();
    function fill() {
      checkUpdate().then(function (u) {
        var rd = el.querySelector('input[value="' + (u.channel || "stable") + '"]'); if (rd) rd.checked = true;
        var info = u.error ? '<div class="banner er"><strong>No se pudo comprobar.</strong><span class="grow">' + esc(u.error) + "</span></div>" :
          u.available ? '<div class="small mut">Al actualizar se descarga el paquete de tu sistema y se instala encima. Después hay que reiniciar chip-chop.' + (u.note ? " <b>" + esc(u.note) + "</b>" : "") + ' <a href="' + esc(u.url) + '" target="_blank" rel="noopener">Ver cambios en GitHub</a></div>' : '<div class="small mut">Estás al día.</div>';
        $("upcard").innerHTML = '<div class="row"><div class="grow"><div class="small mut">Instalada</div><b style="font-size:24px">' + esc(u.current || project.version) + '</b></div><div class="grow"><div class="small mut">Disponible en tu canal</div><b style="font-size:24px">' + (u.latest ? esc(u.latest) + " " + (u.available ? badge(u.prerelease ? "Candidata" : "Versión final", u.prerelease ? "wa" : "ok") : badge("Al día", "ok")) : "—") + '</b></div><button class="btn" id="chk">Buscar ahora</button><button class="btn p" id="upd"' + (u.available && !u.note ? "" : " disabled") + '>Actualizar</button></div><div style="margin-top:16px">' + info + "</div>";
        $("chk").onclick = function () { busy(this, function () { return Promise.resolve(fill()); }); };
        $("upd").onclick = function () {
          var btn = this, chk = $("chk"), host = $("upprog"), pg = progress(host);
          btn.disabled = true; chk.disabled = true; btn.textContent = "Actualizando…";
          job("/api/update/install", {}, null, pg.push).then(function (r) {
            if (r.status === "done") {
              pg.end(true, "Actualización instalada");
              return dialog({ kind: "ok", title: "Actualización instalada", message: "Cierra chip-chop (Ctrl+C en la terminal) y ábrelo de nuevo para usar la nueva versión.", buttons: [{ label: "Entendido", primary: true, value: true }] });
            }
            pg.end(false, "La actualización ha fallado"); btn.disabled = false; chk.disabled = false; btn.textContent = "Actualizar";
            return dialog({ kind: "er", title: "La actualización ha fallado", message: "No se ha podido instalar la nueva versión. La que tenías sigue funcionando.", detail: "Abre «Ver detalles» en el panel de progreso para ver el motivo." });
          }, function (e) { pg.end(false, "La actualización ha fallado"); btn.disabled = false; chk.disabled = false; btn.textContent = "Actualizar"; return notify(e, "No se ha podido actualizar"); });
        };
      });
    }
  }

  // ---------- start ----------
  function load() {
    return api("/api/project").then(function (p) { project = p; return api("/api/ai").then(function (c) { ai = c; }, function () {}); }).then(function () { renderProject(); renderCompare(); renderBanner(); });
  }
  load().then(checkUpdate).catch(function (e) { document.body.insertAdjacentHTML("beforeend", '<main><div class="banner er"><strong>No se pudo conectar.</strong><span class="grow">' + esc(e.message) + " Abre el enlace que imprime chip-chop ui.</span></div></main>"); });
})();
