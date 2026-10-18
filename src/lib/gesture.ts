/**
 * Convierte la rueda del ratón / el panel táctil en pasos de navegación (mes siguiente o anterior).
 * Un gesto = un paso: la inercia del panel táctil no salta varios meses. Un gesto nuevo empieza
 * cuando pasa un rato sin recibir eventos de rueda.
 */
export class WheelStepper {
  private acc = 0;
  private last = -Infinity;
  private stepped = false;

  constructor(
    /** Desplazamiento acumulado necesario para dar un paso (px). */
    private threshold = 60,
    /** Pausa que separa dos gestos (ms). */
    private gap = 220,
  ) {}

  /** Devuelve +1 (siguiente), -1 (anterior) o 0. `delta` > 0 = hacia abajo/derecha. */
  feed(delta: number, time: number): -1 | 0 | 1 {
    if (time - this.last > this.gap) {
      this.acc = 0;
      this.stepped = false;
    }
    this.last = time;
    if (this.stepped) return 0;
    this.acc += delta;
    if (Math.abs(this.acc) >= this.threshold) {
      this.stepped = true;
      return this.acc > 0 ? 1 : -1;
    }
    return 0;
  }
}

/** Deslizar con el dedo: +1 si el dedo sube (o va a la izquierda), -1 si baja (o a la derecha). */
export function swipeStep(dx: number, dy: number, axis: "x" | "y", min = 50): -1 | 0 | 1 {
  const main = axis === "y" ? dy : dx;
  const cross = axis === "y" ? dx : dy;
  if (Math.abs(main) < min || Math.abs(main) < Math.abs(cross) * 1.2) return 0;
  return main < 0 ? 1 : -1;
}

/** Normaliza el delta de la rueda a píxeles (algunos ratones lo dan en líneas o páginas). */
export function wheelPixels(delta: number, mode: number): number {
  return mode === 1 ? delta * 16 : mode === 2 ? delta * 400 : delta;
}
