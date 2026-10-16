import { expect, test, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dialog = (page: Page) => page.getByRole("dialog").last();

async function quickAdd(page: Page, text: string) {
  await page.keyboard.press("Control+k");
  await page.getByLabel("Añadir rápido").fill(text);
  await page.getByLabel("Añadir rápido").press("Enter");
}

test("exportar a .ics, borrar todo e importar lo restaura (con sus calendarios)", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector(".app");

  // Un calendario propio + evento repetido + tarea
  await page.getByRole("button", { name: "Nuevo calendario" }).click();
  await page.getByPlaceholder("Nombre").fill("Gimnasio");
  await dialog(page).getByRole("button", { name: "Crear" }).click();
  await quickAdd(page, "Pierna cada lunes y jueves 19-20 #gim");
  await quickAdd(page, "Entrega memoria mañana 23:59 #uni !!!");
  const countPierna = async () => {
    await page.keyboard.press("t");
    await page.keyboard.press("3");
    return page.locator(".mitem", { hasText: "Pierna" }).count();
  };
  const before = await countPierna();
  expect(before).toBeGreaterThan(3);

  // Exportar
  await page.getByRole("button", { name: "Ajustes" }).click();
  await dialog(page).getByRole("button", { name: "Exportar .ics…" }).click();
  const downloadP = page.waitForEvent("download");
  await dialog(page).getByRole("button", { name: "Exportar", exact: true }).click();
  const download = await downloadP;
  const file = join(tmpdir(), `agenda-test-${Date.now()}.ics`);
  await download.saveAs(file);
  const ics = readFileSync(file, "utf8");
  expect(ics).toContain("SUMMARY:Pierna");
  expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO,TH");
  expect(ics).toContain("X-AGENDA-CALENDAR:Gimnasio");
  expect(ics).toContain("BEGIN:VTODO");
  await expect(page.locator(".f-help", { hasText: "Exportados" })).toBeVisible();

  // Borrar todo
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector(".app");
  expect(await countPierna()).toBe(0);
  await expect(page.locator(".cal-row", { hasText: "Gimnasio" })).toHaveCount(0);

  // Importar
  await page.getByRole("button", { name: "Ajustes" }).click();
  const chooserP = page.waitForEvent("filechooser");
  await dialog(page).getByRole("button", { name: "Importar .ics…" }).click();
  await (await chooserP).setFiles(file);
  await expect(dialog(page)).toContainText("1 repetidos");
  await expect(dialog(page).getByLabel("Calendario de destino")).toHaveValue("source");
  await dialog(page).getByRole("button", { name: "Importar", exact: true }).click();
  await expect(page.locator(".f-help", { hasText: "Importados" })).toBeVisible();
  await page.getByRole("button", { name: "Listo" }).click();

  await expect(page.locator(".cal-row", { hasText: "Gimnasio" })).toBeVisible();
  expect(await countPierna()).toBe(before);
  await expect(page.locator(".task-row", { hasText: "Entrega memoria" })).toContainText("!!!");

  // Reimportar no duplica
  await page.getByRole("button", { name: "Ajustes" }).click();
  const chooser2 = page.waitForEvent("filechooser");
  await dialog(page).getByRole("button", { name: "Importar .ics…" }).click();
  await (await chooser2).setFiles(file);
  await dialog(page).getByRole("button", { name: "Importar", exact: true }).click();
  await page.getByRole("button", { name: "Listo" }).click();
  expect(await countPierna()).toBe(before);
  await expect(page.locator(".task-row", { hasText: "Entrega memoria" })).toHaveCount(1);
});

test("importar un .ics de Google a un calendario nuevo", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector(".app");
  const file = join(tmpdir(), `google-${Date.now()}.ics`);
  const day = await page.evaluate(() => {
    const d = new Date(Date.now() + 86_400_000);
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  });
  writeFileSync(file, ["BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-CALNAME:Festivos Málaga",
    "BEGIN:VEVENT", "UID:fest1@google.com", `DTSTART;VALUE=DATE:${day}`, "SUMMARY:Feria de Málaga", "END:VEVENT", "END:VCALENDAR"].join("\r\n"));
  await page.getByRole("button", { name: "Ajustes" }).click();
  const chooserP = page.waitForEvent("filechooser");
  await dialog(page).getByRole("button", { name: "Importar .ics…" }).click();
  await (await chooserP).setFiles(file);
  await expect(dialog(page).getByLabel("Calendario de destino")).toHaveValue("new");
  await expect(dialog(page).getByLabel("Nombre del calendario nuevo")).toHaveValue("Festivos Málaga");
  await dialog(page).getByRole("button", { name: "Importar", exact: true }).click();
  await page.getByRole("button", { name: "Listo" }).click();
  await expect(page.locator(".cal-row", { hasText: "Festivos Málaga" })).toBeVisible();
  await page.keyboard.press("3");
  await expect(page.locator(".mitem", { hasText: "Feria de Málaga" })).toBeVisible();
});
