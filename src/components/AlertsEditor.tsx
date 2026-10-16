import { ALERT_OPTIONS } from "../lib/alarms";
import { Row } from "./fields";

/** Hasta dos alertas, como en Apple Calendar. */
export function AlertsEditor({ alerts, allDay, onChange }: { alerts: number[]; allDay: boolean; onChange(a: number[]): void }) {
  const options = ALERT_OPTIONS.filter((o) => !allDay || o.value >= 1440 || o.value === 0).map((o) =>
    allDay && o.value === 0 ? { ...o, label: "El mismo día (9:00)" } : allDay && o.value >= 1440 ? { ...o, label: `${o.label} (9:00)` } : o,
  );
  const select = (idx: number, label: string) => (
    <Row label={label}>
      <select
        value={alerts[idx] ?? "none"}
        onChange={(e) => {
          const next = [...alerts];
          if (e.target.value === "none") next.splice(idx, 1);
          else next[idx] = Number(e.target.value);
          onChange([...new Set(next)]);
        }}
        aria-label={label}
      >
        <option value="none">Ninguna</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Row>
  );
  return (
    <>
      {select(0, "Alerta")}
      {alerts.length >= 1 && select(1, "Segunda alerta")}
    </>
  );
}
