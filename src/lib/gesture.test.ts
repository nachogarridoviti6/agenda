import { describe, expect, it } from "vitest";
import { swipeStep, WheelStepper } from "./gesture";

describe("rueda y panel táctil", () => {
  it("un clic de rueda hacia abajo = mes siguiente; hacia arriba = anterior", () => {
    const w = new WheelStepper();
    expect(w.feed(100, 0)).toBe(1);
    expect(w.feed(-100, 1000)).toBe(-1);
  });

  it("la inercia del panel táctil solo da un paso por gesto", () => {
    const w = new WheelStepper();
    const steps = Array.from({ length: 40 }, (_, i) => w.feed(12, i * 16)).filter((s) => s !== 0);
    expect(steps).toEqual([1]);
    // tras una pausa, otro gesto da otro paso
    expect(w.feed(80, 40 * 16 + 500)).toBe(1);
  });

  it("movimientos pequeños no cambian de mes", () => {
    const w = new WheelStepper();
    expect(w.feed(20, 0)).toBe(0);
    expect(w.feed(20, 500)).toBe(0);
  });
});

describe("deslizar con el dedo", () => {
  it("vertical: subir el dedo = siguiente, bajarlo = anterior", () => {
    expect(swipeStep(5, -120, "y")).toBe(1);
    expect(swipeStep(-8, 90, "y")).toBe(-1);
  });
  it("ignora toques cortos y gestos en diagonal", () => {
    expect(swipeStep(0, -20, "y")).toBe(0);
    expect(swipeStep(100, -90, "y")).toBe(0);
  });
  it("horizontal para semanas", () => {
    expect(swipeStep(-120, 10, "x")).toBe(1);
    expect(swipeStep(120, 10, "x")).toBe(-1);
  });
});
