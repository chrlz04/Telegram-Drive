use actix_web::{get, post, web, HttpRequest, HttpResponse, Responder, cookie::Cookie};
use crate::commands::TelegramState;
use crate::commands::utils::resolve_peer;
use crate::db::DbConnection;
use crate::server::parse_range_header;
use grammers_client::types::Media;
use sha2::{Sha256, Digest};
use std::sync::Arc;
use serde::Deserialize;

#[derive(Clone)]
struct SharedLinkRow {
    _id: String,
    folder_id: Option<i64>,
    message_id: i32,
    file_name: String,
    file_size: i64,
    password_hash: Option<String>,
    password_salt: Option<String>,
    expires_at: Option<i64>,
    revoked: bool,
}

#[derive(Deserialize)]
struct VerifyForm {
    password: String,
}

#[derive(Deserialize)]
struct FileQuery {
    dl: Option<String>,
}

fn hash_password(password: &str, salt: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    hasher.update(salt.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn generate_cookie_val(token: &str, password_hash: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hasher.update(password_hash.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn get_share_by_token(db: &DbConnection, token: &str) -> Result<Option<SharedLinkRow>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, folder_id, message_id, file_name, file_size, password_hash, password_salt, expires_at, revoked
             FROM shared_links WHERE id = ?"
        )
        .map_err(|e| e.to_string())?;

    stmt.bind((1, token)).map_err(|e| e.to_string())?;

    if let sqlite::State::Row = stmt.next().map_err(|e| e.to_string())? {
        let id = stmt.read::<String, _>("id").map_err(|e| e.to_string())?;
        let folder_id = stmt.read::<Option<i64>, _>("folder_id").ok().flatten();
        let message_id = stmt.read::<i64, _>("message_id").map_err(|e| e.to_string())? as i32;
        let file_name = stmt.read::<String, _>("file_name").map_err(|e| e.to_string())?;
        let file_size = stmt.read::<i64, _>("file_size").map_err(|e| e.to_string())?;
        let password_hash = stmt.read::<Option<String>, _>("password_hash").ok().flatten();
        let password_salt = stmt.read::<Option<String>, _>("password_salt").ok().flatten();
        let expires_at = stmt.read::<Option<i64>, _>("expires_at").ok().flatten();
        let revoked = stmt.read::<i64, _>("revoked").map_err(|e| e.to_string())? != 0;

        Ok(Some(SharedLinkRow {
            _id: id,
            folder_id,
            message_id,
            file_name,
            file_size,
            password_hash,
            password_salt,
            expires_at,
            revoked,
        }))
    } else {
        Ok(None)
    }
}

// Returns Ok(row) if valid + authenticated, Err(response) to return early.
// show_password_form: true for landing page, false for asset requests (returns 403 instead).
fn check_share_auth(
    req: &HttpRequest,
    token: &str,
    db: &DbConnection,
    show_password_form: bool,
) -> Result<SharedLinkRow, HttpResponse> {
    let row = match get_share_by_token(db, token) {
        Ok(Some(r)) => r,
        Ok(None) => return Err(HttpResponse::NotFound().body("Shared link not found")),
        Err(e) => {
            log::error!("DB error resolving token {}: {}", token, e);
            return Err(HttpResponse::InternalServerError().body("Internal server error"));
        }
    };

    if row.revoked {
        return Err(HttpResponse::NotFound().body("This shared link has been revoked"));
    }

    if let Some(expiry) = row.expires_at {
        let now = chrono::Utc::now().timestamp();
        if expiry < now {
            return Err(HttpResponse::Gone().body("This shared link has expired"));
        }
    }

    if let Some(hash) = &row.password_hash {
        let mut authenticated = false;
        if let Some(cookie) = req.cookie(&format!("share_auth_{}", token)) {
            let expected = generate_cookie_val(token, hash);
            if cookie.value() == expected {
                authenticated = true;
            }
        }

        if !authenticated {
            return Err(if show_password_form {
                render_password_form(&row.file_name, token, None)
            } else {
                HttpResponse::Forbidden().body("Authentication required")
            });
        }
    }

    Ok(row)
}

fn format_file_size(bytes: i64) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else if bytes < 1024 * 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    } else {
        format!("{:.2} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    }
}

enum MediaKind {
    Image,
    Video,
    Audio,
    Other,
}

fn infer_media_kind(filename: &str) -> MediaKind {
    let lower = filename.to_lowercase();
    if lower.ends_with(".jpg") || lower.ends_with(".jpeg") || lower.ends_with(".png")
        || lower.ends_with(".gif") || lower.ends_with(".webp") || lower.ends_with(".bmp")
        || lower.ends_with(".svg") || lower.ends_with(".ico")
    {
        MediaKind::Image
    } else if lower.ends_with(".mp4") || lower.ends_with(".webm") || lower.ends_with(".mov")
        || lower.ends_with(".mkv") || lower.ends_with(".avi") || lower.ends_with(".ogv")
    {
        MediaKind::Video
    } else if lower.ends_with(".mp3") || lower.ends_with(".wav") || lower.ends_with(".flac")
        || lower.ends_with(".aac") || lower.ends_with(".m4a") || lower.ends_with(".opus")
        || lower.ends_with(".ogg")
    {
        MediaKind::Audio
    } else {
        MediaKind::Other
    }
}

fn file_icon(filename: &str) -> &'static str {
    let lower = filename.to_lowercase();
    if lower.ends_with(".pdf") { return "📄"; }
    if lower.ends_with(".zip") || lower.ends_with(".rar") || lower.ends_with(".7z")
        || lower.ends_with(".tar") || lower.ends_with(".gz")
    { return "📦"; }
    if lower.ends_with(".doc") || lower.ends_with(".docx") || lower.ends_with(".txt")
        || lower.ends_with(".md") || lower.ends_with(".odt")
    { return "📝"; }
    if lower.ends_with(".xls") || lower.ends_with(".xlsx") || lower.ends_with(".csv") {
        return "📊";
    }
    if lower.ends_with(".ppt") || lower.ends_with(".pptx") { return "📑"; }
    if lower.ends_with(".exe") || lower.ends_with(".msi") || lower.ends_with(".dmg")
        || lower.ends_with(".apk")
    { return "⚙️"; }
    match infer_media_kind(filename) {
        MediaKind::Image => "🖼️",
        MediaKind::Video => "🎬",
        MediaKind::Audio => "🎵",
        MediaKind::Other => "📁",
    }
}

fn render_password_form(file_name: &str, token: &str, error: Option<&str>) -> HttpResponse {
    let error_html = match error {
        Some(err) => format!("<div class=\"error\">{}</div>", err),
        None => "".to_string(),
    };

    let html = format!(
        r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Password Protected - Telegram Drive</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            background-color: #0e1621;
            color: #c5cdd6;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }}
        .card {{
            background: #182533;
            border: 1px solid #2b3a4a;
            border-radius: 16px;
            width: 100%;
            max-width: 400px;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,0.4);
        }}
        .brand {{
            padding: 14px 20px;
            border-bottom: 1px solid #2b3a4a;
            font-size: 13px;
            color: #40a7e3;
            font-weight: 600;
        }}
        .body {{ padding: 28px 24px; text-align: center; }}
        .lock {{ font-size: 40px; margin-bottom: 16px; }}
        h2 {{ font-size: 17px; color: #e8f0f8; margin-bottom: 6px; }}
        .subtitle {{ font-size: 13px; color: #6b8499; margin-bottom: 24px; }}
        .error {{ color: #ff5e5e; font-size: 13px; margin-bottom: 16px; }}
        input[type="password"] {{
            width: 100%;
            padding: 12px 14px;
            border-radius: 10px;
            border: 1px solid #2b3a4a;
            background: #0e1621;
            color: #e8f0f8;
            font-size: 15px;
            margin-bottom: 14px;
            outline: none;
            transition: border-color 0.2s;
        }}
        input[type="password"]:focus {{ border-color: #40a7e3; }}
        button {{
            width: 100%;
            padding: 13px;
            border-radius: 10px;
            border: none;
            background: #40a7e3;
            color: white;
            font-weight: 600;
            font-size: 15px;
            cursor: pointer;
            transition: background 0.2s;
        }}
        button:hover {{ background: #3598d1; }}
        .footer {{
            padding: 12px 20px;
            border-top: 1px solid #2b3a4a;
            font-size: 11px;
            color: #4a6070;
            text-align: center;
        }}
    </style>
</head>
<body>
    <div class="card">
        <div class="brand">✈ Telegram Drive</div>
        <div class="body">
            <div class="lock">🔒</div>
            <h2>Password Required</h2>
            <p class="subtitle">File: <strong style="color:#c5cdd6">{}</strong></p>
            {}
            <form method="POST" action="/d/{}/verify">
                <input type="password" name="password" placeholder="Enter password" autofocus required>
                <button type="submit">Unlock &amp; View</button>
            </form>
        </div>
        <div class="footer">Shared via Telegram Drive</div>
    </div>
</body>
</html>"#,
        file_name, error_html, token
    );

    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(html)
}

fn render_landing_page(file_name: &str, file_size: i64, token: &str) -> HttpResponse {
    let size_str = format_file_size(file_size);
    let icon = file_icon(file_name);

    let preview_html = match infer_media_kind(file_name) {
        MediaKind::Image => format!(
            r#"<div class="preview"><img src="/d/{}/file" alt="{}" /></div>"#,
            token, file_name
        ),
        MediaKind::Video => format!(
            r#"<div class="preview"><video src="/d/{}/file" controls preload="metadata"></video></div>"#,
            token
        ),
        MediaKind::Audio => format!(
            r#"<div class="preview audio"><audio src="/d/{}/file" controls></audio></div>"#,
            token
        ),
        MediaKind::Other => String::new(),
    };

    let html = format!(
        r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{} - Telegram Drive</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            background-color: #0e1621;
            color: #c5cdd6;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }}
        .card {{
            background: #182533;
            border: 1px solid #2b3a4a;
            border-radius: 16px;
            width: 100%;
            max-width: 600px;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,0.4);
        }}
        .brand {{
            padding: 14px 20px;
            border-bottom: 1px solid #2b3a4a;
            font-size: 13px;
            color: #40a7e3;
            font-weight: 600;
        }}
        .preview {{
            background: #0e1621;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            max-height: 500px;
            overflow: hidden;
        }}
        .preview img {{
            max-width: 100%;
            max-height: 452px;
            border-radius: 8px;
            object-fit: contain;
        }}
        .preview video {{
            max-width: 100%;
            max-height: 452px;
            border-radius: 8px;
        }}
        .preview.audio {{
            padding: 20px 24px;
        }}
        .preview audio {{
            width: 100%;
        }}
        .info {{
            padding: 20px;
            display: flex;
            align-items: center;
            gap: 14px;
        }}
        .file-icon {{
            width: 48px;
            height: 48px;
            background: rgba(64,167,227,0.12);
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            flex-shrink: 0;
        }}
        .file-meta {{ min-width: 0; flex: 1; }}
        .file-name {{
            font-size: 15px;
            font-weight: 600;
            color: #e8f0f8;
            word-break: break-word;
        }}
        .file-size {{
            font-size: 12px;
            color: #6b8499;
            margin-top: 4px;
        }}
        .actions {{ padding: 0 20px 20px; }}
        .btn-download {{
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            width: 100%;
            padding: 13px;
            background: #40a7e3;
            color: white;
            text-align: center;
            border-radius: 10px;
            font-size: 15px;
            font-weight: 600;
            text-decoration: none;
            transition: background 0.2s;
        }}
        .btn-download:hover {{ background: #3598d1; }}
        .footer {{
            padding: 12px 20px;
            border-top: 1px solid #2b3a4a;
            font-size: 11px;
            color: #4a6070;
            text-align: center;
        }}
    </style>
</head>
<body>
    <div class="card">
        <div class="brand">✈ Telegram Drive</div>
        {}
        <div class="info">
            <div class="file-icon">{}</div>
            <div class="file-meta">
                <div class="file-name">{}</div>
                <div class="file-size">{}</div>
            </div>
        </div>
        <div class="actions">
            <a class="btn-download" href="/d/{}/file?dl=1">
                ↓ &nbsp;Download
            </a>
        </div>
        <div class="footer">Shared via Telegram Drive</div>
    </div>
</body>
</html>"#,
        file_name, preview_html, icon, file_name, size_str, token
    );

    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(html)
}

// Landing page — shows preview (image/video/audio) + download button
#[get("/d/{token}")]
async fn get_shared_file(
    req: HttpRequest,
    path: web::Path<String>,
    db_conn: web::Data<DbConnection>,
    _tg_state: web::Data<Arc<TelegramState>>,
) -> impl Responder {
    let token = path.into_inner();

    let row = match check_share_auth(&req, &token, &db_conn, true) {
        Ok(r) => r,
        Err(response) => return response,
    };

    render_landing_page(&row.file_name, row.file_size, &token)
}

// File content — inline for browser preview, attachment when ?dl=1
#[get("/d/{token}/file")]
async fn get_shared_file_content(
    req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<FileQuery>,
    db_conn: web::Data<DbConnection>,
    tg_state: web::Data<Arc<TelegramState>>,
) -> impl Responder {
    let token = path.into_inner();

    let row = match check_share_auth(&req, &token, &db_conn, false) {
        Ok(r) => r,
        Err(response) => return response,
    };

    let client_opt = { tg_state.client.lock().await.clone() };
    let client = match client_opt {
        Some(c) => c,
        None => return HttpResponse::ServiceUnavailable().body("Telegram client is not connected"),
    };

    let peer = match resolve_peer(&client, row.folder_id, &tg_state.peer_cache).await {
        Ok(p) => p,
        Err(e) => {
            log::error!("Failed to resolve peer for share: {}", e);
            return HttpResponse::InternalServerError().body("Failed to locate folder");
        }
    };

    match client.get_messages_by_id(peer, &[row.message_id]).await {
        Ok(messages) => {
            if let Some(Some(msg)) = messages.first() {
                if let Some(media) = msg.media() {
                    let size = match &media {
                        Media::Document(d) => d.size() as u64,
                        _ => 0,
                    };
                    let mime = match &media {
                        Media::Document(d) => d.mime_type().unwrap_or("application/octet-stream").to_string(),
                        _ => "application/octet-stream".to_string(),
                    };
                    let filename = row.file_name.clone();
                    let force_download = query.dl.is_some();
                    let disposition = if force_download {
                        format!("attachment; filename=\"{}\"", filename)
                    } else {
                        format!("inline; filename=\"{}\"", filename)
                    };

                    let mut start_byte = 0u64;
                    let mut end_byte = if size > 0 { size - 1 } else { 0 };
                    let mut is_range = false;

                    if size > 0 {
                        if let Some(range_header) = req.headers().get(actix_web::http::header::RANGE) {
                            if let Ok(range_str) = range_header.to_str() {
                                if let Some((start, end)) = parse_range_header(range_str, size) {
                                    start_byte = start;
                                    end_byte = end;
                                    is_range = true;
                                }
                            }
                        }
                    }

                    let content_length = if is_range { end_byte - start_byte + 1 } else { size };

                    let mut download_iter = client.iter_download(&media);
                    let mut bytes_to_skip = 0usize;

                    if start_byte > 0 {
                        const MIN_CHUNK_SIZE: i32 = 4096;
                        const MAX_CHUNK_SIZE: i32 = 512 * 1024;
                        let chunk_index = (start_byte / MIN_CHUNK_SIZE as u64) as i32;
                        download_iter = download_iter
                            .chunk_size(MIN_CHUNK_SIZE)
                            .skip_chunks(chunk_index)
                            .chunk_size(MAX_CHUNK_SIZE);
                        bytes_to_skip = (start_byte - (chunk_index as u64 * MIN_CHUNK_SIZE as u64)) as usize;
                    }

                    let token_clone = token.clone();
                    let stream = async_stream::stream! {
                        let mut skipped = 0usize;
                        let mut total_yielded = 0u64;

                        while let Some(chunk) = download_iter.next().await.transpose() {
                            match chunk {
                                Ok(data) => {
                                    let mut data_slice = data;

                                    if skipped < bytes_to_skip {
                                        let to_skip = bytes_to_skip - skipped;
                                        if data_slice.len() <= to_skip {
                                            skipped += data_slice.len();
                                            continue;
                                        } else {
                                            data_slice = data_slice[to_skip..].to_vec();
                                            skipped = bytes_to_skip;
                                        }
                                    }

                                    if total_yielded + data_slice.len() as u64 > content_length {
                                        let allowed = (content_length - total_yielded) as usize;
                                        if allowed > 0 {
                                            yield Ok::<_, actix_web::Error>(web::Bytes::from(data_slice[..allowed].to_vec()));
                                        }
                                        break;
                                    } else {
                                        let len = data_slice.len() as u64;
                                        yield Ok::<_, actix_web::Error>(web::Bytes::from(data_slice));
                                        total_yielded += len;
                                        if total_yielded >= content_length { break; }
                                    }
                                }
                                Err(e) => {
                                    log::error!("Share stream error for token {}: {}", token_clone, e);
                                    break;
                                }
                            }
                        }
                    };

                    if is_range {
                        return HttpResponse::PartialContent()
                            .insert_header(("Content-Type", mime))
                            .insert_header(("Content-Range", format!("bytes {}-{}/{}", start_byte, end_byte, size)))
                            .insert_header(("Content-Length", content_length.to_string()))
                            .insert_header(("Content-Disposition", disposition))
                            .insert_header(("Accept-Ranges", "bytes"))
                            .streaming(stream);
                    } else {
                        return HttpResponse::Ok()
                            .insert_header(("Content-Type", mime))
                            .insert_header(("Content-Length", size.to_string()))
                            .insert_header(("Content-Disposition", disposition))
                            .insert_header(("Accept-Ranges", "bytes"))
                            .streaming(stream);
                    }
                }
            }
            HttpResponse::NotFound().body("Message or media not found in Telegram")
        }
        Err(e) => {
            log::error!("Failed to fetch shared message {}: {}", row.message_id, e);
            HttpResponse::InternalServerError().body(format!("Failed to retrieve file: {}", e))
        }
    }
}

#[post("/d/{token}/verify")]
async fn verify_shared_file_password(
    path: web::Path<String>,
    form: web::Form<VerifyForm>,
    db_conn: web::Data<DbConnection>,
) -> impl Responder {
    let token = path.into_inner();

    let row = match get_share_by_token(&db_conn, &token) {
        Ok(Some(r)) => r,
        Ok(None) => return HttpResponse::NotFound().body("Shared link not found"),
        Err(e) => {
            log::error!("DB error resolving token {}: {}", token, e);
            return HttpResponse::InternalServerError().body("Internal server error");
        }
    };

    if row.revoked {
        return HttpResponse::NotFound().body("This shared link has been revoked");
    }

    let hash = match &row.password_hash {
        Some(h) => h,
        None => return HttpResponse::BadRequest().body("No password required for this link"),
    };

    let salt = row.password_salt.as_deref().unwrap_or("");
    let entered_hash = hash_password(&form.password, salt);

    if &entered_hash == hash {
        let val = generate_cookie_val(&token, hash);
        let cookie = Cookie::build(format!("share_auth_{}", token), val)
            .path(format!("/d/{}", token))
            .http_only(true)
            .same_site(actix_web::cookie::SameSite::Strict)
            .max_age(actix_web::cookie::time::Duration::minutes(30))
            .finish();

        HttpResponse::Found()
            .insert_header(("Location", format!("/d/{}", token)))
            .cookie(cookie)
            .finish()
    } else {
        render_password_form(&row.file_name, &token, Some("Incorrect password. Please try again."))
    }
}

pub fn configure_share_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(get_shared_file)
       .service(get_shared_file_content)
       .service(verify_shared_file_password);
}
