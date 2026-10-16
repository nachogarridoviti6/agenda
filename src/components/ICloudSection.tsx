import { useEffect, useState, type CSSProperties } from "react";
import { useStore } from "../store";
import { useCloud, transport } from "../cloud";
import { backend, newId } from "../lib/backend";
import type { RemoteCalendar, SyncLink } from "../lib/sync";
import { fmt } from "../lib/dates";
import { Row } from "./fields";
import { APPLE_APP_PASSWORDS_URL, checkAppPassword, formatAppPassword } from "../lib/applepw";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

function ago(ms: number | null): string {
  if (!ms) return "nunca";
  const m = Math.round((Date.now() - ms) / 60_000);
  if (m < 1) return "ahora mismo";
  if (m < 60) return `hace ${m} min`;
  return `a las ${fmt(ms, "H:mm")}`;
}

/** Ajustes → iCloud: conectar la cuenta y elegir qué calendarios se sincronizan con cuál. */
export function ICloudSection() {
  const { account, syncing, lastSync, lastReport, error } = useCloud();
  const calendars = useStore((s) => s.calendars);
  const [appleId, setAppleId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemoteCalendar[] | null>(null);
  const [links, setLinks] = useState<SyncLink[]>([]);

  const loadLinks = async () => {
    setLinks((await backend.syncState()).links);
    try {
      setRemote((await transport.calendars()).filter((c) => c.supportsEvents));
    } catch (e) {
      setFormError(String(e));
    }
  };
  const connectedId = account?.appleId;
  useEffect(() => {
    if (connectedId) void loadLinks();
  }, [connectedId]);

  const connect = async () => {
    setBusy(true);
    setFormError(null);
    try {
      const c = checkAppPassword(password);
      await backend.icloudConnect(appleId.trim(), c.ok ? c.value : password);
      setPassword("");
      await useCloud.getState().refresh();
      // Enlaza automáticamente los calendarios que se llaman igual en los dos lados.
      const rc = (await transport.calendars()).filter((c) => c.supportsEvents);
      const auto = calendars
        .map((c) => ({ c, r: rc.find((r) => norm(r.name) === norm(c.name)) }))
        .filter((x): x is { c: (typeof calendars)[number]; r: RemoteCalendar } => !!x.r)
        .map(({ c, r }) => ({ calendarId: c.id, url: r.url, ctag: null }));
      if (auto.length) await backend.syncCommit({ upsertLinks: auto });
      await loadLinks();
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      setFormError(
        /rechazado|401/.test(msg)
          ? "Apple no ha aceptado el Apple ID o el código. Comprueba que el Apple ID está bien escrito y que has copiado el código entero; si no, crea otro en el paso 2."
          : msg,
      );
    } finally {
      setBusy(false);
    }
  };

  const linkFor = (url: string) => links.find((l) => l.url === url);
  const setLink = async (r: RemoteCalendar, value: string) => {
    const old = linkFor(r.url);
    const st = await backend.syncState();
    const dropItems = old ? st.items.filter((i) => i.calendarId === old.calendarId).map((i) => i.eventId) : [];
    if (value === "") {
      await backend.syncCommit({ deleteLinkCalendarIds: old ? [old.calendarId] : [], deleteItemIds: dropItems });
    } else if (value === "new") {
      const cal = { id: newId(), name: r.name, color: r.color ?? "#5856D6", visible: true, sortOrder: Math.max(-1, ...calendars.map((c) => c.sortOrder)) + 1 };
      await backend.syncCommit({ saveCalendars: [cal], deleteLinkCalendarIds: old ? [old.calendarId] : [], deleteItemIds: dropItems, upsertLinks: [{ calendarId: cal.id, url: r.url, ctag: null }] });
    } else {
      const taken = links.find((l) => l.calendarId === value);
      await backend.syncCommit({
        deleteLinkCalendarIds: [...(old ? [old.calendarId] : []), ...(taken ? [taken.calendarId] : [])],
        deleteItemIds: dropItems,
        upsertLinks: [{ calendarId: value, url: r.url, ctag: null }],
      });
    }
    await loadLinks();
    await useCloud.getState().refresh();
    void useCloud.getState().sync();
  };

  const createInICloud = async (calendarId: string) => {
    const cal = calendars.find((c) => c.id === calendarId);
    if (!cal) return;
    setBusy(true);
    try {
      const url = await backend.icloudMakeCalendar(cal.name, cal.color);
      await backend.syncCommit({ upsertLinks: [{ calendarId: cal.id, url, ctag: null }] });
      await loadLinks();
      await useCloud.getState().refresh();
      void useCloud.getState().sync();
    } catch (e) {
      setFormError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    await backend.icloudDisconnect();
    setRemote(null);
    setLinks([]);
    await useCloud.getState().refresh();
  };

  if (!account) {
    const check = checkAppPassword(password);
    const validId = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(appleId.trim());
    return (
      <div className="wizard">
        <p className="wizard-intro">
          Apple no deja que otras apps usen tu contraseña normal de iCloud. Se crea <b>una vez</b> un código solo para Agenda
          (así puedes quitarle el acceso cuando quieras sin cambiar tu contraseña). Tarda un minuto:
        </p>

        <div className="wizard-step">
          <span className="wizard-num">1</span>
          <div className="wizard-body">
            <b>Tu Apple ID</b>
            <input className="text-input wide" type="email" placeholder="tu@icloud.com" value={appleId} onChange={(e) => setAppleId(e.target.value)} aria-label="Apple ID" autoComplete="username" />
          </div>
        </div>

        <div className="wizard-step">
          <span className="wizard-num">2</span>
          <div className="wizard-body">
            <b>Crea el código en la web de Apple</b>
            <button className="btn small" onClick={() => void backend.openApplePage(APPLE_APP_PASSWORDS_URL)}>Abrir la página de Apple ↗</button>
            <ol className="wizard-list">
              <li>Inicia sesión con tu Apple ID (te llegará un código al iPhone).</li>
              <li>Entra en <b>Contraseñas específicas para apps</b>.</li>
              <li>Pulsa <b>+</b>, escribe <b>Agenda</b> como nombre y pulsa <b>Crear</b>.</li>
              <li>Copia el código que aparece (<span className="mono">abcd-efgh-ijkl-mnop</span>).</li>
            </ol>
          </div>
        </div>

        <div className="wizard-step">
          <span className="wizard-num">3</span>
          <div className="wizard-body">
            <b>Pega el código aquí</b>
            <div className="wizard-code">
              <input
                className={`text-input wide mono ${check.ok ? "is-ok" : ""}`}
                placeholder="abcd-efgh-ijkl-mnop"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData("text");
                  const c = checkAppPassword(pasted);
                  if (c.ok) {
                    e.preventDefault();
                    setPassword(c.value);
                  }
                }}
                onBlur={() => check.ok || !/^[a-z\s-]*$/i.test(password) || setPassword(formatAppPassword(password))}
                aria-label="Contraseña específica para apps"
                autoComplete="off"
                spellCheck={false}
              />
              {check.ok && <span className="wizard-ok" aria-label="Código válido">✓</span>}
            </div>
            {!check.ok && check.reason === "looks-like-normal-password" && (
              <span className="f-error-inline f-small">Esto parece tu contraseña normal. Apple pide el código de 16 letras del paso 2.</span>
            )}
            {!check.ok && check.reason === "incomplete" && <span className="f-muted f-small">Faltan letras: el código tiene 16.</span>}
          </div>
        </div>

        {formError && <p className="f-error">{formError}</p>}
        <p className="f-help">
          El código se guarda cifrado en el Administrador de credenciales de Windows y no se vuelve a pedir. Se sincronizan los eventos; las tareas se quedan en este PC.
        </p>
        <div className="f-actions">
          <span className="spacer" />
          <button className="btn primary" disabled={busy || !validId || !check.ok} onClick={() => void connect()}>
            {busy ? "Conectando…" : "Conectar con iCloud"}
          </button>
        </div>
      </div>
    );
  }

  const linkedLocal = new Set(links.map((l) => l.calendarId));
  const unlinkedLocal = calendars.filter((c) => !linkedLocal.has(c.id));
  return (
    <>
      <div className="f-group">
        <Row label="Cuenta">
          <span className="f-muted">{account.appleId}</span>
        </Row>
        <Row label="Última sincronización">
          <span className={error ? "f-error-inline" : "f-muted"}>{syncing ? "Sincronizando…" : ago(lastSync)}</span>
          <button className="btn small" disabled={syncing} onClick={() => void useCloud.getState().sync()}>Sincronizar ahora</button>
        </Row>
      </div>
      {error && <p className="f-error">{error}</p>}
      {lastReport && (lastReport.conflicts.length > 0 || lastReport.skippedReadonly.length > 0 || lastReport.unlinked.length > 0) && (
        <div className="f-help">
          {lastReport.conflicts.map((c) => <div key={c}>⚠️ {c}</div>)}
          {lastReport.skippedReadonly.length > 0 && <div>🔒 No se han subido cambios en invitaciones de iCloud: {lastReport.skippedReadonly.join(", ")}.</div>}
          {lastReport.unlinked.map((n) => <div key={n}>ℹ️ El calendario de iCloud enlazado con «{n}» ya no existe; se ha desenlazado.</div>)}
        </div>
      )}

      <div className="f-section">Calendarios de iCloud</div>
      <div className="f-group">
        {remote == null && <Row label="Cargando…"><span /></Row>}
        {remote?.map((r) => (
          <Row key={r.url} label={r.name}>
            <span className="dot" style={{ "--c": r.color ?? "#999" } as CSSProperties} />
            <select value={linkFor(r.url)?.calendarId ?? ""} onChange={(e) => void setLink(r, e.target.value)} aria-label={`Sincronizar ${r.name} con`}>
              <option value="">No sincronizar</option>
              <option value="new">Crear calendario «{r.name}»</option>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>↔ {c.name}</option>
              ))}
            </select>
          </Row>
        ))}
      </div>
      {unlinkedLocal.length > 0 && (
        <>
          <div className="f-section">Subir a iCloud</div>
          <div className="f-group">
            {unlinkedLocal.map((c) => (
              <Row key={c.id} label={c.name}>
                <button className="btn small" disabled={busy} onClick={() => void createInICloud(c.id)}>Crear en iCloud</button>
              </Row>
            ))}
          </div>
          <p className="f-help">Crea el calendario en iCloud con sus eventos; aparecerá en el iPhone en unos minutos.</p>
        </>
      )}
      <div className="f-actions">
        <button className="btn danger" onClick={() => void disconnect()}>Desconectar iCloud</button>
        <span className="f-muted f-small">Los eventos se quedan en este PC.</span>
      </div>
    </>
  );
}
