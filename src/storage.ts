import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";

export type ProjectMetadata = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  elementsCount: number;
  bytes: number;
  version: number;
  folderId?: string;
  folderTitle?: string;
  folderName?: string;
  path?: string;
  sortOrder?: number;
};

export type ExportedFile = {
  path: string;
};

export type AttachmentKind = "text" | "pdf" | "image" | "video" | "file";

export type AttachmentAsset = {
  name: string;
  path: string;
  extension: string;
  mimeType: string;
  kind: AttachmentKind;
  size: number;
};

export type NativeVideoPoster = {
  bytes: number[];
  width: number;
  height: number;
};

export type StorageSettings = {
  storageRoot: string;
  defaultStorageRoot: string;
};

const INDEX_KEY = "excalibur.projects.index";
const PROJECT_KEY_PREFIX = "excalibur.project.";
const STORAGE_SETTINGS_KEY = "excalibur.storage.settings";

function getLocalIndex(): ProjectMetadata[] {
  const raw = localStorage.getItem(INDEX_KEY);

  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as ProjectMetadata[];
  } catch {
    return [];
  }
}

function setLocalIndex(projects: ProjectMetadata[]) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(projects));
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.click();

  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function getFileNameFromSavePath(path: string) {
  return path.split(/[\\/]/).pop() || "excalibur-export.png";
}

export async function listProjects(): Promise<ProjectMetadata[]> {
  if (isTauri()) {
    return invoke<ProjectMetadata[]>("list_projects");
  }

  return getLocalIndex();
}

export async function saveProject(
  metadata: ProjectMetadata,
  data: string,
): Promise<ProjectMetadata> {
  if (isTauri()) {
    return invoke<ProjectMetadata>("save_project", { metadata, data });
  }

  localStorage.setItem(`${PROJECT_KEY_PREFIX}${metadata.id}`, data);
  const projects = getLocalIndex();
  const next = [
    metadata,
    ...projects.filter((project) => project.id !== metadata.id),
  ];

  setLocalIndex(next);
  return metadata;
}

export async function loadProject(id: string): Promise<string> {
  if (isTauri()) {
    return invoke<string>("load_project", { id });
  }

  const data = localStorage.getItem(`${PROJECT_KEY_PREFIX}${id}`);

  if (!data) {
    throw new Error("Projeto nao encontrado.");
  }

  return data;
}

export async function deleteProject(id: string): Promise<ProjectMetadata[]> {
  if (isTauri()) {
    return invoke<ProjectMetadata[]>("delete_project", { id });
  }

  localStorage.removeItem(`${PROJECT_KEY_PREFIX}${id}`);
  const next = getLocalIndex().filter((project) => project.id !== id);
  setLocalIndex(next);
  return next;
}

export async function saveExport(
  projectId: string,
  fileName: string,
  bytes: number[],
  blob: Blob,
): Promise<ExportedFile> {
  if (isTauri()) {
    return invoke<ExportedFile>("save_export", { projectId, fileName, bytes });
  }

  downloadBlob(blob, fileName);
  return { path: fileName };
}

export async function saveExportToPath(
  path: string,
  bytes: number[],
  blob: Blob,
): Promise<ExportedFile> {
  if (isTauri()) {
    return invoke<ExportedFile>("save_export_to_path", { path, bytes });
  }

  downloadBlob(blob, getFileNameFromSavePath(path));
  return { path };
}

export async function attachFileToProject(
  projectId: string,
  sourcePath: string,
): Promise<AttachmentAsset> {
  if (!isTauri()) {
    throw new Error("Anexos persistentes estao disponiveis no app desktop.");
  }

  return invoke<AttachmentAsset>("attach_file", { projectId, sourcePath });
}

export async function attachFileBytesToProject(
  projectId: string,
  fileName: string,
  bytes: number[],
): Promise<AttachmentAsset> {
  if (!isTauri()) {
    throw new Error("Anexos persistentes estao disponiveis no app desktop.");
  }

  return invoke<AttachmentAsset>("attach_file_bytes", { projectId, fileName, bytes });
}

export async function readAttachmentText(path: string): Promise<string> {
  if (!isTauri()) {
    throw new Error("Preview de texto esta disponivel no app desktop.");
  }

  return invoke<string>("read_attachment_text", { path });
}

export async function readAttachmentBytes(path: string): Promise<number[]> {
  if (!isTauri()) {
    throw new Error("Preview binario esta disponivel no app desktop.");
  }

  return invoke<number[]>("read_attachment_bytes", { path });
}

export async function deleteAttachmentFile(path: string): Promise<void> {
  if (!isTauri()) {
    return;
  }

  return invoke<void>("delete_attachment_file", { path });
}

export async function openAttachmentFile(path: string): Promise<void> {
  if (!isTauri()) {
    window.open(getAttachmentAssetUrl(path), "_blank", "noopener");
    return;
  }

  return invoke<void>("open_attachment_file", { path });
}

export async function createVideoPoster(path: string): Promise<NativeVideoPoster> {
  if (!isTauri()) {
    throw new Error("Preview nativo de video esta disponivel no app desktop.");
  }

  return invoke<NativeVideoPoster>("create_video_poster", { path });
}

export function getAttachmentAssetUrl(path: string) {
  return isTauri() ? convertFileSrc(path) : path;
}

export async function getStorageSettings(): Promise<StorageSettings> {
  if (isTauri()) {
    return invoke<StorageSettings>("get_storage_settings");
  }

  const raw = localStorage.getItem(STORAGE_SETTINGS_KEY);

  if (raw) {
    try {
      return JSON.parse(raw) as StorageSettings;
    } catch {
      localStorage.removeItem(STORAGE_SETTINGS_KEY);
    }
  }

  return {
    storageRoot: "localStorage do navegador",
    defaultStorageRoot: "localStorage do navegador",
  };
}

export async function setStorageRoot(path: string): Promise<StorageSettings> {
  if (isTauri()) {
    return invoke<StorageSettings>("set_storage_root", { path });
  }

  const settings = {
    storageRoot: path,
    defaultStorageRoot: "localStorage do navegador",
  };

  localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(settings));
  return settings;
}

export async function resetStorageRoot(): Promise<StorageSettings> {
  if (isTauri()) {
    return invoke<StorageSettings>("reset_storage_root");
  }

  localStorage.removeItem(STORAGE_SETTINGS_KEY);
  return getStorageSettings();
}
