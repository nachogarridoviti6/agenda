import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector(".app");
});

const dialog = (page: Page) => page.getByRole("dialog").last();

async function quickAdd(page: Page, text: string) {
  await page.keyboard.press("Control+k");
  await page.getByLabel("Añadir rápido").fill(text);
  await page.getByLabel("Añadir rápido").press("Enter");
}

test("evento semanal: crear, cambiar solo uno, cambiar los futuros y borrar", async ({ page }) => {
  await page.keyboard.press("n");
  await page.getByPlaceholder("Título").fill("Clase de inglés");
  await page.getByLabel("Repetir").selectOption("daily");
  await expect(dialog(page)).toContainText("Cada día");
  await page.getByLabel("Termina").selectOption("count");
  await page.getByLabel("Número de veces").fill("5");
  await expect(dialog(page)).toContainText("Cada día, 5 veces");
  await dialog(page).getByRole("button", { name: "Añadir" }).click();

  await page.keyboard.press("1"); // vista día
  await expect(page.locator(".ev", { hasText: "Clase de inglés" })).toHaveCount(1);
  await page.keyboard.press("2");
  const inWeek = await page.locator(".ev", { hasText: "Clase de inglés" }).count();
  expect(inWeek).toBeGreaterThan(0);

  // Solo este: renombrar la primera repetición
  await page.locator(".ev", { hasText: "Clase de inglés" }).first().click();
  await page.getByPlaceholder("Título").fill("Inglés (examen oral)");
  await dialog(page).getByRole("button", { name: "Guardar", exact: true }).click();
  await page.getByRole("button", { name: "Solo este evento" }).click();
  await expect(page.locator(".ev", { hasText: "Inglés (examen oral)" })).toHaveCount(1);
  await expect(page.locator(".ev", { hasText: "Clase de inglés" })).toHaveCount(inWeek - 1);

  // Borrar todos los futuros desde la segunda repetición (si está en esta semana)
  if (inWeek > 1) {
    await page.locator(".ev", { hasText: "Clase de inglés" }).first().click();
    await dialog(page).getByRole("button", { name: "Eliminar evento" }).click();
    await page.getByRole("button", { name: "Eliminar todos los futuros" }).click();
    await expect(page.locator(".ev", { hasText: "Clase de inglés" })).toHaveCount(0);
    await expect(page.locator(".ev", { hasText: "Inglés (examen oral)" })).toHaveCount(1);
  }
});

test("Esc en el diálogo de alcance solo cierra ese diálogo", async ({ page }) => {
  await quickAdd(page, "Meditar cada día 8:00");
  await page.locator(".ev", { hasText: "Meditar" }).first().click();
  await dialog(page).getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Solo este evento" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Solo este evento" })).toHaveCount(0);
  await expect(page.getByPlaceholder("Título")).toBeVisible();
});

test("añadir rápido crea eventos y tareas con vista previa", async ({ page }) => {
  await page.keyboard.press("Control+k");
  await page.getByLabel("Añadir rápido").fill("Grabación villa mañana 10-13 #trabajo @Marbella");
  const preview = page.locator(".quick-preview");
  await expect(preview).toContainText("Grabación villa");
  await expect(preview).toContainText("10:00 – 13:00");
  await expect(preview).toContainText("Marbella");
  await expect(preview).toContainText("Trabajo");
  await page.getByLabel("Añadir rápido").press("Enter");
  await expect(page.locator(".ev", { hasText: "Grabación villa" })).toContainText("10:00 – 13:00");

  await quickAdd(page, "Entrega memoria TFG mañana 23:59 #uni !!!");
  await expect(page.locator(".task-row", { hasText: "Entrega memoria TFG" })).toContainText("!!!");
  await expect(page.locator(".task-row", { hasText: "Entrega memoria TFG" })).toContainText("Mañana 23:59");
});

test("búsqueda sin acentos lleva al evento", async ({ page }) => {
  await quickAdd(page, "Examen Termodinámica 20/11 9:00 #uni");
  await page.keyboard.press("t");
  await page.keyboard.press("Control+f");
  await page.keyboard.type("termodinamica");
  await expect(page.locator(".search-hit")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.getByPlaceholder("Título")).toHaveValue("Examen Termodinámica");
  await page.keyboard.press("Escape");
  await expect(page.locator(".tb-title")).toContainText("Noviembre");
});

test("vistas día, semana, mes y año con 1-4", async ({ page }) => {
  await page.keyboard.press("1");
  await expect(page.locator(".tg-dayhead")).toHaveCount(1);
  await page.keyboard.press("2");
  await expect(page.locator(".tg-dayhead")).toHaveCount(7);
  await page.keyboard.press("3");
  await expect(page.locator(".month")).toBeVisible();
  await page.keyboard.press("4");
  await expect(page.locator(".year-month")).toHaveCount(12);
  await expect(page.locator(".year-day.is-today")).toHaveCount(1);
  await page.locator(".year-day.is-today").click();
  await expect(page.locator(".tg-dayhead.is-today")).toHaveCount(1);
  await expect(page.locator(".tg-dayhead")).toHaveCount(1);
});

test("tarea que se repite: al completarla salta a la siguiente fecha y queda en el historial", async ({ page }) => {
  await quickAdd(page, "Pagar alquiler cada mes el 1 !!");
  const row = page.locator(".task-row", { hasText: "Pagar alquiler" });
  await expect(row).toContainText("↻");
  const before = await row.locator(".task-due").textContent();
  await row.getByRole("checkbox").click();
  // Sigue pendiente, pero con la fecha del mes siguiente
  await expect(page.locator(".task-row", { hasText: "Pagar alquiler" })).toHaveCount(1);
  await expect(page.locator(".task-row", { hasText: "Pagar alquiler" }).locator(".task-due")).not.toHaveText(before!);
  // La copia completada aparece en "Ver hechas"
  await page.getByRole("button", { name: "Ver hechas" }).click();
  await expect(page.locator(".task-row", { hasText: "Pagar alquiler" })).toHaveCount(2);
  await expect(page.locator(".task-group", { hasText: "Hechas" })).toBeVisible();
});

test("cambiar de mes con la rueda y de semana con gesto horizontal; tarea del widget se abre para editar", async ({ page, context }) => {
  await quickAdd(page, "Comprar regalo hoy");
  await page.keyboard.press("3");
  const title = await page.locator(".tb-title").textContent();
  const grid = page.locator(".month-grid");
  await grid.hover();
  await page.mouse.wheel(0, 120);
  await expect(page.locator(".tb-title")).not.toHaveText(title!);
  await page.waitForTimeout(400);
  await page.mouse.wheel(0, -120);
  await expect(page.locator(".tb-title")).toHaveText(title!);

  await page.keyboard.press("2");
  const week = await page.locator(".tg-dayhead").first().textContent();
  await page.locator(".tg-scroll").hover();
  await page.mouse.wheel(150, 0);
  await expect(page.locator(".tg-dayhead").first()).not.toHaveText(week!);

  // En la app: el lápiz abre la tarea
  await page.locator(".task-row", { hasText: "Comprar regalo" }).hover();
  await page.getByRole("button", { name: "Editar Comprar regalo" }).click();
  await expect(page.getByPlaceholder("¿Qué hay que hacer?")).toHaveValue("Comprar regalo");
  await page.keyboard.press("Escape");

  // En el widget: pulsar el nombre abre el editor en la app (y no la marca como hecha)
  const widget = await context.newPage();
  await widget.goto("/widget.html");
  await widget.locator(".w-task-main", { hasText: "Comprar regalo" }).click();
  await expect(page.getByPlaceholder("¿Qué hay que hacer?")).toHaveValue("Comprar regalo");
  await expect(widget.locator(".w-task", { hasText: "Comprar regalo" }).getByRole("checkbox")).not.toBeChecked();
});
