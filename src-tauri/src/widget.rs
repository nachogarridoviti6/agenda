//! Ventana del widget: creación, configuración (monitor, posición, tamaño, bloqueo, acrílico)
//! y guardado de la posición cuando el usuario la arrastra.

use crate::AppState;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::window::{Effect, EffectsBuilder};
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

pub const LABEL: &str = "widget";
const SETTING_KEY: &str = "widget";
const MARGIN: f64 = 24.0;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct WidgetConfig {
    pub visible: bool,
    /// Nombre del monitor; None = principal.
    pub monitor: Option<String>,
    /// Posición en px lógicos relativa a la esquina superior izquierda del monitor.
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// false hasta que se coloca por primera vez (se pone arriba a la derecha).
    pub position_set: bool,
    pub locked: bool,
    pub acrylic: bool,
    /// Opacidad del fondo (0.2–1). La aplica el propio widget en CSS.
    pub opacity: f64,
    /// "system" | "light" | "dark". La aplica el propio widget.
    pub theme: String,
    /// "week" (semana completa) | "today" (agenda de hoy y mañana).
    pub layout: String,
}

impl Default for WidgetConfig {
    fn default() -> Self {
        Self {
            visible: true,
            monitor: None,
            x: 0.0,
            y: 0.0,
            width: 760.0,
            height: 380.0,
            position_set: false,
            locked: false,
            acrylic: true,
            opacity: 0.72,
            theme: "system".into(),
            layout: "week".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub name: String,
    pub label: String,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
    pub primary: bool,
}

pub fn load_config(app: &AppHandle) -> WidgetConfig {
    let state = app.state::<AppState>();
    let db = match state.db.lock() {
        Ok(db) => db,
        Err(_) => return WidgetConfig::default(),
    };
    db.get_settings()
        .ok()
        .and_then(|s| s.get(SETTING_KEY).cloned())
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

pub fn save_config(app: &AppHandle, cfg: &WidgetConfig) -> Result<(), String> {
    let state = app.state::<AppState>();
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.set_setting(SETTING_KEY, &serde_json::to_value(cfg).map_err(|e| e.to_string())?)?;
    drop(db);
    let _ = app.emit("data-changed", "settings");
    Ok(())
}

fn find_monitor(app: &AppHandle, name: Option<&str>) -> Option<Monitor> {
    let monitors = app.available_monitors().ok().unwrap_or_default();
    name.and_then(|n| monitors.iter().find(|m| m.name().map(String::as_str) == Some(n)).cloned())
        .or_else(|| app.primary_monitor().ok().flatten())
        .or_else(|| monitors.into_iter().next())
}

pub fn list_monitors(app: &AppHandle) -> Vec<MonitorInfo> {
    let primary = app.primary_monitor().ok().flatten().and_then(|m| m.name().cloned());
    app.available_monitors()
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .map(|(i, m)| {
            let scale = m.scale_factor();
            let name = m.name().cloned().unwrap_or_else(|| format!("monitor-{i}"));
            let is_primary = primary.as_deref() == Some(name.as_str());
            let (w, h) = (m.size().width as f64 / scale, m.size().height as f64 / scale);
            MonitorInfo {
                label: format!(
                    "Pantalla {}{} — {}×{}",
                    i + 1,
                    if is_primary { " (principal)" } else { "" },
                    w.round(),
                    h.round()
                ),
                name,
                width: w,
                height: h,
                scale,
                primary: is_primary,
            }
        })
        .collect()
}

/// Área útil del monitor (sin barra de tareas) relativa a su esquina, en px lógicos: (x, y, ancho, alto).
fn work_area(m: &Monitor) -> (f64, f64, f64, f64) {
    let s = m.scale_factor();
    let wa = m.work_area();
    (
        (wa.position.x - m.position().x) as f64 / s,
        (wa.position.y - m.position().y) as f64 / s,
        wa.size.width as f64 / s,
        wa.size.height as f64 / s,
    )
}

/// Coloca el widget en una esquina del área útil: "tl", "tr", "bl", "br".
pub fn snap(cfg: &mut WidgetConfig, m: &Monitor, corner: &str) {
    let (ax, ay, aw, ah) = work_area(m);
    cfg.x = if corner.ends_with('l') { ax + MARGIN } else { ax + aw - cfg.width - MARGIN };
    cfg.y = if corner.starts_with('t') { ay + MARGIN } else { ay + ah - cfg.height - MARGIN };
    cfg.position_set = true;
}

/// Ajusta tamaño y posición para que el widget quede dentro del monitor.
fn clamp(cfg: &mut WidgetConfig, m: &Monitor) {
    let s = m.scale_factor();
    let (mw, mh) = (m.size().width as f64 / s, m.size().height as f64 / s);
    cfg.width = cfg.width.clamp(320.0, mw);
    cfg.height = cfg.height.clamp(180.0, mh);
    cfg.x = cfg.x.clamp(0.0, (mw - cfg.width).max(0.0));
    cfg.y = cfg.y.clamp(0.0, (mh - cfg.height).max(0.0));
}

fn build(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let win = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("widget.html".into()))
        .title("Agenda — widget")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .skip_taskbar(true)
        .always_on_bottom(true)
        .focusable(false)
        .minimizable(false)
        .maximizable(false)
        .visible(false)
        .build()?;

    let handle = app.clone();
    win.on_window_event(move |e| match e {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => schedule_save_bounds(&handle),
        WindowEvent::CloseRequested { api, .. } => {
            // Alt+F4 sobre el widget: se oculta en vez de cerrarse.
            api.prevent_close();
            if let Some(w) = handle.get_webview_window(LABEL) {
                let _ = w.hide();
            }
        }
        _ => {}
    });
    Ok(win)
}

/// Aplica la configuración guardada: crea/oculta la ventana, monitor, posición, tamaño y efectos.
pub fn apply(app: &AppHandle) -> Result<(), String> {
    let mut cfg = load_config(app);
    let existing = app.get_webview_window(LABEL);
    if !cfg.visible {
        if let Some(w) = existing {
            w.hide().map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let win = match existing {
        Some(w) => w,
        None => build(app).map_err(|e| e.to_string())?,
    };
    let monitor = find_monitor(app, cfg.monitor.as_deref()).ok_or("No se encuentra ningún monitor")?;
    let original = cfg.clone();
    if !cfg.position_set {
        snap(&mut cfg, &monitor, "tr");
    }
    clamp(&mut cfg, &monitor);
    if cfg != original {
        save_config(app, &cfg)?;
    }

    IGNORE_MOVES_UNTIL.store(now_ms() + 600, Ordering::SeqCst);
    let s = monitor.scale_factor();
    let origin = monitor.position();
    let pos = PhysicalPosition::new(origin.x + (cfg.x * s).round() as i32, origin.y + (cfg.y * s).round() as i32);
    win.set_position(pos).map_err(|e| e.to_string())?;
    win.set_size(PhysicalSize::new((cfg.width * s).round() as u32, (cfg.height * s).round() as u32))
        .map_err(|e| e.to_string())?;
    win.set_resizable(!cfg.locked).map_err(|e| e.to_string())?;

    let effects = cfg.acrylic.then(|| EffectsBuilder::new().effect(Effect::Acrylic).build());
    win.set_effects(effects).map_err(|e| e.to_string())?;

    win.show().map_err(|e| e.to_string())?;
    pin(app, &win);
    Ok(())
}

#[cfg(windows)]
fn pin(app: &AppHandle, win: &WebviewWindow) {
    if let Ok(hwnd) = win.hwnd() {
        let raw = hwnd.0 as isize;
        let _ = app.run_on_main_thread(move || crate::desktop::pin(raw));
    }
}

#[cfg(not(windows))]
fn pin(_app: &AppHandle, win: &WebviewWindow) {
    let _ = win.set_always_on_bottom(true);
}

// ---------- Guardar la posición cuando el usuario mueve o redimensiona el widget ----------

static SAVE_GEN: AtomicU64 = AtomicU64::new(0);
static IGNORE_MOVES_UNTIL: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn schedule_save_bounds(app: &AppHandle) {
    // Los movimientos que provoca `apply` no son del usuario.
    if now_ms() < IGNORE_MOVES_UNTIL.load(Ordering::SeqCst) {
        return;
    }
    let gen = SAVE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(400));
        if SAVE_GEN.load(Ordering::SeqCst) != gen {
            return; // sigue moviéndose
        }
        let Some(win) = app.get_webview_window(LABEL) else { return };
        let (Ok(pos), Ok(size), Ok(Some(monitor))) = (win.outer_position(), win.inner_size(), win.current_monitor()) else {
            return;
        };
        let s = monitor.scale_factor();
        let mut cfg = load_config(&app);
        cfg.monitor = monitor.name().cloned();
        cfg.x = ((pos.x - monitor.position().x) as f64 / s).round();
        cfg.y = ((pos.y - monitor.position().y) as f64 / s).round();
        cfg.width = (size.width as f64 / s).round();
        cfg.height = (size.height as f64 / s).round();
        cfg.position_set = true;
        let _ = save_config(&app, &cfg);
        #[cfg(windows)]
        if let Ok(hwnd) = win.hwnd() {
            let raw = hwnd.0 as isize;
            let _ = app.run_on_main_thread(move || crate::desktop::send_to_back(raw));
        }
    });
}

pub fn snap_to(app: &AppHandle, corner: &str) -> Result<(), String> {
    let mut cfg = load_config(app);
    let monitor = find_monitor(app, cfg.monitor.as_deref()).ok_or("No se encuentra ningún monitor")?;
    snap(&mut cfg, &monitor, corner);
    clamp(&mut cfg, &monitor);
    save_config(app, &cfg)?;
    apply(app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_por_defecto_y_campos_que_faltan() {
        let cfg: WidgetConfig = serde_json::from_str(r#"{"locked": true}"#).unwrap();
        assert!(cfg.locked);
        assert!(cfg.visible);
        assert_eq!(cfg.width, 760.0);
        assert_eq!(cfg.theme, "system");
        assert_eq!(cfg.layout, "week");
    }

    #[test]
    fn serializa_en_camel_case() {
        let v = serde_json::to_value(WidgetConfig::default()).unwrap();
        assert!(v.get("positionSet").is_some());
    }
}
