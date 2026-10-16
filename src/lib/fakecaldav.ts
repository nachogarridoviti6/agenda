import type { RemoteCalendar, Resource, Transport } from "./sync";

/** iCloud de mentira, en memoria: para los tests y para probar la interfaz en el navegador. */
export class FakeCalDav implements Transport {
  cals = new Map<string, { name: string; color: string; ctag: number; items: Map<string, { etag: string; data: string }> }>();
  private n = 0;
  log: string[] = [];
  /** Si es true, PUT no devuelve ETag (iCloud a veces no la manda). */
  omitPutEtag = false;

  addCalendar(url: string, name: string, color = "#FF2968") {
    this.cals.set(url, { name, color, ctag: 1, items: new Map() });
    return url;
  }
  private cal(url: string) {
    const c = this.cals.get(url);
    if (!c) throw new Error("404");
    return c;
  }
  private calOfHref(href: string) {
    const url = href.slice(0, href.lastIndexOf("/") + 1);
    return { url, cal: this.cal(url) };
  }
  /** Simula un cambio hecho desde el iPhone. */
  remotePut(href: string, data: string) {
    const { cal } = this.calOfHref(href);
    cal.items.set(href, { etag: `"${++this.n}"`, data });
    cal.ctag++;
  }
  remoteDelete(href: string) {
    const { cal } = this.calOfHref(href);
    cal.items.delete(href);
    cal.ctag++;
  }

  async calendars(): Promise<RemoteCalendar[]> {
    return [...this.cals].map(([url, c]) => ({ url, name: c.name, color: c.color, ctag: String(c.ctag), supportsEvents: true }));
  }
  /** Con `since` imita el filtro de fechas del servidor: excluye eventos sueltos que terminaron antes. */
  async listEtags(url: string, since?: number) {
    this.log.push(`LIST ${url}`);
    return [...this.cal(url).items]
      .filter(([, v]) => since == null || /RRULE:/.test(v.data) || endOf(v.data) >= since)
      .map(([href, v]) => ({ href, etag: v.etag }));
  }
  async fetch(url: string, hrefs: string[]): Promise<Resource[]> {
    this.log.push(`GET ${hrefs.length}`);
    const c = this.cal(url);
    return hrefs.flatMap((h) => {
      const v = c.items.get(h);
      return v ? [{ href: h, ...v }] : [];
    });
  }
  async put(href: string, data: string, etag: string | null) {
    this.log.push(`PUT ${href}`);
    const { cal } = this.calOfHref(href);
    const cur = cal.items.get(href);
    if (etag == null && cur) throw new Error("412 ya existe");
    if (etag != null && (!cur || cur.etag !== etag)) throw new Error("412 El evento ha cambiado en iCloud mientras tanto.");
    const next = `"${++this.n}"`;
    cal.items.set(href, { etag: next, data });
    cal.ctag++;
    return this.omitPutEtag ? null : next;
  }
  async del(href: string, etag: string | null) {
    this.log.push(`DELETE ${href}`);
    const { cal } = this.calOfHref(href);
    const cur = cal.items.get(href);
    if (cur && etag && cur.etag !== etag) throw new Error("412");
    cal.items.delete(href);
    cal.ctag++;
  }
  async makeCalendar(name: string, color: string) {
    const url = `https://fake.icloud/123/calendars/agenda-${++this.n}/`;
    this.addCalendar(url, name, color);
    return url;
  }
}

/** Fin (UTC ms) del primer VEVENT, de forma aproximada (para el filtro de fechas del simulador). */
function endOf(data: string): number {
  const m = data.match(/DTEND[^:\r\n]*:(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 23), +(m[5] ?? 59));
}
