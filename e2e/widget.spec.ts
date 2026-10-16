import { expect, test } from "@playwright/test";

// App principal y widget abiertos a la vez (en el navegador se comunican por BroadcastChannel,
// igual que en la app real lo hacen con el evento "data-changed" de Tauri).
test("el widget se actualiza al instante y abre la app en el día", async ({ context }) => {
  const main = await context.newPage();
  await main.goto("/");
  await main.evaluate(() => localStorage.clear());
  await main.reload();
  await main.waitForSelector(".app");

  const widget = await context.newPage();
  await widget.goto("/widget.html");
  await widget.waitForSelector(".widget-root");
  await expect(widget.locator(".w-day")).toHaveCount(7);
  await expect(widget.locator(".w-day.is-today")).toHaveCount(1);

  // Evento creado en la app → aparece en el widget, en el día de hoy
  await main.keyboard.press("n");
  await main.getByPlaceholder("Título").fill("Reunión con notario");
  await main.getByRole("dialog").getByRole("button", { name: "Añadir" }).click();
  await expect(widget.locator(".w-day.is-today .w-item", { hasText: "Reunión con notario" })).toBeVisible();

  // Tarea creada en la app → aparece en la lista del widget
  await main.getByRole("button", { name: "Nueva tarea" }).click();
  await main.getByPlaceholder("¿Qué hay que hacer?").fill("Llamar al banco");
  await main.getByRole("switch", { name: "Fecha límite" }).click();
  await main.getByRole("dialog").getByRole("button", { name: "Añadir" }).click();
  const wtask = widget.locator(".w-task", { hasText: "Llamar al banco" });
  await expect(wtask).toBeVisible();

  // Completarla desde el widget → desaparece de pendientes en la app y luego del widget
  await wtask.getByRole("checkbox").click();
  await expect(main.locator(".task-row", { hasText: "Llamar al banco" })).toHaveCount(0);
  await expect(wtask).toHaveCount(0, { timeout: 4000 });

  // Cambiar el tema del widget desde Ajustes → el widget lo aplica
  await main.getByRole("button", { name: "Ajustes" }).click();
  await main.getByRole("dialog").locator(".f-row", { hasText: /^Tema/ }).last().getByRole("button", { name: "Oscuro" }).click();
  await expect(widget.locator("html")).toHaveAttribute("data-theme", "dark");
  await main.getByRole("dialog").getByRole("switch", { name: "Bloquear posición" }).click();
  await expect(widget.locator(".widget-root")).toHaveClass(/is-locked/);
  await main.getByRole("button", { name: "Listo" }).click();

  // Doble clic en un día del widget → la app navega a esa semana
  await main.keyboard.press("ArrowRight");
  await main.keyboard.press("ArrowRight");
  const before = await main.locator(".tg-dayhead.is-today").count();
  expect(before).toBe(0);
  await widget.locator(".w-day.is-today").dblclick();
  await expect(main.locator(".tg-dayhead.is-today")).toHaveCount(1);
});
