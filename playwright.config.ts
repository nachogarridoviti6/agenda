import { defineConfig } from "@playwright/test";

// Pruebas de interfaz en el navegador contra el backend simulado (localStorage).
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:1420",
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    viewport: { width: 1280, height: 800 },
    launchOptions: process.env.CHROME ? { executablePath: process.env.CHROME } : {},
  },
  webServer: { command: "npx vite --port 1420", url: "http://localhost:1420", reuseExistingServer: true },
});
