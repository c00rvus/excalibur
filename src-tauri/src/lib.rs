use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::{RPC_E_CHANGED_MODE, SIZE},
        Graphics::Gdi::{
            CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
            BI_RGB, DIB_RGB_COLORS, HBITMAP, HDC, HGDIOBJ,
        },
        System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED},
        UI::Shell::{IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK},
    },
};

const APP_FOLDER_NAME: &str = "Excalibur";
const CANVAS_FILE_NAME: &str = "scene.excalidraw";
const DEFAULT_FOLDER_ID: &str = "default";
const INDEX_FILE_NAME: &str = "index.json";
const PROJECT_META_FILE_NAME: &str = "project.json";
const SETTINGS_FILE_NAME: &str = "settings.json";
const MAX_TEXT_PREVIEW_BYTES: u64 = 2 * 1024 * 1024;
const MAX_PDF_PREVIEW_BYTES: u64 = 60 * 1024 * 1024;
const MAX_IMAGE_PREVIEW_BYTES: u64 = 40 * 1024 * 1024;
const MAX_VIDEO_POSTER_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectMetadata {
    id: String,
    title: String,
    created_at: u64,
    updated_at: u64,
    elements_count: usize,
    bytes: usize,
    version: u32,
    #[serde(default)]
    folder_id: String,
    #[serde(default)]
    folder_title: String,
    #[serde(default)]
    folder_name: String,
    #[serde(default)]
    path: String,
    #[serde(default)]
    sort_order: u64,
}

#[derive(Debug, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct StoredSettings {
    storage_root: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageSettings {
    storage_root: String,
    default_storage_root: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportedFile {
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentAsset {
    name: String,
    path: String,
    extension: String,
    mime_type: String,
    kind: String,
    size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeVideoPoster {
    bytes: Vec<u8>,
    width: u32,
    height: u32,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;

    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join(SETTINGS_FILE_NAME))
}

fn read_stored_settings(app: &AppHandle) -> Result<StoredSettings, String> {
    let path = settings_path(app)?;

    if !path.exists() {
        return Ok(StoredSettings::default());
    }

    let data = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&data).map_err(|error| error.to_string())
}

fn write_stored_settings(app: &AppHandle, settings: &StoredSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let data = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;

    fs::write(path, data).map_err(|error| error.to_string())
}

fn default_storage_root(app: &AppHandle) -> Result<PathBuf, String> {
    match app.path().document_dir() {
        Ok(documents) => Ok(documents.join(APP_FOLDER_NAME)),
        Err(_) => Ok(app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join(APP_FOLDER_NAME)),
    }
}

fn storage_root(app: &AppHandle) -> Result<PathBuf, String> {
    let settings = read_stored_settings(app)?;

    if let Some(path) = settings.storage_root {
        let trimmed = path.trim();

        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    default_storage_root(app)
}

fn ensure_storage_root(root: &Path) -> Result<(), String> {
    fs::create_dir_all(projects_dir(root)).map_err(|error| error.to_string())
}

fn projects_dir(root: &Path) -> PathBuf {
    root.join("projects")
}

fn index_path(root: &Path) -> PathBuf {
    projects_dir(root).join(INDEX_FILE_NAME)
}

fn legacy_projects_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("projects"))
}

fn sanitize_id(id: &str) -> Result<String, String> {
    let sanitized: String = id
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || *character == '-' || *character == '_'
        })
        .collect();

    if sanitized.is_empty() || sanitized.len() != id.len() {
        return Err("Invalid project id.".to_string());
    }

    Ok(sanitized)
}

fn sanitize_path_part(value: &str) -> String {
    let mut sanitized = String::with_capacity(value.len());

    for character in value.chars() {
        let is_forbidden = matches!(
            character,
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
        ) || character.is_control();

        if is_forbidden {
            sanitized.push('-');
        } else {
            sanitized.push(character);
        }
    }

    let compacted = sanitized.split_whitespace().collect::<Vec<_>>().join("-");
    let trimmed = compacted.trim_matches([' ', '.', '-']).trim();

    if trimmed.is_empty() {
        "projeto".to_string()
    } else {
        trimmed.chars().take(90).collect()
    }
}

fn normalize_folder_fields(project: &mut ProjectMetadata) {
    if project.sort_order == 0 {
        project.sort_order = project.created_at;
    }
}

fn get_folder_name(folder_id: &str, folder_title: &str) -> String {
    let folder_id = folder_id.trim();
    if folder_id.is_empty() {
        String::new()
    } else if folder_id == DEFAULT_FOLDER_ID {
        sanitize_path_part(folder_title)
    } else {
        let short_id: String = folder_id.chars().take(8).collect();
        format!("{}-{}", sanitize_path_part(folder_title), short_id)
    }
}

fn make_folder_name(project: &ProjectMetadata) -> String {
    get_folder_name(&project.folder_id, &project.folder_title)
}

fn make_project_folder_name(project: &ProjectMetadata) -> Result<String, String> {
    if !project.folder_name.trim().is_empty() {
        return Ok(sanitize_path_part(&project.folder_name));
    }

    let id = sanitize_id(&project.id)?;
    let short_id: String = id.chars().take(8).collect();

    Ok(format!(
        "{}-{}",
        sanitize_path_part(&project.title),
        short_id
    ))
}

fn push_unique_path(paths: &mut Vec<PathBuf>, candidate: PathBuf) {
    if !paths.iter().any(|path| path == &candidate) {
        paths.push(candidate);
    }
}

fn copy_dir_contents(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }

    fs::create_dir_all(destination).map_err(|error| error.to_string())?;

    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let entry_type = entry.file_type().map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());

        if entry_type.is_dir() {
            copy_dir_contents(&source_path, &destination_path)?;
        } else if entry_type.is_file() {
            if let Some(parent) = destination_path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }

            fs::copy(source_path, destination_path).map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

fn write_project_meta(root: &Path, project: &ProjectMetadata) -> Result<(), String> {
    let project_meta = serde_json::to_string_pretty(project).map_err(|error| error.to_string())?;
    fs::write(
        project_dir(root, project)?.join(PROJECT_META_FILE_NAME),
        project_meta,
    )
    .map_err(|error| error.to_string())
}

fn normalize_project(root: &Path, project: &mut ProjectMetadata) -> Result<(), String> {
    normalize_folder_fields(project);
    let folder_name = make_project_folder_name(project)?;
    let project_dir = projects_dir(root)
        .join(make_folder_name(project))
        .join(&folder_name);

    project.folder_name = folder_name;
    project.path = project_dir.to_string_lossy().to_string();
    Ok(())
}

fn project_dir(root: &Path, project: &ProjectMetadata) -> Result<PathBuf, String> {
    Ok(projects_dir(root)
        .join(make_folder_name(project))
        .join(make_project_folder_name(project)?))
}

fn canvas_dir(root: &Path, project: &ProjectMetadata) -> Result<PathBuf, String> {
    Ok(project_dir(root, project)?.join("canvas"))
}

fn exports_dir(root: &Path, project: &ProjectMetadata) -> Result<PathBuf, String> {
    Ok(project_dir(root, project)?.join("exports"))
}

fn attachments_dir(root: &Path, project: &ProjectMetadata) -> Result<PathBuf, String> {
    Ok(project_dir(root, project)?.join("attachments"))
}

fn ensure_project_dirs(root: &Path, project: &ProjectMetadata) -> Result<(), String> {
    fs::create_dir_all(canvas_dir(root, project)?).map_err(|error| error.to_string())?;
    fs::create_dir_all(exports_dir(root, project)?.join("png"))
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(exports_dir(root, project)?.join("jpg"))
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(exports_dir(root, project)?.join("files"))
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(attachments_dir(root, project)?).map_err(|error| error.to_string())
}

fn canvas_path(root: &Path, project: &ProjectMetadata) -> Result<PathBuf, String> {
    Ok(canvas_dir(root, project)?.join(CANVAS_FILE_NAME))
}

fn legacy_project_dir_candidates(
    root: &Path,
    project: &ProjectMetadata,
    previous_path: &str,
) -> Result<Vec<PathBuf>, String> {
    let mut candidates = Vec::new();
    let projects_root = projects_dir(root);
    let previous_path = previous_path.trim();

    if !previous_path.is_empty() {
        let candidate = PathBuf::from(previous_path);

        if candidate.starts_with(&projects_root) {
            push_unique_path(&mut candidates, candidate);
        }
    }

    push_unique_path(
        &mut candidates,
        projects_root.join(make_project_folder_name(project)?),
    );

    Ok(candidates)
}

fn migrate_flat_project_if_needed(
    root: &Path,
    project: &ProjectMetadata,
    previous_path: &str,
) -> Result<bool, String> {
    let canonical_dir = project_dir(root, project)?;
    let canonical_canvas = canonical_dir.join("canvas").join(CANVAS_FILE_NAME);

    if canonical_canvas.exists() {
        return Ok(false);
    }

    for candidate in legacy_project_dir_candidates(root, project, previous_path)? {
        if candidate == canonical_dir {
            continue;
        }

        let candidate_canvas = candidate.join("canvas").join(CANVAS_FILE_NAME);

        if candidate_canvas.exists() {
            copy_dir_contents(&candidate, &canonical_dir)?;
            ensure_project_dirs(root, project)?;
            write_project_meta(root, project)?;
            return Ok(true);
        }
    }

    Ok(false)
}

fn cleanup_empty_directories(dir: &Path) -> Result<bool, std::io::Error> {
    if !dir.is_dir() {
        return Ok(false);
    }

    let mut has_files = false;
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            let subdir_empty = cleanup_empty_directories(&path)?;
            if subdir_empty {
                let _ = fs::remove_dir(&path);
            } else {
                has_files = true;
            }
        } else {
            has_files = true;
        }
    }

    Ok(!has_files)
}

fn cleanup_unused_folders(root: &Path) -> Result<(), std::io::Error> {
    let proj_dir = projects_dir(root);
    if !proj_dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(&proj_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            let is_empty = cleanup_empty_directories(&path)?;
            if is_empty {
                let _ = fs::remove_dir(&path);
            }
        }
    }
    Ok(())
}

fn read_index(root: &Path) -> Result<Vec<ProjectMetadata>, String> {
    let _ = cleanup_unused_folders(root);
    let path = index_path(root);

    if !path.exists() {
        return Ok(Vec::new());
    }

    let data = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let mut projects: Vec<ProjectMetadata> =
        serde_json::from_str(&data).map_err(|error| error.to_string())?;
    let mut changed = false;

    for project in &mut projects {
        let previous_path = project.path.clone();

        normalize_project(root, project)?;
        changed |= migrate_flat_project_if_needed(root, project, &previous_path)?;
    }

    projects.sort_by(|left, right| {
        left.folder_title
            .to_lowercase()
            .cmp(&right.folder_title.to_lowercase())
            .then(left.sort_order.cmp(&right.sort_order))
            .then(left.created_at.cmp(&right.created_at))
    });

    if changed {
        write_index(root, &projects)?;
    }

    Ok(projects)
}

fn write_index(root: &Path, projects: &[ProjectMetadata]) -> Result<(), String> {
    let mut sorted = projects.to_vec();

    for project in &mut sorted {
        normalize_project(root, project)?;
    }

    sorted.sort_by(|left, right| {
        left.folder_title
            .to_lowercase()
            .cmp(&right.folder_title.to_lowercase())
            .then(left.sort_order.cmp(&right.sort_order))
            .then(left.created_at.cmp(&right.created_at))
    });

    let data = serde_json::to_string_pretty(&sorted).map_err(|error| error.to_string())?;
    fs::write(index_path(root), data).map_err(|error| error.to_string())
}

fn migrate_legacy_projects_if_needed(app: &AppHandle, root: &Path) -> Result<(), String> {
    let settings = read_stored_settings(app)?;

    if settings.storage_root.is_some() || index_path(root).exists() {
        return Ok(());
    }

    let legacy_dir = legacy_projects_dir(app)?;
    let legacy_index = legacy_dir.join(INDEX_FILE_NAME);

    if !legacy_index.exists() {
        return Ok(());
    }

    let data = fs::read_to_string(legacy_index).map_err(|error| error.to_string())?;
    let mut projects: Vec<ProjectMetadata> =
        serde_json::from_str(&data).map_err(|error| error.to_string())?;

    if projects.is_empty() {
        return Ok(());
    }

    ensure_storage_root(root)?;

    for project in &mut projects {
        project.folder_name.clear();
        project.path.clear();
        normalize_project(root, project)?;
        ensure_project_dirs(root, project)?;

        let legacy_canvas = legacy_dir.join(format!("{}.excalidraw", sanitize_id(&project.id)?));

        if legacy_canvas.exists() {
            fs::copy(legacy_canvas, canvas_path(root, project)?)
                .map_err(|error| error.to_string())?;
        }

        write_project_meta(root, project)?;
    }

    write_index(root, &projects)
}

fn find_project(root: &Path, id: &str) -> Result<ProjectMetadata, String> {
    let sanitized_id = sanitize_id(id)?;
    read_index(root)?
        .into_iter()
        .find(|project| project.id == sanitized_id)
        .ok_or_else(|| "Project not found.".to_string())
}

fn sanitize_file_name(file_name: &str) -> String {
    let sanitized = sanitize_path_part(file_name);

    if sanitized.is_empty() {
        "excalibur-export.png".to_string()
    } else {
        sanitized.chars().take(120).collect()
    }
}

fn file_extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn is_text_extension(extension: &str) -> bool {
    matches!(extension, "txt" | "text" | "md" | "log" | "csv" | "json")
}

fn is_image_extension(extension: &str) -> bool {
    matches!(
        extension,
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "ico" | "avif" | "jfif"
    )
}

fn is_video_extension(extension: &str) -> bool {
    matches!(
        extension,
        "mp4" | "m4v" | "mov" | "webm" | "avi" | "mkv" | "wmv"
    )
}

fn attachment_kind(extension: &str) -> &'static str {
    match extension {
        value if is_text_extension(value) => "text",
        "pdf" => "pdf",
        value if is_image_extension(value) => "image",
        value if is_video_extension(value) => "video",
        _ => "file",
    }
}

fn attachment_mime_type(extension: &str) -> &'static str {
    match extension {
        value if is_text_extension(value) => "text/plain",
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" | "jfif" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        "wmv" => "video/x-ms-wmv",
        _ => "application/octet-stream",
    }
}

fn is_supported_attachment(extension: &str) -> bool {
    is_text_extension(extension)
        || is_image_extension(extension)
        || is_video_extension(extension)
        || extension == "pdf"
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn ensure_path_inside_storage(app: &AppHandle, path: &Path) -> Result<PathBuf, String> {
    let root = storage_root(app)?;
    ensure_storage_root(&root)?;

    let canonical_root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    let canonical_path = fs::canonicalize(path).map_err(|error| error.to_string())?;

    if !canonical_path.starts_with(canonical_root) {
        return Err("Attachment path is outside the storage folder.".to_string());
    }

    Ok(canonical_path)
}

fn export_kind(file_name: &str) -> &'static str {
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    match extension.as_str() {
        "png" => "png",
        "jpg" | "jpeg" => "jpg",
        _ => "files",
    }
}

#[tauri::command]
fn get_storage_settings(app: AppHandle) -> Result<StorageSettings, String> {
    let root = storage_root(&app)?;
    let default_root = default_storage_root(&app)?;

    ensure_storage_root(&root)?;

    Ok(StorageSettings {
        storage_root: root.to_string_lossy().to_string(),
        default_storage_root: default_root.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn set_storage_root(app: AppHandle, path: String) -> Result<StorageSettings, String> {
    let trimmed = path.trim();

    if trimmed.is_empty() {
        return Err("Storage path cannot be empty.".to_string());
    }

    let root = PathBuf::from(trimmed);
    ensure_storage_root(&root)?;
    write_stored_settings(
        &app,
        &StoredSettings {
            storage_root: Some(root.to_string_lossy().to_string()),
        },
    )?;

    get_storage_settings(app)
}

#[tauri::command]
fn reset_storage_root(app: AppHandle) -> Result<StorageSettings, String> {
    write_stored_settings(&app, &StoredSettings::default())?;
    get_storage_settings(app)
}

#[tauri::command]
fn list_projects(app: AppHandle) -> Result<Vec<ProjectMetadata>, String> {
    let root = storage_root(&app)?;
    ensure_storage_root(&root)?;
    migrate_legacy_projects_if_needed(&app, &root)?;
    read_index(&root)
}

#[tauri::command]
fn save_project(
    app: AppHandle,
    mut metadata: ProjectMetadata,
    data: String,
) -> Result<ProjectMetadata, String> {
    let root = storage_root(&app)?;

    ensure_storage_root(&root)?;
    normalize_project(&root, &mut metadata)?;
    ensure_project_dirs(&root, &metadata)?;

    metadata.bytes = data.len();
    fs::write(canvas_path(&root, &metadata)?, data).map_err(|error| error.to_string())?;

    write_project_meta(&root, &metadata)?;

    let mut projects = read_index(&root)?;
    projects.retain(|project| project.id != metadata.id);
    projects.push(metadata.clone());
    write_index(&root, &projects)?;

    Ok(metadata)
}

#[tauri::command]
fn load_project(app: AppHandle, id: String) -> Result<String, String> {
    let root = storage_root(&app)?;
    let project = find_project(&root, &id)?;
    let path = canvas_path(&root, &project)?;

    if path.exists() {
        return fs::read_to_string(path).map_err(|error| error.to_string());
    }

    migrate_flat_project_if_needed(&root, &project, &project.path)?;
    fs::read_to_string(canvas_path(&root, &project)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_project(app: AppHandle, id: String) -> Result<Vec<ProjectMetadata>, String> {
    let root = storage_root(&app)?;
    let project = find_project(&root, &id)?;
    let path = project_dir(&root, &project)?;

    if path.exists() {
        fs::remove_dir_all(&path).map_err(|error| error.to_string())?;
    }

    for candidate in legacy_project_dir_candidates(&root, &project, &project.path)? {
        if candidate != path && candidate.exists() {
            fs::remove_dir_all(candidate).map_err(|error| error.to_string())?;
        }
    }

    let mut projects = read_index(&root)?;
    projects.retain(|project| project.id != id);
    write_index(&root, &projects)?;
    Ok(projects)
}

#[tauri::command]
fn delete_folder(
    app: AppHandle,
    folder_id: String,
    folder_title: String,
) -> Result<Vec<ProjectMetadata>, String> {
    let root = storage_root(&app)?;
    let mut projects = read_index(&root)?;
    let folder_id_trimmed = folder_id.trim();

    if folder_id_trimmed.is_empty() {
        return Err("Cannot delete root folder.".to_string());
    }

    let folder_name = get_folder_name(folder_id_trimmed, &folder_title);
    if !folder_name.is_empty() {
        let folder_dir = projects_dir(&root).join(&folder_name);
        if folder_dir.exists() {
            fs::remove_dir_all(&folder_dir).map_err(|error| error.to_string())?;
        }
    }

    projects.retain(|p| p.folder_id.trim() != folder_id_trimmed);
    write_index(&root, &projects)?;

    Ok(projects)
}

#[tauri::command]
fn move_project(
    app: AppHandle,
    project_id: String,
    new_folder_id: String,
    new_folder_title: String,
) -> Result<Vec<ProjectMetadata>, String> {
    let root = storage_root(&app)?;
    let mut projects = read_index(&root)?;

    let idx = projects
        .iter()
        .position(|p| p.id == project_id)
        .ok_or_else(|| "Project not found.".to_string())?;

    let mut project = projects[idx].clone();
    let old_project_dir = project_dir(&root, &project)?;

    project.folder_id = new_folder_id;
    project.folder_title = new_folder_title;

    normalize_project(&root, &mut project)?;
    let new_project_dir = project_dir(&root, &project)?;

    if old_project_dir != new_project_dir && old_project_dir.exists() {
        if let Some(parent) = new_project_dir.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::rename(&old_project_dir, &new_project_dir).map_err(|error| error.to_string())?;
    }

    write_project_meta(&root, &project)?;

    projects[idx] = project;
    write_index(&root, &projects)?;

    Ok(projects)
}

#[tauri::command]
fn reorder_projects(
    app: AppHandle,
    ordered_ids: Vec<String>,
) -> Result<Vec<ProjectMetadata>, String> {
    let root = storage_root(&app)?;
    let mut projects = read_index(&root)?;

    for (index, id) in ordered_ids.iter().enumerate() {
        if let Some(project) = projects.iter_mut().find(|p| p.id == *id) {
            project.sort_order = (index + 1) as u64;
            write_project_meta(&root, project)?;
        }
    }

    write_index(&root, &projects)?;
    Ok(projects)
}

#[tauri::command]
fn attach_file(
    app: AppHandle,
    project_id: String,
    source_path: String,
) -> Result<AttachmentAsset, String> {
    let root = storage_root(&app)?;
    let project = find_project(&root, &project_id)?;
    let source = PathBuf::from(source_path.trim());

    if !source.is_file() {
        return Err("Arquivo nao encontrado.".to_string());
    }

    let extension = file_extension(&source);
    if !is_supported_attachment(&extension) {
        return Err("Formato de arquivo nao suportado para anexo.".to_string());
    }

    ensure_project_dirs(&root, &project)?;

    let original_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("arquivo");
    let sanitized_name = {
        let value = sanitize_path_part(original_name);
        if value.is_empty() {
            "arquivo".to_string()
        } else {
            value
        }
    };
    let destination_name = format!("{}-{}", now_millis(), sanitized_name);
    let destination = attachments_dir(&root, &project)?.join(destination_name);

    fs::copy(&source, &destination).map_err(|error| error.to_string())?;

    let size = fs::metadata(&destination)
        .map_err(|error| error.to_string())?
        .len();

    Ok(AttachmentAsset {
        name: original_name.to_string(),
        path: destination.to_string_lossy().to_string(),
        extension: extension.clone(),
        mime_type: attachment_mime_type(&extension).to_string(),
        kind: attachment_kind(&extension).to_string(),
        size,
    })
}

#[tauri::command]
fn attach_file_bytes(
    app: AppHandle,
    project_id: String,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<AttachmentAsset, String> {
    let root = storage_root(&app)?;
    let project = find_project(&root, &project_id)?;
    let source_name = file_name.trim();

    if source_name.is_empty() {
        return Err("Nome do arquivo ausente.".to_string());
    }

    let extension = file_extension(Path::new(source_name));
    if !is_supported_attachment(&extension) {
        return Err("Formato de arquivo nao suportado para anexo.".to_string());
    }

    ensure_project_dirs(&root, &project)?;

    let sanitized_name = {
        let value = sanitize_path_part(source_name);
        if value.is_empty() {
            "arquivo".to_string()
        } else {
            value
        }
    };
    let destination_name = format!("{}-{}", now_millis(), sanitized_name);
    let destination = attachments_dir(&root, &project)?.join(destination_name);

    fs::write(&destination, &bytes).map_err(|error| error.to_string())?;

    Ok(AttachmentAsset {
        name: source_name.to_string(),
        path: destination.to_string_lossy().to_string(),
        extension: extension.clone(),
        mime_type: attachment_mime_type(&extension).to_string(),
        kind: attachment_kind(&extension).to_string(),
        size: bytes.len() as u64,
    })
}

#[tauri::command]
fn read_attachment_text(app: AppHandle, path: String) -> Result<String, String> {
    let path = ensure_path_inside_storage(&app, &PathBuf::from(path.trim()))?;
    let extension = file_extension(&path);

    if !is_text_extension(&extension) {
        return Err("Este arquivo nao e um texto suportado.".to_string());
    }

    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_TEXT_PREVIEW_BYTES {
        return Err("Arquivo de texto muito grande para preview.".to_string());
    }

    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[tauri::command]
fn read_attachment_bytes(app: AppHandle, path: String) -> Result<Vec<u8>, String> {
    let path = ensure_path_inside_storage(&app, &PathBuf::from(path.trim()))?;
    let extension = file_extension(&path);

    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    let max_bytes = if extension == "pdf" {
        MAX_PDF_PREVIEW_BYTES
    } else if is_image_extension(&extension) {
        MAX_IMAGE_PREVIEW_BYTES
    } else if is_video_extension(&extension) {
        MAX_VIDEO_POSTER_BYTES
    } else {
        return Err("Este arquivo nao tem leitura binaria de preview.".to_string());
    };

    if metadata.len() > max_bytes {
        return Err("Arquivo muito grande para preview.".to_string());
    }

    fs::read(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_attachment_file(app: AppHandle, path: String) -> Result<(), String> {
    let path = ensure_path_inside_storage(&app, &PathBuf::from(path.trim()))?;

    if !path.is_file() {
        return Err("Arquivo nao encontrado.".to_string());
    }

    open_path_with_system(&path)
}

#[tauri::command]
fn create_video_poster(app: AppHandle, path: String) -> Result<NativeVideoPoster, String> {
    let path = ensure_path_inside_storage(&app, &PathBuf::from(path.trim()))?;
    let extension = file_extension(&path);

    if !path.is_file() {
        return Err("Arquivo nao encontrado.".to_string());
    }

    if !is_video_extension(&extension) {
        return Err("Este arquivo nao e um video suportado.".to_string());
    }

    create_native_video_poster(&path)
}

#[cfg(target_os = "windows")]
struct ComGuard {
    should_uninitialize: bool,
}

#[cfg(target_os = "windows")]
impl ComGuard {
    fn init() -> Result<Self, String> {
        let result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };

        if result.is_ok() {
            return Ok(Self {
                should_uninitialize: true,
            });
        }

        if result == RPC_E_CHANGED_MODE {
            return Ok(Self {
                should_uninitialize: false,
            });
        }

        Err(format!("Nao foi possivel iniciar COM: {result:?}"))
    }
}

#[cfg(target_os = "windows")]
impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.should_uninitialize {
            unsafe {
                CoUninitialize();
            }
        }
    }
}

#[cfg(target_os = "windows")]
struct BitmapGuard(HBITMAP);

#[cfg(target_os = "windows")]
impl Drop for BitmapGuard {
    fn drop(&mut self) {
        if !self.0 .0.is_null() {
            unsafe {
                let _ = DeleteObject(HGDIOBJ(self.0 .0));
            }
        }
    }
}

#[cfg(target_os = "windows")]
struct DcGuard(HDC);

#[cfg(target_os = "windows")]
impl Drop for DcGuard {
    fn drop(&mut self) {
        if !self.0 .0.is_null() {
            unsafe {
                let _ = DeleteDC(self.0);
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn create_native_video_poster(path: &Path) -> Result<NativeVideoPoster, String> {
    let _com = ComGuard::init()?;
    let path_wide: Vec<u16> = path
        .as_os_str()
        .to_string_lossy()
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let factory: IShellItemImageFactory = unsafe {
        SHCreateItemFromParsingName(PCWSTR(path_wide.as_ptr()), None)
            .map_err(|error| error.to_string())?
    };
    let bitmap = unsafe {
        factory
            .GetImage(SIZE { cx: 1280, cy: 720 }, SIIGBF_BIGGERSIZEOK)
            .map_err(|error| error.to_string())?
    };

    encode_hbitmap_as_png(BitmapGuard(bitmap))
}

#[cfg(not(target_os = "windows"))]
fn create_native_video_poster(_path: &Path) -> Result<NativeVideoPoster, String> {
    Err("Preview nativo de video esta disponivel apenas no Windows.".to_string())
}

#[cfg(target_os = "windows")]
fn encode_hbitmap_as_png(bitmap: BitmapGuard) -> Result<NativeVideoPoster, String> {
    let mut bitmap_info = BITMAP::default();
    let object_size = std::mem::size_of::<BITMAP>() as i32;
    let object_result = unsafe {
        GetObjectW(
            HGDIOBJ(bitmap.0 .0),
            object_size,
            Some(&mut bitmap_info as *mut BITMAP as *mut _),
        )
    };

    if object_result == 0 {
        return Err("Nao foi possivel ler a miniatura do video.".to_string());
    }

    let width = bitmap_info.bmWidth.max(1) as u32;
    let height = bitmap_info.bmHeight.abs().max(1) as u32;
    let mut info = BITMAPINFO::default();
    info.bmiHeader.biSize =
        std::mem::size_of::<windows::Win32::Graphics::Gdi::BITMAPINFOHEADER>() as u32;
    info.bmiHeader.biWidth = width as i32;
    info.bmiHeader.biHeight = -(height as i32);
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB.0;

    let dc = unsafe { CreateCompatibleDC(None) };
    if dc.0.is_null() {
        return Err("Nao foi possivel criar o contexto da miniatura.".to_string());
    }
    let dc = DcGuard(dc);
    let mut bgra = vec![0u8; width as usize * height as usize * 4];
    let copied_lines = unsafe {
        GetDIBits(
            dc.0,
            bitmap.0,
            0,
            height,
            Some(bgra.as_mut_ptr() as *mut _),
            &mut info,
            DIB_RGB_COLORS,
        )
    };

    if copied_lines == 0 {
        return Err("Nao foi possivel copiar a miniatura do video.".to_string());
    }

    let has_alpha = bgra.chunks_exact(4).any(|pixel| pixel[3] != 0);
    for pixel in bgra.chunks_exact_mut(4) {
        pixel.swap(0, 2);
        if !has_alpha {
            pixel[3] = 255;
        }
    }

    let bytes = encode_png_rgba(width, height, &bgra)?;

    Ok(NativeVideoPoster {
        bytes,
        width,
        height,
    })
}

#[cfg(target_os = "windows")]
fn encode_png_rgba(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let mut cursor = Cursor::new(&mut bytes);
    {
        let mut encoder = png::Encoder::new(&mut cursor, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|error| error.to_string())?;
        writer
            .write_image_data(rgba)
            .map_err(|error| error.to_string())?;
    }

    Ok(bytes)
}

#[cfg(target_os = "windows")]
fn open_path_with_system(path: &Path) -> Result<(), String> {
    let shell_path = windows_shell_path(path);

    std::process::Command::new("cmd")
        .args(["/C", "start", ""])
        .arg(shell_path)
        .spawn()
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[cfg(target_os = "windows")]
fn windows_shell_path(path: &Path) -> String {
    let value = path.to_string_lossy();

    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{}", rest)
    } else if let Some(rest) = value.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        value.into_owned()
    }
}

#[cfg(target_os = "macos")]
fn open_path_with_system(path: &Path) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(path)
        .spawn()
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_path_with_system(path: &Path) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
fn delete_attachment_file(app: AppHandle, path: String) -> Result<(), String> {
    let path = ensure_path_inside_storage(&app, &PathBuf::from(path.trim()))?;

    if path.is_file() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn save_export(
    app: AppHandle,
    project_id: String,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<ExportedFile, String> {
    let root = storage_root(&app)?;
    let project = find_project(&root, &project_id)?;
    let file_name = sanitize_file_name(&file_name);
    let path = exports_dir(&root, &project)?
        .join(export_kind(&file_name))
        .join(file_name);

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::write(&path, bytes).map_err(|error| error.to_string())?;

    Ok(ExportedFile {
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn save_export_to_path(path: String, bytes: Vec<u8>) -> Result<ExportedFile, String> {
    let path = PathBuf::from(path.trim());

    if path.as_os_str().is_empty() {
        return Err("Caminho de exportacao ausente.".to_string());
    }

    let extension = file_extension(&path);
    if !matches!(extension.as_str(), "png" | "jpg" | "jpeg") {
        return Err("Formato de exportacao nao suportado.".to_string());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::write(&path, bytes).map_err(|error| error.to_string())?;

    Ok(ExportedFile {
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn set_titlebar_color(window: tauri::Window, theme: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_CAPTION_COLOR, DWMWA_USE_IMMERSIVE_DARK_MODE};

        let hwnd = window.hwnd().map_err(|e| e.to_string())?;

        let is_dark = theme == "dark";
        
        let dark_mode: i32 = if is_dark { 1 } else { 0 };
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_USE_IMMERSIVE_DARK_MODE,
                &dark_mode as *const _ as *const _,
                std::mem::size_of::<i32>() as u32,
            );
        }

        let color: u32 = if is_dark {
            0x00212121
        } else {
            0x00eef0f0
        };

        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_CAPTION_COLOR,
                &color as *const _ as *const _,
                std::mem::size_of::<u32>() as u32,
            );
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_storage_settings,
            set_storage_root,
            reset_storage_root,
            list_projects,
            save_project,
            load_project,
            delete_project,
            delete_folder,
            move_project,
            reorder_projects,
            attach_file,
            attach_file_bytes,
            read_attachment_text,
            read_attachment_bytes,
            open_attachment_file,
            create_video_poster,
            delete_attachment_file,
            save_export,
            save_export_to_path,
            set_titlebar_color
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
