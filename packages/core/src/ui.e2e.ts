import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";
import { stringify } from "yaml";
import { makeRepo } from "./demoRepo.js";
import { startUi } from "./server.js";

test("local app: generation validates both selected branches before comparison", { timeout: 300000 }, async () => {
  process.env.CHIPCHOP_HOME = makeRepo() + "-home";
  const dir = makeRepo();
  const fakeAi = join(dir, "fake-ai.mjs");
  writeFileSync(fakeAi, `import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
assert.ok(readFileSync(0, "utf8").includes('{"base":"develop","head":"restyle"}'));
`);
  writeFileSync(join(dir, ".chipchop", "ai.yaml"), stringify({
    providers: { test: { type: "custom", command: process.execPath, args: [fakeAi], promptVia: "stdin" } },
    stages: Object.fromEntries(["discover", "flows", "mocks", "repair"].map((stage) => [stage, { provider: "test" }])),
  }));
  const ui = await startUi(dir);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.goto(ui.url);
    await page.getByRole("heading", { name: "Preparar la app" }).waitFor();
    assert.ok((await page.locator("#app").textContent())?.length);
    await page.getByText("Comprobando").waitFor({ state: "detached", timeout: 30000 });
    if (process.env.CHIPCHOP_SHOTS) await page.screenshot({ path: `${process.env.CHIPCHOP_SHOTS}/proyecto.png` });

    await page.locator("#project-base").fill("develop");
    await page.locator("#project-head").fill("restyle");
    await page.locator("#gen").click();
    await page.getByText("10 pares de capturas comparables").waitFor({ timeout: 120000 });
    await page.locator(".runmodal [data-m=x]").click();
    assert.equal(await page.locator("#validation-result img").count(), 2);
    assert.ok(await page.locator("#validation-result img").first().evaluate((img: HTMLImageElement) => img.decode().then(() => img.naturalWidth > 0)));

    await page.getByRole("button", { name: "Comparar", exact: true }).first().click();
    assert.equal(await page.locator("#base").inputValue(), "develop");
    assert.equal(await page.locator("#head").inputValue(), "restyle");
    assert.match(await page.locator("#compare-validation").innerText(), /Capturas verificadas/);
    for (const [id, ref] of [["base", "develop"], ["head", "restyle"]] as const) {
      await page.locator(`[data-for="${id}"] .md-trigger`).click();
      await page.locator(`[data-for="${id}"] .md-search`).fill(ref);
      await page.keyboard.press("Enter");
      assert.equal(await page.locator(`#${id}`).inputValue(), ref);
    }
    await page.locator("#cmp").click();
    await page.locator(".chip").first().waitFor({ timeout: 240000 });
    await page.locator(".runmodal [data-m=x]").click(); // el modal de progreso se abre solo al empezar
    const text = await page.locator("#result").innerText();
    assert.match(text, /Solo visual/);
    assert.match(text, /Pasa\./);
    if (process.env.CHIPCHOP_SHOTS) await page.screenshot({ path: `${process.env.CHIPCHOP_SHOTS}/comparar.png`, fullPage: true });

    await page.getByRole("button", { name: "Informes" }).click();
    await page.getByText("develop → restyle").waitFor();
    if (process.env.CHIPCHOP_SHOTS) await page.screenshot({ path: `${process.env.CHIPCHOP_SHOTS}/informes.png` });

    await page.getByRole("button", { name: "IA" }).click();
    await page.getByRole("heading", { name: "Modelos por etapa" }).waitFor();
    if (process.env.CHIPCHOP_SHOTS) await page.screenshot({ path: `${process.env.CHIPCHOP_SHOTS}/ia.png` });

    await page.locator("#ver").click();
    await page.getByRole("heading", { name: "Actualizaciones" }).waitFor();
    await page.locator("#chk").waitFor();
    if (process.env.CHIPCHOP_SHOTS) await page.screenshot({ path: `${process.env.CHIPCHOP_SHOTS}/actualizar.png` });

    // protected: no token, no data
    const r = await fetch(ui.url.split("?")[0] + "api/project");
    assert.equal(r.status, 401);
  } finally {
    await browser.close();
    await ui.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
