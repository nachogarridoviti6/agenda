import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "./nlp";
import { combine, dayKey, timeKey } from "./dates";
import { DEFAULT_CALENDARS } from "./defaults";

// Viernes 16 de octubre de 2026, 10:40 en Madrid
const now = combine("2026-10-16", "10:40");
const p = (s: string) => parseQuickAdd(s, DEFAULT_CALENDARS, now);
const at = (ms: number | null) => (ms == null ? null : `${dayKey(ms)} ${timeKey(ms)}`);

describe("ejemplos del enunciado", () => {
  it("Entrega práctica fabricación viernes 23:59 #uni → tarea", () => {
    const r = p("Entrega práctica fabricación viernes 23:59 #uni");
    expect(r.kind).toBe("task");
    expect(r.title).toBe("Entrega práctica fabricación");
    expect(r.calendarId).toBe("cal-uni");
    expect(at(r.due)).toBe("2026-10-16 23:59"); // hoy es viernes y las 23:59 aún no han pasado
    expect(r.dueHasTime).toBe(true);
  });

  it("Grabación villa martes 10-13 #trabajo → evento", () => {
    const r = p("Grabación villa martes 10-13 #trabajo");
    expect(r.kind).toBe("event");
    expect(r.title).toBe("Grabación villa");
    expect(r.calendarId).toBe("cal-trabajo");
    expect(at(r.start)).toBe("2026-10-20 10:00");
    expect(at(r.end)).toBe("2026-10-20 13:00");
  });
});

describe("fechas", () => {
  it.each([
    ["Cena hoy 21:00", "2026-10-16 21:00"],
    ["Cena mañana a las 21", "2026-10-17 21:00"],
    ["Cena pasado mañana 21h", "2026-10-18 21:00"],
    ["Dentista el lunes a las 9:30", "2026-10-19 09:30"],
    ["Dentista lunes 9", "2026-10-19 09:00"],
    ["Reunión próximo viernes 12:00", "2026-10-23 12:00"],
    ["Reunión el viernes que viene 12:00", "2026-10-23 12:00"],
    ["Reunión viernes 9:00", "2026-10-23 09:00"], // hoy es viernes pero las 9 ya han pasado
    ["Examen 23/10 9:00", "2026-10-23 09:00"],
    ["Examen 3/2 9:00", "2027-02-03 09:00"], // ya pasó este año → el que viene
    ["Examen 23 de octubre a las 9", "2026-10-23 09:00"],
    ["Examen 5 nov 16:30", "2026-11-05 16:30"],
    ["Examen el 20 a las 10", "2026-10-20 10:00"],
    ["Examen el 2 a las 10", "2026-11-02 10:00"], // el 2 ya pasó → noviembre
    ["Revisión dentro de 3 días 10:00", "2026-10-19 10:00"],
    ["Revisión en 2 semanas 10:00", "2026-10-30 10:00"],
    ["Café 9am", "2026-10-16 09:00"],
    ["Cine 10pm", "2026-10-16 22:00"],
  ])("%s → %s", (input, expected) => expect(at(p(input).start)).toBe(expected));
});

describe("horas y duración", () => {
  it("rangos en sus distintas formas", () => {
    for (const s of ["Clase jueves 10-12", "Clase jueves de 10 a 12", "Clase jueves 10 a 12", "Clase jueves 10:00-12:00", "Clase jueves 10 - 12"]) {
      const r = p(s);
      expect([r.title, at(r.start), at(r.end)], s).toEqual(["Clase", "2026-10-22 10:00", "2026-10-22 12:00"]);
    }
  });
  it("sin hora de fin → 1 h; con 'durante'", () => {
    expect(at(p("Llamada lunes 10:00").end)).toBe("2026-10-19 11:00");
    expect(at(p("Gimnasio lunes 19:00 durante 90 min").end)).toBe("2026-10-19 20:30");
    expect(at(p("Taller lunes 16:00 durante 2 horas").end)).toBe("2026-10-19 18:00");
  });
  it("cruza la medianoche", () => {
    const r = p("Fiesta sábado 22-3");
    expect([at(r.start), at(r.end)]).toEqual(["2026-10-17 22:00", "2026-10-18 03:00"]);
  });
  it("sin hora → todo el día; 'todo el día' explícito", () => {
    const r = p("Feria inmobiliaria jueves #trabajo");
    expect(r.allDay).toBe(true);
    expect(dayKey(r.start!)).toBe("2026-10-22");
    expect(p("Viaje mañana todo el día").allDay).toBe(true);
  });
  it("los números del título no son horas", () => {
    const r = p("Clase aula 3 lunes 10-12");
    expect(r.title).toBe("Clase aula 3");
    expect(at(r.start)).toBe("2026-10-19 10:00");
  });
});

describe("tareas, prioridad, lugar y calendario", () => {
  it("prioridad con ! y palabras", () => {
    expect(p("Pagar alquiler el 1 !!")).toMatchObject({ kind: "task", priority: 2, title: "Pagar alquiler" });
    expect(dayKey(p("Pagar alquiler el 1 !!").due!)).toBe("2026-11-01");
    expect(p("Revisar contrato !alta").priority).toBe(3);
  });
  it("tarea sin fecha", () => {
    const r = p("Comprar tóner impresora");
    expect(r).toMatchObject({ kind: "task", due: null, title: "Comprar tóner impresora" });
  });
  it("forzar tipo", () => {
    expect(p("tarea: Estudiar tema 4 mañana").kind).toBe("task");
    expect(p("evento: Entrega de llaves lunes 12:00").kind).toBe("event");
    expect(p("evento: Entrega de llaves lunes 12:00").title).toBe("Entrega de llaves");
  });
  it("lugar con @ y calendario por prefijo", () => {
    const r = p("Visita ático martes 17:00 #trab @Calle Larios 5, Málaga");
    expect(r.location).toBe("Calle Larios 5");
    expect(r.calendarId).toBe("cal-trabajo");
    expect(r.title).toBe("Visita ático Málaga");
    const r2 = p("Visita martes 17:00 @Calle Larios 5");
    expect([r2.title, r2.location]).toEqual(["Visita", "Calle Larios 5"]);
  });
  it("calendario sin acentos ni mayúsculas, y etiqueta desconocida se queda en el título", () => {
    expect(p("Algo #PERSONAL").calendarId).toBe("cal-personal");
    expect(p("Algo #gym").title).toBe("Algo #gym");
  });
});

describe("tareas que se repiten", () => {
  it("Pagar alquiler cada mes el 1 !! → tarea mensual", () => {
    const r = p("Pagar alquiler cada mes el 1 !!");
    expect(r).toMatchObject({ kind: "task", title: "Pagar alquiler", priority: 2, rrule: "FREQ=MONTHLY" });
    expect(dayKey(r.due!)).toBe("2026-11-01");
  });
  it("Entregar informe cada viernes 14:00 → tarea semanal con hora", () => {
    const r = p("Entregar informe cada viernes 14:00 #trabajo");
    expect(r).toMatchObject({ kind: "task", rrule: "FREQ=WEEKLY;BYDAY=FR", dueHasTime: true });
    expect(at(r.due)).toBe("2026-10-16 14:00");
  });
});

describe("repeticiones", () => {
  it("cada lunes y miércoles", () => {
    const r = p("Cálculo cada lunes y miércoles 9-11 #uni");
    expect(r).toMatchObject({ kind: "event", title: "Cálculo", rrule: "FREQ=WEEKLY;BYDAY=MO,WE" });
    expect(at(r.start)).toBe("2026-10-19 09:00");
  });
  it("todos los martes, cada día, cada 2 semanas, laborables", () => {
    expect(p("Pádel todos los martes 19:00").rrule).toBe("FREQ=WEEKLY;BYDAY=TU");
    expect(p("Meditar cada día 8:00").rrule).toBe("FREQ=DAILY");
    expect(p("Reunión cada 2 semanas viernes 12:00").rrule).toBe("FREQ=WEEKLY;INTERVAL=2");
    expect(p("Daily cada día laborable 9:30").rrule).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(p("Cuota gimnasio cada mes el 1").rrule).toBe("FREQ=MONTHLY");
  });
  it("con fecha de fin", () => {
    const r = p("Inglés cada jueves 18-19 hasta el 17/12");
    expect(r.rrule).toMatch(/^FREQ=WEEKLY;BYDAY=TH;UNTIL=20261217T2259/);
    expect(at(r.start)).toBe("2026-10-22 18:00");
  });
});
