mod db;
#[cfg(windows)]
mod desktop;
mod models;
mod tray;
mod widget;

use db::Db;
use models::{CalEvent, Calendar, Task};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use widget::{MonitorInfo, WidgetConfig};

/// Argumento con el que Windows lanza la app al iniciar sesión: arranca sin abrir la ventana principal.
const AUTOSTART_ARG: &str = "--autostart";

pub struct AppState {
    db: Mutex<Db>,
}

type CmdResult<T> = Result<T, String>;

/// Avisa a todas las ventanas (app principal y widget) de que algo ha cambiado.
fn changed(app: &AppHandle, kind: &str) {
    let _ = app.emit("data-changed", kind);
}

fn with_db<T>(state: &State<AppState>, f: impl FnOnce(&Db) -> CmdResult<T>) -> CmdResult<T> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    f(&db)
}

#[tauri::command]
fn list_calendars(state: State<AppState>) -> CmdResult<Vec<Calendar>> {
    with_db(&state, |db| db.list_calendars())
}

#[tauri::command]
fn save_calendar(app: AppHandle, state: State<AppState>, calendar: Calendar) -> CmdResult<()> {
    with_db(&state, |db| db.save_calendar(&calendar))?;
    changed(&app, "calendars");
    Ok(())
}

#[tauri::command]
fn delete_calendar(app: AppHandle, state: State<AppState>, id: String) -> CmdResult<()> {
    with_db(&state, |db| db.delete_calendar(&id))?;
    changed(&app, "calendars");
    Ok(())
}

#[tauri::command]
fn list_events(state: State<AppState>, from: i64, to: i64) -> CmdResult<Vec<CalEvent>> {
    with_db(&state, |db| db.list_events(from, to))
}

#[tauri::command]
fn get_event(state: State<AppState>, id: String) -> CmdResult<Option<CalEvent>> {
    with_db(&state, |db| db.get_event(&id))
}

#[tauri::command]
fn save_event(app: AppHandle, state: State<AppState>, event: CalEvent) -> CmdResult<()> {
    with_db(&state, |db| db.save_event(&event))?;
    changed(&app, "events");
    Ok(())
}

#[tauri::command]
fn delete_event(app: AppHandle, state: State<AppState>, id: String) -> CmdResult<()> {
    with_db(&state, |db| db.delete_event(&id))?;
    changed(&app, "events");
    Ok(())
}

#[tauri::command]
fn list_tasks(state: State<AppState>) -> CmdResult<Vec<Task>> {
    with_db(&state, |db| db.list_tasks())
}

#[tauri::command]
fn save_task(app: AppHandle, state: State<AppState>, task: Task) -> CmdResult<()> {
    with_db(&state, |db| db.save_task(&task))?;
    changed(&app, "tasks");
    Ok(())
}

#[tauri::command]
fn delete_task(app: AppHandle, state: State<AppState>, id: String) -> CmdResult<()> {
    with_db(&state, |db| db.delete_task(&id))?;
    changed(&app, "tasks");
    Ok(())
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> CmdResult<HashMap<String, serde_json::Value>> {
    with_db(&state, |db| db.get_settings())
}

#[tauri::command]
fn set_setting(app: AppHandle, state: State<AppState>, key: String, value: serde_json::Value) -> CmdResult<()> {
    with_db(&state, |db| db.set_setting(&key, &value))?;
    changed(&app, "settings");
    Ok(())
}

// ---------- Widget, ventana principal y sistema ----------

#[tauri::command]
fn widget_get_config(app: AppHandle) -> WidgetConfig {
    widget::load_config(&app)
}

#[tauri::command]
fn widget_set_config(app: AppHandle, config: WidgetConfig) -> CmdResult<()> {
    widget::save_config(&app, &config)?;
    widget::apply(&app)?;
    tray::sync_widget_item(&app);
    Ok(())
}

#[tauri::command]
fn widget_snap(app: AppHandle, corner: String) -> CmdResult<()> {
    widget::snap_to(&app, &corner)
}

#[tauri::command]
fn list_monitors(app: AppHandle) -> Vec<MonitorInfo> {
    widget::list_monitors(&app)
}

/// Abre (o trae al frente) la ventana principal; si se indica un día, navega a él.
#[tauri::command]
fn open_main(app: AppHandle, day: Option<i64>) {
    show_main(&app, day);
}

#[tauri::command]
fn get_autostart(app: AppHandle) -> CmdResult<bool> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> CmdResult<()> {
    let al = app.autolaunch();
    if enabled { al.enable() } else { al.disable() }.map_err(|e| e.to_string())
}

pub fn show_main(app: &AppHandle, day: Option<i64>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        if let Some(day) = day {
            let _ = app.emit_to("main", "navigate", day);
        }
    }
}

/// La primera vez que se ejecuta la versión instalada, activa el arranque con Windows.
fn init_autostart(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let state = app.state::<AppState>();
    let Ok(db) = state.db.lock() else { return };
    let done = db.get_settings().map(|s| s.contains_key("autostartInitialized")).unwrap_or(true);
    if !done {
        let _ = app.autolaunch().enable();
        let _ = db.set_setting("autostartInitialized", &serde_json::json!(true));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Debe ir primero: si ya hay una Agenda abierta, la segunda solo enseña la ventana.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app, None)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![AUTOSTART_ARG])))
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db = Db::open(&dir.join("agenda.db"))?;
            app.manage(AppState { db: Mutex::new(db) });

            let handle = app.handle().clone();
            init_autostart(&handle);
            tray::create(&handle)?;
            if let Err(e) = widget::apply(&handle) {
                eprintln!("No se pudo mostrar el widget: {e}");
            }

            let main = app.get_webview_window("main").expect("falta la ventana principal");
            // Cerrar la ventana principal la esconde; la app sigue en la bandeja con el widget.
            let m = main.clone();
            main.on_window_event(move |e| {
                if let WindowEvent::CloseRequested { api, .. } = e {
                    api.prevent_close();
                    let _ = m.hide();
                }
            });
            if !std::env::args().any(|a| a == AUTOSTART_ARG) {
                main.show()?;
                main.set_focus()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_calendars,
            save_calendar,
            delete_calendar,
            list_events,
            get_event,
            save_event,
            delete_event,
            list_tasks,
            save_task,
            delete_task,
            get_settings,
            set_setting,
            widget_get_config,
            widget_set_config,
            widget_snap,
            list_monitors,
            open_main,
            get_autostart,
            set_autostart,
        ])
        .run(tauri::generate_context!())
        .expect("error al arrancar Agenda");
}
