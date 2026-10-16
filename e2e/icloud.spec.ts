import { expect, test, type Page } from "@playwright/test";

const dialog = (page: Page) => page.getByRole("dialog").last();

test("conectar iCloud (simulado), enlazar calendarios y sincronizar", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector(".app");

  await page.getByRole("button", { name: "Ajustes" }).click();
  await dialog(page).getByLabel("Apple ID").fill("nacho@icloud.com");

  // Contraseña normal del Apple ID → error claro
  await dialog(page).getByLabel("Contraseña específica para apps").fill("MiContraseña2026!");
  await dialog(page).getByRole("button", { name: "Conectar con iCloud" }).click();
  await expect(dialog(page)).toContainText("contraseña específica para apps");

  // Contraseña específica → conecta; "Trabajo" se enlaza solo porque se llama igual
  await dialog(page).getByLabel("Contraseña específica para apps").fill("abcd-efgh-ijkl-mnop");
  await dialog(page).getByRole("button", { name: "Conectar con iCloud" }).click();
  await expect(dialog(page)).toContainText("nacho@icloud.com");
  await expect(dialog(page).getByLabel("Sincronizar Trabajo con")).toHaveValue("cal-trabajo");
  await expect(dialog(page).getByLabel("Sincronizar Casa con")).toHaveValue("");

  // Enlazar "Casa" creando un calendario nuevo → baja el evento del iPhone
  await dialog(page).getByLabel("Sincronizar Casa con").selectOption("new");
  await expect(page.locator(".cal-row", { hasText: "Casa" })).toBeVisible();
  await expect(page.locator(".cal-row", { hasText: "Casa" }).locator(".cloud-badge")).toBeVisible();

  // Subir "Uni" a iCloud
  await dialog(page).locator(".f-row", { hasText: "Uni" }).getByRole("button", { name: "Crear en iCloud" }).click();
  await expect(page.locator(".cal-row", { hasText: "Uni" }).locator(".cloud-badge")).toBeVisible();
  await expect(dialog(page).getByLabel("Sincronizar Uni con")).toHaveValue("cal-uni");
  await page.getByRole("button", { name: "Listo" }).click();

  await page.keyboard.press("3");
  await expect(page.locator(".mitem", { hasText: "Dentista (desde el iPhone)" }).first()).toBeVisible();
  await expect(page.locator(".sync-status")).toContainText("iCloud ·");

  // Desconectar deja los eventos
  await page.getByRole("button", { name: "Ajustes" }).click();
  await dialog(page).getByRole("button", { name: "Desconectar iCloud" }).click();
  await expect(dialog(page).getByRole("button", { name: "Conectar con iCloud" })).toBeVisible();
  await page.getByRole("button", { name: "Listo" }).click();
  await expect(page.locator(".mitem", { hasText: "Dentista (desde el iPhone)" }).first()).toBeVisible();
  await expect(page.locator(".sync-status")).toHaveCount(0);
});
