/**
 * Interpreta lo que se escribe en un campo de hora: "9", "930", "9:30", "9.30", "21h", "21:5".
 * Devuelve "HH:mm" o null si no es válido.
 */
export function parseTimeInput(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/h$/, "").replace(/[.,h]/, ":");
  let h: number, m: number;
  const colon = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (colon) {
    h = Number(colon[1]);
    m = Number(colon[2].length === 1 ? colon[2] + "0" : colon[2]);
  } else if (/^\d{1,2}$/.test(s)) {
    h = Number(s);
    m = 0;
  } else if (/^\d{3,4}$/.test(s)) {
    h = Number(s.slice(0, s.length - 2));
    m = Number(s.slice(-2));
  } else return null;
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Suma minutos a "HH:mm" dando la vuelta al día. */
export function shiftTime(value: string, delta: number): string {
  const [h, m] = value.split(":").map(Number);
  const t = (((h * 60 + m + delta) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
