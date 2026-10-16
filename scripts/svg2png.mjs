// Rasteriza un SVG a PNG con Chromium (para iconos e imágenes del instalador).
// Uso: node scripts/svg2png.mjs entrada.svg salida.png
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const [, , src, out] = process.argv;
const svg = readFileSync(src, "utf8");
const [w, h] = [Number(svg.match(/width="(\d+)"/)[1]), Number(svg.match(/height="(\d+)"/)[1])];
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const p = await b.newPage({ viewport: { width: w, height: h } });
await p.setContent(`<html><body style="margin:0">${svg}</body></html>`);
await p.waitForTimeout(150);
await p.screenshot({ path: out });
await b.close();
