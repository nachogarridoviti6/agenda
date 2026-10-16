/**
 * Sincronización bidireccional con iCloud (CalDAV).
 *
 * Modelo: cada serie o evento local ↔ un recurso .ics remoto (con sus excepciones dentro).
 * Por cada recurso se guarda (sync_items) href, ETag, UID, el .ics remoto y la "versión" local
 * (el updatedAt más alto de la serie y sus excepciones) del momento de la última sincronización.
 *
 * - Remoto cambió (ETag distinta) y local no → se baja.
 * - Local cambió (versión mayor) y remoto no → se sube (PUT con If-Match).
 * - Los dos → gana el más reciente (LAST-MODIFIED remoto vs. versión local) y se avisa.
 * - Borrado en un lado → se borra en el otro (si el otro no lo había cambiado).
 * - Las tareas no se sincronizan (Apple no da acceso a Recordatorios por CalDAV).
 */
import type { CalEvent, Calendar, Id } from "./types";
import { exportIcs, importIcs, preservedFrom } from "./ics";
import { expandRule, parseRRule } from "./rrule";

/** Solo se sincroniza desde hace un año: evita descargar años de historial cada vez. */
export const SYNC_WINDOW_MS = 365 * 86_400_000;

export interface RemoteCalendar {
  url: string;
  name: string;
  color: string | null;
  ctag: string | null;
  supportsEvents: boolean;
}
export interface ETagItem {
  href: string;
  etag: string;
}
export interface Resource extends ETagItem {
  data: string;
}
export interface SyncLink {
  calendarId: Id;
  url: string;
  ctag: string | null;
}
export interface SyncItem {
  eventId: Id;
  calendarId: Id;
  href: string;
  etag: string;
  uid: string;
  raw: string;
  syncedVersion: number;
  readonly: boolean;
}
export interface SyncState {
  links: SyncLink[];
  items: SyncItem[];
}
export interface SyncCommit {
  saveCalendars?: Calendar[];
  upsertLinks?: SyncLink[];
  deleteLinkCalendarIds?: Id[];
  saveEvents?: CalEvent[];
  deleteEventIds?: Id[];
  upsertItems?: SyncItem[];
  deleteItemIds?: Id[];
}

export interface Transport {
  calendars(): Promise<RemoteCalendar[]>;
  /** Con `since` (UTC ms), solo los eventos con alguna aparición desde esa fecha. */
  listEtags(url: string, since?: number): Promise<ETagItem[]>;
  fetch(url: string, hrefs: string[]): Promise<Resource[]>;
  put(href: string, data: string, etag: string | null): Promise<string | null>;
  del(href: string, etag: string | null): Promise<void>;
}

export interface LocalStore {
  state(): Promise<SyncState>;
  calendars(): Promise<Calendar[]>;
  allEvents(): Promise<CalEvent[]>;
  commit(c: SyncCommit): Promise<void>;
}

export interface SyncReport {
  pulled: number;
  pushed: number;
  deletedLocal: number;
  deletedRemote: number;
  conflicts: string[];
  /** Cambios locales en eventos de solo lectura (invitaciones…) que no se han subido. */
  skippedReadonly: string[];
  errors: string[];
  /** Calendarios enlazados que ya no existen en iCloud (se han desenlazado). */
  unlinked: string[];
}

const emptyReport = (): SyncReport => ({ pulled: 0, pushed: 0, deletedLocal: 0, deletedRemote: 0, conflicts: [], skippedReadonly: [], errors: [], unlinked: [] });

/** Versión local de una serie/evento: su updatedAt más alto contando las excepciones. */
function versionOf(master: CalEvent, exceptions: CalEvent[]): number {
  return Math.max(master.updatedAt, ...exceptions.map((e) => e.updatedAt));
}

const hrefFor = (calUrl: string, id: Id) => `${calUrl.replace(/\/?$/, "/")}${encodeURIComponent(id)}.ics`;

export async function syncAll(t: Transport, store: LocalStore, now = Date.now()): Promise<SyncReport> {
  const report = emptyReport();
  const state = await store.state();
  if (!state.links.length) return report;
  const calendars = await store.calendars();
  const calName = (id: Id) => calendars.find((c) => c.id === id)?.name ?? "?";
  let remoteCals: RemoteCalendar[];
  try {
    remoteCals = await t.calendars();
  } catch (e) {
    report.errors.push(String(e));
    return report;
  }

  const all = await store.allEvents();
  const byId = new Map(all.map((e) => [e.id, e]));
  const exceptionsOf = new Map<Id, CalEvent[]>();
  for (const e of all) if (e.seriesId) exceptionsOf.set(e.seriesId, [...(exceptionsOf.get(e.seriesId) ?? []), e]);
  const linkByCal = new Map(state.links.map((l) => [l.calendarId, l]));
  const itemsById = new Map(state.items.map((i) => [i.eventId, i]));

  // Enlaces a calendarios que ya no existen en iCloud: se desenlazan sin tocar los eventos locales.
  for (const l of state.links) {
    if (!remoteCals.some((r) => r.url === l.url)) {
      report.unlinked.push(calName(l.calendarId));
      await store.commit({ deleteLinkCalendarIds: [l.calendarId], deleteItemIds: state.items.filter((i) => i.calendarId === l.calendarId).map((i) => i.eventId) });
      linkByCal.delete(l.calendarId);
      for (const i of state.items) if (i.calendarId === l.calendarId) itemsById.delete(i.eventId);
    }
  }

  // Recursos cuyo calendario local ya no está enlazado (se borró o desenlazó): se olvidan sin borrar en iCloud.
  const orphanItems = [...itemsById.values()].filter((i) => !linkByCal.has(i.calendarId) && !(byId.get(i.eventId) && linkByCal.has(byId.get(i.eventId)!.calendarId)));
  if (orphanItems.length) {
    await store.commit({ deleteItemIds: orphanItems.map((i) => i.eventId) });
    for (const i of orphanItems) itemsById.delete(i.eventId);
  }

  // Todos los calendarios a la vez.
  const ctx = { all, byId, exceptionsOf, itemsById, linkByCal, calendars, since: now - SYNC_WINDOW_MS };
  await Promise.all(
    [...linkByCal.values()].map((link) =>
      syncCalendar(t, store, link, remoteCals.find((r) => r.url === link.url)!, ctx, report, now).catch((e) => {
        report.errors.push(`${calName(link.calendarId)}: ${String(e)}`);
      }),
    ),
  );
  return report;
}

interface Ctx {
  all: CalEvent[];
  byId: Map<Id, CalEvent>;
  exceptionsOf: Map<Id, CalEvent[]>;
  itemsById: Map<Id, SyncItem>;
  linkByCal: Map<Id, SyncLink>;
  calendars: Calendar[];
  since: number;
}

/** ¿Tiene el evento (o su serie) alguna aparición desde `since`? Si no, iCloud no lo lista por la ventana de fechas. */
function inWindow(e: CalEvent, since: number): boolean {
  if (e.end >= since) return true;
  const rule = parseRRule(e.rrule);
  if (!rule) return false;
  if (rule.until == null && rule.count == null) return true;
  return expandRule(rule, { ...e, exdates: [] }, since, Number.MAX_SAFE_INTEGER).length > 0;
}

async function syncCalendar(t: Transport, store: LocalStore, link: SyncLink, remote: RemoteCalendar, ctx: Ctx, report: SyncReport, now: number) {
  const masters = ctx.all.filter((e) => e.calendarId === link.calendarId && !e.seriesId);
  const items = [...ctx.itemsById.values()].filter((i) => i.calendarId === link.calendarId);
  const itemOf = (id: Id) => ctx.itemsById.get(id);

  const localChanged = (m: CalEvent) => {
    const it = itemOf(m.id);
    return !it || it.calendarId !== link.calendarId || versionOf(m, ctx.exceptionsOf.get(m.id) ?? []) > it.syncedVersion;
  };
  const hasLocalWork =
    masters.some(localChanged) ||
    items.some((i) => {
      const ev = ctx.byId.get(i.eventId);
      return !ev || ev.calendarId !== link.calendarId;
    });
  if (!hasLocalWork && link.ctag != null && link.ctag === remote.ctag) return; // nada nuevo en ningún lado

  const commit: Required<SyncCommit> = { saveCalendars: [], upsertLinks: [], deleteLinkCalendarIds: [], saveEvents: [], deleteEventIds: [], upsertItems: [], deleteItemIds: [] };
  const etags = new Map((await t.listEtags(link.url, ctx.since)).map((x) => [x.href, x.etag]));
  const byHref = new Map(items.map((i) => [i.href, i]));
  const toFetch: string[] = [];
  const pushAfter = new Map<Id, string>(); // id → ETag remota con la que hacer If-Match

  // 1) Lo que ha cambiado o desaparecido en iCloud
  for (const it of items) {
    const ev = ctx.byId.get(it.eventId);
    const remoteEtag = etags.get(it.href);
    // Lo movieron aquí a otro calendario: lo gestiona la sincronización de ese calendario.
    if (ev && ev.calendarId !== link.calendarId) continue;
    // Fuera de la ventana de fechas: iCloud no lo lista, pero no está borrado.
    if (remoteEtag == null && ev && !inWindow(ev, ctx.since)) continue;
    if (remoteEtag == null) {
      // Borrado en iCloud. Si aquí se cambió desde entonces, se vuelve a crear; si no, se borra aquí.
      if (ev && ev.calendarId === link.calendarId && localChanged(ev)) {
        report.conflicts.push(`«${ev.title}» se borró en iCloud pero lo habías cambiado aquí: se ha vuelto a subir.`);
        commit.deleteItemIds.push(it.eventId);
        ctx.itemsById.delete(it.eventId);
      } else {
        if (ev) {
          commit.deleteEventIds.push(ev.id);
          report.deletedLocal++;
        }
        commit.deleteItemIds.push(it.eventId);
        ctx.itemsById.delete(it.eventId);
      }
    } else if (remoteEtag !== it.etag) toFetch.push(it.href);
  }
  for (const href of etags.keys()) if (!byHref.has(href)) toFetch.push(href);

  // 2) Bajar lo nuevo o cambiado
  if (toFetch.length) {
    for (const res of await t.fetch(link.url, toFetch)) {
      let parsed;
      try {
        parsed = importIcs(res.data, now);
      } catch {
        continue;
      }
      const master = parsed.events.find((e) => !e.seriesId);
      if (!master) continue;
      const uid = parsed.uids.get(master.id) ?? master.id;
      const local = ctx.byId.get(master.id);
      const existing = byHref.get(res.href) ?? itemOf(master.id);
      if (local && existing && localChanged(local) && !existing.readonly) {
        const remoteTime = parsed.modified.get(master.id) ?? 0;
        const localTime = versionOf(local, ctx.exceptionsOf.get(local.id) ?? []);
        if (localTime > remoteTime) {
          report.conflicts.push(`«${local.title}» cambió en los dos sitios: se queda la versión de este PC (más reciente).`);
          // Se sube después con la ETag nueva y el .ics remoto como base.
          ctx.itemsById.set(master.id, { ...existing, etag: res.etag, raw: res.data });
          pushAfter.set(master.id, res.etag);
          continue;
        }
        report.conflicts.push(`«${local.title}» cambió en los dos sitios: se queda la versión de iCloud (más reciente).`);
      }
      const incoming = parsed.events.map((e) => ({
        ...e,
        calendarId: link.calendarId,
        createdAt: ctx.byId.get(e.id)?.createdAt ?? now,
        updatedAt: now,
      }));
      const incomingIds = new Set(incoming.map((e) => e.id));
      for (const old of ctx.exceptionsOf.get(master.id) ?? []) if (!incomingIds.has(old.id)) commit.deleteEventIds.push(old.id);
      commit.saveEvents.push(...incoming);
      const item: SyncItem = {
        eventId: master.id,
        calendarId: link.calendarId,
        href: res.href,
        etag: res.etag,
        uid,
        raw: res.data,
        syncedVersion: now,
        readonly: parsed.lossy.has(master.id),
      };
      commit.upsertItems.push(item);
      ctx.itemsById.set(master.id, item);
      report.pulled++;
    }
  }
  const pulledIds = new Set(commit.saveEvents.map((e) => e.id));
  const removedHere = new Set(commit.deleteEventIds);

  // 3) Subir lo creado o cambiado aquí
  const missingEtags: SyncItem[] = [];
  for (const m of masters) {
    if (pulledIds.has(m.id) || removedHere.has(m.id)) continue;
    const it = ctx.itemsById.get(m.id);
    const exceptions = ctx.exceptionsOf.get(m.id) ?? [];
    const version = versionOf(m, exceptions);
    const moved = it && it.calendarId !== link.calendarId;
    if (it && !moved && version <= it.syncedVersion && !pushAfter.has(m.id)) continue;
    if (it?.readonly && !moved) {
      report.skippedReadonly.push(m.title);
      continue;
    }
    if (moved && it) {
      // Viene de otro calendario: se borra allí y se crea aquí.
      await t.del(it.href, it.etag);
      report.deletedRemote++;
    }
    const create = !it || moved;
    const uid = it?.uid ?? `${m.id}@agenda`;
    const href = create ? hrefFor(link.url, m.id) : it!.href;
    const { preserve, sequence } = create || !it ? { preserve: new Map(), sequence: 0 } : preservedFrom(it.raw);
    const data = exportIcs({ events: [m, ...exceptions], calendars: ctx.calendars, uids: new Map([[m.id, uid]]), preserve, sequence, now });
    let etag: string | null;
    try {
      etag = await t.put(href, data, create ? null : (pushAfter.get(m.id) ?? it!.etag));
    } catch (e) {
      report.errors.push(`«${m.title}»: ${String(e)}`);
      continue;
    }
    const item: SyncItem = { eventId: m.id, calendarId: link.calendarId, href, etag: etag ?? "", uid, raw: data, syncedVersion: version, readonly: false };
    if (!etag) missingEtags.push(item);
    commit.upsertItems.push(item);
    ctx.itemsById.set(m.id, item);
    report.pushed++;
  }

  // 4) Borrados aquí → borrar en iCloud
  for (const it of items) {
    if (!ctx.itemsById.has(it.eventId) || commit.deleteItemIds.includes(it.eventId)) continue;
    const ev = ctx.byId.get(it.eventId);
    if (ev) continue;
    if (it.readonly) {
      report.skippedReadonly.push("(evento borrado)");
    } else {
      await t.del(it.href, it.etag);
      report.deletedRemote++;
    }
    commit.deleteItemIds.push(it.eventId);
    ctx.itemsById.delete(it.eventId);
  }

  // iCloud no siempre devuelve la ETag tras un PUT: se pregunta una vez.
  if (missingEtags.length) {
    const fresh = new Map((await t.listEtags(link.url, ctx.since)).map((x) => [x.href, x.etag]));
    for (const it of missingEtags) it.etag = fresh.get(it.href) ?? "";
  }

  // Si hemos escrito, el ctag nuevo incluye nuestros cambios y quizá otros: se vuelve a listar la próxima vez.
  const wrote = report.pushed > 0 || report.deletedRemote > 0;
  commit.upsertLinks.push({ ...link, ctag: wrote ? null : remote.ctag });
  await store.commit(commit);
}
