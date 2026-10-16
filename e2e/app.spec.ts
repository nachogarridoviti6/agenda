import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector(".app");
});

test("crear un evento arrastrando, editarlo y borrarlo", async ({ page }) => {
  const col = page.locator(".tg-col").nth(2);
  const box = (await col.boundingBox())!;
  await page.locator(".tg-scroll").evaluate((el) => (el.scrollTop = 9 * 48));
  const top = (await page.locator(".tg-cols").boundingBox())!.y;
  // de 10:00 a 11:30
  await page.mouse.move(box.x + 20, top + 10 * 48 + 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, top + 11.5 * 48, { steps: 5 });
  await page.mouse.up();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Hora").first()).toHaveValue("10:00");
  await expect(page.getByLabel("Hora").nth(1)).toHaveValue("11:30");
  await page.getByPlaceholder("Título").fill("Examen Termodinámica");
  await page.getByPlaceholder("Ubicación").fill("Aula Magna");
  await page.getByRole("dialog").getByRole("button", { name: "Añadir" }).click();

  const ev = page.locator(".ev", { hasText: "Examen Termodinámica" });
  await expect(ev).toBeVisible();
  await expect(ev).toContainText("10:00 – 11:30");

  // Persistencia: sobrevive a recargar
  await page.reload();
  await expect(page.locator(".ev", { hasText: "Examen Termodinámica" })).toBeVisible();

  // Editar: cambiar hora de inicio mantiene la duración
  await page.locator(".ev", { hasText: "Examen Termodinámica" }).click();
  const start = page.getByLabel("Hora").first();
  await start.fill("12");
  await start.press("Tab");
  await expect(page.getByLabel("Hora").nth(1)).toHaveValue("13:30");
  await page.getByRole("dialog").getByRole("button", { name: "Guardar" }).click();
  await expect(page.locator(".ev", { hasText: "Examen Termodinámica" })).toContainText("12:00 – 13:30");

  // Borrar (pide confirmación)
  await page.locator(".ev", { hasText: "Examen Termodinámica" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Eliminar evento" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Seguro/ }).click();
  await expect(page.locator(".ev", { hasText: "Examen Termodinámica" })).toHaveCount(0);
});

test("mover un evento arrastrándolo a otro día y hora", async ({ page }) => {
  await page.keyboard.press("n");
  await page.getByPlaceholder("Título").fill("Mover");
  await page.getByLabel("Hora").first().fill("9:00");
  await page.getByLabel("Hora").first().press("Tab");
  await page.getByRole("dialog").getByRole("button", { name: "Añadir" }).click();
  const ev = page.locator(".ev", { hasText: "Mover" });
  await page.locator(".tg-scroll").evaluate((el) => (el.scrollTop = 8 * 48));
  const b = (await ev.boundingBox())!;
  const colW = (await page.locator(".tg-col").first().boundingBox())!.width;
  const dir = (await page.locator(".tg-col").nth(6).boundingBox())!.x > b.x + colW ? 1 : -1;
  await page.mouse.move(b.x + 10, b.y + 10);
  await page.mouse.down();
  await page.mouse.move(b.x + 10 + dir * colW, b.y + 10 + 96, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".ev", { hasText: "Mover" })).toContainText("11:00 – 12:00");
});

test("tareas: crear, completar desde la lista y verla en su día", async ({ page }) => {
  await page.getByRole("button", { name: "Nueva tarea" }).click();
  await page.getByPlaceholder("¿Qué hay que hacer?").fill("Entrega memoria");
  await page.getByRole("switch", { name: "Fecha límite" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Alta" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Añadir" }).click();

  await expect(page.locator(".task-row", { hasText: "Entrega memoria" })).toBeVisible();
  await expect(page.locator(".taskchip", { hasText: "Entrega memoria" })).toBeVisible();

  await page.locator(".task-row", { hasText: "Entrega memoria" }).getByRole("checkbox").click();
  await expect(page.locator(".task-row", { hasText: "Entrega memoria" })).toHaveCount(0);
  await expect(page.locator(".taskchip", { hasText: "Entrega memoria" }).locator(".done")).toBeVisible();
});

test("calendarios: crear, ocultar y borrar", async ({ page }) => {
  await page.getByRole("button", { name: "Nuevo calendario" }).click();
  await page.getByPlaceholder("Nombre").fill("Gimnasio");
  await page.getByRole("dialog").getByRole("button", { name: "Morado" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Crear" }).click();
  await expect(page.locator(".cal-row", { hasText: "Gimnasio" })).toBeVisible();

  await page.keyboard.press("n");
  await page.getByPlaceholder("Título").fill("Pierna");
  await page.getByLabel("Calendario", { exact: true }).selectOption({ label: "Gimnasio" });
  await page.getByRole("dialog").getByRole("button", { name: "Añadir" }).click();
  await expect(page.locator(".ev", { hasText: "Pierna" })).toBeVisible();

  await page.locator(".cal-row", { hasText: "Gimnasio" }).getByRole("checkbox").uncheck();
  await expect(page.locator(".ev", { hasText: "Pierna" })).toHaveCount(0);

  await page.getByRole("button", { name: "Editar Gimnasio" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Eliminar calendario" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Seguro/ }).click();
  await expect(page.locator(".cal-row", { hasText: "Gimnasio" })).toHaveCount(0);
});

test("atajos de teclado y vista mes", async ({ page }) => {
  await page.keyboard.press("3");
  await expect(page.locator(".month")).toBeVisible();
  const title = await page.locator(".tb-title").textContent();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".tb-title")).not.toHaveText(title!);
  await page.keyboard.press("t");
  await expect(page.locator(".tb-title")).toHaveText(title!);
  await expect(page.locator(".month-daynum.is-today")).toHaveCount(1);
  await page.keyboard.press("2");
  await expect(page.locator(".tg-dayhead.is-today")).toHaveCount(1);
});
