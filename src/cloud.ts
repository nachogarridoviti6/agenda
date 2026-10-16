import { create } from "zustand";
import { backend, type ICloudAccount } from "./lib/backend";
import { syncAll, type LocalStore, type SyncReport, type Transport } from "./lib/sync";

/** Estado de la sincronización con iCloud (lo usan Ajustes, la barra lateral y el editor). */
interface CloudState {
  account: ICloudAccount | null;
  syncing: boolean;
  lastSync: number | null;
  lastReport: SyncReport | null;
  error: string | null;
  /** Eventos que vienen de iCloud y no se pueden editar desde aquí (invitaciones…). */
  readonlyIds: Set<string>;
  /** Calendarios locales enlazados con iCloud. */
  linkedIds: Set<string>;
  refresh(): Promise<void>;
  sync(): Promise<SyncReport | null>;
}

export const transport: Transport = {
  calendars: () => backend.icloudCalendars().then((cs) => cs.map((c) => ({ ...c, color: c.color ?? null, ctag: c.ctag ?? null }))),
  listEtags: (url, since) => backend.icloudListEtags(url, since),
  fetch: (url, hrefs) => backend.icloudFetch(url, hrefs),
  put: (href, data, etag) => backend.icloudPut(href, data, etag),
  del: (href, etag) => backend.icloudDelete(href, etag),
};

const localStore: LocalStore = {
  state: () => backend.syncState(),
  calendars: () => backend.listCalendars(),
  allEvents: () => backend.listAllEvents(),
  commit: (c) => backend.syncCommit(c),
};

let running: Promise<SyncReport | null> | null = null;
/** Hasta cuándo ignorar los avisos de cambios (los provoca la propia sincronización). */
export let ignoreChangesUntil = 0;

export const useCloud = create<CloudState>((set, get) => ({
  account: null,
  syncing: false,
  lastSync: null,
  lastReport: null,
  error: null,
  readonlyIds: new Set(),
  linkedIds: new Set(),

  async refresh() {
    try {
      const [account, st] = await Promise.all([backend.icloudAccount(), backend.syncState()]);
      const prev = get().account;
      set({
        // Mismo objeto si no ha cambiado, para no relanzar efectos que dependen de la cuenta.
        account: prev && account && prev.appleId === account.appleId && prev.homeUrl === account.homeUrl ? prev : account,
        readonlyIds: new Set(st.items.filter((i) => i.readonly).map((i) => i.eventId)),
        linkedIds: new Set(st.links.map((l) => l.calendarId)),
      });
    } catch {
      /* sin backend de iCloud */
    }
  },

  sync() {
    if (running) return running;
    if (!get().account) return Promise.resolve(null);
    set({ syncing: true });
    running = (async () => {
      try {
        const report = await Promise.race([
          syncAll(transport, localStore),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("iCloud está tardando demasiado. Se volverá a intentar en unos minutos.")), 120_000),
          ),
        ]);
        ignoreChangesUntil = Date.now() + 2000;
        set({ lastSync: Date.now(), lastReport: report, error: report.errors[0] ?? null });
        return report;
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) });
        return null;
      } finally {
        set({ syncing: false });
        running = null;
        await get().refresh();
      }
    })();
    return running;
  },
}));
