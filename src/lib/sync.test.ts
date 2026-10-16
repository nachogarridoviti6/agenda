import { beforeEach, describe, expect, it } from "vitest";
import { syncAll, type LocalStore, type SyncCommit, type SyncState } from "./sync";
import { FakeCalDav } from "./fakecaldav";
import { combine } from "./dates";
import { DEFAULT_CALENDARS } from "./defaults";
import type { CalEvent, Calendar } from "./types";

/** "Base de datos" local en memoria con la misma semántica que sync_commit en Rust. */
class MemStore implements LocalStore {
  events = new Map<string, CalEvent>();
  st: SyncState = { links: [], items: [] };
  cals: Calendar[] = [...DEFAULT_CALENDARS];
  async state() { return structuredClone(this.st); }
  async calendars() { return this.cals; }
  async allEvents() { return [...this.events.values()]; }
  async commit(c: SyncCommit) {
    for (const id of c.deleteLinkCalendarIds ?? []) this.st.links = this.st.links.filter((l) => l.calendarId !== id);
    for (const l of c.upsertLinks ?? []) this.st.links = [...this.st.links.filter((x) => x.calendarId !== l.calendarId), l];
    for (const id of c.deleteEventIds ?? []) this.events.delete(id);
    for (const e of c.saveEvents ?? []) this.events.set(e.id, e);
    for (const id of c.deleteItemIds ?? []) this.st.items = this.st.items.filter((i) => i.eventId !== id);
    for (const i of c.upsertItems ?? []) this.st.items = [...this.st.items.filter((x) => x.eventId !== i.eventId), i];
  }
  /** Simula editar en Agenda (sube updatedAt). */
  edit(id: string, patch: Partial<CalEvent>, at: number) {
    this.events.set(id, { ...this.events.get(id)!, ...patch, updatedAt: at });
  }
}

const CAL = "https://fake.icloud/123/calendars/home/";
const iphoneEvent = (uid: string, title: string, day: string, extra = "", modified = "20261015T100000Z") =>
  [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Apple Inc.//iOS 18//EN",
    "BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${modified}`, `LAST-MODIFIED:${modified}`,
    `DTSTART;TZID=Europe/Madrid:${day.replace(/-/g, "")}T100000`, `DTEND;TZID=Europe/Madrid:${day.replace(/-/g, "")}T110000`,
    `SUMMARY:${title}`, extra, "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");

const ev = (id: string, title: string, at: number, over: Partial<CalEvent> = {}): CalEvent => ({
  id, calendarId: "cal-personal", title, location: "", notes: "", allDay: false,
  start: combine("2026-10-21", "18:00"), end: combine("2026-10-21", "19:00"),
  rrule: null, exdates: [], seriesId: null, recurrenceId: null, alerts: [], createdAt: at, updatedAt: at, ...over,
});

let server: FakeCalDav;
let local: MemStore;
let clock: number;
const tick = () => (clock += 60_000);
const sync = () => syncAll(server, local, tick());
const titles = () => [...local.events.values()].map((e) => e.title).sort();
const remoteTitles = () =>
  [...server.cals.get(CAL)!.items.values()].map((v) => v.data.match(/SUMMARY:(.*)/)![1].trim()).sort();

beforeEach(async () => {
  server = new FakeCalDav();
  server.addCalendar(CAL, "Casa");
  local = new MemStore();
  clock = combine("2026-10-16", "12:00");
  await local.commit({ upsertLinks: [{ calendarId: "cal-personal", url: CAL, ctag: null }] });
});

describe("sincronización con iCloud", () => {
  it("primera vez: baja lo de iCloud y sube lo local", async () => {
    server.remotePut(`${CAL}A.ics`, iphoneEvent("A-IPHONE", "Dentista", "2026-10-20"));
    local.events.set("l1", ev("l1", "Pádel", clock));
    const r = await sync();
    expect(r).toMatchObject({ pulled: 1, pushed: 1, errors: [] });
    expect(titles()).toEqual(["Dentista", "Pádel"]);
    expect(remoteTitles()).toEqual(["Dentista", "Pádel"]);
    expect(local.events.get([...local.events.keys()].find((k) => k !== "l1")!)!.calendarId).toBe("cal-personal");
  });

  it("si no ha cambiado nada no vuelve a pedir nada a iCloud", async () => {
    server.remotePut(`${CAL}A.ics`, iphoneEvent("A", "Dentista", "2026-10-20"));
    await sync();
    await sync(); // la primera escritura deja el ctag sin guardar
    server.log = [];
    const r = await sync();
    expect(server.log).toEqual([]);
    expect(r).toMatchObject({ pulled: 0, pushed: 0 });
  });

  it("cambios del iPhone llegan; cambios de Agenda se suben conservando el UID", async () => {
    server.remotePut(`${CAL}A.ics`, iphoneEvent("A-IPHONE", "Dentista", "2026-10-20", "URL:https://clinica.example"));
    await sync();
    const id = [...local.events.keys()][0];

    server.remotePut(`${CAL}A.ics`, iphoneEvent("A-IPHONE", "Dentista (revisión)", "2026-10-20", "", "20261016T120500Z"));
    await sync();
    expect(titles()).toEqual(["Dentista (revisión)"]);

    local.edit(id, { location: "Clínica Sonrisas" }, tick());
    const r = await sync();
    expect(r.pushed).toBe(1);
    const data = server.cals.get(CAL)!.items.get(`${CAL}A.ics`)!.data;
    expect(data).toContain("UID:A-IPHONE");
    expect(data).toContain("LOCATION:Clínica Sonrisas");
    expect(server.cals.get(CAL)!.items.size).toBe(1);
  });

  it("borrados en cada lado", async () => {
    server.remotePut(`${CAL}A.ics`, iphoneEvent("A", "Uno", "2026-10-20"));
    local.events.set("l1", ev("l1", "Dos", clock));
    await sync();
    server.remoteDelete(`${CAL}A.ics`);
    local.events.delete("l1");
    const r = await sync();
    expect(r).toMatchObject({ deletedLocal: 1, deletedRemote: 1 });
    expect(titles()).toEqual([]);
    expect(remoteTitles()).toEqual([]);
    expect(local.st.items).toEqual([]);
  });

  it("conflicto: gana el cambio más reciente", async () => {
    local.events.set("l1", ev("l1", "Cena", clock));
    await sync();
    // iPhone cambia a las 12:05 UTC; Agenda cambia después (reloj local más tarde) → gana Agenda
    server.remotePut(`${CAL}l1.ics`, iphoneEvent("l1@agenda", "Cena (iPhone)", "2026-10-21", "", "20261016T080000Z"));
    local.edit("l1", { title: "Cena (PC)" }, tick());
    const r = await sync();
    expect(r.conflicts[0]).toMatch(/versión de este PC/);
    expect(remoteTitles()).toEqual(["Cena (PC)"]);
    expect(titles()).toEqual(["Cena (PC)"]);

    // Ahora el iPhone cambia más tarde que Agenda → gana iCloud
    local.edit("l1", { title: "Cena (PC 2)" }, tick());
    server.remotePut(`${CAL}l1.ics`, iphoneEvent("l1@agenda", "Cena (iPhone 2)", "2026-10-21", "", "20271016T080000Z"));
    const r2 = await sync();
    expect(r2.conflicts[0]).toMatch(/versión de iCloud/);
    expect(titles()).toEqual(["Cena (iPhone 2)"]);
  });

  it("borrado en iCloud pero editado aquí: se vuelve a subir", async () => {
    local.events.set("l1", ev("l1", "Cena", clock));
    await sync();
    server.remoteDelete(`${CAL}l1.ics`);
    local.edit("l1", { title: "Cena con Laura" }, tick());
    const r = await sync();
    expect(r.conflicts).toHaveLength(1);
    expect(remoteTitles()).toEqual(["Cena con Laura"]);
  });

  it("series con excepciones viajan en el mismo recurso", async () => {
    const m = ev("s1", "Inglés", clock, { rrule: "FREQ=WEEKLY;BYDAY=TH" });
    const x = ev("x1", "Inglés (oral)", clock, { seriesId: "s1", recurrenceId: combine("2026-10-29", "18:00"), start: combine("2026-10-29", "19:00"), end: combine("2026-10-29", "20:00") });
    local.events.set("s1", { ...m, exdates: [x.recurrenceId!] });
    local.events.set("x1", x);
    await sync();
    const data = server.cals.get(CAL)!.items.get(`${CAL}s1.ics`)!.data;
    expect(data.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(data).toContain("RECURRENCE-ID;TZID=Europe/Madrid:20261029T180000");

    // Otro PC/iPhone: borra la excepción → aquí desaparece
    const otherSide = data.replace(/BEGIN:VEVENT(?:(?!END:VEVENT)[\s\S])*RECURRENCE-ID[\s\S]*?END:VEVENT\r\n/, "").replace("LAST-MODIFIED", "X-OLD");
    server.remotePut(`${CAL}s1.ics`, otherSide);
    await sync();
    expect(local.events.has("x1")).toBe(false);
    expect(local.events.get("s1")!.rrule).toBe("FREQ=WEEKLY;BYDAY=TH");
  });

  it("mover un evento a otro calendario enlazado lo mueve en iCloud", async () => {
    const CAL2 = server.addCalendar("https://fake.icloud/123/calendars/work/", "Trabajo");
    await local.commit({ upsertLinks: [{ calendarId: "cal-trabajo", url: CAL2, ctag: null }] });
    local.events.set("l1", ev("l1", "Visita", clock));
    await sync();
    local.edit("l1", { calendarId: "cal-trabajo" }, tick());
    await sync();
    expect(server.cals.get(CAL)!.items.size).toBe(0);
    expect(server.cals.get(CAL2)!.items.size).toBe(1);
  });

  it("invitaciones (con ATTENDEE) no se reescriben desde aquí", async () => {
    server.remotePut(`${CAL}A.ics`, iphoneEvent("A", "Comité", "2026-10-20", "ATTENDEE;CN=Ana:mailto:ana@example.com"));
    await sync();
    const id = [...local.events.keys()][0];
    local.edit(id, { title: "Comité (cambiado)" }, tick());
    server.log = [];
    const r = await sync();
    expect(r.skippedReadonly).toEqual(["Comité (cambiado)"]);
    expect(server.log.some((l) => l.startsWith("PUT"))).toBe(false);
  });

  it("si iCloud no devuelve la ETag tras subir, la pregunta", async () => {
    server.omitPutEtag = true;
    local.events.set("l1", ev("l1", "Cena", clock));
    await sync();
    expect(local.st.items[0].etag).toMatch(/^"\d+"$/);
  });

  it("calendario borrado en iCloud: se desenlaza y los eventos locales se quedan", async () => {
    local.events.set("l1", ev("l1", "Cena", clock));
    await sync();
    server.cals.delete(CAL);
    const r = await sync();
    expect(r.unlinked).toEqual(["Personal"]);
    expect(local.st.links).toEqual([]);
    expect(titles()).toEqual(["Cena"]);
  });

  it("los errores de un evento no paran el resto", async () => {
    local.events.set("l1", ev("l1", "Uno", clock));
    local.events.set("l2", ev("l2", "Dos", clock));
    const orig = server.put.bind(server);
    server.put = async (href, data, etag) => (href.includes("l1") ? Promise.reject(new Error("507 lleno")) : orig(href, data, etag));
    const r = await sync();
    expect(r.pushed).toBe(1);
    expect(r.errors[0]).toMatch(/Uno.*507/);
  });
});
