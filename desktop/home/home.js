(function () {
  "use strict";
  var api = window.chipchop;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var badge = function (t, k) { return '<span class="badge ' + (k || "") + '">' + esc(t) + "</span>"; };
  var STAGES = [["discover", "Descubrir", "Rutas y modales → estados"], ["flows", "Flujos", "Recorridos del usuario"], ["mocks", "Mocks", "Respuestas del backend con tipos"], ["repair", "Reparar", "Corrige errores de validación"]];
  var TR = [["needs >= 22", "hace falta 22 o superior"], ["not found on PATH (only needed if a stage uses it)", "no encontrado (solo hace falta si una etapa lo usa)"], ["not found on PATH", "no encontrado"], ["not installed. Run: npx playwright install chromium", "no instalado"]];
  var tr = function (s) { TR.forEach(function (p) { s = s.replace(p[0], p[1]); }); return s; };
  var updPg = null, S = null, tab = "proyectos", chromiumLog = "", updLog = "", updInfo = null, installingChromium = false, chromiumFailed = false, autoTried = false, msgs = {};

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
  function fail(e) { return notify(e); }
  function ago(ts) { if (!ts) return "nunca"; var m = Math.round((Date.now() - ts) / 60000); if (m < 1) return "ahora mismo"; if (m < 60) return "hace " + m + " min"; var h = Math.round(m / 60); if (h < 24) return "hace " + h + " h"; return "hace " + Math.round(h / 24) + " d"; }

  api.onLog(function (line) {
    if (line.indexOf("chromium:") === 0) { chromiumLog = line.slice(9); var el = $("chromiumLog"); if (el) el.textContent = chromiumLog; }
    else if (updPg) updPg.push(line);
  });

  function loadEditor(href) { return window.ChipAi || !href ? Promise.resolve() : new Promise(function (ok) { var s = document.createElement("script"); s.src = href; s.onload = s.onerror = function () { ok(); }; document.head.appendChild(s); }); }
  function load() { return api.invoke("home:state").then(function (s) { return loadEditor(s.aiEditorHref).then(function () { return s; }); }).then(function (s) { S = s; if (!document.getElementById("css")) { var l = document.createElement("link"); l.id = "css"; l.rel = "stylesheet"; l.href = s.cssHref; l.onload = function () { document.body.style.visibility = "visible"; }; document.head.appendChild(l); } render(); }); }

  var TABS = ["proyectos", "ia", "ajustes"];
  function show(t, focus) {
    tab = t;
    document.querySelectorAll("#tabs [role=tab]").forEach(function (b) { var on = b.dataset.tab === t; b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false"); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    document.querySelectorAll(".tab").forEach(function (x) { x.hidden = x.id !== t; });
  }
  document.addEventListener("click", function (e) { var t = e.target.closest("[data-tab]"); if (t) { if (t.tagName === "A") e.preventDefault(); show(t.dataset.tab); } });
  // Pestañas con teclado (patrón WAI-ARIA): flechas, Inicio y Fin cambian de pestaña; Tab sale de la lista.
  $("tabs").addEventListener("keydown", function (e) {
    var i = TABS.indexOf(tab), n = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1;
    if (n < 0) return;
    e.preventDefault(); show(TABS[n], true);
  });

  // ---------- avisos: git y herramientas de IA ----------
  var GIT_HOWTO = {
    darwin: "En macOS: ejecuta <code>xcode-select --install</code> en la Terminal, o <code>brew install git</code> si usas Homebrew.",
    win32: "En Windows: ejecuta <code>winget install --id Git.Git -e</code> en PowerShell, o descarga el instalador de git-scm.com/download/win.",
    linux: "En Linux: <code>sudo apt install git</code> (Debian/Ubuntu), <code>sudo dnf install git</code> (Fedora) o <code>sudo pacman -S git</code> (Arch)."
  };
  function check(pred) { return (S.checks || []).filter(pred)[0]; }
  function providerName(c) { var m = /^ai: (.+?) \(/.exec(c.name); return m ? m[1] : ""; }
  function warnings() {
    var out = [], git = check(function (c) { return c.name === "git"; });
    if (git && !git.ok) out.push('<div class="banner er" role="status"><div class="grow"><b>Falta git</b><div class="small">Chip Chop lo necesita para sacar cada versión de tu app (ramas, etiquetas) sin tocar tu carpeta de trabajo. ' + (GIT_HOWTO[S.os] || GIT_HOWTO.linux) + " Después cierra y vuelve a abrir Chip Chop.</div></div></div>");
    if (!S.ai.error) {
      var tools = (S.checks || []).filter(function (c) { return c.name.indexOf("ai:") === 0; });
      var okName = {}; tools.forEach(function (c) { if (c.ok) okName[providerName(c)] = 1; });
      var used = {}; STAGES.forEach(function (st) { var cur = S.ai.stages[st[0]]; if (cur) used[cur.provider] = 1; });
      var missing = Object.keys(used).filter(function (n) { return !okName[n]; });
      var anyOk = Object.keys(okName).length > 0;
      if (tools.length && missing.length) {
        out.push('<div class="banner ' + (anyOk ? "wa" : "er") + '" role="status"><div class="grow"><b>' + (anyOk ? "Alguna etapa usa una herramienta de IA que no está instalada" : "Falta Claude Code, GitHub Copilot u OpenAI Codex") + '</b><div class="small">' + (anyOk
          ? "Las etapas por defecto usan <code>" + esc(missing.join(", ")) + "</code>. Cambia el proveedor en la pestaña <a href=\"#\" data-tab=\"ia\">IA</a> o instala la que falta."
          : "La etapa por defecto usa <code>" + esc(missing.join(", ")) + "</code> y no se encuentra en tu PATH. Instala Claude Code (<code>" + (S.os === "win32" ? "irm https://claude.ai/install.ps1 | iex" : "curl -fsSL https://claude.ai/install.sh | bash") + "</code>) o GitHub Copilot CLI (<code>" + (S.os === "win32" ? "winget install GitHub.Copilot" : "npm install -g @github/copilot") + "</code>) u OpenAI Codex (<code>npm install -g @openai/codex</code>), inicia sesión una vez en una terminal (<code>claude</code>, <code>copilot</code> o <code>codex login</code>) y reabre Chip Chop. Sin IA puedes seguir capturando y comparando, pero no generar el catálogo.") + "</div></div></div>");
      }
    }
    return out.join("");
  }

  // ---------- navegador de capturas ----------
  function renderBrowser() {
    var c = S.chromium, el = $("browser");
    if (c.installed) { el.innerHTML = ""; return; }
    if (installingChromium) {
      el.innerHTML = '<div class="banner"><div class="grow"><b><span class="spin"></span>Descargando el navegador de capturas…</b><div class="small mut">Chip Chop usa su propio Chromium para hacer las capturas de tu app, así no toca tu navegador. Se descarga una sola vez (unos 150 MB) y puede tardar un par de minutos. Mientras tanto puedes mirar la app; para abrir un proyecto espera a que termine.</div><pre class="log" id="chromiumLog" style="margin-top:8px;max-height:60px">' + esc(chromiumLog) + "</pre></div></div>";
    } else {
      el.innerHTML = '<div class="banner ' + (chromiumFailed ? "er" : "wa") + '"><div class="grow"><b>' + (chromiumFailed ? "No se pudo descargar el navegador de capturas" : "Falta el navegador de capturas") + '</b><div class="small">Chip Chop necesita su propio Chromium (unos 150 MB, una sola vez). ' + (chromiumFailed ? "Comprueba la conexión y reintenta. " : "") + '</div></div><button class="btn p" id="dlChromium">' + (chromiumFailed ? "Reintentar" : "Descargar ahora") + "</button></div>";
      $("dlChromium").onclick = startChromium;
    }
  }
  function startChromium() {
    installingChromium = true; chromiumFailed = false; chromiumLog = "Preparando la descarga…"; render();
    api.invoke("home:installChromium").then(function (ok) { installingChromium = false; chromiumFailed = !ok; return load(); }, function (e) { installingChromium = false; chromiumFailed = true; load(); fail(e); });
  }

  // ---------- proyectos ----------
  var RESULT = { identical: ["idéntico", "ok"], changes: ["cambios", "wa"], failed: ["fallos", "er"] };
  var INIT_CREA = "<code>.chipchop/</code> dentro de tu carpeta: <code>config.yaml</code> (cómo compilar y servir la app), <code>states.yaml</code> y <code>flows/</code> (catálogo inicial), <code>mocks/</code>, <code>ai.yaml</code> y las guías para la IA. Es lo mismo que <code>chip-chop init</code>; no toca el código de tu app ni pisa nada que ya exista.";
  function fmtDate(ts) { try { return new Date(ts).toLocaleString("es-ES", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }
  function reportLine(p) {
    if (!p.exists || !p.initialized) return "";
    var r = p.lastReport;
    if (!r) return '<div class="small mut">Aún sin informes: abre el proyecto y compara dos ramas.</div>';
    var res = RESULT[r.result] || ["", ""];
    return '<div class="small"><b>Último informe:</b> ' + esc(r.base) + " → " + esc(r.head) + " · " + esc(fmtDate(r.generatedAt)) + " · " + badge(res[0], res[1]) + " · " + r.states + (r.states === 1 ? " estado" : " estados") + (r.mode === "flow-audit" ? " · auditoría de flujos" : "") + "</div>";
  }
  function steps() {
    var t = [["Añade la carpeta de tu app", "Debe ser un repositorio git (AngularJS, Angular, React…)."], ["Inicializa y genera el catálogo con IA", "Chip Chop crea <code>.chipchop/</code> y Claude o Copilot leen tu código y escriben la lista de pantallas y estados."], ["Captura y compara dos ramas", "Elige dos ramas (por ejemplo develop y desarrollo-1) y obtén un informe con las diferencias."]];
    return '<div class="empty"><b>Empieza en tres pasos</b><ol class="steps">' + t.map(function (x, i) { return '<li><span class="num" aria-hidden="true">' + (i + 1) + '</span><span><b>' + x[0] + '</b><br><span class="mut small">' + x[1] + "</span></span></li>"; }).join("") + "</ol></div>";
  }
  function renderProjects() {
    var blocked = !S.chromium.installed;
    var list = S.projects.map(function (p, i) {
      var n = esc(p.name), canOpen = !(blocked || !p.exists);
      var act = '<button class="btn p" data-open="' + i + '" aria-label="Abrir ' + n + '"' + (canOpen ? "" : " disabled") + ">Abrir</button>" +
        (p.exists && p.initialized && p.lastReport ? '<button class="btn" data-reports="' + i + '" aria-label="Ver informes de ' + n + '"' + (canOpen ? "" : " disabled") + ">Ver informes</button>" : "") +
        (p.exists && !p.initialized ? '<button class="btn" data-init="' + i + '" aria-describedby="init-' + i + '" aria-label="Inicializar ' + n + '">Inicializar</button>' : "") +
        '<button class="btn ghost" data-rm="' + i + '" aria-label="Quitar ' + n + ' de la lista">Quitar de la lista</button>';
      var help = p.exists && !p.initialized ? '<div class="small mut" id="init-' + i + '"><b>Inicializar</b> crea ' + INIT_CREA + (p.framework !== "other" ? " Marco detectado: <b>" + esc(p.framework) + "</b>." : "") + "</div>" : "";
      var msg = msgs[p.path] ? '<div class="small" role="status">' + msgs[p.path] + "</div>" : "";
      return '<div class="proj" role="listitem"><div class="grow"><div class="nm">' + n + " " + (!p.exists ? badge("no encontrada", "er") : p.initialized ? badge("configurado", "ok") : badge("sin inicializar", "wa")) + '</div><div class="pt" title="' + esc(p.path) + '">' + esc(p.path) + '</div><div class="small mut">Abierto ' + ago(p.lastOpened) + "</div>" + reportLine(p) + help + msg + '</div><div class="acts">' + act + "</div></div>";
    }).join("");
    $("proyectos").innerHTML = '<div class="hero"><img src="' + esc(S.logoHref) + '" alt=""><div><h1>Tus proyectos</h1><p class="sub">Cada proyecto es la carpeta de una app web que quieres auditar (AngularJS, Angular, React…). Chip Chop captura todos sus estados en dos versiones de git y los compara.</p></div></div>' +
      '<div class="stack">' + warnings() + "</div>" +
      '<div class="card">' + (list ? '<div role="list" aria-label="Proyectos">' + list + "</div>" : steps()) +
      '<div class="row" style="margin-top:16px"><button class="btn p" id="add"' + (blocked ? " disabled" : "") + ">Añadir proyecto…</button>" + (blocked ? '<span class="small mut">Disponible cuando termine la descarga del navegador.</span>' : "") + "</div></div>";
    $("add").onclick = function () { api.invoke("home:addProject").catch(fail); };
    document.querySelectorAll("[data-open]").forEach(function (b) { b.onclick = function () { b.disabled = true; api.invoke("home:openProject", S.projects[+b.dataset.open].path).catch(function (e) { b.disabled = false; fail(e); }); }; });
    document.querySelectorAll("[data-reports]").forEach(function (b) { b.onclick = function () { b.disabled = true; api.invoke("home:openReports", S.projects[+b.dataset.reports].path).catch(function (e) { b.disabled = false; fail(e); }); }; });
    document.querySelectorAll("[data-init]").forEach(function (b) { b.onclick = function () {
      var p = S.projects[+b.dataset.init]; b.disabled = true;
      api.invoke("home:initProject", p.path).then(function (r) { msgs[p.path] = "Listo: se creó <code>.chipchop/</code> (" + r.created.map(esc).join(", ") + "). Siguiente paso: <b>Abrir</b> el proyecto y, en su pestaña IA, generar el catálogo."; return load(); }, function (e) { b.disabled = false; fail(e); });
    }; });
    document.querySelectorAll("[data-rm]").forEach(function (b) { b.onclick = function () { api.invoke("home:removeProject", S.projects[+b.dataset.rm].path).then(load); }; });
  }

  // ---------- IA ----------
  function renderAi() {
    var ok = S.checks.filter(function (c) { return c.name.indexOf("ai:") === 0; });
    if (S.ai.error) {
      $("ia").innerHTML = '<div><h1>Inteligencia artificial</h1></div><div class="banner er" role="alert" data-ai-error><div class="grow"><b>No se puede leer la configuración de IA</b><div class="small">El archivo <code>' + esc(S.ai.globalPath) + '</code> tiene un error y Chip Chop no puede mostrarlo ni guardarlo:</div><pre class="log" style="margin-top:8px">' + esc(S.ai.error) + '</pre><div class="small" style="margin-top:8px">Corrígelo con un editor de texto (es YAML: cuida las sangrías y los dos puntos) o bórralo para volver a los valores por defecto, y pulsa Recargar.</div></div><button class="btn p" id="reloadAi">Recargar</button></div>';
      $("reloadAi").onclick = function () { load().catch(fail); };
      return;
    }
    var info = S.ai.info || {};
    $("ia").innerHTML = warnings() + '<div><h1>Inteligencia artificial</h1><p class="sub">Chip Chop no trae IA propia: usa la herramienta de línea de comandos que ya tengas (Claude Code o GitHub Copilot) para leer el código de tu app y escribir su catálogo de estados. Estos valores son los de partida para todos los proyectos; cada proyecto puede cambiarlos en su pestaña IA.</p></div>' +
      '<div class="card"><div class="row"><h2 class="grow" style="margin:0">Herramientas detectadas</h2><button class="btn" id="rescan">Volver a buscar</button></div>' + (Object.keys(info).map(function (n) { var i = info[n]; return '<div class="kv"><span>' + esc(n) + ' <span class="small mut">(' + esc(i.command) + ")</span></span><span>" + badge(i.found ? "instalada" : "no encontrada", i.found ? "ok" : "wa") + ' <span class="small mut">' + esc(i.found ? (i.version || "") + " · " + i.found.path : "no está en el PATH ni en las carpetas habituales de instalación") + "</span></span></div>"; }).join("") || ok.map(function (c) { return '<div class="kv"><span>' + esc(c.name.replace("ai: ", "")) + "</span><span>" + badge(c.ok ? "instalada" : "no instalada", c.ok ? "ok" : "wa") + ' <span class="small mut">' + esc(tr(c.detail)) + "</span></span></div>"; }).join("") || '<span class="mut">Ninguna.</span>') + "</div>" +
      '<div class="card"><h2>Qué herramienta y modelo usa cada etapa</h2>' + ChipAi.rows({ stages: STAGES, cfg: { providers: S.ai.providers, stages: S.ai.stages }, info: info }) + '<div class="row" style="margin-top:12px"><button class="btn p" id="saveAi">Guardar</button><span id="aiMsg" class="small mut" role="status"></span></div>' +
      '<p class="small mut" style="margin-bottom:0">Se guarda en <code>' + esc(S.ai.globalPath) + "</code>. Sobre el consumo: Chip Chop no lo mide; lo contabiliza tu proveedor (Claude o Copilot) en su propia cuenta.</p></div>";
    ChipAi.bind($("ia"), { info: info });
    $("rescan").onclick = function () { var b = $("rescan"); b.disabled = true; b.textContent = "Buscando…"; api.invoke("home:state", { refreshAi: true }).then(function (s) { S = s; render(); }, fail); };
    $("saveAi").onclick = function () {
      api.invoke("home:saveAi", ChipAi.collect($("ia"))).then(function () { $("aiMsg").textContent = "Guardado."; }, fail);
    };
  }

  // ---------- ajustes ----------
  function renderSettings() {
    var info = updInfo;
    var upd = info ? (info.error ? '<div class="banner er">No se pudo consultar: ' + esc(info.error) + "</div>" : info.available ? '<div class="banner"><div class="grow"><b>Hay una versión nueva: ' + esc(info.latest) + "</b>" + (info.prerelease ? " " + badge("candidata", "wa") : "") + '<div class="small">' + (S.updateMode === "auto" ? "Se descarga e instala sola y la app se reinicia." : "En este sistema se abre la página de descargas para instalarla a mano.") + '</div></div><button class="btn p" id="doUpd">' + (S.updateMode === "auto" ? "Actualizar ahora" : "Abrir descargas") + "</button></div>" : '<div class="banner">Estás al día (' + esc(info.current) + ").</div>") : "";
    $("ajustes").innerHTML = '<div><h1>Ajustes</h1><p class="sub">Versión, actualizaciones y estado del sistema.</p></div>' + warnings() +
      '<div class="card"><h2>Actualizaciones</h2><div class="kv"><span>Versión instalada</span><b>' + esc(S.version) + "</b></div>" +
      '<div role="radiogroup" aria-label="Canal de actualizaciones"><label class="radio"><input type="radio" name="canal" value="stable"' + (S.channel === "stable" ? " checked" : "") + '><span><b>Solo estables</b><br><span class="mut small">Solo versiones finales. Ignora las candidatas (rc).</span></span></label>' +
      '<label class="radio"><input type="radio" name="canal" value="latest"' + (S.channel === "latest" ? " checked" : "") + '><span><b>Últimas</b><br><span class="mut small">Siempre la más reciente, sea candidata (rc) o final.</span></span></label></div>' +
      '<div class="row" style="margin:12px 0"><button class="btn" id="chk">Buscar actualizaciones</button></div>' + upd + '<div id="updProg"></div></div>' +
      '<div class="card"><h2>Estado del sistema</h2>' + S.checks.filter(function (c) { return c.name.indexOf("ai:") !== 0; }).map(function (c) { return '<div class="kv"><span>' + esc(c.name) + "</span><span>" + badge(c.ok ? "ok" : "falta", c.ok ? "ok" : "er") + ' <span class="small mut">' + esc(tr(c.detail)) + "</span></span></div>"; }).join("") + '<div class="kv"><span>Sistema</span><span class="mut">' + esc(S.platform) + "</span></div></div>" +
      '<div class="card"><h2>Acerca de</h2><p style="margin:0">Chip Chop captura cada estado de la interfaz de una app web en dos versiones de git y compara píxeles, árbol ARIA, peticiones, errores de consola y el grafo de flujos. <a href="#" id="docs">Documentación y versiones</a></p></div>';
    document.querySelectorAll("input[name=canal]").forEach(function (r) { r.onchange = function () { api.invoke("home:setChannel", r.value).then(function () { S.channel = r.value; updInfo = null; }); }; });
    $("chk").onclick = function () { var b = $("chk"); b.disabled = true; b.textContent = "Buscando…"; api.invoke("home:checkUpdate").then(function (i) { updInfo = i; renderSettings(); }, function (e) { updInfo = { error: e.message }; renderSettings(); }); };
    if (updPg && $("updProg")) $("updProg").replaceWith(updPg.host);
    if ($("doUpd")) $("doUpd").onclick = function () {
      var b = $("doUpd"), manual = S.updateMode !== "auto", c = $("chk");
      b.disabled = true; c.disabled = true; b.textContent = manual ? "Abriendo…" : "Actualizando…";
      updPg = progress($("updProg"), manual); updPg.host = $("updProg");
      api.invoke("home:installUpdate").then(function () {
        if (manual) { updPg.end(true, "Se ha abierto la página de descargas"); b.disabled = false; c.disabled = false; b.textContent = "Abrir descargas"; }
        else updPg.end(true, "Descargada: la app se reinicia para terminar");
      }, function (e) { updPg.end(false, "La actualización ha fallado"); b.disabled = false; c.disabled = false; b.textContent = "Actualizar ahora"; return notify(e, "No se ha podido actualizar"); });
    };
    $("docs").onclick = function (e) { e.preventDefault(); api.invoke("home:openExternal", "https://github.com/ElMaxter99/chip-chop"); };
  }

  function render() {
    $("ver").textContent = "v" + S.version;
    renderBrowser(); renderProjects(); renderAi(); renderSettings(); show(tab);
    if (!S.smoke && !S.chromium.installed && !installingChromium && !chromiumFailed && !autoTried) { autoTried = true; startChromium(); }
  }
  // Arrastrar una carpeta sobre la ventana la añade y la abre.
  var dragDepth = 0;
  function dropHint(on) { document.body.classList.toggle("dropping", on); }
  window.addEventListener("dragenter", function (e) { e.preventDefault(); dragDepth++; dropHint(true); });
  window.addEventListener("dragleave", function () { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropHint(false); });
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) {
    e.preventDefault(); dragDepth = 0; dropHint(false);
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    var p = f && api.pathForFile(f);
    if (p) api.invoke("home:dropProject", p).catch(fail);
  });
  load().catch(fail);
})();
