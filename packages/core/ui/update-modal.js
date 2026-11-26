// Ventana de progreso de la actualización (la usan la interfaz del proyecto y la pantalla de Inicio de la app de escritorio).
// ChipUpdate.run(start) → start(push) hace el trabajo y devuelve una promesa; push(línea) la va contando.
// Reconoce: «descargando», «progreso: N%», «permisos: …», «permisos-ok», «instalando: …», «descargada…/reiniciando».
(function () {
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function tidy(m) {
    m = String(m || "").replace(/^Error invoking remote method '[^']+': (Error: )?/, "").replace(/^error:\s*/i, "");
    if (/another job is still running|otra tarea/i.test(m)) return "Ya hay otra tarea en marcha (captura, comparación, IA o actualización). Espera a que termine y reinténtalo.";
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(m)) return "No hay conexión con GitHub. Comprueba tu red o el proxy y reinténtalo.";
    return m || "No se ha podido instalar la nueva versión. La que tenías sigue funcionando.";
  }

  function run(start) {
    return new Promise(function (resolve) {
      var prev = document.activeElement, back = document.createElement("div");
      back.className = "modal-back";
      back.innerHTML = '<div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="umt"><div class="modal-h"><span class="modal-i" aria-hidden="true"><span class="spin"></span></span><h2 id="umt">Actualizando chip-chop</h2></div>' +
        '<div class="modal-b"><div class="prog" role="status" aria-live="polite" style="margin-top:0"><div class="prog-head"><b data-r="t">Preparando…</b><span class="mut small" data-r="s">0 s</span></div><div class="bar ind" data-r="b"><i data-r="i"></i></div><ol class="phases" data-r="p"></ol><div class="small mut" data-r="h"></div><details><summary>Ver detalles</summary><pre class="log" data-r="l"></pre></details></div><div class="modal-d" data-r="e" hidden></div></div>' +
        '<div class="modal-f" data-r="f"></div></div>';
      document.body.appendChild(back);
      var q = function (k) { return back.querySelector('[data-r="' + k + '"]'); };
      var phases = [["dl", "Descargar"], ["ins", "Instalar"], ["rs", "Reiniciar"]], cur = "dl", pct = null, log = "", lastErr = "", ended = false, t0 = Date.now();
      var timer = setInterval(function () { q("s").textContent = Math.round((Date.now() - t0) / 1000) + " s"; }, 500);
      function paint(title, hint) {
        q("t").textContent = title; q("h").textContent = hint || "";
        var idx = phases.findIndex(function (p) { return p[0] === cur; });
        q("p").innerHTML = phases.map(function (p, i) { return '<li class="' + (i < idx ? "done" : i === idx ? "on" : "") + '">' + esc(p[1]) + "</li>"; }).join("");
        q("b").className = "bar" + (pct == null ? " ind" : ""); q("i").style.width = pct == null ? "" : pct + "%";
      }
      function addPerm() { if (!phases.some(function (p) { return p[0] === "perm"; })) phases.splice(1, 0, ["perm", "Permisos de administrador"]); }
      function push(line) {
        if (ended) return;
        line = String(line); log += line + "\n"; q("l").textContent = log; q("l").scrollTop = q("l").scrollHeight;
        var m;
        if (/^error:/i.test(line)) lastErr = line.replace(/^error:\s*/i, "");
        else if ((m = /^progreso:\s*(\d+)%/.exec(line))) { cur = "dl"; pct = +m[1]; paint("Descargando… " + pct + "%"); }
        else if (/^(downloading|descargando)/i.test(line)) { cur = "dl"; pct = null; paint("Descargando la nueva versión…"); }
        else if (/^permisos:/i.test(line)) { addPerm(); cur = "perm"; pct = null; paint("Esperando tu contraseña de administrador…", line.replace(/^permisos:\s*/i, "") + " Si no la ves, mira detrás de esta ventana."); }
        else if (/^permisos-ok/i.test(line)) { addPerm(); cur = "ins"; pct = null; paint("Instalando…", "Permisos concedidos."); }
        else if (/^instalando:/i.test(line)) { cur = "ins"; pct = null; paint("Instalando…", line.replace(/^instalando:\s*/i, "").slice(0, 90)); }
        else if (/^installing/i.test(line)) { cur = "ins"; pct = null; paint("Instalando sobre la versión actual…"); }
        else if (/descargada|reiniciando|restart/i.test(line)) { cur = "rs"; pct = null; paint("Reiniciando chip-chop…", "La app se cerrará y se abrirá sola en unos segundos."); }
      }
      function close(v) { clearInterval(timer); back.remove(); if (prev && prev.focus) prev.focus(); resolve(v); }
      function buttons(list) {
        var f = q("f"); f.innerHTML = list.map(function (b, i) { return '<button class="btn' + (b.primary ? " p" : "") + '" data-i="' + i + '">' + esc(b.label) + "</button>"; }).join("");
        f.querySelectorAll("button").forEach(function (el) { el.onclick = function () { list[+el.dataset.i].go(); }; });
        var first = f.querySelector(".p") || f.querySelector("button"); if (first) first.focus();
      }
      function finish(ok, title, msg) {
        ended = true; clearInterval(timer);
        back.querySelector(".modal").classList.add(ok ? "ok" : "er");
        back.querySelector(".modal-i").innerHTML = ok ? "✓" : "!";
        q("t").textContent = title; q("b").className = "bar"; q("i").style.width = (ok ? 100 : 0) + "%"; q("h").textContent = "";
        q("s").textContent = Math.round((Date.now() - t0) / 1000) + " s";
        back.querySelector(".prog").classList.toggle("er", !ok);
        if (msg) { q("e").hidden = false; q("e").textContent = msg; }
      }
      function attempt() {
        log = ""; lastErr = ""; ended = false; cur = "dl"; pct = null; t0 = Date.now(); phases = [["dl", "Descargar"], ["ins", "Instalar"], ["rs", "Reiniciar"]];
        q("e").hidden = true; q("l").textContent = ""; back.querySelector(".modal").classList.remove("er", "ok"); back.querySelector(".modal-i").innerHTML = '<span class="spin"></span>';
        back.querySelector(".prog").classList.remove("er");
        timer = setInterval(function () { q("s").textContent = Math.round((Date.now() - t0) / 1000) + " s"; }, 500);
        buttons([]); paint("Buscando la versión…");
        Promise.resolve().then(function () { return start(push); }).then(function (r) {
          if (r && r.restart) {
            cur = "rs"; pct = 100; paint("Reiniciando chip-chop…", "La app se cerrará y se abrirá sola en unos segundos.");
            ended = true; clearInterval(timer); q("b").className = "bar"; q("i").style.width = "100%";
            // Si por algún motivo la app no se reinicia sola, no dejamos al usuario atrapado.
            setTimeout(function () { finish(true, "Actualización instalada", "Si chip-chop no se ha vuelto a abrir sola, ciérrala y ábrela de nuevo."); buttons([{ label: "Cerrar", primary: true, go: function () { close({ ok: true, restart: true }); } }]); }, 20000);
          } else if (r && r.manual) {
            finish(true, "Se ha abierto la página de descargas", "Descarga e instala la nueva versión desde allí.");
            buttons([{ label: "Entendido", primary: true, go: function () { close({ ok: true }); } }]);
          } else {
            finish(true, "Actualización instalada", "Cierra chip-chop y ábrelo de nuevo para usar la nueva versión.");
            buttons([{ label: "Entendido", primary: true, go: function () { close({ ok: true }); } }]);
          }
        }, function (e) {
          finish(false, "La actualización no se ha completado", tidy(lastErr || (e && e.message)));
          buttons([{ label: "Cerrar", go: function () { close({ ok: false }); } }, { label: "Reintentar", primary: true, go: attempt }]);
        });
      }
      attempt();
    });
  }
  window.ChipUpdate = { run: run };
})();
