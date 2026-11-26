// «Generar con IA» (y cualquier trabajo largo con varias etapas): franja de estado en la página + ventana de detalle en vivo.
// ChipRun.start({ host, title }) → { push(línea), finish(status, result) }. Entiende las líneas que emite runAi:
//   «== etapa: herramienta / modelo», «  ai: paso», «  uso: …», «validation found…», «error: …».
(function () {
  var LABEL = { discover: "Descubrir", flows: "Flujos", mocks: "Mocks", repair: "Reparar" };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function n(v) { v = Math.round(v || 0); return v >= 10000 ? (v / 1000).toFixed(v >= 100000 ? 0 : 1) + "k" : String(v); }
  function clock(ms) { var s = Math.round(ms / 1000); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
  function billed(u) { return u ? u.input + u.output + u.cacheWrite : 0; }
  /** «12k tokens · ≈ $0.12 · 6,76 AI credits» — solo lo que el CLI informó. */
  function usageText(u) {
    if (!u) return "sin datos de consumo (este CLI no los informa)";
    var p = billed(u) > 0 ? [n(billed(u)) + " tokens"] : [];
    if (u.costUsd !== undefined) p.push("≈ $" + u.costUsd.toFixed(u.costUsd < 0.1 ? 3 : 2));
    if (u.aiCredits !== undefined) p.push(u.aiCredits.toFixed(2).replace(".", ",") + " AI credits");
    if (u.premiumRequests !== undefined) p.push(Math.round(u.premiumRequests * 100) / 100 + " premium request" + (u.premiumRequests === 1 ? "" : "s"));
    return p.length ? p.join(" · ") : "sin datos de consumo (este CLI no los informa)";
  }
  function sum(runs) {
    var t = null; runs.forEach(function (r) { if (!r.usage) return; t = t || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }; ["input", "output", "cacheRead", "cacheWrite", "costUsd", "aiCredits", "premiumRequests"].forEach(function (k) { if (r.usage[k] !== undefined) t[k] = (t[k] || 0) + r.usage[k]; }); });
    if (t) ["premiumRequests", "aiCredits"].forEach(function (k) { if (t[k] !== undefined) t[k] = Math.round(t[k] * 100) / 100; });
    return t;
  }

  function start(o) {
    var t0 = Date.now(), stages = [], cur = null, steps = 0, last = "preparando…", ended = false, log = "", modal = null, status = null, runs = [];
    var host = null;
    var q = function (k) { return host.querySelector('[data-r="' + k + '"]'); };
    function mount(h) {
      host = h; h.hidden = false;
      h.innerHTML = '<div class="runstrip' + (ended ? (status === "done" ? " ok" : " er") : "") + '"><span class="runstrip-i">' + (ended ? (status === "done" ? "✓" : "!") : '<span class="spin"></span>') + '</span><div class="grow"><b data-r="t"></b><div class="small mut" data-r="s"></div></div><button class="btn" data-r="d">Ver detalle</button></div>';
      q("d").onclick = openModal; paint();
    }
    function stageOf(id) { return stages.filter(function (s) { return s.id === id; })[0]; }
    function title() { return cur ? (LABEL[cur.id] || cur.id) + " · " + cur.who : (o.title || "Trabajando"); }
    function paint() {
      if (host && host.isConnected) paintStrip();
      if (modal) modal.paint();
    }
    function paintStrip() {
      q("t").textContent = ended ? (status === "done" ? "Terminó" : "No se completó") + " · " + clock(Date.now() - t0) : title();
      q("s").textContent = ended ? summary() : "último paso: " + last + " · " + clock(Date.now() - t0) + (o.plain ? "" : " · " + steps + " pasos");
    }
    function summary() { if (o.plain) return "Registro completo en «Ver detalle»"; var t = sum(runs.length ? runs : stages.map(function (s) { return { usage: s.usage }; })); return stages.length + " etapa(s) · " + usageText(t); }
    var tick = setInterval(function () { if (ended) return clearInterval(tick); paint(); }, 1000);

    function openModal() {
      if (modal) return;
      var prev = document.activeElement, back = document.createElement("div"); back.className = "modal-back";
      back.innerHTML = '<div class="modal runmodal" role="dialog" aria-modal="true" aria-labelledby="rmt"><div class="modal-h"><span class="modal-i" aria-hidden="true"><span class="spin"></span></span><h2 id="rmt">' + esc(o.title || "Trabajando") + '</h2></div>' +
        '<div class="modal-b"><div class="small mut" data-m="s"></div><ol class="runstages" data-m="p"></ol><div class="small mut" style="margin:10px 0 4px">Registro en vivo</div><pre class="log runlog" data-m="l" tabindex="0"></pre></div>' +
        '<div class="modal-f"><button class="btn" data-m="copy">Copiar registro</button><button class="btn p" data-m="x">Segundo plano</button></div></div>';
      document.body.appendChild(back);
      var m = function (k) { return back.querySelector('[data-m="' + k + '"]'); };
      function close() { document.removeEventListener("keydown", key, true); back.remove(); modal = null; if (prev && prev.focus) prev.focus(); }
      function key(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }
      document.addEventListener("keydown", key, true);
      m("x").onclick = close;
      m("copy").onclick = function () { try { navigator.clipboard.writeText(log).then(function () { m("copy").textContent = "Copiado ✓"; setTimeout(function () { m("copy").textContent = "Copiar registro"; }, 1500); }); } catch (e) { /* sin portapapeles */ } };
      modal = {
        paint: function () {
          var modalEl = back.querySelector(".modal"); modalEl.classList.toggle("ok", ended && status === "done"); modalEl.classList.toggle("er", ended && status !== "done");
          back.querySelector(".modal-i").innerHTML = ended ? (status === "done" ? "✓" : "!") : '<span class="spin"></span>';
          m("x").textContent = ended ? "Cerrar" : "Segundo plano";
          m("s").textContent = (ended ? (status === "done" ? "Terminó en " : "Se detuvo a los ") : "En marcha desde hace ") + clock(Date.now() - t0) + (o.plain ? "" : " · " + steps + " pasos de la IA") + (ended && !o.plain ? " · Total: " + usageText(sum(runs.length ? runs : stages.map(function (s) { return { usage: s.usage }; }))) : "");
          m("p").innerHTML = stages.map(function (s) {
            var on = !ended && cur === s;
            return '<li class="' + (on ? "on" : s.done ? "done" : "") + '"><b>' + esc(LABEL[s.id] || s.id) + "</b> <span class=\"mut\">" + esc(s.who) + "</span>" + (s.ms ? ' <span class="mut">· ' + clock(s.ms) + "</span>" : on ? ' <span class="mut">· en curso</span>' : "") + (s.done ? '<div class="small">' + esc(s.usage ? usageText(s.usage) : s.usageLine || usageText(null)) + "</div>" : "") + "</li>";
          }).join("");
          var pre = m("l"), stick = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 30; pre.textContent = log; if (stick) pre.scrollTop = pre.scrollHeight;
        },
      };
      modal.paint(); m("l").scrollTop = m("l").scrollHeight; m("x").focus();
    }
    mount(o.host);
    if (o.autoOpen !== false) openModal();

    function push(line) {
      line = String(line); log += line + "\n";
      var m;
      if (o.plain) { var tl = line.trim(); if (tl) last = tl.slice(0, 70); paint(); return; }
      if ((m = /^== (\w+): (.+)$/.exec(line))) {
        if (cur && !cur.done) { cur.done = true; cur.ms = Date.now() - cur.t; }
        cur = { id: m[1], who: m[2], t: Date.now(), done: false, usage: null, ms: 0 }; stages.push(cur); last = "arranca " + (LABEL[cur.id] || cur.id);
      } else if ((m = /^\s+ai: (.+)$/.exec(line)) && cur) { steps++; last = m[1].slice(0, 70); }
      else if (/^\s+uso: /.test(line) && cur) { cur.usageLine = line.replace(/^\s+uso: /, ""); }
      else if (/^validation found/.test(line)) last = "validando lo generado";
      paint();
    }
    function finish(st, result) {
      ended = true; status = st; clearInterval(tick);
      if (cur && !cur.done) { cur.done = true; cur.ms = Date.now() - cur.t; }
      runs = (result && result.runs) || [];
      // El consumo exacto de cada etapa llega en el resultado (en el mismo orden en que se ejecutaron).
      runs.forEach(function (r, i) { if (stages[i]) stages[i].usage = r.usage; });
      if (host.isConnected) mount(host); else paint();
    }
    return { push: push, finish: finish, open: openModal, attach: function (h) { if (h) mount(h); } };
  }
  window.ChipRun = { start: start, usageText: usageText };
})();
