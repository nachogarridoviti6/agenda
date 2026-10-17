import { useEffect, useMemo, useState } from "react";
import { useStore } from "./store";
import { useAlarmScheduler, useApplyTheme, useCloudSync, useKeyboardShortcuts } from "./hooks";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { TimeGrid } from "./components/TimeGrid";
import { MonthView } from "./components/MonthView";
import { EventEditor } from "./components/EventEditor";
import { TaskEditor } from "./components/TaskEditor";
import { CalendarEditor } from "./components/CalendarEditor";
import { SettingsModal } from "./components/SettingsModal";
import { YearView } from "./components/YearView";
import { QuickAdd } from "./components/QuickAdd";
import { ScopeDialog } from "./components/ScopeDialog";
import { Welcome } from "./components/Welcome";
import { PendingIcsImport } from "./components/ImportExport";
import { applyHolidays, HOLIDAYS_CALENDAR_ID } from "./components/HolidaysSection";
import { backend } from "./lib/backend";
import { startOfDayZ, weekDays } from "./lib/dates";

export function App() {
  const ready = useStore((s) => s.ready);
  const view = useStore((s) => s.view);
  const cursor = useStore((s) => s.cursor);
  const editor = useStore((s) => s.editor);
  const error = useStore((s) => s.error);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const [settings, setSettings] = useState(false);
  const quickAdd = useStore((s) => s.quickAddOpen);
  const days = useMemo(() => weekDays(cursor), [cursor]);
  const oneDay = useMemo(() => [startOfDayZ(cursor)], [cursor]);

  useApplyTheme();
  useKeyboardShortcuts();
  useAlarmScheduler();
  useCloudSync();
  useEffect(() => void useStore.getState().init(), []);
  // Año nuevo: renovar los festivos (este año y el siguiente) si el calendario existe.
  useEffect(() => {
    if (!ready) return;
    void backend.getSettings().then((s) => {
      const year = new Date().getFullYear();
      if (typeof s.holidaysYear === "number" && s.holidaysYear < year && useStore.getState().calendars.some((c) => c.id === HOLIDAYS_CALENDAR_ID))
        void applyHolidays((s.holidayRegion as string | null) ?? null);
    });
  }, [ready]);

  if (!ready) return <div className="loading">{error ?? ""}</div>;

  return (
    <div className={`app ${sidebarOpen ? "" : "no-sidebar"}`}>
      {sidebarOpen && <Sidebar onSettings={() => setSettings(true)} />}
      <main className="main">
        <Toolbar />
        <div className="view">
          {view === "month" ? <MonthView /> : view === "year" ? <YearView /> : <TimeGrid key={view} days={view === "day" ? oneDay : days} />}
        </div>
      </main>

      {editor?.kind === "event" && <EventEditor key={`${editor.event.id}@${editor.occStart ?? ""}`} event={editor.event} isNew={editor.isNew} isOccurrence={editor.master != null} />}
      {editor?.kind === "task" && <TaskEditor key={editor.task.id} task={editor.task} isNew={editor.isNew} />}
      {editor?.kind === "calendar" && <CalendarEditor key={editor.calendar.id} calendar={editor.calendar} isNew={editor.isNew} />}
      {settings && <SettingsModal onClose={() => setSettings(false)} />}
      {quickAdd && <QuickAdd />}
      <ScopeDialog />
      <PendingIcsImport />
      <Welcome />

      {error && (
        <div className="toast" role="alert" onClick={() => useStore.setState({ error: null })}>
          {error}
        </div>
      )}
    </div>
  );
}
