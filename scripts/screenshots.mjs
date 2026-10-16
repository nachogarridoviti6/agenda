// Capturas de la interfaz en modo navegador con datos de ejemplo.
// Uso: npm run dev (en otra terminal) y luego: node scripts/screenshots.mjs [carpeta]
import { chromium } from "@playwright/test";

const out = process.argv[2] ?? "screenshots";
const base = process.env.URL ?? "http://localhost:1420";
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });

async function shot(name, { path = "/?demo", scheme = "light", width = 1280, height = 800, tz = "Europe/Madrid", act } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, timezoneId: tz, locale: "es-ES", deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error(`[${name}] pageerror:`, e.message));
  page.on("console", (m) => m.type() === "error" && console.error(`[${name}] console:`, m.text()));
  await page.goto(base + path);
  await page.waitForSelector(".app, .widget-root", { timeout: 10000 });
  if (act) await act(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${name}.png` });
  await ctx.close();
}

await shot("semana-claro");
await shot("semana-oscuro", { scheme: "dark" });
await shot("semana-otra-zona-horaria", { tz: "America/New_York" });
await shot("mes-claro", { act: (p) => p.keyboard.press("3") });
await shot("mes-oscuro", { scheme: "dark", act: (p) => p.keyboard.press("3") });
await shot("editor-evento", { act: (p) => p.locator(".ev", { hasText: "Grabación villa" }).first().click() });
await shot("nuevo-evento-oscuro", { scheme: "dark", act: (p) => p.keyboard.press("n") });
await shot("editor-tarea", { act: (p) => p.locator(".task-row", { hasText: "Entrega práctica" }).click() });
await shot("ventana-pequena", { width: 860, height: 600 });
await browser.close();
