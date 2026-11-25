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
    return '<div class="ai-problems banner er" role="alert" hidden></div><div class="ai-list">' + o.stages.map(function (s) {
      var sc = o.cfg.stages[s[0]] || { provider: names[0] }, m = modelSelect(o.info, sc.provider, sc.model);
      return '<div class="ai-stage" data-stage="' + s[0] + '" data-title="' + esc(s[1]) + '"><div class="ai-name"><b>' + esc(s[1]) + '</b><div class="mut small">' + esc(s[2]) + '</div></div>' +
        '<div class="ai-prov">' + picker(s[1], names, sc.provider, o.info) + "</div>" +
        '<div class="ai-model"><label class="f">Modelo<select class="ai-sel" aria-label="Modelo de ' + esc(s[1]) + '">' + m.html + '</select></label><input type="text" class="ai-other" placeholder="Nombre exacto del modelo" aria-label="Otro modelo de ' + esc(s[1]) + '" value="' + esc(m.other) + '"' + (m.other || (m.html.indexOf('value="' + OTHER + '" selected') >= 0) ? "" : " hidden") + '><div class="small mut ai-note">' + esc(m.note) + "</div></div>" +
        (o.extra ? '<div class="ai-extra">' + o.extra(s[0]) + "</div>" : "") + "</div>";
    }).join("") + "</div>";
  }

  // ---- Aviso breve («toast») ----
  function toast(msg, kind) {
    var host = document.getElementById("toasts");
    if (!host) { host = document.createElement("div"); host.id = "toasts"; host.className = "toast-host"; host.setAttribute("role", "status"); host.setAttribute("aria-live", "polite"); document.body.appendChild(host); }
    var t = document.createElement("div"); t.className = "toast " + (kind || "ok");
    t.innerHTML = '<span class="toast-i" aria-hidden="true">' + (kind === "er" ? "!" : kind === "wa" ? "!" : "✓") + "</span><span>" + esc(msg) + "</span>";
    host.appendChild(t);
    setTimeout(function () { t.classList.add("out"); setTimeout(function () { t.remove(); }, 300); }, kind === "er" ? 6000 : 2600);
  }

  /** Qué impide usar la IA con esto (mismo criterio que el servidor): herramienta que falta o modelo que su CLI ya no lista. */
  function problems(stages, info) {
    var out = [];
    Object.keys(stages).forEach(function (st) {
      var sc = stages[st], i = info[sc.provider];
      if (!i || !i.found) out.push({ stage: st, provider: sc.provider, message: "«" + sc.provider + "» no está instalada o no se encuentra" });
      else if (sc.model && i.models && i.models.source === "cli" && i.models.options.length && !i.models.options.some(function (o) { return o.value === sc.model; })) out.push({ stage: st, provider: sc.provider, message: "el modelo «" + sc.model + "» ya no está disponible en " + sc.provider });
    });
    return out;
  }

  /**
   * Conecta el editor. o = { stages, cfg, info, refresh?:()=>Promise<{info}>, save?:(stages)=>Promise, onProblems?:(lista)=>void, titles }
   * Cada cambio se guarda solo (con aviso); al elegir herramienta se vuelven a buscar sus modelos.
   */
  function bind(el, o) {
    var names = Object.keys(o.cfg.providers), timer = null, seq = 0;
    var titleOf2 = function (row) { return row.dataset.title || row.dataset.stage; };
    function banner() {
      var box = el.querySelector(".ai-problems"); if (!box) return [];
      var list = problems(collect(el), o.info);
      box.hidden = !list.length;
      box.innerHTML = list.length ? '<b>Hay que revisar la configuración de IA</b><ul>' + list.map(function (p) { return "<li><b>" + esc(p.stage) + ":</b> " + esc(p.message) + ". Elige otra herramienta o modelo aquí abajo.</li>"; }).join("") + "</ul>" : "";
      if (o.onProblems) o.onProblems(list);
      return list;
    }
    function changed() {
      banner();
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (!o.save) return;
        var n = ++seq;
        Promise.resolve(o.save(collect(el))).then(function () { if (n === seq) toast("Configuración de IA guardada", "ok"); }, function (e) { toast("No se pudo guardar: " + ((e && e.message) || e), "er"); });
      }, 350);
    }
    function repaintCards() {
      el.querySelectorAll(".ai-stage").forEach(function (row) {
        var d = row.querySelector(".pvsel"), trig = d.querySelector(".pv-trigger");
        trig.innerHTML = card(d.dataset.value, o.info) + '<span class="pv-caret" aria-hidden="true">▾</span>'; trig.title = titleOf(d.dataset.value, o.info);
        d.querySelectorAll("li").forEach(function (l) { l.innerHTML = card(l.dataset.v, o.info); l.title = titleOf(l.dataset.v, o.info); });
      });
    }
    function reloadModels(row, resetIfUnknown) {
      var sel = row.querySelector(".ai-sel"), other = row.querySelector(".ai-other"), prov = row.querySelector(".pvsel").dataset.value;
      var cur = sel.value === OTHER ? other.value.trim() : sel.value, m = modelSelect(o.info, prov, cur);
      // al cambiar de herramienta, un modelo que no existe en la nueva vuelve a «Predeterminado»
      if (resetIfUnknown && cur && !((o.info[prov] && o.info[prov].models.options) || []).some(function (x) { return x.value === cur; })) { cur = ""; m = modelSelect(o.info, prov, ""); }
      sel.innerHTML = m.html; other.hidden = !(sel.value === OTHER); if (other.hidden) other.value = m.other || ""; if (!other.hidden) other.value = m.other || cur;
      row.querySelector(".ai-note").textContent = m.note;
    }
    // Vuelve a buscar herramientas y modelos; refresca tarjetas y listas sin perder lo elegido.
    function rescan(row) {
      if (!o.refresh) return Promise.resolve();
      if (row) row.querySelector(".ai-note").textContent = "Buscando los modelos disponibles…";
      return Promise.resolve(o.refresh()).then(function (r) {
        var fresh = Object.assign({}, (r && r.info) || r); Object.keys(o.info).forEach(function (k) { delete o.info[k]; }); Object.assign(o.info, fresh);
        repaintCards(); el.querySelectorAll(".ai-stage").forEach(function (r2) { reloadModels(r2); }); banner();
      }, function () { if (row) reloadModels(row); });
    }
    el.querySelectorAll(".ai-stage").forEach(function (row) {
      var sel = row.querySelector(".ai-sel"), other = row.querySelector(".ai-other"), d = row.querySelector(".pvsel"), trig = d.querySelector(".pv-trigger"), menu = d.querySelector(".pv-menu");
      var items = function () { return [].slice.call(menu.querySelectorAll("li")); }, active = -1;
      function closeAll(except) { el.querySelectorAll(".pvsel").forEach(function (x) { if (x === except) return; x.querySelector(".pv-menu").hidden = true; x.querySelector(".pv-trigger").setAttribute("aria-expanded", "false"); }); }
      sel.onchange = function () { other.hidden = sel.value !== OTHER; if (!other.hidden) other.focus(); else changed(); };
      other.onchange = changed;
      function mark(i) { var it = items(); active = Math.max(0, Math.min(it.length - 1, i)); it.forEach(function (l, k) { l.classList.toggle("act", k === active); }); it[active].scrollIntoView({ block: "nearest" }); }
      function open() { closeAll(d); menu.hidden = false; trig.setAttribute("aria-expanded", "true"); mark(items().findIndex(function (l) { return l.dataset.v === d.dataset.value; })); menu.focus(); rescan(null); }
      function close(focus) { menu.hidden = true; trig.setAttribute("aria-expanded", "false"); if (focus) trig.focus(); }
      function choose(name) {
        var same = name === d.dataset.value;
        d.dataset.value = name; trig.innerHTML = card(name, o.info) + '<span class="pv-caret" aria-hidden="true">▾</span>'; trig.title = titleOf(name, o.info);
        items().forEach(function (l) { l.classList.toggle("on", l.dataset.v === name); l.setAttribute("aria-selected", String(l.dataset.v === name)); });
        close(true); if (same) return;
        // otro proveedor ⇒ otra lista de modelos: se vuelve a buscar y se conserva el modelo solo si también existe allí
        reloadModels(row, true); rescan(row).then(function () { reloadModels(row, true); changed(); });
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
    document.addEventListener("click", function (e) { if (!e.target.closest || !e.target.closest(".pvsel")) el.querySelectorAll(".pvsel").forEach(function (x) { x.querySelector(".pv-menu").hidden = true; x.querySelector(".pv-trigger").setAttribute("aria-expanded", "false"); }); });
    // Cajas vacías (algo sin encontrar o sin lista de modelos): se busca solo, sin botón.
    var empty = names.some(function (n) { var i = o.info[n]; return !i || !i.found || (i.type === "copilot" && !i.models.options.length); });
    if (empty) rescan(null);
    banner();
    return { changed: changed, rescan: rescan, banner: banner };
  }

  function read(row) {
    var p = row.querySelector(".pvsel"), sel = row.querySelector(".ai-sel"), other = row.querySelector(".ai-other");
    var model = sel.value === OTHER ? other.value.trim() : sel.value;
    var out = { provider: p ? p.dataset.value : "" }; if (model) out.model = model; return out;
  }
  function collect(el) { var o = {}; el.querySelectorAll(".ai-stage").forEach(function (row) { o[row.dataset.stage] = read(row); }); return o; }

  root.ChipAi = { rows: rows, bind: bind, collect: collect, read: read, toast: toast, problems: problems };
})(window);
