import { useEffect, useMemo, useState } from "react";
import { useStore } from "./store";
import { useApplyTheme, useKeyboardShortcuts } from "./hooks";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { TimeGrid } from "./components/TimeGrid";
import { MonthView } from "./components/MonthView";
import { EventEditor } from "./components/EventEditor";
import { TaskEditor } from "./components/TaskEditor";
import { CalendarEditor } from "./components/CalendarEditor";
import { SettingsModal } from "./components/SettingsModal";
import { weekDays } from "./lib/dates";

export function App() {
  const ready = useStore((s) => s.ready);
  const view = useStore((s) => s.view);
  const cursor = useStore((s) => s.cursor);
  const editor = useStore((s) => s.editor);
  const error = useStore((s) => s.error);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const [settings, setSettings] = useState(false);
  const days = useMemo(() => weekDays(cursor), [cursor]);

  useApplyTheme();
  useKeyboardShortcuts();
  useEffect(() => void useStore.getState().init(), []);

  if (!ready) return <div className="loading">{error ?? ""}</div>;

  return (
    <div className={`app ${sidebarOpen ? "" : "no-sidebar"}`}>
      {sidebarOpen && <Sidebar onSettings={() => setSettings(true)} />}
      <main className="main">
        <Toolbar />
        <div className="view">{view === "month" ? <MonthView /> : <TimeGrid days={days} />}</div>
      </main>

      {editor?.kind === "event" && <EventEditor key={editor.event.id} event={editor.event} isNew={editor.isNew} />}
      {editor?.kind === "task" && <TaskEditor key={editor.task.id} task={editor.task} isNew={editor.isNew} />}
      {editor?.kind === "calendar" && <CalendarEditor key={editor.calendar.id} calendar={editor.calendar} isNew={editor.isNew} />}
      {settings && <SettingsModal onClose={() => setSettings(false)} />}

      {error && (
        <div className="toast" role="alert" onClick={() => useStore.setState({ error: null })}>
          {error}
        </div>
      )}
    </div>
  );
}
