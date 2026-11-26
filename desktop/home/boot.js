// Pantalla de arranque: el logo animado y un mensaje de qué se está haciendo. __boot(msg) cambia el mensaje, __bootDone() la quita.
(function () {
  var el = document.getElementById("boot"); if (!el) return;
  var msg = el.querySelector(".boot-msg"), sub = el.querySelector(".boot-sub"), t0 = Date.now();
  window.__boot = function (m) { if (msg) msg.textContent = m; };
  window.__bootDone = function () { clearInterval(tick); el.remove(); };
  var tick = setInterval(function () {
    var s = (Date.now() - t0) / 1000;
    if (s > 4 && sub && !sub.textContent) sub.textContent = "Sigue en marcha: se están comprobando git, el navegador de capturas y tus herramientas de IA.";
    if (s > 12 && sub) sub.textContent = "Está tardando más de lo normal; la primera vez en un equipo puede tardar un poco más. No se ha colgado.";
  }, 500);
})();
