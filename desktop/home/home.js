(function () {
  "use strict";
  var api = window.chipchop;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var badge = function (t, k) { return '<span class="badge ' + (k || "") + '">' + esc(t) + "</span>"; };
  var STAGES = [["discover", "Descubrir", "Rutas y modales → estados"], ["flows", "Flujos", "Recorridos del usuario"], ["mocks", "Mocks", "Respuestas del backend con tipos"], ["repair", "Reparar", "Corrige errores de validación"]];
  var TR = [["needs >= 22", "hace falta 22 o superior"], ["not found on PATH (only needed if a stage uses it)", "no encontrado (solo hace falta si una etapa lo usa)"], ["not found on PATH", "no encontrado"], ["not installed. Run: npx playwright install chromium", "no instalado"]];
  var tr = function (s) { TR.forEach(function (p) { s = s.replace(p[0], p[1]); }); return s; };
  var S = null, tab = "proyectos", chromiumLog = "", updLog = "", updInfo = null, installingChromium = false, chromiumFailed = false, autoTried = false;

  function fail(e) { alert(String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")); }
  function ago(ts) { if (!ts) return "nunca"; var m = Math.round((Date.now() - ts) / 60000); if (m < 1) return "ahora mismo"; if (m < 60) return "hace " + m + " min"; var h = Math.round(m / 60); if (h < 24) return "hace " + h + " h"; return "hace " + Math.round(h / 24) + " d"; }

  api.onLog(function (line) {
    if (line.indexOf("chromium:") === 0) { chromiumLog = line.slice(9); var el = $("chromiumLog"); if (el) el.textContent = chromiumLog; }
    else { updLog += line + "\n"; var u = $("updLog"); if (u) { u.hidden = false; u.textContent = updLog; u.scrollTop = u.scrollHeight; } }
  });

  function load() { return api.invoke("home:state").then(function (s) { S = s; if (!document.getElementById("css")) { var l = document.createElement("link"); l.id = "css"; l.rel = "stylesheet"; l.href = s.cssHref; l.onload = function () { document.body.style.visibility = "visible"; }; document.head.appendChild(l); } render(); }); }

  function show(t) { tab = t; document.querySelectorAll("#tabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === t); }); document.querySelectorAll(".tab").forEach(function (x) { x.hidden = x.id !== t; }); }
  document.addEventListener("click", function (e) { var t = e.target.closest("[data-tab]"); if (t) show(t.dataset.tab); });

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
  function renderProjects() {
    var blocked = !S.chromium.installed;
    var list = S.projects.map(function (p, i) {
      return '<div class="proj"><div class="grow"><div class="nm">' + esc(p.name) + " " + (!p.exists ? badge("no encontrada", "er") : p.initialized ? badge("configurado", "ok") : badge("sin inicializar", "wa")) + '</div><div class="pt" title="' + esc(p.path) + '">' + esc(p.path) + '</div><div class="small mut">Abierto ' + ago(p.lastOpened) + "</div></div>" +
        '<button class="btn p" data-open="' + i + '"' + (blocked || !p.exists ? " disabled" : "") + ">Abrir</button><button class='btn ghost' data-rm='" + i + "'>Quitar de la lista</button></div>";
    }).join("");
    $("proyectos").innerHTML = '<div class="hero"><img src="' + esc(S.logoHref) + '" alt=""><div><h1>Tus proyectos</h1><p class="sub">Cada proyecto es la carpeta de una app web que quieres auditar (AngularJS, Angular, React…). Chip Chop captura todos sus estados en dos versiones de git y los compara.</p></div></div>' +
      '<div class="card">' + (list || '<div class="empty"><b>Aún no has añadido ningún proyecto</b><div class="mut">Elige la carpeta de la app que quieres auditar. Debe ser un repositorio git.</div></div>') +
      '<div class="row" style="margin-top:16px"><button class="btn p" id="add"' + (blocked ? " disabled" : "") + ">Añadir proyecto…</button>" + (blocked ? '<span class="small mut">Disponible cuando termine la descarga del navegador.</span>' : "") + "</div></div>";
    $("add").onclick = function () { api.invoke("home:addProject").catch(fail); };
    document.querySelectorAll("[data-open]").forEach(function (b) { b.onclick = function () { b.disabled = true; api.invoke("home:openProject", S.projects[+b.dataset.open].path).catch(function (e) { b.disabled = false; fail(e); }); }; });
    document.querySelectorAll("[data-rm]").forEach(function (b) { b.onclick = function () { api.invoke("home:removeProject", S.projects[+b.dataset.rm].path).then(load); }; });
  }

  // ---------- IA ----------
  function renderAi() {
    var provs = Object.keys(S.ai.providers);
    var ok = S.checks.filter(function (c) { return c.name.indexOf("ai:") === 0; });
    var rows = STAGES.map(function (s) {
      var cur = S.ai.stages[s[0]] || { provider: provs[0], model: "" };
      return "<tr><td><b>" + s[1] + '</b><div class="small mut">' + s[2] + '</div></td><td><select data-st="' + s[0] + '" data-k="provider">' + provs.map(function (p) { return '<option value="' + esc(p) + '"' + (p === cur.provider ? " selected" : "") + ">" + esc(p) + "</option>"; }).join("") + '</select></td><td><input type="text" data-st="' + s[0] + '" data-k="model" value="' + esc(cur.model || "") + '" placeholder="modelo (opcional)" aria-label="Modelo de ' + s[1] + '"></td></tr>';
    }).join("");
    $("ia").innerHTML = '<div><h1>Inteligencia artificial</h1><p class="sub">Chip Chop no trae IA propia: usa la herramienta de línea de comandos que ya tengas (Claude Code o GitHub Copilot) para leer el código de tu app y escribir su catálogo de estados. Estos valores son los de partida para todos los proyectos; cada proyecto puede cambiarlos en su pestaña IA.</p></div>' +
      '<div class="card"><h2>Herramientas detectadas</h2>' + (ok.map(function (c) { return '<div class="kv"><span>' + esc(c.name.replace("ai: ", "")) + "</span><span>" + badge(c.ok ? "instalada" : "no instalada", c.ok ? "ok" : "wa") + ' <span class="small mut">' + esc(tr(c.detail)) + "</span></span></div>"; }).join("") || '<span class="mut">Ninguna.</span>') + "</div>" +
      '<div class="card"><h2>Qué modelo usa cada etapa</h2><table><tr><th>Etapa</th><th>Proveedor</th><th>Modelo</th></tr>' + rows + '</table><div class="row" style="margin-top:12px"><button class="btn p" id="saveAi">Guardar</button><span id="aiMsg" class="small mut"></span></div>' +
      '<p class="small mut" style="margin-bottom:0">Se guarda en <code>' + esc(S.ai.globalPath) + "</code>. Sobre el consumo: Chip Chop no lo mide; lo contabiliza tu proveedor (Claude o Copilot) en su propia cuenta.</p></div>";
    $("saveAi").onclick = function () {
      var stages = {};
      document.querySelectorAll("#ia [data-st]").forEach(function (el) { var k = el.dataset.st; stages[k] = stages[k] || {}; stages[k][el.dataset.k] = el.value.trim(); });
      api.invoke("home:saveAi", stages).then(function () { $("aiMsg").textContent = "Guardado."; }, fail);
    };
  }

  // ---------- ajustes ----------
  function renderSettings() {
    var info = updInfo;
    var upd = info ? (info.error ? '<div class="banner er">No se pudo consultar: ' + esc(info.error) + "</div>" : info.available ? '<div class="banner"><div class="grow"><b>Hay una versión nueva: ' + esc(info.latest) + "</b>" + (info.prerelease ? " " + badge("candidata", "wa") : "") + '<div class="small">' + (S.updateMode === "auto" ? "Se descarga e instala sola y la app se reinicia." : "En este sistema se abre la página de descargas para instalarla a mano.") + '</div></div><button class="btn p" id="doUpd">' + (S.updateMode === "auto" ? "Actualizar ahora" : "Abrir descargas") + "</button></div>" : '<div class="banner">Estás al día (' + esc(info.current) + ").</div>") : "";
    $("ajustes").innerHTML = '<div><h1>Ajustes</h1><p class="sub">Versión, actualizaciones y estado del sistema.</p></div>' +
      '<div class="card"><h2>Actualizaciones</h2><div class="kv"><span>Versión instalada</span><b>' + esc(S.version) + "</b></div>" +
      '<div class="radio"><input type="radio" name="canal" value="stable"' + (S.channel === "stable" ? " checked" : "") + '><span><b>Solo estables</b><br><span class="mut small">Solo versiones finales. Ignora las candidatas (rc).</span></span></div>' +
      '<div class="radio"><input type="radio" name="canal" value="latest"' + (S.channel === "latest" ? " checked" : "") + '><span><b>Últimas</b><br><span class="mut small">Siempre la más reciente, sea candidata (rc) o final.</span></span></div>' +
      '<div class="row" style="margin:12px 0"><button class="btn" id="chk">Buscar actualizaciones</button></div>' + upd + '<pre class="log" id="updLog" hidden></pre></div>' +
      '<div class="card"><h2>Estado del sistema</h2>' + S.checks.filter(function (c) { return c.name.indexOf("ai:") !== 0; }).map(function (c) { return '<div class="kv"><span>' + esc(c.name) + "</span><span>" + badge(c.ok ? "ok" : "falta", c.ok ? "ok" : "er") + ' <span class="small mut">' + esc(tr(c.detail)) + "</span></span></div>"; }).join("") + '<div class="kv"><span>Sistema</span><span class="mut">' + esc(S.platform) + "</span></div></div>" +
      '<div class="card"><h2>Acerca de</h2><p style="margin:0">Chip Chop captura cada estado de la interfaz de una app web en dos versiones de git y compara píxeles, árbol ARIA, peticiones, errores de consola y el grafo de flujos. <a href="#" id="docs">Documentación y versiones</a></p></div>';
    document.querySelectorAll("input[name=canal]").forEach(function (r) { r.onchange = function () { api.invoke("home:setChannel", r.value).then(function () { S.channel = r.value; updInfo = null; }); }; });
    $("chk").onclick = function () { var b = $("chk"); b.disabled = true; b.textContent = "Buscando…"; api.invoke("home:checkUpdate").then(function (i) { updInfo = i; renderSettings(); }, function (e) { updInfo = { error: e.message }; renderSettings(); }); };
    if ($("doUpd")) $("doUpd").onclick = function () { var b = $("doUpd"); b.disabled = true; updLog = ""; api.invoke("home:installUpdate").catch(fail).then(function () { b.disabled = false; }); };
    $("docs").onclick = function (e) { e.preventDefault(); api.invoke("home:openExternal", "https://github.com/ElMaxter99/chip-chop"); };
  }

  function render() {
    $("ver").textContent = "v" + S.version;
    renderBrowser(); renderProjects(); renderAi(); renderSettings(); show(tab);
    if (!S.chromium.installed && !installingChromium && !chromiumFailed && !autoTried) { autoTried = true; startChromium(); }
  }
  load().catch(fail);
})();
