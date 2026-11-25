// Editor «qué proveedor y modelo usa cada etapa». Lo comparten la interfaz local y la pantalla de Inicio de la app de escritorio.
// Lee de /api/ai/info (o del equivalente de Inicio) qué herramientas hay instaladas y qué modelos ofrece cada una.
(function (root) {
  "use strict";
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var LABEL = { claude: "Claude Code", copilot: "GitHub Copilot CLI", codex: "OpenAI Codex (ChatGPT)", custom: "Personalizado" };
  // Monograma propio de cada herramienta. Si existe ui/icons/<tipo>.svg (o .png) se usa ese icono en su lugar.
  var MONO = { claude: "C", copilot: "G", codex: "O", custom: "·" };
  var OTHER = "__other";

  function card(name, info) {
    var i = info[name] || {}, ok = !!i.found;
    var sub = ok ? "Instalada" + (i.version ? " · " + esc(i.version.replace(/\s*\(.*$/, "")) : "") : "No encontrada";
    return '<span class="pv-ico ' + esc(i.type || "custom") + '" aria-hidden="true">' + esc(MONO[i.type] || MONO.custom) + '<img alt="" src="icons/' + esc(i.type || "custom") + '.svg" onload="this.parentNode.classList.add(\'img\')" onerror="this.remove()"><span class="pv-dot ' + (ok ? "ok" : "wa") + '"></span></span><span class="pv-t"><b>' + esc(name) + '</b><span class="small mut">' + esc(LABEL[i.type] || i.type || "") + " · " + sub + "</span></span>";
  }
  function titleOf(name, info) { var i = info[name] || {}; return i.found ? i.found.path : "No se encuentra «" + (i.command || name) + "». Instálala o indica su ruta en ai.yaml"; }
  // Desplegable propio (mismas tarjetas que en la lista): botón con la opción actual + lista con teclado.
  function picker(id, names, cur, info) {
    return '<div class="pvsel" data-value="' + esc(cur) + '"><button type="button" class="pv pv-trigger on" aria-haspopup="listbox" aria-expanded="false" aria-label="Herramienta de IA de la etapa ' + esc(id) + '" title="' + esc(titleOf(cur, info)) + '">' + card(cur, info) + '<span class="pv-caret" aria-hidden="true">▾</span></button>' +
      '<ul class="pv-menu" role="listbox" hidden tabindex="-1">' + names.map(function (n) { return '<li role="option" class="pv' + (n === cur ? " on" : "") + '" data-v="' + esc(n) + '" aria-selected="' + (n === cur) + '" title="' + esc(titleOf(n, info)) + '">' + card(n, info) + "</li>"; }).join("") + "</ul></div>";
  }

  function modelSelect(info, provider, value) {
    var m = (info[provider] && info[provider].models) || { options: [] }, known = m.options.some(function (o) { return o.value === value; });
    var sel = !value ? "" : known ? value : OTHER;
    var opts = '<option value=""' + (sel === "" ? " selected" : "") + ">Predeterminado del CLI</option>" +
      m.options.map(function (o) { return '<option value="' + esc(o.value) + '"' + (sel === o.value ? " selected" : "") + ">" + esc(o.label + (o.hint ? " — " + o.hint : "")) + "</option>"; }).join("") +
      '<option value="' + OTHER + '"' + (sel === OTHER ? " selected" : "") + ">Otro…</option>";
    return { html: opts, other: sel === OTHER ? value : "", note: m.note || "", source: m.source };
  }

  /** HTML de las filas. o = { stages:[[id,título,descripción]], cfg:{providers,stages}, info, extra?:(id)=>html } */
  function rows(o) {
    var names = Object.keys(o.cfg.providers);
    return '<div class="ai-list">' + o.stages.map(function (s) {
      var sc = o.cfg.stages[s[0]] || { provider: names[0] }, m = modelSelect(o.info, sc.provider, sc.model);
      return '<div class="ai-stage" data-stage="' + s[0] + '"><div class="ai-name"><b>' + esc(s[1]) + '</b><div class="mut small">' + esc(s[2]) + '</div></div>' +
        '<div class="ai-prov">' + picker(s[1], names, sc.provider, o.info) + "</div>" +
        '<div class="ai-model"><label class="f">Modelo<select class="ai-sel" aria-label="Modelo de ' + esc(s[1]) + '">' + m.html + '</select></label><input type="text" class="ai-other" placeholder="Nombre exacto del modelo" aria-label="Otro modelo de ' + esc(s[1]) + '" value="' + esc(m.other) + '"' + (m.other || (m.html.indexOf('value="' + OTHER + '" selected') >= 0) ? "" : " hidden") + '><div class="small mut ai-note">' + esc(m.note) + "</div></div>" +
        (o.extra ? '<div class="ai-extra">' + o.extra(s[0]) + "</div>" : "") + "</div>";
    }).join("") + "</div>";
  }

  function bind(el, o) {
    function closeAll(except) { el.querySelectorAll(".pvsel").forEach(function (d) { if (d === except) return; var m = d.querySelector(".pv-menu"); m.hidden = true; d.querySelector(".pv-trigger").setAttribute("aria-expanded", "false"); }); }
    document.addEventListener("click", function (e) { if (!e.target.closest || !e.target.closest(".pvsel")) closeAll(null); });
    el.querySelectorAll(".ai-stage").forEach(function (row) {
      var sel = row.querySelector(".ai-sel"), other = row.querySelector(".ai-other"), d = row.querySelector(".pvsel"), trig = d.querySelector(".pv-trigger"), menu = d.querySelector(".pv-menu");
      var items = function () { return [].slice.call(menu.querySelectorAll("li")); }, active = -1;
      function sync() { other.hidden = sel.value !== OTHER; if (!other.hidden) other.focus(); }
      sel.onchange = sync;
      function mark(i) { var it = items(); active = Math.max(0, Math.min(it.length - 1, i)); it.forEach(function (l, k) { l.classList.toggle("act", k === active); }); it[active].scrollIntoView({ block: "nearest" }); }
      function open() { closeAll(d); menu.hidden = false; trig.setAttribute("aria-expanded", "true"); mark(items().findIndex(function (l) { return l.dataset.v === d.dataset.value; })); menu.focus(); }
      function close(focus) { menu.hidden = true; trig.setAttribute("aria-expanded", "false"); if (focus) trig.focus(); }
      function choose(name) {
        d.dataset.value = name; trig.innerHTML = card(name, o.info) + '<span class="pv-caret" aria-hidden="true">▾</span>'; trig.title = titleOf(name, o.info);
        items().forEach(function (l) { l.classList.toggle("on", l.dataset.v === name); l.setAttribute("aria-selected", String(l.dataset.v === name)); });
        var cur = sel.value === OTHER ? other.value.trim() : sel.value, m = modelSelect(o.info, name, cur);
        sel.innerHTML = m.html; other.hidden = !(sel.value === OTHER); if (other.hidden) other.value = ""; row.querySelector(".ai-note").textContent = m.note;
        close(true);
      }
      trig.onclick = function () { menu.hidden ? open() : close(false); };
      trig.onkeydown = function (e) { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); open(); } };
      menu.onclick = function (e) { var li = e.target.closest("li"); if (li) choose(li.dataset.v); };
      menu.onkeydown = function (e) {
        if (e.key === "ArrowDown") { e.preventDefault(); mark(active + 1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); mark(active - 1); }
        else if (e.key === "Home") { e.preventDefault(); mark(0); }
        else if (e.key === "End") { e.preventDefault(); mark(items().length - 1); }
        else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(items()[active].dataset.v); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
        else if (e.key === "Tab") close(false);
      };
    });
  }

  function read(row) {
    var p = row.querySelector(".pvsel"), sel = row.querySelector(".ai-sel"), other = row.querySelector(".ai-other");
    var model = sel.value === OTHER ? other.value.trim() : sel.value;
    var out = { provider: p ? p.dataset.value : "" }; if (model) out.model = model; return out;
  }
  function collect(el) { var o = {}; el.querySelectorAll(".ai-stage").forEach(function (row) { o[row.dataset.stage] = read(row); }); return o; }

  root.ChipAi = { rows: rows, bind: bind, collect: collect, read: read };
})(window);
