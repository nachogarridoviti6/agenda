import type { CalEvent, Calendar, Corner, Id, MonitorInfo, Task, WidgetConfig } from "./types";
import { DEFAULT_CALENDARS, DEFAULT_WIDGET } from "./defaults";
import { demoData } from "./demo";
import type { Alarm } from "./alarms";
import type { RemoteCalendar, Resource, ETagItem, SyncCommit, SyncState } from "./sync";
import { FakeCalDav } from "./fakecaldav";

export interface ICloudAccount {
  appleId: string;
  homeUrl: string;
}

/**
 * Contrato con el backend. En la app real lo implementa Rust (SQLite) vía comandos de Tauri;
 * en el navegador (desarrollo y capturas) lo implementa `MockBackend` con localStorage.
 */
export interface Backend {
  listCalendars(): Promise<Calendar[]>;
  saveCalendar(c: Calendar): Promise<void>;
  /** Borra el calendario y todo lo que contiene. */
  deleteCalendar(id: Id): Promise<void>;

  /** Eventos que pueden aparecer en [from, to): los normales que solapan y todas las series que empiezan antes de `to`. */
  listEvents(from: number, to: number): Promise<CalEvent[]>;
  getEvent(id: Id): Promise<CalEvent | null>;
  /** Todos los eventos (para la búsqueda). */
  listAllEvents(): Promise<CalEvent[]>;
  deleteExceptionsFrom(seriesId: Id, from: number): Promise<void>;
  /** Alertas que el backend debe disparar como notificaciones de Windows. */
  setAlarms(alarms: Alarm[]): Promise<void>;
  /** Importación: guarda todo de golpe (una transacción, un solo aviso de cambios). */
  saveBulk(calendars: Calendar[], events: CalEvent[], tasks: Task[]): Promise<void>;
  /** Elige un .ics y devuelve su contenido (null si se cancela). */
  pickIcs(): Promise<string | null>;
  /** Guarda un .ics donde diga el usuario. Devuelve la ruta (null si se cancela). */
  saveIcs(content: string, fileName: string): Promise<string | null>;

  // iCloud (CalDAV). La contraseña la guarda Rust en el Administrador de credenciales.
  icloudConnect(appleId: string, password: string): Promise<ICloudAccount>;
  icloudAccount(): Promise<ICloudAccount | null>;
  icloudDisconnect(): Promise<void>;
  icloudCalendars(): Promise<RemoteCalendar[]>;
  icloudListEtags(url: string, since?: number): Promise<ETagItem[]>;
  icloudFetch(url: string, hrefs: string[]): Promise<Resource[]>;
  icloudPut(href: string, data: string, etag: string | null): Promise<string | null>;
  icloudDelete(href: string, etag: string | null): Promise<void>;
  icloudMakeCalendar(name: string, color: string): Promise<string>;
  syncState(): Promise<SyncState>;
  syncCommit(commit: SyncCommit): Promise<void>;

  /** .ics abierto con doble clic en el Explorador (null si no hay). */
  takePendingIcs(): Promise<string | null>;
  onOpenIcs(cb: () => void): Promise<() => void>;
  appInfo(): Promise<{ version: string; dataDir: string }>;
  openDataDir(): Promise<void>;
  /** Abre una página de Apple en el navegador. */
  openApplePage(url: string): Promise<void>;
  /** Desde el widget: abre la app con "Añadir rápido". */
  openQuickAdd(): Promise<void>;
  /** Desde el widget: abre la app con el editor de una tarea. */
  openTaskInMain(id: Id): Promise<void>;
  onOpenTask(cb: (id: Id) => void): Promise<() => void>;
  saveEvent(e: CalEvent): Promise<void>;
  /** Borra el evento y, si es una serie, también sus excepciones. */
  deleteEvent(id: Id): Promise<void>;

  listTasks(): Promise<Task[]>;
  saveTask(t: Task): Promise<void>;
  deleteTask(id: Id): Promise<void>;

  getSettings(): Promise<Record<string, unknown>>;
  setSetting(key: string, value: unknown): Promise<void>;

  /** Se llama cuando cualquier ventana cambia datos. Devuelve la función para dejar de escuchar. */
  onChange(cb: (kind: string) => void): Promise<() => void>;

  // Widget y sistema
  getWidgetConfig(): Promise<WidgetConfig>;
  setWidgetConfig(c: WidgetConfig): Promise<void>;
  snapWidget(corner: Corner): Promise<void>;
  listMonitors(): Promise<MonitorInfo[]>;
  /** Abre la ventana principal (y navega a `day` si se indica). */
  openMain(day?: number): Promise<void>;
  getAutostart(): Promise<boolean>;
  setAutostart(enabled: boolean): Promise<void>;
  /** Eventos de la bandeja / del widget dirigidos a la ventana principal. */
  onNavigate(cb: (day: number) => void): Promise<() => void>;
  onQuickAdd(cb: () => void): Promise<() => void>;
}

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

class TauriBackend implements Backend {
  private async call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }
  listCalendars() { return this.call<Calendar[]>("list_calendars"); }
  saveCalendar(calendar: Calendar) { return this.call<void>("save_calendar", { calendar }); }
  deleteCalendar(id: Id) { return this.call<void>("delete_calendar", { id }); }
  listEvents(from: number, to: number) { return this.call<CalEvent[]>("list_events", { from, to }); }
  getEvent(id: Id) { return this.call<CalEvent | null>("get_event", { id }); }
  listAllEvents() { return this.call<CalEvent[]>("list_all_events"); }
  deleteExceptionsFrom(seriesId: Id, from: number) { return this.call<void>("delete_exceptions_from", { seriesId, from }); }
  setAlarms(alarms: Alarm[]) { return this.call<void>("set_alarms", { alarms }); }
  saveBulk(calendars: Calendar[], events: CalEvent[], tasks: Task[]) { return this.call<void>("save_bulk", { calendars, events, tasks }); }
  pickIcs() { return this.call<string | null>("pick_ics"); }
  saveIcs(content: string, fileName: string) { return this.call<string | null>("save_ics", { content, fileName }); }
  icloudConnect(appleId: string, password: string) { return this.call<ICloudAccount>("icloud_connect", { appleId, password }); }
  icloudAccount() { return this.call<ICloudAccount | null>("icloud_account"); }
  icloudDisconnect() { return this.call<void>("icloud_disconnect"); }
  icloudCalendars() { return this.call<RemoteCalendar[]>("icloud_calendars"); }
  icloudListEtags(url: string, since?: number) { return this.call<ETagItem[]>("icloud_list_etags", { url, since: since ?? null }); }
  icloudFetch(url: string, hrefs: string[]) { return this.call<Resource[]>("icloud_fetch", { url, hrefs }); }
  icloudPut(href: string, data: string, etag: string | null) { return this.call<string | null>("icloud_put", { href, data, etag }); }
  icloudDelete(href: string, etag: string | null) { return this.call<void>("icloud_delete", { href, etag }); }
  icloudMakeCalendar(name: string, color: string) { return this.call<string>("icloud_make_calendar", { name, color }); }
  syncState() { return this.call<SyncState>("sync_state"); }
  syncCommit(commit: SyncCommit) { return this.call<void>("sync_commit", { commit }); }
  takePendingIcs() { return this.call<string | null>("take_pending_ics"); }
  async onOpenIcs(cb: () => void) {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    return getCurrentWebviewWindow().listen("open-ics", () => cb());
  }
  appInfo() { return this.call<{ version: string; dataDir: string }>("app_info"); }
  openDataDir() { return this.call<void>("open_data_dir"); }
  openApplePage(url: string) { return this.call<void>("open_apple_page", { url }); }
  openQuickAdd() { return this.call<void>("open_quick_add"); }
  openTaskInMain(id: Id) { return this.call<void>("open_task", { id }); }
  async onOpenTask(cb: (id: Id) => void) {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    return getCurrentWebviewWindow().listen<string>("open-task", (e) => cb(e.payload));
  }
  saveEvent(event: CalEvent) { return this.call<void>("save_event", { event }); }
  deleteEvent(id: Id) { return this.call<void>("delete_event", { id }); }
  listTasks() { return this.call<Task[]>("list_tasks"); }
  saveTask(task: Task) { return this.call<void>("save_task", { task }); }
  deleteTask(id: Id) { return this.call<void>("delete_task", { id }); }
  getSettings() { return this.call<Record<string, unknown>>("get_settings"); }
  setSetting(key: string, value: unknown) { return this.call<void>("set_setting", { key, value }); }
  async onChange(cb: (kind: string) => void) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<string>("data-changed", (e) => cb(e.payload));
  }
  getWidgetConfig() { return this.call<WidgetConfig>("widget_get_config"); }
  setWidgetConfig(config: WidgetConfig) { return this.call<void>("widget_set_config", { config }); }
  snapWidget(corner: Corner) { return this.call<void>("widget_snap", { corner }); }
  listMonitors() { return this.call<MonitorInfo[]>("list_monitors"); }
  openMain(day?: number) { return this.call<void>("open_main", { day: day ?? null }); }
  getAutostart() { return this.call<boolean>("get_autostart"); }
  setAutostart(enabled: boolean) { return this.call<void>("set_autostart", { enabled }); }
  async onNavigate(cb: (day: number) => void) {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    return getCurrentWebviewWindow().listen<number>("navigate", (e) => cb(e.payload));
  }
  async onQuickAdd(cb: () => void) {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    return getCurrentWebviewWindow().listen("quick-add", () => cb());
  }
}

interface MockDb {
  calendars: Calendar[];
  events: CalEvent[];
  tasks: Task[];
  settings: Record<string, unknown>;
}

/** Backend en memoria + localStorage para `npm run dev` en el navegador. Se sincroniza entre pestañas. */
export class MockBackend implements Backend {
  private key = "agenda-mock-db";
  private channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("agenda") : null;
  private listeners = new Set<(k: string) => void>();
  private memory: MockDb | null = null;
  /** Con datos de ejemplo se trabaja solo en memoria (no se toca lo guardado). */
  private memoryOnly = false;

  constructor(seed?: Partial<MockDb>) {
    if (seed) {
      this.memory = { calendars: DEFAULT_CALENDARS, events: [], tasks: [], settings: {}, ...seed };
      this.memoryOnly = true;
    }
    // Avisos entre pestañas con el evento "storage": llega cuando los datos ya están escritos
    // (un BroadcastChannel puede adelantarse a localStorage entre procesos).
    if (typeof window !== "undefined" && !this.memoryOnly) {
      window.addEventListener("storage", (e) => {
        if (e.key !== this.key || !e.newValue) return;
        try {
          const kind = (JSON.parse(e.newValue) as { _kind?: string })._kind ?? "events";
          this.listeners.forEach((l) => l(kind));
        } catch {
          /* ignorar */
        }
      });
    }
  }

  private load(): MockDb {
    if (!this.memoryOnly) {
      try {
        const raw = localStorage.getItem(this.key);
        if (raw) return JSON.parse(raw);
      } catch {
        /* sin almacenamiento: seguimos en memoria */
      }
    }
    this.memory ??= { calendars: [...DEFAULT_CALENDARS], events: [], tasks: [], settings: {} };
    return this.memory;
  }
  private save(db: MockDb, kind: string) {
    this.memory = db;
    if (!this.memoryOnly) {
      try {
        localStorage.setItem(this.key, JSON.stringify({ ...db, _kind: kind, _t: Date.now() + Math.random() }));
      } catch {
        /* se queda en memoria */
      }
    }
    this.listeners.forEach((l) => l(kind));
  }
  private upsert<T extends { id: Id }>(list: T[], item: T): T[] {
    const i = list.findIndex((x) => x.id === item.id);
    return i === -1 ? [...list, item] : list.map((x, j) => (j === i ? item : x));
  }

  async listCalendars() { return [...this.load().calendars].sort((a, b) => a.sortOrder - b.sortOrder); }
  async saveCalendar(c: Calendar) { const db = this.load(); db.calendars = this.upsert(db.calendars, c); this.save(db, "calendars"); }
  async deleteCalendar(id: Id) {
    const db = this.load();
    db.calendars = db.calendars.filter((c) => c.id !== id);
    db.events = db.events.filter((e) => e.calendarId !== id);
    db.tasks = db.tasks.filter((t) => t.calendarId !== id);
    this.save(db, "calendars");
  }
  async listEvents(from: number, to: number) {
    return this.load().events.filter((e) =>
      e.rrule ? e.start < to : e.start < to && e.end > from,
    );
  }
  async getEvent(id: Id) { return this.load().events.find((e) => e.id === id) ?? null; }
  async listAllEvents() { return this.load().events; }
  async deleteExceptionsFrom(seriesId: Id, from: number) {
    const db = this.load();
    db.events = db.events.filter((e) => !(e.seriesId === seriesId && (e.recurrenceId ?? 0) >= from));
    this.save(db, "events");
  }
  async setAlarms() {}
  async saveBulk(calendars: Calendar[], events: CalEvent[], tasks: Task[]) {
    const db = this.load();
    for (const c of calendars) db.calendars = this.upsert(db.calendars, c);
    for (const e of events) db.events = this.upsert(db.events, e);
    for (const t of tasks) db.tasks = this.upsert(db.tasks, t);
    this.save(db, "calendars");
  }
  pickIcs(): Promise<string | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".ics,text/calendar";
      input.onchange = () => {
        const f = input.files?.[0];
        if (!f) return resolve(null);
        void f.text().then(resolve);
      };
      input.click();
    });
  }
  // iCloud simulado en el navegador (para desarrollar y para las pruebas de interfaz).
  private fake = MockBackend.makeFake();
  static makeFake() {
    const f = new FakeCalDav();
    f.addCalendar("https://fake.icloud/123/calendars/home/", "Casa", "#FF2968");
    f.addCalendar("https://fake.icloud/123/calendars/work/", "Trabajo", "#FF9500");
    const day = new Date(Date.now() + 2 * 86_400_000);
    const ymd = `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, "0")}${String(day.getDate()).padStart(2, "0")}`;
    f.remotePut(
      "https://fake.icloud/123/calendars/home/ABC-IPHONE.ics",
      ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:ABC-IPHONE", "DTSTAMP:20261001T080000Z",
        `DTSTART;TZID=Europe/Madrid:${ymd}T170000`, `DTEND;TZID=Europe/Madrid:${ymd}T180000`,
        "SUMMARY:Dentista (desde el iPhone)", "END:VEVENT", "END:VCALENDAR"].join("\r\n"),
    );
    return f;
  }
  private syncDb(): SyncState {
    const st = this.load().settings.__sync as SyncState | undefined;
    return st ?? { links: [], items: [] };
  }
  async icloudConnect(appleId: string, password: string) {
    if (!/^[a-z]{4}-?[a-z]{4}-?[a-z]{4}-?[a-z]{4}$/i.test(password.replace(/\s/g, "")))
      throw new Error("iCloud ha rechazado el Apple ID o la contraseña. Usa una contraseña específica para apps (no la de tu Apple ID).");
    const account = { appleId, homeUrl: "https://fake.icloud/123/calendars/" };
    await this.setSetting("icloud", account);
    return account;
  }
  async icloudAccount() { return (this.load().settings.icloud as ICloudAccount | undefined) ?? null; }
  async icloudDisconnect() {
    const db = this.load();
    delete db.settings.icloud;
    delete db.settings.__sync;
    this.save(db, "settings");
  }
  icloudCalendars() { return this.fake.calendars(); }
  icloudListEtags(url: string, since?: number) { return this.fake.listEtags(url, since); }
  icloudFetch(url: string, hrefs: string[]) { return this.fake.fetch(url, hrefs); }
  icloudPut(href: string, data: string, etag: string | null) { return this.fake.put(href, data, etag); }
  icloudDelete(href: string, etag: string | null) { return this.fake.del(href, etag); }
  icloudMakeCalendar(name: string, color: string) { return this.fake.makeCalendar(name, color); }
  async syncState() { return structuredClone(this.syncDb()); }
  async syncCommit(c: SyncCommit) {
    const db = this.load();
    const st = (db.settings.__sync as SyncState | undefined) ?? { links: [], items: [] };
    for (const cal of c.saveCalendars ?? []) db.calendars = this.upsert(db.calendars, cal);
    for (const id of c.deleteLinkCalendarIds ?? []) st.links = st.links.filter((l) => l.calendarId !== id);
    for (const l of c.upsertLinks ?? []) st.links = [...st.links.filter((x) => x.calendarId !== l.calendarId), l];
    for (const id of c.deleteEventIds ?? []) db.events = db.events.filter((e) => e.id !== id);
    for (const e of c.saveEvents ?? []) db.events = this.upsert(db.events, e);
    for (const id of c.deleteItemIds ?? []) st.items = st.items.filter((i) => i.eventId !== id);
    for (const i of c.upsertItems ?? []) st.items = [...st.items.filter((x) => x.eventId !== i.eventId), i];
    db.settings.__sync = st;
    const touches = (c.saveEvents?.length ?? 0) + (c.deleteEventIds?.length ?? 0) + (c.saveCalendars?.length ?? 0) > 0;
    this.memory = db;
    if (touches) this.save(db, "calendars");
    else this.saveQuiet(db);
  }
  async takePendingIcs() { return null; }
  async onOpenIcs() { return () => {}; }
  async appInfo() { return { version: __APP_VERSION__, dataDir: "(navegador: localStorage)" }; }
  async openDataDir() {}
  async openQuickAdd() {
    this.channel?.postMessage("quickadd:");
  }
  async openTaskInMain(id: Id) {
    this.channel?.postMessage(`opentask:${id}`);
  }
  async onOpenTask(cb: (id: Id) => void) {
    const l = (e: MessageEvent) => String(e.data).startsWith("opentask:") && cb(String(e.data).slice(9));
    this.channel?.addEventListener("message", l);
    return () => this.channel?.removeEventListener("message", l);
  }
  async openApplePage(url: string) {
    window.open(url, "_blank", "noopener");
  }
  private saveQuiet(db: MockDb) {
    this.memory = db;
    if (!this.memoryOnly) {
      try {
        localStorage.setItem(this.key, JSON.stringify(db));
      } catch {
        /* en memoria */
      }
    }
  }
  async saveIcs(content: string, fileName: string) {
    const url = URL.createObjectURL(new Blob([content], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return fileName;
  }
  async saveEvent(e: CalEvent) { const db = this.load(); db.events = this.upsert(db.events, e); this.save(db, "events"); }
  async deleteEvent(id: Id) {
    const db = this.load();
    db.events = db.events.filter((e) => e.id !== id && e.seriesId !== id);
    this.save(db, "events");
  }
  async listTasks() { return this.load().tasks; }
  async saveTask(t: Task) { const db = this.load(); db.tasks = this.upsert(db.tasks, t); this.save(db, "tasks"); }
  async deleteTask(id: Id) { const db = this.load(); db.tasks = db.tasks.filter((t) => t.id !== id); this.save(db, "tasks"); }
  async getSettings() { return { ...this.load().settings }; }
  async setSetting(key: string, value: unknown) { const db = this.load(); db.settings[key] = value; this.save(db, "settings"); }
  async onChange(cb: (kind: string) => void) {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }
  async getWidgetConfig() { return { ...DEFAULT_WIDGET, ...(this.load().settings.widget as Partial<WidgetConfig> | undefined) }; }
  async setWidgetConfig(c: WidgetConfig) { await this.setSetting("widget", c); }
  async snapWidget(corner: Corner) {
    const c = await this.getWidgetConfig();
    await this.setWidgetConfig({ ...c, positionSet: true, x: corner.endsWith("l") ? 24 : 1440 - c.width - 24, y: corner.startsWith("t") ? 24 : 900 - c.height - 24 });
  }
  async listMonitors(): Promise<MonitorInfo[]> {
    return [{ name: "navegador", label: "Pantalla 1 (principal) — 1440×960", width: 1440, height: 960, scale: 2, primary: true }];
  }
  async openMain(day?: number) { this.channel?.postMessage(`navigate:${day ?? ""}`); }
  async getAutostart() { return Boolean(this.load().settings.autostart ?? true); }
  async setAutostart(enabled: boolean) { await this.setSetting("autostart", enabled); }
  async onNavigate(cb: (day: number) => void) {
    const l = (e: MessageEvent) => {
      const m = String(e.data).match(/^navigate:(\d*)$/);
      if (m && m[1]) cb(Number(m[1]));
    };
    this.channel?.addEventListener("message", l);
    return () => this.channel?.removeEventListener("message", l);
  }
  async onQuickAdd(cb: () => void) {
    const l = (e: MessageEvent) => e.data === "quickadd:" && cb();
    this.channel?.addEventListener("message", l);
    return () => this.channel?.removeEventListener("message", l);
  }
}

function browserBackend(): Backend {
  // /?demo arranca con datos de ejemplo en memoria (no toca lo guardado en localStorage).
  const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
  if (params?.has("demo")) {
    // ?demo&layout=today para ver el widget en modo "Hoy y mañana"
    const layout = params.get("layout") === "today" ? "today" : "week";
    return new MockBackend({ ...demoData(), settings: { widget: { ...DEFAULT_WIDGET, layout } } });
  }
  return new MockBackend();
}

export const backend: Backend = isTauri() ? new TauriBackend() : browserBackend();

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
