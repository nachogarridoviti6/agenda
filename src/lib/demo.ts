import type { CalEvent, Task } from "./types";
import { addDaysZ, atMinutes, startOfDayZ, startOfWeekZ } from "./dates";

/** Datos de ejemplo para probar la interfaz en el navegador (`npm run dev` → /?demo). */
export function demoData(now = Date.now()): { events: CalEvent[]; tasks: Task[] } {
  const mon = startOfWeekZ(now);
  const day = (i: number) => addDaysZ(mon, i);
  let n = 0;
  const ev = (cal: string, title: string, d: number, from: number, to: number, extra: Partial<CalEvent> = {}): CalEvent => ({
    id: `demo-e${++n}`,
    calendarId: cal,
    title,
    location: "",
    notes: "",
    allDay: false,
    start: atMinutes(day(d), from * 60),
    end: atMinutes(day(d), to * 60),
    rrule: null,
    exdates: [],
    seriesId: null,
    recurrenceId: null,
    alerts: [15],
    createdAt: now,
    updatedAt: now,
    ...extra,
  });
  const allDay = (cal: string, title: string, d: number, days = 1): CalEvent => ({
    ...ev(cal, title, d, 0, 0),
    allDay: true,
    start: day(d),
    end: day(d + days),
    alerts: [],
  });
  const task = (cal: string, title: string, d: number | null, time: number | null, priority: 0 | 1 | 2 | 3 = 0, done = false): Task => ({
    id: `demo-t${++n}`,
    calendarId: cal,
    title,
    notes: "",
    due: d == null ? null : time == null ? startOfDayZ(day(d)) : atMinutes(day(d), time * 60),
    dueHasTime: time != null,
    priority,
    completedAt: done ? now : null,
    createdAt: now,
    updatedAt: now,
  });

  const events: CalEvent[] = [
    ev("cal-uni", "Cálculo II", 0, 9, 11, { location: "Aula 1.2", rrule: "FREQ=WEEKLY;BYDAY=MO,WE", start: atMinutes(addDaysZ(mon, -28), 540), end: atMinutes(addDaysZ(mon, -28), 660) }),
    ev("cal-uni", "Sistemas de fabricación", 1, 11.5, 13.5, { location: "Lab. 3", rrule: "FREQ=WEEKLY;BYDAY=TU,TH", start: atMinutes(addDaysZ(mon, -27), 690), end: atMinutes(addDaysZ(mon, -27), 810) }),
    ev("cal-trabajo", "Grabación villa Marbella", 1, 10, 13, { location: "Urb. Sierra Blanca" }),
    ev("cal-trabajo", "Reunión equipo marketing", 0, 16, 17),
    ev("cal-trabajo", "Edición vídeo ático", 2, 15, 18),
    ev("cal-trabajo", "Llamada cliente", 2, 16, 16.5),
    ev("cal-trabajo", "Sesión fotos piso centro", 4, 10, 12),
    ev("cal-uni", "Tutoría TFG", 4, 12.5, 13.25),
    ev("cal-personal", "Gimnasio", 0, 19.5, 21, { rrule: "FREQ=WEEKLY;BYDAY=MO,TH", alerts: [30] }),
    ev("cal-personal", "Cena con amigos", 5, 21, 23.5, { location: "La Tagliatella" }),
    ev("cal-personal", "Pádel", 6, 11, 12.5),
    allDay("cal-trabajo", "Feria inmobiliaria SIMA", 2, 2),
    allDay("cal-personal", "Cumple de Laura", 5),
  ];
  const tasks: Task[] = [
    task("cal-uni", "Entrega práctica fabricación", 4, 23 + 59 / 60, 3),
    task("cal-uni", "Leer tema 4 Cálculo", 1, null, 1, true),
    task("cal-trabajo", "Enviar copy anuncio Idealista", 2, null, 2),
    task("cal-trabajo", "Subir reel Instagram", 3, 18),
    task("cal-personal", "Pagar alquiler", 0, null, 2),
    task("cal-uni", "Apuntarse a examen extraordinario", null, null),
  ];
  return { events, tasks };
}
