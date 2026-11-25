import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { test } from "node:test";
import { chromium } from "playwright";
import { makeRepo } from "./demoRepo.js";
import { startUi } from "./server.js";

test("local app: compare from the UI, see the report list, open the update tab", { timeout: 300000 }, async () => {
  process.env.CHIPCHOP_HOME = makeRepo() + "-home";
  const dir = makeRepo();
  const ui = await startUi(dir);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.goto(ui.url);
    await page.getByRole("heading", { name: "Preparar la app" }).waitFor();
    assert.ok((await page.locator("#app").textContent())?.length);
    await page.getByText("Comprobando").waitFor({ state: "detached", timeout: 30000 });
    if (process.env.CHIPCHOP_SHOTS) await page.screenshot({ path: `${process.env.CHIPCHOP_SHOTS}/proyecto.png` });

    await page.getByRole("button", { name: "Comparar", exact: true }).first().click();
    await page.locator("#base").selectOption("develop");
    await page.locator("#head").selectOption("restyle");
    await page.locator("#cmp").click();
    await page.locator(".chip").first().waitFor({ timeout: 240000 });
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
