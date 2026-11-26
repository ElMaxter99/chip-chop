---
type: Added
---
**Generar con IA ya no es una caja negra:** al pulsar se abre una ventana con el progreso en vivo (qué etapa, qué lee y escribe la IA, tiempo) y una franja en la página con «Ver detalle»; se puede mandar a segundo plano. **Medición de consumo por etapa:** tras cada ejecución se muestra lo que informa tu herramienta (tokens y coste equivalente en Claude Code, AI credits y premium requests en Copilot, tokens en Codex) por etapa, la última ejecución y el acumulado, también en «Probar esta etapa». Se guarda en `.chipchop/ai-usage.jsonl` (ignorado por git). Nada se estima: si un CLI no informa algo, no se muestra. **Selector de modelo con buscador:** lista filtrable con teclado, cabecera «Cargando modelos…» mientras se leen y la opción de escribir el nombre exacto.
