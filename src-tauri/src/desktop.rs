//! Anclaje del widget al escritorio de Windows.
//!
//! Técnica (ver README, "Widget"):
//! 1. Estilos WS_EX_TOOLWINDOW (fuera de la barra de tareas y de Alt+Tab) y WS_EX_NOACTIVATE.
//! 2. Subclase de la ventana: mientras el escritorio no está al frente, cualquier cambio de
//!    orden Z se convierte en HWND_BOTTOM; los clics no la activan y no se puede minimizar.
//! 3. Hook de "ventana en primer plano": si el escritorio pasa al frente (Win+D, clic en el
//!    escritorio), el widget se coloca justo encima de la ventana del escritorio; en cuanto
//!    otra app pasa al frente, vuelve al fondo.
//! 4. Acepta los avisos de fin de sesión de Windows (WM_QUERYENDSESSION) y sale.
//!
//! Nota: la versión 1.0.x hacía además al widget "propiedad" (owner) de la ventana del
//! escritorio del Explorador. Esa relación entre procesos, junto con forzar HWND_BOTTOM
//! (Windows exige que una ventana con propietario quede por encima de él), podía bloquear el
//! hilo principal de Agenda. Ya no se usa.

use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering};
use windows::core::{w, BOOL, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND};
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::*;

static WIDGET: AtomicIsize = AtomicIsize::new(0);
static REPOSITIONING: AtomicBool = AtomicBool::new(false);
/// true mientras el escritorio está en primer plano (el widget va encima de él).
static DESKTOP_MODE: AtomicBool = AtomicBool::new(false);
static HOOK_INSTALLED: AtomicBool = AtomicBool::new(false);
static TASKBAR_CREATED: AtomicU32 = AtomicU32::new(0);
const SUBCLASS_ID: usize = 0xA6E0DA;

fn hwnd_from(raw: isize) -> HWND {
    HWND(raw as *mut core::ffi::c_void)
}

unsafe extern "system" fn find_defview_host(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let defview = FindWindowExW(Some(hwnd), None, w!("SHELLDLL_DefView"), PCWSTR::null());
    if matches!(defview, Ok(h) if !h.is_invalid()) {
        *(lparam.0 as *mut HWND) = hwnd;
        return BOOL(0); // encontrado: parar
    }
    BOOL(1)
}

/// Ventana de nivel superior que contiene los iconos del escritorio (WorkerW o Progman).
fn desktop_window() -> Option<HWND> {
    unsafe {
        let mut found = HWND::default();
        let _ = EnumWindows(Some(find_defview_host), LPARAM(&mut found as *mut HWND as isize));
        if !found.is_invalid() {
            return Some(found);
        }
        FindWindowW(w!("Progman"), PCWSTR::null()).ok().filter(|h| !h.is_invalid())
    }
}

fn class_name(hwnd: HWND) -> String {
    let mut buf = [0u16; 64];
    let len = unsafe { GetClassNameW(hwnd, &mut buf) };
    String::from_utf16_lossy(&buf[..len.max(0) as usize])
}

fn force_styles(ex: isize) -> isize {
    (ex | WS_EX_TOOLWINDOW.0 as isize | WS_EX_NOACTIVATE.0 as isize) & !(WS_EX_APPWINDOW.0 as isize)
}

/// Coloca el widget justo encima de la ventana del escritorio (o al fondo si no se encuentra).
unsafe fn place_above_desktop(widget: HWND) {
    let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER;
    REPOSITIONING.store(true, Ordering::SeqCst);
    let after = desktop_window()
        .and_then(|desk| GetWindow(desk, GW_HWNDPREV).ok())
        .filter(|h| !h.is_invalid() && *h != widget);
    let _ = match after {
        Some(prev) => SetWindowPos(widget, Some(prev), 0, 0, 0, 0, flags),
        None => SetWindowPos(widget, Some(HWND_BOTTOM), 0, 0, 0, 0, flags),
    };
    REPOSITIONING.store(false, Ordering::SeqCst);
}

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    match msg {
        WM_WINDOWPOSCHANGING => {
            let wp = &mut *(lparam.0 as *mut WINDOWPOS);
            if !REPOSITIONING.load(Ordering::SeqCst) && !DESKTOP_MODE.load(Ordering::SeqCst) && (wp.flags & SWP_NOZORDER).0 == 0 {
                wp.hwndInsertAfter = HWND_BOTTOM;
            }
            // Nunca activar la ventana al moverla.
            wp.flags |= SWP_NOACTIVATE;
        }
        WM_STYLECHANGING if wparam.0 as i32 == GWL_EXSTYLE.0 => {
            // Tauri/tao recalculan los estilos al cambiar opciones: mantener los nuestros.
            let ss = &mut *(lparam.0 as *mut STYLESTRUCT);
            ss.styleNew = force_styles(ss.styleNew as isize) as u32;
        }
        WM_MOUSEACTIVATE => return LRESULT(MA_NOACTIVATE as isize),
        // Windows (apagado, cierre de sesión o un instalador vía Restart Manager) pide cerrar:
        // aceptar y salir, en vez de seguir viva en la bandeja.
        WM_QUERYENDSESSION => return LRESULT(1),
        WM_ENDSESSION if wparam.0 != 0 => std::process::exit(0),
        WM_SYSCOMMAND if (wparam.0 & 0xFFF0) as u32 == SC_MINIMIZE || (wparam.0 & 0xFFF0) as u32 == SC_MAXIMIZE => {
            return LRESULT(0);
        }
        m if m != 0 && m == TASKBAR_CREATED.load(Ordering::SeqCst) => {
            // Explorer se ha reiniciado: hay una ventana de escritorio nueva.
            send_to_bottom(hwnd);
        }
        _ => {}
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

unsafe extern "system" fn on_foreground(
    _hook: HWINEVENTHOOK,
    _event: u32,
    hwnd: HWND,
    _id_object: i32,
    _id_child: i32,
    _thread: u32,
    _time: u32,
) {
    let raw = WIDGET.load(Ordering::SeqCst);
    if raw == 0 || hwnd.0 as isize == raw {
        return;
    }
    let widget = hwnd_from(raw);
    if !IsWindowVisible(widget).as_bool() {
        return;
    }
    let class = class_name(hwnd);
    if class == "WorkerW" || class == "Progman" || Some(hwnd) == desktop_window() {
        DESKTOP_MODE.store(true, Ordering::SeqCst);
        place_above_desktop(widget);
    } else if DESKTOP_MODE.swap(false, Ordering::SeqCst) {
        // Otra app al frente: el widget vuelve al fondo.
        send_to_bottom(widget);
    }
}

unsafe fn send_to_bottom(widget: HWND) {
    REPOSITIONING.store(true, Ordering::SeqCst);
    let _ = SetWindowPos(widget, Some(HWND_BOTTOM), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
    REPOSITIONING.store(false, Ordering::SeqCst);
}

/// Ancla la ventana al escritorio. Debe llamarse desde el hilo principal (el del bucle de mensajes).
pub fn pin(raw_hwnd: isize) {
    let hwnd = hwnd_from(raw_hwnd);
    WIDGET.store(raw_hwnd, Ordering::SeqCst);
    unsafe {
        if TASKBAR_CREATED.load(Ordering::SeqCst) == 0 {
            TASKBAR_CREATED.store(RegisterWindowMessageW(w!("TaskbarCreated")), Ordering::SeqCst);
        }
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, force_styles(ex));

        let pref = DWMWCP_ROUND;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &pref as *const _ as *const core::ffi::c_void,
            std::mem::size_of_val(&pref) as u32,
        );

        let _ = SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0);

        if !HOOK_INSTALLED.swap(true, Ordering::SeqCst) {
            SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                None,
                Some(on_foreground),
                0,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            );
        }
        send_to_bottom(hwnd);
    }
}

/// Recoloca el widget al fondo (tras moverlo o redimensionarlo).
pub fn send_to_back(raw_hwnd: isize) {
    if !DESKTOP_MODE.load(Ordering::SeqCst) {
        unsafe { send_to_bottom(hwnd_from(raw_hwnd)) }
    }
}
