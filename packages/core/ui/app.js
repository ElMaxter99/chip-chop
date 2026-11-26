(function () {
  "use strict";
  var token = new URLSearchParams(location.search).get("token") || "";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var badge = function (t, k) { return '<span class="badge ' + (k || "") + '">' + esc(t) + "</span>"; };
  var TR = [["needs >= 22", "hace falta 22 o superior"], ["not found on PATH (only needed if a stage uses it)", "no encontrado (solo hace falta si una etapa lo usa)"], ["not found on PATH", "no encontrado"], ["not installed. Run: npx playwright install chromium", "no instalado. Ejecuta: npx playwright install chromium"]];
  var tr = function (s) { TR.forEach(function (p) { s = s.replace(p[0], p[1]); }); return s; };
  var STAGES = [["discover", "Descubrir", "Rutas y modales → estados"], ["flows", "Flujos", "Recorridos del usuario"], ["mocks", "Mocks", "Respuestas del backend con tipos"], ["repair", "Reparar", "Corrige errores de validación"]];
  var project = {}, ai = null, aiInfo = null, update = null, lastCompare = null;

  function api(path, method, body) {
    return fetch(path + (path.indexOf("?") < 0 ? "?" : "&") + "token=" + token, {
      method: method || "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json().then(function (j) { if (!r.ok) { var er = new Error(j.error || r.status); er.code = j.code; er.problems = j.problems; throw er; } return j; }); });
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
    $("bn").onclick = function () { runUpdate(); };
  }
  // Mismo flujo desde el aviso de arriba y desde la pestaña Actualizar: ventana con el progreso.
  function runUpdate() {
    return window.ChipUpdate.run(function (push) {
      return job("/api/update/install", {}, null, push).then(function (r) { if (r.status === "done") return r.result; throw new Error(""); });
    }).then(function (r) { return checkUpdate().then(function () { return r; }); });
  }
  function checkUpdate() {
    return api("/api/update").then(function (u) { update = u; renderBanner(); return u; }).catch(function (e) { update = { error: e.message, available: false }; renderBanner(); return update; });
  }

  // ---------- Proyecto ----------
  function step(n, title, sub, status, action) {
    return '<div class="card step"><span class="num">' + n + '</span><div><b>' + title + '</b><span class="mut">' + sub + '</span></div><div class="st">' + status + '</div><div class="act">' + action + "</div></div>";
  }
  // Sin herramienta o modelo utilizable no se lanza la IA: se explica y se lleva al usuario a la configuración.
  function needAiConfig(probs) {
    return dialog({ kind: "wa", title: "Configura la IA para continuar", message: "Lo que estaba elegido ya no se puede usar:", detail: probs.map(function (p) { return "• " + (p.stage ? p.stage + ": " : "") + p.message; }).join("\n"), buttons: [{ label: "Ir a la configuración de IA", primary: true, value: true }] }).then(function () { show("ia"); });
  }
  function renderProject() {
    var c = $("proyecto"), p = project, k = p.counts || {};
    $("app").textContent = p.appDir || ""; $("app").title = p.appDir || "";
    var generated = k.states > 1 || k.mocks > 0;
    var disc = ai && ai.stages && ai.stages.discover ? ai.stages.discover.provider + (ai.stages.discover.model ? " · " + ai.stages.discover.model : "") : "tu IA";
    var aiBad = aiInfo && ai && ai.stages ? ChipAi.problems(ai.stages, aiInfo) : [];
    var s1 = p.hasCatalog
      ? step(1, "Crear carpeta .chipchop", "Configuración, estados y guías para la IA.", badge("Hecho", "ok"), "")
      : step(1, "Crear carpeta .chipchop", "Configuración, estados y guías para la IA.", badge("Pendiente"), '<label class="f">Framework<select id="fw"><option>angularjs</option><option>angular</option><option>react</option><option>other</option></select></label><button class="btn p" id="init">Crear</button>');
    var s2 = step(2, "Generar con IA", esc(disc) + " lee el código y escribe estados, flujos y mocks.", (aiBad.length ? badge("Revisar la IA", "wa") : p.hasCatalog ? (generated ? badge(k.states + " estados · " + k.mocks + " mocks", "ok") : badge("Pendiente")) : badge("Falta el paso 1", "wa")), '<button class="btn p" id="gen"' + (p.hasCatalog ? "" : " disabled") + ">" + (generated ? "Volver a generar" : "Generar con IA") + "</button>");
    var s3 = step(3, "Validar", "Comprueba que todo lo generado es coherente.", '<span id="valst">' + badge("Sin comprobar") + "</span>", '<button class="btn" id="val"' + (p.hasCatalog ? "" : " disabled") + ">Validar</button>");
    c.innerHTML = '<div><h1>Preparar la app</h1><p class="sub">Tres pasos. Puedes repetir cualquiera cuando cambie el código.</p></div>' + s1 + s2 + s3 +
      '<pre class="log" id="log1" hidden></pre><div class="card"><h2>Entorno</h2><div id="env" class="mut">Comprobando…</div></div>';
    if ($("init")) $("init").onclick = function () { api("/api/init", "POST", { framework: $("fw").value }).then(load); };
    $("gen").onclick = function () {
      busy(this, function () {
        return api("/api/ai/info?refresh=1").then(function (info) {
          aiInfo = info;
          var probs = ChipAi.problems(ai && ai.stages ? ai.stages : {}, info);
          if (probs.length) return needAiConfig(probs);
          var lines = [];
          return job("/api/ai/run", {}, "log1", function (l) { lines.push(l); }).then(function (r) {
            return load().then(function () {
              if (r.status === "failed") {
                if (/model|modelo/i.test(lines.join("\n")) && /(not found|invalid|unknown|unsupported|does not exist|not available|no existe|no disponible)/i.test(lines.join("\n"))) return needAiConfig([{ stage: "IA", message: "la herramienta rechazó el modelo elegido" }]);
                notify("La generación con IA ha fallado. Revisa el registro de debajo para ver el motivo.", "La generación falló");
              }
            });
          }, function (e) { if (e.code === "ai-config") return needAiConfig(e.problems || []); throw e; });
        });
      });
    };
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
  // Modal de «Probar esta etapa»: cuenta qué se hace, muestra que está trabajando y enseña el resultado y el comando.
  function runTest(title, v) {
    var prev = document.activeElement, back = document.createElement("div"), closed = false, t0 = Date.now();
    back.className = "modal-back";
    var model = v.model ? esc(v.model) : "el predeterminado de la herramienta";
    back.innerHTML = '<div class="modal wa" role="dialog" aria-modal="true" aria-labelledby="tt"><div class="modal-h"><span class="modal-i" aria-hidden="true"><span class="spin"></span></span><h2 id="tt">Probando «' + esc(title) + '»</h2></div><div class="modal-b" id="tb"></div><div class="modal-f"><button class="btn" id="tclose">Cerrar</button></div></div>';
    document.body.appendChild(back);
    var box = back.querySelector("#tb"), head = back.querySelector(".modal"), icon = back.querySelector(".modal-i");
    box.innerHTML = '<p style="margin:0 0 10px">Voy a comprobar que <b>' + esc(v.provider) + '</b> arranca, que has iniciado sesión y que acepta el modelo <b>' + model + '</b>.</p>' +
      '<ol class="steps-mini"><li>Localizo el programa en tu equipo.</li><li>Le envío una petición mínima: «responde exactamente <code>chip-chop-ok</code>». Sin permiso para ejecutar comandos ni escribir archivos.</li><li>Compruebo que la respuesta es la esperada.</li></ol>' +
      '<div class="bar ind" style="margin:12px 0 6px"><i></i></div><div class="small mut" id="telapsed">Esperando respuesta… 0 s</div>';
    var tick = setInterval(function () { var e = back.querySelector("#telapsed"); if (e) e.textContent = "Esperando respuesta… " + Math.round((Date.now() - t0) / 1000) + " s"; }, 500);
    function close() { closed = true; clearInterval(tick); document.removeEventListener("keydown", key, true); back.remove(); if (prev && prev.focus) prev.focus(); }
    function key(e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }
    document.addEventListener("keydown", key, true);
    back.querySelector("#tclose").onclick = close; back.querySelector("#tclose").focus();
    return api("/api/ai/test", "POST", { provider: v.provider, model: v.model }).then(function (t) {
      if (closed) return t;
      clearInterval(tick);
      head.className = "modal " + (t.ok ? "ok" : "er"); icon.innerHTML = t.ok ? "✓" : "!"; back.querySelector("h2").textContent = t.ok ? "«" + title + "» funciona" : "«" + title + "» no funciona";
      var cmd = (t.foundAt || t.command) + " " + t.args.join(" ");
      box.innerHTML = '<p style="margin:0 0 10px">' + (t.ok ? "<b>" + esc(v.provider) + "</b> respondió correctamente en " + (t.ms / 1000).toFixed(1) + " s." : "No se obtuvo la respuesta esperada (" + (t.ms / 1000).toFixed(1) + " s" + (t.exitCode != null ? ", código de salida " + t.exitCode : "") + ").") + "</p>" +
        (t.ok ? "" : '<p class="small" style="margin:0 0 8px">' + (t.modelRejected ? "<b>La herramienta funciona</b> (con su modelo por defecto sí responde), pero <b>rechaza el modelo «" + esc(t.model) + "»</b>: no existe con ese nombre o tu plan no lo tiene habilitado. Elige otro de la lista o déjalo en «Predeterminado»." : t.foundAt ? "El programa se encontró, pero falló al responder: revisa que hayas iniciado sesión (ejecútalo una vez en una terminal) y que el modelo exista." : "No se encontró el programa «" + esc(t.command) + "». Instálalo o indica su ruta en ai.yaml.") + "</p>") +
        (!t.ok && t.stderr ? '<div class="small mut">Lo que dijo el programa (el motivo)</div><pre class="log" style="margin-bottom:10px">' + esc(t.stderr) + "</pre>" : "") + '<div class="small mut">Respuesta</div><pre class="log">' + esc(t.output || "(vacía)") + '</pre><details style="margin-top:10px"><summary class="small mut" style="cursor:pointer">Qué se ejecutó</summary><pre class="log" style="margin-top:6px">' + esc(cmd) + '\n\nPetición: ' + esc(t.prompt) + '</pre></details>';
      var f = back.querySelector(".modal-f"); f.innerHTML = (t.ok ? "" : '<button class="btn" id="tagain">Reintentar</button>') + '<button class="btn p" id="tclose2">Cerrar</button>';
      back.querySelector("#tclose2").onclick = close; back.querySelector("#tclose2").focus();
      if (!t.ok) back.querySelector("#tagain").onclick = function () { close(); runTest(title, v); };
      return t;
    }, function (e) { if (!closed) { close(); notify(e, "No se pudo probar"); } });
  }
  function renderIa() {
    Promise.all([api("/api/ai"), api("/api/ai/info")]).then(function (r) {
      var cfg = r[0], info = r[1]; ai = cfg; aiInfo = info;
      var ex = function (s) { return '<div class="row"><button class="btn" data-test="' + s + '">Probar esta etapa</button><span data-res="' + s + '"></span></div>'; };
      $("ia").innerHTML = '<div><h1>Modelos por etapa</h1><p class="sub">Cada etapa puede usar otra herramienta y otro modelo. Lo que cambies se guarda solo. Si tu CLI tiene un modelo que no sale en la lista, usa «Otro…».</p></div>' +
        (Object.keys(info).every(function (n) { return !info[n].found; }) ? '<div class="banner er"><strong>No se encuentra ninguna herramienta de IA.</strong><span class="grow">Instala Claude Code, GitHub Copilot CLI u OpenAI Codex e inicia sesión una vez en una terminal. chip-chop busca en el PATH y en las carpetas habituales de instalación; al abrir una lista vuelve a buscar.</span></div>' : "") +
        '<div class="card" id="aiEd"></div>' +
        '<div class="row"><label class="f">Reintentos de reparación<input type="number" id="maxr" min="0" max="10" value="' + cfg.settings.maxRepairs + '" style="width:90px"></label></div><p class="mut small">Comandos y argumentos avanzados: archivo .chipchop/ai.yaml (por app) o la carpeta de usuario (para todas).</p>';
      var root = $("aiEd"), opts = {
        stages: STAGES, cfg: cfg, info: info, extra: ex,
        refresh: function () { return api("/api/ai/info?refresh=1"); },
        save: function (stages) { return api("/api/ai", "PUT", { providers: cfg.providers, stages: stages, settings: { maxRepairs: Number($("maxr").value) } }).then(function () { return api("/api/ai").then(function (c) { ai = c; renderProject(); }); }); }
      };
      root.innerHTML = ChipAi.rows(opts);
      var ed = ChipAi.bind(root, opts);
      $("maxr").onchange = ed.changed;
      root.querySelectorAll("[data-test]").forEach(function (b) {
        b.onclick = function () {
          var s = b.dataset.test, row = root.querySelector('.ai-stage[data-stage="' + s + '"]'), res = root.querySelector('[data-res="' + s + '"]');
          runTest(row.dataset.title || s, ChipAi.read(row)).then(function (t) { if (t) res.innerHTML = t.ok ? badge("Funciona", "ok") : badge("Falla", "er"); });
        };
      });
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
          u.available ? '<div class="small mut">Al actualizar se descarga el paquete de tu sistema y se instala encima. Después hay que reiniciar chip-chop (en la app de escritorio se reinicia sola).' + (u.note ? " <b>" + esc(u.note) + "</b>" : "") + ' <a href="' + esc(u.url) + '" target="_blank" rel="noopener">Ver cambios en GitHub</a></div>' : '<div class="small mut">Estás al día.</div>';
        $("upcard").innerHTML = '<div class="row"><div class="grow"><div class="small mut">Instalada</div><b style="font-size:24px">' + esc(u.current || project.version) + '</b></div><div class="grow"><div class="small mut">Disponible en tu canal</div><b style="font-size:24px">' + (u.latest ? esc(u.latest) + " " + (u.available ? badge(u.prerelease ? "Candidata" : "Versión final", u.prerelease ? "wa" : "ok") : badge("Al día", "ok")) : "—") + '</b></div><button class="btn" id="chk">Buscar ahora</button><button class="btn p" id="upd"' + (u.available && !u.note ? "" : " disabled") + '>Actualizar</button></div><div style="margin-top:16px">' + info + "</div>";
        $("chk").onclick = function () { busy(this, function () { return Promise.resolve(fill()); }); };
        $("upd").onclick = function () { var btn = this; btn.disabled = true; $("chk").disabled = true; runUpdate().then(function () { btn.disabled = false; $("chk").disabled = false; return fill(); }); };
      });
    }
  }

  // ---------- start ----------
  function load() {
    return api("/api/project").then(function (p) { project = p; return api("/api/ai").then(function (c) { ai = c; }, function () {}); }).then(function () { return api("/api/ai/info").then(function (i) { aiInfo = i; }, function () {}); }).then(function () { renderProject(); renderCompare(); renderBanner(); });
  }
  load().then(checkUpdate).catch(function (e) { document.body.insertAdjacentHTML("beforeend", '<main><div class="banner er"><strong>No se pudo conectar.</strong><span class="grow">' + esc(e.message) + " Abre el enlace que imprime chip-chop ui.</span></div></main>"); });
})();
