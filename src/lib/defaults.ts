import type { Calendar, WidgetConfig } from "./types";

/** Paleta tipo Apple. El evento se pinta con el color suavizado (pastel) y una barra intensa. */
export const PALETTE = [
  { name: "Rojo", hex: "#FF3B30" },
  { name: "Naranja", hex: "#FF9500" },
  { name: "Amarillo", hex: "#FFCC00" },
  { name: "Verde", hex: "#34C759" },
  { name: "Menta", hex: "#00C7BE" },
  { name: "Azul", hex: "#007AFF" },
  { name: "Morado", hex: "#AF52DE" },
  { name: "Rosa", hex: "#FF2D55" },
  { name: "Marrón", hex: "#A2845E" },
];

export const DEFAULT_CALENDARS: Calendar[] = [
  { id: "cal-uni", name: "Uni", color: "#007AFF", visible: true, sortOrder: 0 },
  { id: "cal-trabajo", name: "Trabajo", color: "#FF9500", visible: true, sortOrder: 1 },
  { id: "cal-personal", name: "Personal", color: "#34C759", visible: true, sortOrder: 2 },
];

export const DEFAULT_EVENT_MINUTES = 60;

/** Igual que `WidgetConfig::default()` en Rust. */
export const DEFAULT_WIDGET: WidgetConfig = {
  visible: true,
  monitor: null,
  x: 0,
  y: 0,
  width: 760,
  height: 380,
  positionSet: false,
  locked: false,
  acrylic: true,
  opacity: 0.72,
  theme: "system",
};
