//! Cliente CalDAV mínimo para iCloud (RFC 4791).
//!
//! Rust se encarga del HTTP, el XML y la contraseña (Administrador de credenciales de Windows,
//! nunca en disco ni en la base de datos). El algoritmo de sincronización y la conversión
//! iCalendar ↔ eventos están en TypeScript (src/lib/sync.ts), donde se prueban a fondo.

use base64::Engine;
use reqwest::{header, Client, Method, StatusCode};
use serde::{Deserialize, Serialize};
use std::time::Duration;

pub const ICLOUD_URL: &str = "https://caldav.icloud.com/";
const KEYRING_SERVICE: &str = "Agenda iCloud CalDAV";
const USER_AGENT: &str = concat!("Agenda/", env!("CARGO_PKG_VERSION"), " (Windows; CalDAV)");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub apple_id: String,
    pub home_url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCalendar {
    pub url: String,
    pub name: String,
    pub color: Option<String>,
    pub ctag: Option<String>,
    pub supports_events: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ETagItem {
    pub href: String,
    pub etag: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Resource {
    pub href: String,
    pub etag: String,
    pub data: String,
}

pub type CalResult<T> = Result<T, String>;

// ---------- Contraseña en el Administrador de credenciales ----------

pub fn store_password(apple_id: &str, password: &str) -> CalResult<()> {
    keyring::Entry::new(KEYRING_SERVICE, apple_id)
        .and_then(|e| e.set_password(password))
        .map_err(|e| format!("No se pudo guardar la contraseña en Windows: {e}"))
}

pub fn load_password(apple_id: &str) -> CalResult<String> {
    keyring::Entry::new(KEYRING_SERVICE, apple_id)
        .and_then(|e| e.get_password())
        .map_err(|_| "No encuentro la contraseña de iCloud guardada. Vuelve a conectar la cuenta.".to_string())
}

pub fn delete_password(apple_id: &str) {
    if let Ok(e) = keyring::Entry::new(KEYRING_SERVICE, apple_id) {
        let _ = e.delete_credential();
    }
}

// ---------- HTTP ----------

pub struct Session {
    client: Client,
    auth: String,
}

fn friendly(status: StatusCode) -> String {
    match status.as_u16() {
        401 => "iCloud ha rechazado el Apple ID o la contraseña. Usa una contraseña específica para apps (no la de tu Apple ID).".into(),
        403 => "iCloud no permite esta operación en ese calendario (¿es de solo lectura o compartido?).".into(),
        404 => "El calendario o evento ya no existe en iCloud.".into(),
        412 => "El evento ha cambiado en iCloud mientras tanto.".into(),
        507 => "Tu iCloud está lleno.".into(),
        s if s >= 500 => format!("iCloud no responde ahora mismo (error {s}). Se reintentará más tarde."),
        s => format!("Respuesta inesperada de iCloud (error {s})."),
    }
}

impl Session {
    pub fn new(apple_id: &str, password: &str) -> CalResult<Self> {
        let client = Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| e.to_string())?;
        let token = base64::engine::general_purpose::STANDARD.encode(format!("{apple_id}:{password}"));
        Ok(Self { client, auth: format!("Basic {token}") })
    }

    /// Petición WebDAV siguiendo redirecciones (iCloud manda a pXX-caldav.icloud.com) sin
    /// perder el método ni el cuerpo. Devuelve (url final, estado, cabeceras, cuerpo).
    async fn request(
        &self,
        method: &str,
        url: &str,
        depth: Option<&str>,
        body: Option<String>,
        extra: &[(header::HeaderName, String)],
    ) -> CalResult<(String, StatusCode, header::HeaderMap, String)> {
        let mut url = url.to_string();
        for _ in 0..5 {
            let mut req = self
                .client
                .request(Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?, &url)
                .header(header::AUTHORIZATION, &self.auth);
            if let Some(d) = depth {
                req = req.header("Depth", d);
            }
            for (k, v) in extra {
                req = req.header(k, v);
            }
            if let Some(b) = &body {
                let ct = if method == "PUT" { "text/calendar; charset=utf-8" } else { "application/xml; charset=utf-8" };
                req = req.header(header::CONTENT_TYPE, ct).body(b.clone());
            }
            let resp = req.send().await.map_err(|e| {
                if e.is_timeout() || e.is_connect() {
                    "No hay conexión con iCloud. Se reintentará más tarde.".to_string()
                } else {
                    format!("Error de red: {e}")
                }
            })?;
            let status = resp.status();
            if status.is_redirection() {
                if let Some(loc) = resp.headers().get(header::LOCATION).and_then(|l| l.to_str().ok()) {
                    url = join(&url, loc);
                    continue;
                }
            }
            let headers = resp.headers().clone();
            let text = resp.text().await.unwrap_or_default();
            return Ok((url, status, headers, text));
        }
        Err("Demasiadas redirecciones desde iCloud.".into())
    }

    async fn propfind(&self, url: &str, depth: &str, body: &str) -> CalResult<(String, String)> {
        let (final_url, status, _, text) = self.request("PROPFIND", url, Some(depth), Some(body.to_string()), &[]).await?;
        if status.as_u16() != 207 {
            return Err(friendly(status));
        }
        Ok((final_url, text))
    }

    /// Descubre la colección de calendarios del usuario (calendar-home-set).
    pub async fn discover(&self, base: &str) -> CalResult<String> {
        let (url, xml) = self
            .propfind(base, "0", r#"<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>"#)
            .await?;
        let principal = find_href(&xml, "current-user-principal").ok_or("iCloud no ha devuelto el usuario (principal).")?;
        let principal_url = join(&url, &principal);
        let (url, xml) = self
            .propfind(
                &principal_url,
                "0",
                r#"<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>"#,
            )
            .await?;
        let home = find_href(&xml, "calendar-home-set").ok_or("iCloud no ha devuelto la carpeta de calendarios.")?;
        Ok(join(&url, &home))
    }

    pub async fn list_calendars(&self, home: &str) -> CalResult<Vec<RemoteCalendar>> {
        let body = r#"<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/">
  <d:prop><d:resourcetype/><d:displayname/><a:calendar-color/><cs:getctag/><c:supported-calendar-component-set/></d:prop>
</d:propfind>"#;
        let (url, xml) = self.propfind(home, "1", body).await?;
        parse_calendars(&xml, &url)
    }

    /// ETags de los eventos; con `since` (UTC ms) solo los que tienen alguna aparición desde esa fecha
    /// (el servidor expande las repeticiones), para no bajar años de historial.
    pub async fn list_etags(&self, cal_url: &str, since: Option<i64>) -> CalResult<Vec<ETagItem>> {
        let range = since
            .and_then(chrono_utc)
            .map(|start| format!(r#"<c:time-range start="{start}"/>"#))
            .unwrap_or_default();
        let body = format!(
            r#"<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">{range}</c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>"#
        );
        let (url, status, _, xml) = self.request("REPORT", cal_url, Some("1"), Some(body), &[]).await?;
        if status.as_u16() != 207 {
            return Err(friendly(status));
        }
        Ok(parse_responses(&xml, &url)
            .into_iter()
            .filter(|r| r.href.ends_with(".ics") || r.etag.is_some())
            .filter_map(|r| Some(ETagItem { href: r.href, etag: r.etag? }))
            .collect())
    }

    pub async fn fetch(&self, cal_url: &str, hrefs: &[String]) -> CalResult<Vec<Resource>> {
        let mut out = Vec::new();
        for chunk in hrefs.chunks(50) {
            let list: String = chunk.iter().map(|h| format!("<d:href>{}</d:href>", xml_escape(&path_of(h)))).collect();
            let body = format!(
                r#"<c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop>{list}</c:calendar-multiget>"#
            );
            let (url, status, _, xml) = self.request("REPORT", cal_url, Some("1"), Some(body), &[]).await?;
            if status.as_u16() != 207 {
                return Err(friendly(status));
            }
            out.extend(
                parse_responses(&xml, &url)
                    .into_iter()
                    .filter_map(|r| Some(Resource { href: r.href, etag: r.etag?, data: r.data? })),
            );
        }
        Ok(out)
    }

    /// Crea (etag = None, falla si ya existe) o actualiza (If-Match) un evento. Devuelve la nueva ETag si iCloud la manda.
    pub async fn put(&self, href: &str, data: &str, etag: Option<&str>) -> CalResult<Option<String>> {
        let cond = match etag {
            Some(e) => (header::IF_MATCH, e.to_string()),
            None => (header::IF_NONE_MATCH, "*".to_string()),
        };
        let (_, status, headers, _) = self.request("PUT", href, None, Some(data.to_string()), &[cond]).await?;
        if !status.is_success() {
            return Err(friendly(status));
        }
        Ok(headers.get(header::ETAG).and_then(|v| v.to_str().ok()).map(String::from))
    }

    pub async fn delete(&self, href: &str, etag: Option<&str>) -> CalResult<()> {
        let extra: Vec<_> = etag.map(|e| (header::IF_MATCH, e.to_string())).into_iter().collect();
        let (_, status, _, _) = self.request("DELETE", href, None, None, &extra).await?;
        if status.is_success() || status == StatusCode::NOT_FOUND {
            Ok(())
        } else {
            Err(friendly(status))
        }
    }

    /// Crea un calendario nuevo en iCloud (para subir Uni, Trabajo…).
    pub async fn make_calendar(&self, home: &str, name: &str, color: &str) -> CalResult<String> {
        let id = format!("agenda-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
        let url = format!("{}/{id}/", home.trim_end_matches('/'));
        let body = format!(
            r#"<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:set><d:prop>
  <d:displayname>{}</d:displayname><a:calendar-color>{}FF</a:calendar-color>
  <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>
</d:prop></d:set></c:mkcalendar>"#,
            xml_escape(name),
            xml_escape(color)
        );
        let (_, status, _, _) = self.request("MKCALENDAR", &url, None, Some(body), &[]).await?;
        if status.as_u16() == 201 {
            Ok(url)
        } else {
            Err(friendly(status))
        }
    }
}

/// UTC ms → "20251016T000000Z" (formato de CalDAV), sin dependencias extra.
fn chrono_utc(ms: i64) -> Option<String> {
    if ms < 0 {
        return None;
    }
    let secs = ms / 1000;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // Algoritmo civil_from_days (Howard Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    Some(format!("{y:04}{m:02}{d:02}T{:02}{:02}{:02}Z", rem / 3600, (rem % 3600) / 60, rem % 60))
}

// ---------- XML ----------

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Resuelve un href relativo contra la URL de la petición.
pub fn join(base: &str, href: &str) -> String {
    let href = href.trim();
    if href.starts_with("http://") || href.starts_with("https://") {
        return href.to_string();
    }
    let origin_end = base.find("://").map(|i| base[i + 3..].find('/').map(|j| i + 3 + j).unwrap_or(base.len())).unwrap_or(0);
    let origin = &base[..origin_end];
    if href.starts_with('/') {
        format!("{origin}{href}")
    } else {
        let dir_end = base.rfind('/').map(|i| i + 1).unwrap_or(base.len());
        format!("{}{href}", &base[..dir_end.max(origin_end)])
    }
}

/// Ruta de una URL (lo que va en <d:href> del multiget).
fn path_of(url: &str) -> String {
    match url.find("://") {
        Some(i) => url[i + 3..].find('/').map(|j| url[i + 3 + j..].to_string()).unwrap_or_else(|| "/".into()),
        None => url.to_string(),
    }
}

fn find_href(xml: &str, prop: &str) -> Option<String> {
    let doc = roxmltree::Document::parse(xml).ok()?;
    let node = doc.descendants().find(|n| n.tag_name().name() == prop)?;
    node.descendants().find(|n| n.tag_name().name() == "href").and_then(|n| n.text()).map(|t| t.trim().to_string())
}

struct DavResponse {
    href: String,
    etag: Option<String>,
    data: Option<String>,
}

fn parse_responses(xml: &str, base: &str) -> Vec<DavResponse> {
    let Ok(doc) = roxmltree::Document::parse(xml) else { return vec![] };
    doc.descendants()
        .filter(|n| n.tag_name().name() == "response")
        .filter_map(|r| {
            let href = r.children().find(|c| c.tag_name().name() == "href")?.text()?.trim().to_string();
            // Solo las propiedades de los <propstat> con estado 200.
            let ok_props: Vec<_> = r
                .children()
                .filter(|c| c.tag_name().name() == "propstat")
                .filter(|ps| {
                    ps.children()
                        .find(|c| c.tag_name().name() == "status")
                        .and_then(|s| s.text())
                        .map(|s| s.contains(" 200"))
                        .unwrap_or(true)
                })
                .collect();
            let text_of = |name: &str| {
                ok_props
                    .iter()
                    .flat_map(|ps| ps.descendants())
                    .find(|n| n.tag_name().name() == name)
                    .and_then(|n| n.text())
                    .map(|t| t.to_string())
            };
            Some(DavResponse {
                href: join(base, &href),
                etag: text_of("getetag").map(|e| e.trim().to_string()),
                data: text_of("calendar-data"),
            })
        })
        .collect()
}

fn parse_calendars(xml: &str, base: &str) -> CalResult<Vec<RemoteCalendar>> {
    let doc = roxmltree::Document::parse(xml).map_err(|e| format!("Respuesta de iCloud ilegible: {e}"))?;
    let mut out = Vec::new();
    for r in doc.descendants().filter(|n| n.tag_name().name() == "response") {
        let Some(href) = r.children().find(|c| c.tag_name().name() == "href").and_then(|n| n.text()) else { continue };
        let ok = |n: &roxmltree::Node| {
            n.ancestors()
                .find(|a| a.tag_name().name() == "propstat")
                .and_then(|ps| ps.children().find(|c| c.tag_name().name() == "status"))
                .and_then(|s| s.text())
                .map(|s| s.contains(" 200"))
                .unwrap_or(true)
        };
        let find = |name: &str| r.descendants().find(|n| n.tag_name().name() == name && ok(n));
        let is_calendar = find("resourcetype").map(|rt| rt.children().any(|c| c.tag_name().name() == "calendar")).unwrap_or(false);
        if !is_calendar {
            continue;
        }
        let comps: Vec<String> = find("supported-calendar-component-set")
            .map(|s| s.children().filter_map(|c| c.attribute("name").map(String::from)).collect())
            .unwrap_or_default();
        let color = find("calendar-color").and_then(|n| n.text()).map(|c| {
            let c = c.trim();
            if c.len() == 9 && c.starts_with('#') { c[..7].to_string() } else { c.to_string() }
        });
        out.push(RemoteCalendar {
            url: join(base, href),
            name: find("displayname").and_then(|n| n.text()).map(|t| t.trim().to_string()).unwrap_or_else(|| "Sin nombre".into()),
            color,
            ctag: find("getctag").and_then(|n| n.text()).map(|t| t.trim().to_string()),
            supports_events: comps.is_empty() || comps.iter().any(|c| c == "VEVENT"),
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn fechas_caldav_en_utc() {
        assert_eq!(chrono_utc(0).as_deref(), Some("19700101T000000Z"));
        assert_eq!(chrono_utc(1_792_108_800_000).as_deref(), Some("20261016T000000Z"));
        assert_eq!(chrono_utc(951_782_400_000 + 3_723_000).as_deref(), Some("20000229T010203Z"));
    }

    #[test]
    fn join_resuelve_hrefs() {
        assert_eq!(join("https://caldav.icloud.com/", "/123/principal/"), "https://caldav.icloud.com/123/principal/");
        assert_eq!(join("https://a.com/x/y/", "z.ics"), "https://a.com/x/y/z.ics");
        assert_eq!(join("https://a.com/x/", "https://p1-caldav.icloud.com:443/1/calendars/"), "https://p1-caldav.icloud.com:443/1/calendars/");
        assert_eq!(path_of("https://p1-caldav.icloud.com:443/1/calendars/home/a.ics"), "/1/calendars/home/a.ics");
    }

    const CALENDARS_XML: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:">
 <response><href>/1/calendars/</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>
 <response><href>/1/calendars/home/</href><propstat><prop>
   <resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype>
   <displayname>Casa</displayname><calendar-color xmlns="http://apple.com/ns/ical/">#FF2968FF</calendar-color>
   <getctag xmlns="http://calendarserver.org/ns/">HwoQEgwAAA</getctag>
   <supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"><comp name="VEVENT"/></supported-calendar-component-set>
  </prop><status>HTTP/1.1 200 OK</status></propstat>
  <propstat><prop><displayname/></prop><status>HTTP/1.1 404 Not Found</status></propstat></response>
 <response><href>/1/calendars/tasks/</href><propstat><prop>
   <resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype><displayname>Recordatorios</displayname>
   <supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"><comp name="VTODO"/></supported-calendar-component-set>
  </prop><status>HTTP/1.1 200 OK</status></propstat></response>
 <response><href>/1/calendars/inbox/</href><propstat><prop><resourcetype><collection/><schedule-inbox xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>
</multistatus>"#;

    #[test]
    fn lee_calendarios_de_icloud() {
        let cals = parse_calendars(CALENDARS_XML, "https://p1-caldav.icloud.com/1/calendars/").unwrap();
        assert_eq!(
            cals,
            vec![
                RemoteCalendar {
                    url: "https://p1-caldav.icloud.com/1/calendars/home/".into(),
                    name: "Casa".into(),
                    color: Some("#FF2968".into()),
                    ctag: Some("HwoQEgwAAA".into()),
                    supports_events: true
                },
                RemoteCalendar {
                    url: "https://p1-caldav.icloud.com/1/calendars/tasks/".into(),
                    name: "Recordatorios".into(),
                    color: None,
                    ctag: None,
                    supports_events: false
                },
            ]
        );
    }

    #[test]
    fn lee_respuestas_con_datos() {
        let xml = r#"<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
 <d:response><d:href>/1/calendars/home/a.ics</d:href><d:propstat><d:prop><d:getetag>"e1"</d:getetag><c:calendar-data>BEGIN:VCALENDAR&#13;
END:VCALENDAR</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
 <d:response><d:href>/1/calendars/home/b.ics</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>
</d:multistatus>"#;
        let rs = parse_responses(xml, "https://x.com/1/calendars/home/");
        assert_eq!(rs[0].href, "https://x.com/1/calendars/home/a.ics");
        assert_eq!(rs[0].etag.as_deref(), Some("\"e1\""));
        assert!(rs[0].data.as_deref().unwrap().starts_with("BEGIN:VCALENDAR"));
        assert!(rs[1].etag.is_none());
    }

    /// Servidor HTTP de juguete: responde en orden y guarda lo que recibe.
    fn fake_server(responses: Vec<String>) -> (String, std::thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let mut seen = Vec::new();
            for resp in responses {
                let (mut s, _) = listener.accept().unwrap();
                let mut buf = vec![0u8; 65536];
                let mut req = String::new();
                // Leer cabeceras + cuerpo (Content-Length)
                loop {
                    let n = s.read(&mut buf).unwrap();
                    req.push_str(&String::from_utf8_lossy(&buf[..n]));
                    if let Some(h) = req.find("\r\n\r\n") {
                        let len = req[..h]
                            .lines()
                            .find_map(|l| l.to_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0)))
                            .unwrap_or(0);
                        if req.len() >= h + 4 + len {
                            break;
                        }
                    }
                    if n == 0 {
                        break;
                    }
                }
                seen.push(req);
                s.write_all(resp.as_bytes()).unwrap();
            }
            seen
        });
        (base, handle)
    }

    fn http(status: &str, extra: &str, body: &str) -> String {
        format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n{body}", body.len())
    }

    #[test]
    fn descubre_la_cuenta_siguiendo_redirecciones() {
        let principal = r#"<multistatus xmlns="DAV:"><response><href>/</href><propstat><prop><current-user-principal><href>/123/principal/</href></current-user-principal></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>"#;
        let home = r#"<multistatus xmlns="DAV:"><response><href>/123/principal/</href><propstat><prop><calendar-home-set xmlns="urn:ietf:params:xml:ns:caldav"><href xmlns="DAV:">/123/calendars/</href></calendar-home-set></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>"#;
        // iCloud responde primero con una redirección (aquí relativa, a /real/).
        let (base2, handle2) = fake_server(vec![
            http("301 Moved Permanently", "Location: /real/\r\n", ""),
            http("207 Multi-Status", "", principal),
            http("207 Multi-Status", "", home),
        ]);
        let rt = tokio_rt();
        let s = Session::new("yo@icloud.com", "abcd-efgh-ijkl-mnop").unwrap();
        let home_url = rt.block_on(s.discover(&format!("{base2}/"))).unwrap();
        assert_eq!(home_url, format!("{base2}/123/calendars/"));
        let seen = handle2.join().unwrap();
        assert!(seen[0].starts_with("PROPFIND / "));
        assert!(seen[1].starts_with("PROPFIND /real/ "), "la redirección mantiene el método: {}", &seen[1][..30]);
        assert!(seen[1].contains("current-user-principal"), "y el cuerpo");
        assert!(seen[2].starts_with("PROPFIND /123/principal/ "));
        let auth = base64::engine::general_purpose::STANDARD.encode("yo@icloud.com:abcd-efgh-ijkl-mnop");
        assert!(seen.iter().all(|r| r.to_lowercase().contains(&format!("authorization: basic {}", auth.to_lowercase()))));
    }

    #[test]
    fn errores_en_espanol() {
        let (base, handle) = fake_server(vec![http("401 Unauthorized", "", "")]);
        let s = Session::new("a", "b").unwrap();
        let err = tokio_rt().block_on(s.discover(&format!("{base}/"))).unwrap_err();
        assert!(err.contains("contraseña específica"));
        handle.join().unwrap();
    }

    #[test]
    fn put_con_condiciones_y_etag() {
        let (base, handle) = fake_server(vec![http("201 Created", "ETag: \"nueva\"\r\n", ""), http("412 Precondition Failed", "", "")]);
        let s = Session::new("a", "b").unwrap();
        let rt = tokio_rt();
        let etag = rt.block_on(s.put(&format!("{base}/cal/x.ics"), "BEGIN:VCALENDAR", None)).unwrap();
        assert_eq!(etag.as_deref(), Some("\"nueva\""));
        let err = rt.block_on(s.put(&format!("{base}/cal/x.ics"), "BEGIN:VCALENDAR", Some("\"vieja\""))).unwrap_err();
        assert!(err.contains("ha cambiado"));
        let seen = handle.join().unwrap();
        assert!(seen[0].to_lowercase().contains("if-none-match: *"));
        assert!(seen[1].to_lowercase().contains("if-match: \"vieja\""));
    }

    fn tokio_rt() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap()
    }
}
