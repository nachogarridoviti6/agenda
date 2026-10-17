import { expect, test, type Page } from "@playwright/test";

const dialog = (page: Page) => page.getByRole("dialog").last();

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector(".app");
});

test("festivos de Andalucía en un calendario propio", async ({ page }) => {
  await page.getByRole("button", { name: "Ajustes" }).click();
  await dialog(page).getByLabel("Comunidad autónoma").selectOption("AN");
  await dialog(page).getByRole("button", { name: "Añadir festivos" }).click();
  await expect(dialog(page)).toContainText(/Añadidos \d+ festivos/);
  await page.getByRole("button", { name: "Listo" }).click();
  await expect(page.locator(".cal-row", { hasText: "Festivos" })).toBeVisible();
  await page.keyboard.press("Control+f");
  await page.keyboard.type("dia de andalucia");
  await expect(page.locator(".search-hit", { hasText: "Día de Andalucía" }).first()).toBeVisible();
});

test("horario del cuatrimestre crea las clases semanales", async ({ page }) => {
  await page.getByRole("button", { name: "Añadir", exact: true }).click();
  await page.getByRole("button", { name: "Horario del cuatrimestre…" }).click();
  await dialog(page).getByLabel("Asignatura 1", { exact: true }).fill("Termodinámica");
  for (const d of ["L", "M", "X", "J", "V"]) await dialog(page).getByRole("button", { name: `${d} asignatura 1`, exact: true }).click();
  await dialog(page).getByLabel("Aula asignatura 1", { exact: true }).fill("A-12");
  await dialog(page).getByRole("button", { name: "Crear 1 asignatura" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("3");
  const n = await page.locator(".mitem", { hasText: "Termodinámica" }).count();
  expect(n).toBeGreaterThan(5);
});
