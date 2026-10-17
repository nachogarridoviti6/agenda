import { expect, test, type Page } from "@playwright/test";

const dialog = (page: Page) => page.getByRole("dialog").last();

test("plantilla de grabación y duplicar", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector(".app");

  // Crear un evento y guardarlo como plantilla
  await page.keyboard.press("n");
  await page.getByPlaceholder("Título").fill("Grabación");
  await page.getByLabel("Hora").first().fill("10:00");
  await page.getByLabel("Hora").first().press("Tab");
  await page.getByLabel("Hora").nth(1).fill("13:00");
  await page.getByLabel("Hora").nth(1).press("Tab");
  await page.getByLabel("Calendario", { exact: true }).selectOption({ label: "Trabajo" });
  await page.getByPlaceholder("Ubicación").fill("Por confirmar");
  await page.getByPlaceholder("Notas").fill("- Dron\n- Gimbal");
  await dialog(page).getByRole("button", { name: "Guardar como plantilla" }).click();
  await expect(dialog(page).getByRole("button", { name: "Plantilla guardada ✓" })).toBeVisible();
  await dialog(page).getByRole("button", { name: "Cancelar" }).click();

  // Usarla desde el menú +
  await page.getByRole("button", { name: "Añadir", exact: true }).click();
  await page.locator(".menu").getByRole("button", { name: "Grabación" }).click();
  await expect(page.getByPlaceholder("Título")).toHaveValue("Grabación");
  await expect(page.getByPlaceholder("Ubicación")).toHaveValue("Por confirmar");
  await expect(page.getByPlaceholder("Notas")).toHaveValue("- Dron\n- Gimbal");
  await dialog(page).getByRole("button", { name: "Añadir" }).click();
  const ev = page.locator(".ev", { hasText: "Grabación" });
  await expect(ev).toHaveCount(1);

  // Duplicar con Ctrl+D: abre un evento nuevo igual, sin guardar hasta pulsar Añadir
  await ev.click();
  await page.getByPlaceholder("Título").press("Control+d");
  await expect(dialog(page)).toContainText("Nuevo evento");
  await dialog(page).getByRole("button", { name: "Añadir" }).click();
  await expect(page.locator(".ev", { hasText: "Grabación" })).toHaveCount(2);

  // La plantilla aparece en Ajustes y se puede borrar
  await page.getByRole("button", { name: "Ajustes" }).click();
  await dialog(page).locator(".f-row", { hasText: "Grabación" }).getByRole("button", { name: "Eliminar" }).click();
  await expect(dialog(page)).toContainText("Aún no hay plantillas");
});
