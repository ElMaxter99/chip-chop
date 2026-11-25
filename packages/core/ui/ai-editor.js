// Editor «qué proveedor y modelo usa cada etapa». Lo comparten la interfaz local y la pantalla de Inicio de la app de escritorio.
// Lee de /api/ai/info (o del equivalente de Inicio) qué herramientas hay instaladas y qué modelos ofrece cada una.
(function (root) {
  "use strict";
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var LABEL = { claude: "Claude Code", copilot: "GitHub Copilot CLI", codex: "OpenAI Codex (ChatGPT)", custom: "Personalizado" };
  // Monograma propio de cada herramienta. Si existe ui/icons/<tipo>.svg (o .png) se usa ese icono en su lugar.
  var MONO = { claude: "C", copilot: "G", codex: "O", custom: "·" };
  var OTHER = "__other";

  function chip(id, name, info, checked) {
    var i = info[name] || {}, ok = !!i.found;
    var sub = ok ? "Instalada" + (i.version ? " · " + esc(i.version.replace(/\s*\(.*$/, "")) : "") : "No encontrada";
    var title = ok ? i.found.path : "No se encuentra «" + (i.command || name) + "». Instálala o indica su ruta en ai.yaml";
    return '<label class="pv' + (checked ? " on" : "") + '" title="' + esc(title) + '"><input type="radio" name="pv-' + id + '" value="' + esc(name) + '"' + (checked ? " checked" : "") + '><span class="pv-ico ' + esc(i.type || "custom") + '" aria-hidden="true">' + esc(MONO[i.type] || MONO.custom) + '<img alt="" src="icons/' + esc(i.type || "custom") + '.svg" onload="this.parentNode.classList.add(\'img\')" onerror="this.remove()"><span class="pv-dot ' + (ok ? "ok" : "wa") + '"></span></span><span class="pv-t"><b>' + esc(name) + '</b><span class="small mut">' + esc(LABEL[i.type] || i.type || "") + " · " + sub + "</span></span></label>";
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
        '<div class="ai-prov" role="radiogroup" aria-label="Proveedor de ' + esc(s[1]) + '">' + names.map(function (n) { return chip(s[0], n, o.info, n === sc.provider); }).join("") + "</div>" +
        '<div class="ai-model"><label class="f">Modelo<select class="ai-sel" aria-label="Modelo de ' + esc(s[1]) + '">' + m.html + '</select></label><input type="text" class="ai-other" placeholder="Nombre exacto del modelo" aria-label="Otro modelo de ' + esc(s[1]) + '" value="' + esc(m.other) + '"' + (m.other || (m.html.indexOf('value="' + OTHER + '" selected') >= 0) ? "" : " hidden") + '><div class="small mut ai-note">' + esc(m.note) + "</div></div>" +
        (o.extra ? '<div class="ai-extra">' + o.extra(s[0]) + "</div>" : "") + "</div>";
    }).join("") + "</div>";
  }

  function bind(el, o) {
    el.querySelectorAll(".ai-stage").forEach(function (row) {
      var sel = row.querySelector(".ai-sel"), other = row.querySelector(".ai-other");
      function sync() { other.hidden = sel.value !== OTHER; if (!other.hidden) other.focus(); }
      sel.onchange = sync;
      row.querySelectorAll(".ai-prov input").forEach(function (r) {
        r.onchange = function () {
          row.querySelectorAll(".pv").forEach(function (l) { l.classList.toggle("on", l.contains(r) && r.checked); });
          var cur = sel.value === OTHER ? other.value.trim() : sel.value, m = modelSelect(o.info, r.value, cur);
          sel.innerHTML = m.html; other.hidden = !(sel.value === OTHER); if (other.hidden) other.value = ""; row.querySelector(".ai-note").textContent = m.note;
        };
      });
    });
  }

  function read(row) {
    var p = row.querySelector(".ai-prov input:checked"), sel = row.querySelector(".ai-sel"), other = row.querySelector(".ai-other");
    var model = sel.value === OTHER ? other.value.trim() : sel.value;
    var out = { provider: p ? p.value : "" }; if (model) out.model = model; return out;
  }
  function collect(el) { var o = {}; el.querySelectorAll(".ai-stage").forEach(function (row) { o[row.dataset.stage] = read(row); }); return o; }

  root.ChipAi = { rows: rows, bind: bind, collect: collect, read: read };
})(window);
