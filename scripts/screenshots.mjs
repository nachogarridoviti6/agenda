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
await shot("dia", { act: (p) => p.keyboard.press("1") });
await shot("anio", { act: (p) => p.keyboard.press("4") });
await shot("anadir-rapido", { act: async (p) => { await p.keyboard.press("Control+k"); await p.keyboard.type("Grabación villa martes 10-13 #trabajo @Marbella"); } });
await shot("anadir-rapido-tarea-oscuro", { scheme: "dark", act: async (p) => { await p.keyboard.press("Control+k"); await p.keyboard.type("Entrega práctica fabricación viernes 23:59 #uni"); } });
await shot("busqueda", { act: async (p) => { await p.keyboard.press("Control+f"); await p.keyboard.type("calculo"); } });
await shot("repeticion", { act: async (p) => { await p.locator(".ev", { hasText: "Cálculo II" }).first().click(); } });
await shot("solo-este-o-futuros", { act: async (p) => { await p.locator(".ev", { hasText: "Cálculo II" }).first().click(); await p.getByPlaceholder("Título").fill("Cálculo II (examen)"); await p.getByRole("dialog").getByRole("button", { name: "Guardar", exact: true }).click(); } });
await shot("exportar", { act: async (p) => { await p.getByRole("button", { name: "Ajustes" }).click(); await p.getByRole("button", { name: "Exportar .ics…" }).click(); } });
await shot("icloud", {
  path: "/",
  act: async (p) => {
    await p.evaluate(() => localStorage.clear());
    await p.reload();
    await p.waitForSelector(".app");
    await p.getByRole("button", { name: "Ajustes" }).click();
    await p.getByLabel("Apple ID").fill("nacho@icloud.com");
    await p.getByLabel("Contraseña específica para apps").fill("abcd-efgh-ijkl-mnop");
    await p.getByRole("button", { name: "Conectar con iCloud" }).click();
    await p.getByLabel("Sincronizar Casa con").selectOption("new");
    await p.waitForTimeout(500);
    await p.locator(".f-section", { hasText: "Calendarios de iCloud" }).scrollIntoViewIfNeeded();
  },
});
await shot("icloud-asistente", {
  path: "/",
  act: async (p) => {
    await p.evaluate(() => localStorage.clear());
    await p.reload();
    await p.waitForSelector(".app");
    await p.getByRole("button", { name: "Ajustes" }).click();
    await p.getByLabel("Apple ID").fill("nacho@icloud.com");
    await p.getByLabel("Contraseña específica para apps").fill("abcd-efgh-ijkl-mnop");
    await p.locator(".wizard").scrollIntoViewIfNeeded();
  },
});
await shot("tarea-repetida", { act: async (p) => { await p.locator(".task-row", { hasText: "Pagar alquiler" }).click(); await p.getByLabel("Repetir").selectOption("monthly"); } });
await shot("horario-cuatrimestre", {
  act: async (p) => {
    await p.getByRole("button", { name: "Añadir", exact: true }).click();
    await p.getByRole("button", { name: "Horario del cuatrimestre…" }).click();
    const d = p.getByRole("dialog");
    await d.getByLabel("Asignatura 1", { exact: true }).fill("Cálculo II");
    await d.getByRole("button", { name: "L asignatura 1", exact: true }).click();
    await d.getByRole("button", { name: "X asignatura 1", exact: true }).click();
    await d.getByLabel("Aula asignatura 1", { exact: true }).fill("Aula 1.2");
    await d.getByLabel("Asignatura 2", { exact: true }).fill("Sistemas de fabricación");
    await d.getByRole("button", { name: "M asignatura 2", exact: true }).click();
    await d.getByRole("button", { name: "J asignatura 2", exact: true }).click();
  },
});
await shot("editor-con-plantilla", { act: (p) => p.locator(".ev", { hasText: "Grabación villa" }).first().click() });
await shot("bienvenida", { path: "/?demo&welcome" });
await shot("acerca-de", { act: async (p) => { await p.getByRole("button", { name: "Ajustes" }).click(); await p.locator(".f-section", { hasText: "Acerca de" }).scrollIntoViewIfNeeded(); } });
await shot("ajustes", { act: (p) => p.getByRole("button", { name: "Ajustes" }).click() });

// Widget sobre un "fondo de escritorio" simulado para ver la transparencia.
const wallpaper = (p) =>
  p.addStyleTag({ content: "html.widget{background:linear-gradient(135deg,#3a6186,#89253e) !important} html.widget body{padding:20px}" });
const wallpaperLight = (p) =>
  p.addStyleTag({ content: "html.widget{background:linear-gradient(135deg,#a8c0ff,#fbc2eb) !important} html.widget body{padding:20px}" });
await shot("widget-claro", { path: "/widget.html?demo", width: 800, height: 420, act: wallpaperLight });
await shot("widget-oscuro", { path: "/widget.html?demo", scheme: "dark", width: 800, height: 420, act: wallpaper });
await shot("widget-hoy", { path: "/widget.html?demo&layout=today", width: 800, height: 420, act: wallpaperLight });
await shot("widget-hoy-oscuro", { path: "/widget.html?demo&layout=today", scheme: "dark", width: 800, height: 420, act: wallpaper });
await shot("widget-estrecho", { path: "/widget.html?demo", width: 520, height: 520, act: wallpaperLight });
await browser.close();
