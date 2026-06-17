import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  exportToBlob,
  getSceneVersion,
  MainMenu,
  restore,
  serializeAsJSON,
  THEME,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  DataURL,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, FileId } from "@excalidraw/excalidraw/element/types";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ChevronDown,
  Clock3,
  Copy,
  ExternalLink,
  FileImage,
  Folder,
  FolderOpen,
  FolderPlus,
  ImageDown,
  Layers3,
  Moon,
  MousePointer2,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Trash2,
  Users,
  Eye,
  WifiOff,
  X,
} from "lucide-react";
import "./App.css";
import { AttachmentPreview } from "./AttachmentPreview";
import {
  ATTACHMENTS_PAYLOAD_KEY,
  canPreviewAttachment,
  CanvasAttachment,
  AttachmentDisplayMode,
  getAttachmentKindFromExtension,
  getAttachmentSize,
  getExtensionFromPath,
  getFileNameFromPath,
  normalizeAttachments,
} from "./attachments";
import {
  canRenderNativeAttachmentPreview,
  NativePreviewResult,
  NativePreviewProgress,
  renderAttachmentNativePreview,
} from "./nativePreviews";
import {
  attachFileBytesToProject,
  attachFileToProject,
  AttachmentAsset,
  deleteAttachmentFile,
  deleteProject,
  getAttachmentAssetUrl,
  getStorageSettings,
  listProjects,
  loadProject,
  openAttachmentFile,
  ProjectMetadata,
  resetStorageRoot,
  saveExport,
  saveExportToPath,
  saveProject,
  setStorageRoot,
  StorageSettings,
} from "./storage";
import {
  CollaborationEvent,
  CollaborationRole,
  CollaborationSessionInfo,
  getCollaborationDebugLogPath,
  getCollaborationStatus,
  joinCollaborationSession,
  respondCollaborationJoinRequest,
  sendCollaborationCursorUpdate,
  sendCollaborationUpdate,
  startCollaborationSession,
  stopCollaborationSession,
  writeCollaborationDebugLog,
} from "./collaboration";

type ExportFormat = "png" | "jpeg";
type AppTheme = "light" | "dark";
type PendingAttachmentSource =
  | {
      type: "path";
      path: string;
      name: string;
    }
  | {
      type: "bytes";
      fileName: string;
      bytes: number[];
      name: string;
    };

type PreviewConversionState = {
  fileName: string;
  label: string;
  progress: number;
};

type CollaborationUiState = {
  status: "idle" | "starting" | "hosting" | "joining" | "connected" | "stopping" | "error";
  role?: CollaborationRole;
  sessionId?: string;
  canvasId?: string;
  peerId?: string;
  code?: string;
  peerCount?: number;
  readOnly?: boolean;
  message?: string;
};

type PendingCollaborationRequest = {
  requestId: string;
  peerId: string;
  message: string;
  defaultReadOnly: boolean;
  createdAt: number;
};

function isGuestCollaborationState(state: CollaborationUiState) {
  return state.role === "guest" && state.status !== "idle";
}

type ProjectFolder = {
  id: string;
  title: string;
  projects: ProjectMetadata[];
  createdAt?: number;
  sortOrder?: number;
  color?: string;
};

const APP_VERSION = 1;
const AUTO_SAVE_DELAY_MS = 1_200;
const DEFAULT_FOLDER_ID = "default";
const DEFAULT_FOLDER_TITLE = "Projetos";
const DEFAULT_DARK_CANVAS_BACKGROUND = "#212121";
const DEFAULT_LIGHT_CANVAS_BACKGROUND = "#ffffff";
const EMPTY_FILES: BinaryFiles = {};
const FOLDERS_STORAGE_KEY = "excalibur.folders";
const THEME_STORAGE_KEY = "excalibur.theme";
const LAST_LIGHT_BG_KEY = "excalibur.lastLightBg";
const LAST_DARK_BG_KEY = "excalibur.lastDarkBg";
const MAX_DROPPED_ATTACHMENT_BYTES = 128 * 1024 * 1024;
const COLLABORATION_SCENE_UPDATE_DELAY_MS = 60;
const COLLABORATION_CURSOR_UPDATE_DELAY_MS = 32;
const COLLABORATION_REMOTE_APPLY_GUARD_MS = 120;
const REMOTE_CURSOR_TTL_MS = 2_400;
const REMOTE_CURSOR_COLORS = [
  "#80CBC4",
  "#7AA2F7",
  "#F7768E",
  "#E0AF68",
  "#9ECE6A",
  "#BB9AF7",
];

type CanvasInitialData = {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
};

type SceneViewport = {
  scrollX: number;
  scrollY: number;
  zoom: number;
};

type RemoteCursor = {
  peerId: string;
  label: string;
  color: string;
  x: number;
  y: number;
  visible: boolean;
  updatedAt: number;
};

type CollaborationCursorPayload = {
  x: number;
  y: number;
  visible: boolean;
  revision?: number;
};

function isDragInsideCurrentTarget(event: React.DragEvent<HTMLElement>) {
  const bounds = event.currentTarget.getBoundingClientRect();

  return (
    event.clientX >= bounds.left &&
    event.clientX <= bounds.right &&
    event.clientY >= bounds.top &&
    event.clientY <= bounds.bottom
  );
}

function hasProjectDropTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("[data-project-id]"));
}

function getDroppedFilePath(file: File) {
  return (file as File & { path?: string }).path?.trim() || "";
}

function hasDraggedFiles(event: React.DragEvent<HTMLElement>) {
  return (
    Array.from(event.dataTransfer.types).includes("Files") ||
    event.dataTransfer.files.length > 0
  );
}

function stopFileDragEvent(event: React.DragEvent<HTMLElement>) {
  event.preventDefault();
  event.stopPropagation();
  event.nativeEvent.stopImmediatePropagation();
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();

  return (
    target.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select"
  );
}

function normalizeFolder(folder: Partial<ProjectFolder>): ProjectFolder {
  const now = Date.now();
  const id = folder.id?.trim() || DEFAULT_FOLDER_ID;
  const title = folder.title?.trim() || DEFAULT_FOLDER_TITLE;
  const createdAt = folder.createdAt ?? now;

  return {
    id,
    title,
    projects: folder.projects ?? [],
    createdAt,
    sortOrder: folder.sortOrder ?? createdAt,
    color: folder.color,
  };
}

function sortFolders(folders: ProjectFolder[]) {
  return [...folders].map(normalizeFolder).sort((a, b) => {
    const orderCompare = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);

    if (orderCompare !== 0) {
      return orderCompare;
    }

    return a.title.localeCompare(b.title, "pt-BR", { sensitivity: "base" });
  });
}

const PREDEFINED_COLORS = [
  { name: "Padrão", key: "", hex: "currentColor" },
  { name: "Vermelho", key: "red", hex: "var(--folder-color-red)" },
  { name: "Laranja", key: "orange", hex: "var(--folder-color-orange)" },
  { name: "Verde", key: "green", hex: "var(--folder-color-green)" },
  { name: "Azul", key: "blue", hex: "var(--folder-color-blue)" },
  { name: "Roxo", key: "purple", hex: "var(--folder-color-purple)" },
  { name: "Rosa", key: "pink", hex: "var(--folder-color-pink)" },
];

function getStoredFolders() {
  const raw = localStorage.getItem(FOLDERS_STORAGE_KEY);
  let folders: ProjectFolder[] = [];

  if (raw) {
    try {
      folders = JSON.parse(raw) as ProjectFolder[];
    } catch {
      localStorage.removeItem(FOLDERS_STORAGE_KEY);
    }
  }

  return mergeFolders([], folders);
}

function persistStoredFolders(folders: ProjectFolder[]) {
  const data = sortFolders(folders).map(({ id, title, createdAt, sortOrder, color }) => ({
    id,
    title,
    createdAt,
    sortOrder,
    color,
  }));

  localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(data));
}

function mergeFolders(...folderGroups: ProjectFolder[][]) {
  const folderMap = new Map<string, ProjectFolder>();

  for (const folder of folderGroups.flat()) {
    const normalized = normalizeFolder(folder);
    const existing = folderMap.get(normalized.id);

    folderMap.set(normalized.id, {
      ...normalized,
      projects: existing?.projects?.length ? existing.projects : normalized.projects,
      createdAt: Math.min(existing?.createdAt ?? normalized.createdAt ?? 0, normalized.createdAt ?? 0),
      sortOrder: Math.min(existing?.sortOrder ?? normalized.sortOrder ?? 0, normalized.sortOrder ?? 0),
      color: existing?.color ?? normalized.color,
    });
  }

  return sortFolders(Array.from(folderMap.values()));
}

function foldersFromProjects(projects: ProjectMetadata[]) {
  const folderMap = new Map<string, ProjectFolder>();

  for (const project of projects.map(normalizeProject)) {
    const folderId = getProjectFolderId(project);
    if (!folderId || folderId === DEFAULT_FOLDER_ID) {
      continue;
    }
    const existing = folderMap.get(folderId);
    const sortOrder = Math.min(
      existing?.sortOrder ?? getProjectSortOrder(project),
      getProjectSortOrder(project),
    );

    folderMap.set(folderId, {
      id: folderId,
      title: getProjectFolderTitle(project),
      projects: [],
      createdAt: existing?.createdAt ?? project.createdAt,
      sortOrder,
    });
  }

  return sortFolders(Array.from(folderMap.values()));
}

function getProjectFolderId(project: ProjectMetadata) {
  return project.folderId?.trim() || "";
}

function getProjectFolderTitle(project: ProjectMetadata) {
  return project.folderTitle?.trim() || "";
}

function getProjectSortOrder(project: ProjectMetadata) {
  return project.sortOrder ?? project.createdAt;
}

function createProjectTitle(projects: ProjectMetadata[], folderId: string) {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const date = `${year}-${month}-${day}`;
  const projectCount = projects.filter(
    (project) => getProjectFolderId(project) === folderId,
  ).length;

  return `Canvas ${date} ${projectCount + 1}`;
}



function getCleanAppState(appState: AppState): Partial<AppState> {
  return {
    exportBackground: appState.exportBackground,
    exportEmbedScene: true,
    exportScale: appState.exportScale,
    gridModeEnabled: appState.gridModeEnabled,
    gridSize: appState.gridSize,
    name: appState.name,
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
    theme: appState.theme,
    viewBackgroundColor: appState.viewBackgroundColor,
    zoom: appState.zoom,
  };
}

function formatRelativeTime(value: number) {
  const elapsedSeconds = Math.max(1, Math.floor((Date.now() - value) / 1000));

  if (elapsedSeconds < 60) {
    return "agora";
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);

  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} min`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);

  if (elapsedHours < 24) {
    return `${elapsedHours} h`;
  }

  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function bytesToLabel(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function normalizeProject(project: ProjectMetadata): ProjectMetadata {
  return {
    ...project,
    folderId: getProjectFolderId(project),
    folderTitle: getProjectFolderTitle(project),
    sortOrder: getProjectSortOrder(project),
  };
}

function sortProjects(projects: ProjectMetadata[]) {
  return [...projects].map(normalizeProject).sort((a, b) => {
    const folderCompare = getProjectFolderTitle(a).localeCompare(
      getProjectFolderTitle(b),
      "pt-BR",
      { sensitivity: "base" },
    );

    if (folderCompare !== 0) {
      return folderCompare;
    }

    return getProjectSortOrder(a) - getProjectSortOrder(b);
  });
}

function upsertProject(projects: ProjectMetadata[], project: ProjectMetadata) {
  const normalizedProject = normalizeProject(project);
  const existingIndex = projects.findIndex((item) => item.id === project.id);

  if (existingIndex === -1) {
    return sortProjects([...projects, normalizedProject]);
  }

  return projects.map((item) =>
    item.id === normalizedProject.id ? normalizedProject : item,
  );
}

function groupProjects(
  projects: ProjectMetadata[],
  explicitFolders: ProjectFolder[] = [],
): ProjectFolder[] {
  const folderMap = new Map<string, ProjectFolder>();

  for (const folder of mergeFolders([], explicitFolders)) {
    folderMap.set(folder.id, {
      ...folder,
      projects: [],
    });
  }

  for (const project of sortProjects(projects)) {
    const folderId = getProjectFolderId(project);
    const folderTitle = getProjectFolderTitle(project);
    const folder = folderMap.get(folderId);

    if (folder) {
      folder.projects.push(project);
    } else {
      folderMap.set(folderId, {
        id: folderId,
        title: folderTitle,
        projects: [project],
        createdAt: project.createdAt,
        sortOrder: getProjectSortOrder(project),
      });
    }
  }

  return sortFolders(Array.from(folderMap.values()));
}


function getStoredTheme(): AppTheme {
  return localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
}

function getExcalidrawTheme(theme: AppTheme) {
  return theme === "dark" ? THEME.DARK : THEME.LIGHT;
}

function getCanvasBackground(theme: AppTheme) {
  return theme === "dark"
    ? DEFAULT_DARK_CANVAS_BACKGROUND
    : DEFAULT_LIGHT_CANVAS_BACKGROUND;
}

function ExcaliburMainMenu() {
  return (
    <MainMenu>
      <MainMenu.DefaultItems.LoadScene />
      <MainMenu.DefaultItems.SaveToActiveFile />
      <MainMenu.DefaultItems.Export />
      <MainMenu.DefaultItems.SaveAsImage />
      <MainMenu.DefaultItems.SearchMenu />
      <MainMenu.DefaultItems.Help />
      <MainMenu.DefaultItems.ClearCanvas />
      <MainMenu.Separator />
      <MainMenu.DefaultItems.ToggleTheme />
      <MainMenu.DefaultItems.ChangeCanvasBackground />
    </MainMenu>
  );
}

function normalizeColor(value?: string) {
  return value?.trim().toLocaleLowerCase("en-US") ?? "";
}

function getThemeAwareCanvasBackground(
  currentBackground: string | undefined,
  theme: AppTheme,
  lastLightBg: string,
  lastDarkBg: string,
  previousTheme?: AppTheme,
) {
  const normalizedBackground = normalizeColor(currentBackground);

  if (!normalizedBackground) {
    return theme === "dark" ? lastDarkBg : lastLightBg;
  }

  if (
    previousTheme &&
    (normalizedBackground === normalizeColor(theme === "dark" ? lastLightBg : lastDarkBg) ||
     normalizedBackground === normalizeColor(previousTheme === "dark" ? lastDarkBg : lastLightBg))
  ) {
    return theme === "dark" ? lastDarkBg : lastLightBg;
  }

  return currentBackground;
}

function sanitizeFilePart(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80);
}

async function blobToBytes(blob: Blob) {
  const buffer = await blob.arrayBuffer();
  return Array.from(new Uint8Array(buffer));
}

function getExportExtension(format: ExportFormat) {
  return format === "png" ? "png" : "jpg";
}

function getExportLabel(format: ExportFormat) {
  return format === "png" ? "PNG" : "JPG";
}

function getExportMimeType(format: ExportFormat) {
  return format === "png" ? "image/png" : "image/jpeg";
}

function getExportFileName(projectTitle: string, format: ExportFormat) {
  return `${sanitizeFilePart(projectTitle) || "excalibur"}-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.${getExportExtension(format)}`;
}

function withExportPathExtension(path: string, format: ExportFormat) {
  const extension = getExportExtension(format);
  const matchingExtension = format === "png" ? /\.png$/i : /\.(jpe?g)$/i;

  if (matchingExtension.test(path)) {
    return path;
  }

  return path.replace(/\.(png|jpe?g)$/i, "") + `.${extension}`;
}

function getCanvasPayload(
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles,
  attachments: CanvasAttachment[],
  options: { includeFiles?: boolean } = {},
) {
  const includeFiles = options.includeFiles ?? true;
  const payload = JSON.parse(
    serializeAsJSON(
      elements,
      getCleanAppState(appState),
      includeFiles ? files : EMPTY_FILES,
      "local",
    ),
  );

  if (!includeFiles) {
    delete payload.files;
  }

  payload[ATTACHMENTS_PAYLOAD_KEY] = attachments;

  return JSON.stringify(payload);
}

function getFilesSignature(files: BinaryFiles) {
  return JSON.stringify(
    Object.keys(files)
      .sort()
      .map((fileId) => {
        const file = files[fileId as FileId];

        return {
          id: file.id,
          mimeType: file.mimeType,
          dataLength: file.dataURL.length,
          created: file.created,
        };
      }),
  );
}

function getPayloadFiles(payload: Record<string, unknown>) {
  const files = payload.files;

  if (!files || typeof files !== "object" || Array.isArray(files)) {
    return null;
  }

  return files as BinaryFiles;
}

function mergeBinaryFiles(currentFiles: BinaryFiles, incomingFiles: BinaryFiles | null) {
  if (!incomingFiles || Object.keys(incomingFiles).length === 0) {
    return currentFiles;
  }

  return {
    ...currentFiles,
    ...incomingFiles,
  };
}

function getProjectSignature(
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  attachments: CanvasAttachment[],
) {
  return JSON.stringify({
    sceneVersion: getSceneVersion(elements),
    exportBackground: appState.exportBackground,
    gridModeEnabled: appState.gridModeEnabled,
    gridSize: appState.gridSize,
    viewBackgroundColor: appState.viewBackgroundColor,
    attachments: attachments.map((attachment) => ({
      id: attachment.id,
      displayMode: attachment.displayMode,
      path: attachment.path,
      x: Math.round(attachment.x),
      y: Math.round(attachment.y),
      width: Math.round(attachment.width),
      height: Math.round(attachment.height),
      nativeElementIds: attachment.nativeElementIds ?? [],
      nativePageCount: attachment.nativePageCount ?? 0,
      nativeSourcePageCount: attachment.nativeSourcePageCount ?? 0,
    })),
  });
}

function getZoomValue(appState: Partial<AppState> | null | undefined) {
  const zoom = appState?.zoom as { value?: number } | number | undefined;

  if (typeof zoom === "number") {
    return zoom || 1;
  }

  return zoom?.value || 1;
}

function getSceneViewport(appState: Partial<AppState> | null | undefined): SceneViewport {
  return {
    scrollX: Number(appState?.scrollX || 0),
    scrollY: Number(appState?.scrollY || 0),
    zoom: getZoomValue(appState),
  };
}

function getStoredCanvasAttachments(payload: Record<string, unknown>) {
  return normalizeAttachments(
    payload[ATTACHMENTS_PAYLOAD_KEY] ??
      (payload.excalibur as { attachments?: unknown } | undefined)?.attachments,
  );
}

function getChangedElementIds(
  previousElements: readonly ExcalidrawElement[],
  nextElements: readonly ExcalidrawElement[],
) {
  const previousById = new Map(previousElements.map((element) => [element.id, element]));
  const changedIds = new Set<string>();

  nextElements.forEach((element) => {
    const previous = previousById.get(element.id);

    if (
      !previous ||
      previous.version !== element.version ||
      previous.versionNonce !== element.versionNonce ||
      previous.isDeleted !== element.isDeleted
    ) {
      changedIds.add(element.id);
    }
  });

  previousElements.forEach((element) => {
    if (!nextElements.some((nextElement) => nextElement.id === element.id)) {
      changedIds.add(element.id);
    }
  });

  return changedIds;
}

function getRemoteCursorColor(peerId: string) {
  let hash = 0;

  for (const character of peerId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return REMOTE_CURSOR_COLORS[hash % REMOTE_CURSOR_COLORS.length];
}

function getRemoteCursorLabel(peerId: string) {
  const compact = peerId.trim().replace(/[^a-z0-9]/gi, "").slice(0, 4);

  return compact ? compact.toUpperCase() : "PEER";
}

function parseCollaborationCursorPayload(
  payload: string | null | undefined,
): CollaborationCursorPayload | null {
  if (!payload) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload) as Partial<CollaborationCursorPayload>;
    const x = Number(parsed.x);
    const y = Number(parsed.y);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }

    return {
      x,
      y,
      visible: parsed.visible !== false,
      revision:
        typeof parsed.revision === "number" && Number.isFinite(parsed.revision)
          ? parsed.revision
          : undefined,
    };
  } catch {
    return null;
  }
}

function preserveLocalViewport(
  remoteAppState: Partial<AppState>,
  localAppState: Partial<AppState> | null | undefined,
) {
  if (!localAppState) {
    return remoteAppState;
  }

  return {
    ...remoteAppState,
    scrollX: localAppState.scrollX,
    scrollY: localAppState.scrollY,
    zoom: localAppState.zoom,
  } as Partial<AppState>;
}

const NATIVE_PREVIEW_MAX_WIDTH = 640;
const NATIVE_PREVIEW_PAGE_GAP = 28;

function getNativePreviewLayout(result: NativePreviewResult) {
  const sizes = result.pages.map((page) => {
    const scale = Math.min(1, NATIVE_PREVIEW_MAX_WIDTH / Math.max(page.width, 1));

    return {
      width: Math.max(1, Math.round(page.width * scale)),
      height: Math.max(1, Math.round(page.height * scale)),
    };
  });

  return {
    sizes,
    width: Math.max(...sizes.map((size) => size.width), 1),
    height:
      sizes.reduce((total, size) => total + size.height, 0) +
      Math.max(0, sizes.length - 1) * NATIVE_PREVIEW_PAGE_GAP,
  };
}

function randomElementInteger() {
  return Math.floor(Math.random() * 2 ** 31);
}

function createNativePreviewImageElement({
  attachmentId,
  attachmentKind,
  attachmentName,
  fileId,
  height,
  pageIndex,
  sourcePath,
  width,
  x,
  y,
}: {
  attachmentId: string;
  attachmentKind: AttachmentAsset["kind"];
  attachmentName: string;
  fileId: FileId;
  height: number;
  pageIndex: number;
  sourcePath: string;
  width: number;
  x: number;
  y: number;
}) {
  const now = Date.now();

  return {
    id: crypto.randomUUID(),
    type: "image",
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "transparent",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: null,
    roundness: null,
    seed: randomElementInteger(),
    version: 1,
    versionNonce: randomElementInteger(),
    isDeleted: false,
    boundElements: null,
    updated: now,
    link: null,
    locked: false,
    fileId,
    status: "saved",
    scale: [1, 1],
    crop: null,
    customData: {
      excaliburAttachment: {
        attachmentId,
        kind: attachmentKind,
        name: attachmentName,
        pageIndex,
        sourcePath,
      },
    },
  } as ExcalidrawElement;
}

function isPointInsideElement(
  element: ExcalidrawElement,
  sceneX: number,
  sceneY: number,
) {
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;
  const deltaX = sceneX - centerX;
  const deltaY = sceneY - centerY;
  const cos = Math.cos(-element.angle);
  const sin = Math.sin(-element.angle);
  const localX = deltaX * cos - deltaY * sin + element.width / 2;
  const localY = deltaX * sin + deltaY * cos + element.height / 2;

  return (
    localX >= 0 &&
    localX <= element.width &&
    localY >= 0 &&
    localY <= element.height
  );
}

function getNativeVideoAttachmentAtPoint(
  attachments: CanvasAttachment[],
  elements: readonly ExcalidrawElement[],
  sceneX: number,
  sceneY: number,
) {
  const nativeVideoAttachments = new Map<string, CanvasAttachment>();

  attachments.forEach((attachment) => {
    if (attachment.displayMode !== "native" || attachment.kind !== "video") {
      return;
    }

    attachment.nativeElementIds?.forEach((elementId) => {
      nativeVideoAttachments.set(elementId, attachment);
    });
  });

  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index];
    const attachment = nativeVideoAttachments.get(element.id);

    if (!attachment || element.isDeleted) {
      continue;
    }

    if (isPointInsideElement(element, sceneX, sceneY)) {
      return attachment;
    }
  }

  return null;
}

function getCollaborationStateFromInfo(
  info: CollaborationSessionInfo,
  status: CollaborationUiState["status"],
): CollaborationUiState {
  return {
    status,
    role: info.role,
    sessionId: info.sessionId,
    canvasId: info.canvasId,
    peerId: info.peerId,
    code: info.code ?? undefined,
    peerCount: info.peerCount,
    readOnly: info.readOnly,
    message: status === "hosting" ? "Colaboracao ativa" : "Conectado ao host",
  };
}

function createGuestCollaborationProject(canvasId: string, title?: string): ProjectMetadata {
  return normalizeProject({
    id: `collab-${canvasId}`,
    title: title?.trim() || "Canvas colaborativo",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    elementsCount: 0,
    bytes: 0,
    version: APP_VERSION,
    folderId: DEFAULT_FOLDER_ID,
    folderTitle: DEFAULT_FOLDER_TITLE,
    sortOrder: Date.now(),
  });
}

function summarizeCollaborationPayload(payload: string | null | undefined) {
  if (!payload) {
    return "payload=none";
  }

  try {
    const parsed = JSON.parse(payload);
    const elements = Array.isArray(parsed.elements) ? parsed.elements.length : 0;
    const files =
      parsed.files && typeof parsed.files === "object"
        ? Object.keys(parsed.files).length
        : 0;

    return `bytes=${payload.length} elements=${elements} files=${files}`;
  } catch {
    return `bytes=${payload.length} json=invalid`;
  }
}

function logCollaborationDebug(message: string) {
  void writeCollaborationDebugLog(message).catch(() => undefined);
}

function App() {
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const elementsRef = useRef<readonly ExcalidrawElement[]>([]);
  const appStateRef = useRef<AppState | null>(null);
  const filesRef = useRef<BinaryFiles>(EMPTY_FILES);
  const attachmentsRef = useRef<CanvasAttachment[]>([]);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const collaborationUpdateTimerRef = useRef<number | null>(null);
  const collaborationInitialApplyTimerRef = useRef<number | null>(null);
  const collaborationCursorUpdateTimerRef = useRef<number | null>(null);
  const remoteApplyTimerRef = useRef<number | null>(null);
  const themeApplyTimerRef = useRef<number | null>(null);
  const activeProjectRef = useRef<ProjectMetadata | null>(null);
  const previousThemeRef = useRef<AppTheme>(getStoredTheme());
  const foldersRef = useRef<ProjectFolder[]>([]);
  const projectsRef = useRef<ProjectMetadata[]>([]);
  const isDirtyRef = useRef(false);
  const lastKnownSignatureRef = useRef("");
  const lastSavedSignatureRef = useRef("");
  const lastCollaborationFilesSignatureRef = useRef("");
  const lastCollaborationSceneSentAtRef = useRef(0);
  const applyingRemoteSceneRef = useRef(false);
  const collaborationStateRef = useRef<CollaborationUiState>({ status: "idle" });
  const pendingCursorUpdateRef = useRef<{
    x: number;
    y: number;
    visible: boolean;
  } | null>(null);

  const [projects, setProjects] = useState<ProjectMetadata[]>([]);
  const [folders, setFolders] = useState<ProjectFolder[]>(() => getStoredFolders());
  const [activeProject, setActiveProject] = useState<ProjectMetadata | null>(
    null,
  );
  const [activeFolderId, setActiveFolderId] = useState("");
  const [canvasInitialData, setCanvasInitialData] =
    useState<CanvasInitialData | null>(null);
  const [attachments, setAttachments] = useState<CanvasAttachment[]>([]);
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<string | null>(null);
  const [sceneViewport, setSceneViewport] = useState<SceneViewport>({
    scrollX: 0,
    scrollY: 0,
    zoom: 1,
  });
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  const [appTheme, setAppTheme] = useState<AppTheme>(() => getStoredTheme());
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [query, setQuery] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [isSidebarCompact, setIsSidebarCompact] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [status, setStatus] = useState("Carregando canvas");
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isCollaborationOpen, setIsCollaborationOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [collaboration, setCollaboration] = useState<CollaborationUiState>({
    status: "idle",
  });
  const [collaborationRequireApproval, setCollaborationRequireApproval] = useState(true);
  const [collaborationDefaultReadOnly, setCollaborationDefaultReadOnly] = useState(false);
  const [pendingCollaborationRequests, setPendingCollaborationRequests] = useState<
    PendingCollaborationRequest[]
  >([]);
  const [collaborationLogPath, setCollaborationLogPath] = useState<string | null>(null);
  const [storageSettings, setStorageSettings] =
    useState<StorageSettings | null>(null);
  const [projectPendingDelete, setProjectPendingDelete] =
    useState<ProjectMetadata | null>(null);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [folderPendingDelete, setFolderPendingDelete] = useState<ProjectFolder | null>(null);
  const [isDeletingFolder, setIsDeletingFolder] = useState(false);
  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [projectTargetFolder, setProjectTargetFolder] = useState<ProjectFolder | null>(null);
  const [lastLightBg, setLastLightBg] = useState<string>(
    () => localStorage.getItem(LAST_LIGHT_BG_KEY) || DEFAULT_LIGHT_CANVAS_BACKGROUND
  );
  const [lastDarkBg, setLastDarkBg] = useState<string>(
    () => localStorage.getItem(LAST_DARK_BG_KEY) || DEFAULT_DARK_CANVAS_BACKGROUND
  );
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const createProjectAfterFolderRef = useRef(false);
  const [pendingAttachment, setPendingAttachment] =
    useState<PendingAttachmentSource | null>(null);
  const [previewConversion, setPreviewConversion] =
    useState<PreviewConversionState | null>(null);
  const [videoPlayerAttachment, setVideoPlayerAttachment] =
    useState<CanvasAttachment | null>(null);
  const [videoPlaybackError, setVideoPlaybackError] = useState("");

  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null);

  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [colorPickerFolder, setColorPickerFolder] = useState<ProjectFolder | null>(null);
  const [selectedColor, setSelectedColor] = useState("");

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("excalibur.sidebarWidth");
    return saved ? parseInt(saved, 10) : 292;
  });
  const [isResizing, setIsResizing] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(180, Math.min(500, moveEvent.clientX));
      setSidebarWidth(newWidth);
      localStorage.setItem("excalibur.sidebarWidth", String(newWidth));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, []);

  const syncSceneViewport = useCallback((appState: Partial<AppState> | null | undefined) => {
    const nextViewport = getSceneViewport(appState);

    setSceneViewport((current) => {
      if (
        Math.abs(current.scrollX - nextViewport.scrollX) < 0.5 &&
        Math.abs(current.scrollY - nextViewport.scrollY) < 0.5 &&
        Math.abs(current.zoom - nextViewport.zoom) < 0.001
      ) {
        return current;
      }

      return nextViewport;
    });
  }, []);

  const applyCanvasTheme = useCallback(
    (
      theme: AppTheme,
      api = excalidrawApiRef.current,
      options: { previousTheme?: AppTheme; forceBackground?: boolean } = {},
    ) => {
      if (!api) {
        return;
      }

      const apply = () => {
        const currentAppState = api.getAppState();
        const themeAppState = {
          ...currentAppState,
          theme: getExcalidrawTheme(theme),
          viewBackgroundColor: options.forceBackground
            ? (theme === "dark" ? lastDarkBg : lastLightBg)
            : getThemeAwareCanvasBackground(
                currentAppState.viewBackgroundColor,
                theme,
                lastLightBg,
                lastDarkBg,
                options.previousTheme,
              ),
        } as AppState;

        api.updateScene({
          elements: api.getSceneElementsIncludingDeleted(),
          appState: themeAppState,
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        api.refresh();

        appStateRef.current = themeAppState;
        syncSceneViewport(themeAppState);
      };

      apply();

      if (themeApplyTimerRef.current) {
        window.clearTimeout(themeApplyTimerRef.current);
      }

      themeApplyTimerRef.current = window.setTimeout(() => {
        apply();
        themeApplyTimerRef.current = null;
      }, 120);
    },
    [lastLightBg, lastDarkBg, syncSceneViewport],
  );

  useEffect(() => {
    activeProjectRef.current = activeProject;
  }, [activeProject]);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    foldersRef.current = folders;
  }, [folders]);

  useEffect(() => {
    attachmentsRef.current = attachments;
    setSelectedAttachmentId((current) => {
      if (!current || attachments.some((attachment) => attachment.id === current)) {
        return current;
      }

      return null;
    });
  }, [attachments]);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    collaborationStateRef.current = collaboration;
  }, [collaboration]);

  useEffect(() => {
    if (!isExportMenuOpen) {
      return;
    }

    const closeOnPointerDown = (event: PointerEvent) => {
      const menu = exportMenuRef.current;

      if (menu && event.target instanceof Node && !menu.contains(event.target)) {
        setIsExportMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsExportMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isExportMenuOpen]);

  useEffect(() => {
    const previousTheme = previousThemeRef.current;

    localStorage.setItem(THEME_STORAGE_KEY, appTheme);
    applyCanvasTheme(appTheme, undefined, { previousTheme, forceBackground: true });
    previousThemeRef.current = appTheme;
  }, [appTheme, applyCanvasTheme]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    const win = getCurrentWindow();
    win.setTheme(appTheme).catch(console.error);
    invoke("set_titlebar_color", { theme: appTheme }).catch(console.error);

    let active = true;
    let unlistenFn: (() => void) | null = null;

    win.onFocusChanged(() => {
      if (active) {
        win.setTheme(appTheme).catch(console.error);
        invoke("set_titlebar_color", { theme: appTheme }).catch(console.error);
      }
    }).then((fn) => {
      if (active) {
        unlistenFn = fn;
      } else {
        fn();
      }
    }).catch(console.error);

    return () => {
      active = false;
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [appTheme]);

  useEffect(() => {
    persistStoredFolders(folders);
  }, [folders]);

  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      let target = e.target as HTMLElement | null;
      while (target && target !== document.body) {
        if (target.tagName === "A") {
          const href = target.getAttribute("href");
          if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
            if (isTauri()) {
              e.preventDefault();
              e.stopPropagation();
              void openUrl(href).catch((err) => console.error("Error opening URL:", err));
            }
            break;
          }
        }
        target = target.parentElement;
      }
    };

    document.addEventListener("click", handleGlobalClick, true);
    return () => {
      document.removeEventListener("click", handleGlobalClick, true);
    };
  }, []);

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    const normalizedProjects = projects.map(normalizeProject);

    if (!normalizedQuery) {
      return normalizedProjects;
    }

    return normalizedProjects.filter(
      (project) =>
        project.title.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
        getProjectFolderTitle(project)
          .toLocaleLowerCase("pt-BR")
          .includes(normalizedQuery),
    );
  }, [projects, query]);

  const projectFolders = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    const folderIds = new Set(folders.map((f) => f.id));
    const folderProjects = filteredProjects.filter((p) => {
      const fId = getProjectFolderId(p);
      return fId && fId !== DEFAULT_FOLDER_ID && folderIds.has(fId);
    });
    const groupedFolders = groupProjects(folderProjects, folders);

    if (!normalizedQuery) {
      return groupedFolders;
    }

    return groupedFolders.filter(
      (folder) =>
        folder.projects.length > 0 ||
        folder.title.toLocaleLowerCase("pt-BR").includes(normalizedQuery),
    );
  }, [filteredProjects, folders, query]);

  const rootProjects = useMemo(() => {
    const folderIds = new Set(folders.map((f) => f.id));
    return filteredProjects.filter((p) => {
      const fId = getProjectFolderId(p);
      return !fId || fId === DEFAULT_FOLDER_ID || !folderIds.has(fId);
    });
  }, [filteredProjects, folders]);

  const activeFolder = useMemo(
    () =>
      projectFolders.find((folder) => folder.id === activeFolderId) ??
      folders.find((folder) => folder.id === activeFolderId),
    [activeFolderId, folders, projectFolders],
  );

  const persistProject = useCallback(
    async (project = activeProjectRef.current) => {
      const appState = appStateRef.current;

      if (!project || !appState) {
        return null;
      }

      if (isGuestCollaborationState(collaborationStateRef.current)) {
        isDirtyRef.current = false;
        setIsDirty(false);
        setStatus("Visitante nao salva localmente");
        return null;
      }

      const elements = elementsRef.current;
      const files = filesRef.current;
      const currentAttachments = attachmentsRef.current;
      const data = getCanvasPayload(elements, appState, files, currentAttachments);
      const signature = getProjectSignature(elements, appState, currentAttachments);
      const nextProject: ProjectMetadata = {
        ...normalizeProject(project),
        updatedAt: Date.now(),
        elementsCount: elements.filter((element) => !element.isDeleted).length,
        bytes: new Blob([data]).size,
        version: APP_VERSION,
      };
      const saved = normalizeProject(await saveProject(nextProject, data));

      setProjects((current) => upsertProject(current, saved));
      lastKnownSignatureRef.current = signature;
      lastSavedSignatureRef.current = signature;
      setActiveProject(saved);
      setActiveFolderId(getProjectFolderId(saved));
      setIsDirty(false);
      setStatus("Salvo");
      return saved;
    },
    [],
  );

  const clearAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }, []);

  const scheduleAutoSave = useCallback(() => {
    clearAutoSave();
    autoSaveTimerRef.current = window.setTimeout(() => {
      persistProject().catch(() => setStatus("Erro ao salvar"));
    }, AUTO_SAVE_DELAY_MS);
  }, [clearAutoSave, persistProject]);

  const clearCollaborationUpdate = useCallback(() => {
    if (collaborationUpdateTimerRef.current) {
      window.clearTimeout(collaborationUpdateTimerRef.current);
      collaborationUpdateTimerRef.current = null;
    }
  }, []);

  const clearInitialCollaborationApply = useCallback(() => {
    if (collaborationInitialApplyTimerRef.current) {
      window.clearTimeout(collaborationInitialApplyTimerRef.current);
      collaborationInitialApplyTimerRef.current = null;
    }
  }, []);

  const clearCollaborationCursorUpdate = useCallback(() => {
    if (collaborationCursorUpdateTimerRef.current) {
      window.clearTimeout(collaborationCursorUpdateTimerRef.current);
      collaborationCursorUpdateTimerRef.current = null;
    }

    pendingCursorUpdateRef.current = null;
  }, []);

  const getCurrentCollaborationPayload = useCallback((options?: { includeFiles?: boolean }) => {
    const appState = appStateRef.current;

    if (!appState) {
      return null;
    }

    return getCanvasPayload(
      elementsRef.current,
      appState,
      filesRef.current,
      attachmentsRef.current,
      options,
    );
  }, []);

  const sendCurrentCollaborationPayload = useCallback(async () => {
    const current = collaborationStateRef.current;

    if (
      applyingRemoteSceneRef.current ||
      current.readOnly ||
      (current.status !== "hosting" && current.status !== "connected")
    ) {
      logCollaborationDebug(
        `send_skip status=${current.status} role=${current.role ?? "none"} readOnly=${current.readOnly ?? false} applyingRemote=${applyingRemoteSceneRef.current}`,
      );
      return;
    }

    const filesSignature = getFilesSignature(filesRef.current);
    const includeFiles = filesSignature !== lastCollaborationFilesSignatureRef.current;
    const payload = getCurrentCollaborationPayload({
      includeFiles,
    });

    if (!payload) {
      logCollaborationDebug(
        `send_skip reason=no_payload status=${current.status} role=${current.role ?? "none"}`,
      );
      return;
    }

    try {
      await sendCollaborationUpdate(payload);
      lastCollaborationFilesSignatureRef.current = filesSignature;
    } catch (error) {
      console.warn("Failed to send collaboration update", error);
      logCollaborationDebug(
        `send_error status=${current.status} role=${current.role ?? "none"} error=${error instanceof Error ? error.message : String(error)}`,
      );
      setCollaboration((state) => ({
        ...state,
        status: state.status === "idle" ? "idle" : "error",
        message: "Nao foi possivel sincronizar a cena.",
      }));
    }
  }, [getCurrentCollaborationPayload]);

  const scheduleCollaborationUpdate = useCallback(() => {
    const current = collaborationStateRef.current;

    if (
      current.readOnly ||
      (current.status !== "hosting" && current.status !== "connected")
    ) {
      return;
    }

    if (collaborationUpdateTimerRef.current) {
      return;
    }

    const elapsed = Date.now() - lastCollaborationSceneSentAtRef.current;
    const delay = Math.max(0, COLLABORATION_SCENE_UPDATE_DELAY_MS - elapsed);

    collaborationUpdateTimerRef.current = window.setTimeout(() => {
      collaborationUpdateTimerRef.current = null;
      lastCollaborationSceneSentAtRef.current = Date.now();
      void sendCurrentCollaborationPayload();
    }, delay);
  }, [sendCurrentCollaborationPayload]);

  const flushCollaborationCursorUpdate = useCallback(async () => {
    const nextCursor = pendingCursorUpdateRef.current;
    pendingCursorUpdateRef.current = null;

    if (!nextCursor) {
      return;
    }

    const current = collaborationStateRef.current;
    if (
      current.status !== "hosting" &&
      current.status !== "connected"
    ) {
      return;
    }

    try {
      await sendCollaborationCursorUpdate(
        nextCursor.x,
        nextCursor.y,
        nextCursor.visible,
      );
    } catch (error) {
      logCollaborationDebug(
        `cursor_send_error status=${current.status} role=${current.role ?? "none"} error=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, []);

  const scheduleCollaborationCursorUpdate = useCallback(
    (cursor: { x: number; y: number; visible: boolean }) => {
      const current = collaborationStateRef.current;

      if (
        current.status !== "hosting" &&
        current.status !== "connected"
      ) {
        return;
      }

      pendingCursorUpdateRef.current = cursor;

      if (collaborationCursorUpdateTimerRef.current) {
        return;
      }

      collaborationCursorUpdateTimerRef.current = window.setTimeout(() => {
        collaborationCursorUpdateTimerRef.current = null;
        void flushCollaborationCursorUpdate();
      }, COLLABORATION_CURSOR_UPDATE_DELAY_MS);
    },
    [flushCollaborationCursorUpdate],
  );

  const stopCollaborationForCanvasSwitch = useCallback(async () => {
    const current = collaborationStateRef.current;

    if (!current.role || current.status === "idle") {
      return;
    }

    clearCollaborationUpdate();
    clearInitialCollaborationApply();
    clearCollaborationCursorUpdate();
    logCollaborationDebug(
      `stop_for_canvas_switch status=${current.status} role=${current.role ?? "none"}`,
    );
    await stopCollaborationSession();
    lastCollaborationFilesSignatureRef.current = "";
    setPendingCollaborationRequests([]);
    setRemoteCursors([]);
    setCollaboration({ status: "idle" });
    setJoinCode("");
  }, [
    clearCollaborationCursorUpdate,
    clearCollaborationUpdate,
    clearInitialCollaborationApply,
  ]);

  const openProject = useCallback(
    async (project: ProjectMetadata) => {
      clearAutoSave();
      await stopCollaborationForCanvasSwitch();
      const currentProject = activeProjectRef.current;

      if (currentProject && currentProject.id !== project.id && isDirtyRef.current) {
        await persistProject(currentProject);
      }

      setStatus("Abrindo");

      try {
        const normalizedProject = normalizeProject(project);
        const raw = await loadProject(normalizedProject.id);
        const parsed = JSON.parse(raw);
        const restoredAttachments = getStoredCanvasAttachments(parsed);
        const restored = restore(parsed, null, null, {
          refreshDimensions: true,
          repairBindings: true,
        });
        const restoredFiles = restored.files ?? EMPTY_FILES;
        const canvasAppState = {
          ...restored.appState,
          name: normalizedProject.title,
          theme: getExcalidrawTheme(appTheme),
          viewBackgroundColor: getThemeAwareCanvasBackground(
            restored.appState.viewBackgroundColor,
            appTheme,
            lastLightBg,
            lastDarkBg,
          ),
        } as AppState;
        const api = excalidrawApiRef.current;

        setCanvasInitialData({
          elements: restored.elements,
          appState: canvasAppState,
          files: restoredFiles,
        });

        if (api) {
          api.resetScene();
          api.addFiles(Object.values(restoredFiles));
          api.updateScene({
            elements: restored.elements,
            appState: canvasAppState,
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
          });
          api.refresh();
          api.history.clear();
          api.scrollToContent(restored.elements, {
            fitToContent: true,
          });
        }

        elementsRef.current = restored.elements;
        appStateRef.current = api?.getAppState() ?? canvasAppState;
        filesRef.current = restoredFiles;
        attachmentsRef.current = restoredAttachments;
        setAttachments(restoredAttachments);
        setSelectedAttachmentId(null);
        syncSceneViewport(appStateRef.current);

        if (appStateRef.current) {
          const signature = getProjectSignature(
            restored.elements,
            appStateRef.current,
            restoredAttachments,
          );
          lastKnownSignatureRef.current = signature;
          lastSavedSignatureRef.current = signature;
        }

        setActiveProject(normalizedProject);
        setActiveFolderId(getProjectFolderId(normalizedProject));
        setIsDirty(false);
        setExportedPath(null);
        setStatus("Aberto");
      } catch (error) {
        console.error("Failed to open project", error);
        setStatus("Não foi possível abrir");
      }
    },
    [appTheme, clearAutoSave, persistProject, stopCollaborationForCanvasSwitch, lastLightBg, lastDarkBg, syncSceneViewport],
  );

  const createAndOpenProject = useCallback(
    async (folder?: ProjectFolder) => {
      clearAutoSave();
      await stopCollaborationForCanvasSwitch();
      const currentProject = activeProjectRef.current;

      if (
        currentProject &&
        isDirtyRef.current &&
        collaborationStateRef.current.role !== "guest"
      ) {
        await persistProject(currentProject);
      }

      const folderIds = new Set(foldersRef.current.map((f) => f.id));
      const targetFolder = folder ?? (folderIds.has(activeFolderId)
        ? foldersRef.current.find((f) => f.id === activeFolderId)
        : undefined);

      if (!targetFolder) {
        setNewFolderName("Nova pasta");
        setIsCreateFolderOpen(true);
        createProjectAfterFolderRef.current = true;
        return;
      }

      const defaultTitle = createProjectTitle(projectsRef.current, targetFolder.id);
      setProjectTargetFolder(targetFolder);
      setNewProjectTitle(defaultTitle);
      setIsCreateProjectModalOpen(true);
    },
    [activeFolderId, clearAutoSave, persistProject, stopCollaborationForCanvasSwitch, setNewFolderName, setIsCreateFolderOpen, setProjectTargetFolder, setNewProjectTitle, setIsCreateProjectModalOpen],
  );

  const handleConfirmCreateProject = useCallback(async () => {
    const trimmedTitle = newProjectTitle.trim();
    if (!trimmedTitle || !projectTargetFolder) {
      return;
    }

    const project = {
      id: crypto.randomUUID(),
      title: trimmedTitle,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      elementsCount: 0,
      bytes: 0,
      version: APP_VERSION,
      folderId: projectTargetFolder.id,
      folderTitle: projectTargetFolder.title,
      sortOrder: Date.now(),
    };

    const canvasAppState = {
      name: project.title,
      theme: getExcalidrawTheme(appTheme),
      viewBackgroundColor: appTheme === "dark" ? lastDarkBg : lastLightBg,
    } as AppState;
    const api = excalidrawApiRef.current;

    setCanvasInitialData({
      elements: [],
      appState: canvasAppState,
      files: EMPTY_FILES,
    });

    if (api) {
      api.resetScene();
      api.updateScene({
        elements: [],
        appState: canvasAppState,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      api.refresh();
      api.history.clear();
    }

    elementsRef.current = [];
    appStateRef.current = api?.getAppState() ?? canvasAppState;
    filesRef.current = EMPTY_FILES;
    attachmentsRef.current = [];
    setAttachments([]);
    setSelectedAttachmentId(null);
    syncSceneViewport(appStateRef.current);

    if (appStateRef.current) {
      const signature = getProjectSignature([], appStateRef.current, []);
      lastKnownSignatureRef.current = signature;
      lastSavedSignatureRef.current = signature;
    }

    setActiveProject(project);
    setActiveFolderId(getProjectFolderId(project));
    setProjects((current) => upsertProject(current, project));
    setExportedPath(null);
    setStatus("Novo canvas");
    setIsCreateProjectModalOpen(false);
    await persistProject(project);
  }, [newProjectTitle, projectTargetFolder, appTheme, lastLightBg, lastDarkBg, persistProject, syncSceneViewport]);

  const clearActiveCanvas = useCallback(
    async (nextStatus = "Nenhum canvas selecionado") => {
      clearAutoSave();
      await stopCollaborationForCanvasSwitch();
      const currentProject = activeProjectRef.current;

      if (
        currentProject &&
        isDirtyRef.current &&
        !isGuestCollaborationState(collaborationStateRef.current)
      ) {
        await persistProject(currentProject);
      }

      const api = excalidrawApiRef.current;

      if (api) {
        api.resetScene();
        api.history.clear();
      }

      activeProjectRef.current = null;
      elementsRef.current = [];
      appStateRef.current = null;
      filesRef.current = EMPTY_FILES;
      attachmentsRef.current = [];
      excalidrawApiRef.current = null;
      lastKnownSignatureRef.current = "";
      lastSavedSignatureRef.current = "";

      setActiveProject(null);
      setCanvasInitialData(null);
      setAttachments([]);
      setSelectedAttachmentId(null);
      setExportedPath(null);
      setIsDirty(false);
      setStatus(nextStatus);
    },
    [clearAutoSave, persistProject, stopCollaborationForCanvasSwitch],
  );

  useEffect(() => {
    let mounted = true;

    listProjects()
      .then(async (storedProjects) => {
        if (!mounted) {
          return;
        }

        const sorted = sortProjects(storedProjects);
        setProjects(sorted);
        setFolders((current) => mergeFolders(current, foldersFromProjects(sorted)));

        if (sorted[0]) {
          setActiveFolderId(getProjectFolderId(sorted[0]));
          setStatus("Selecione um canvas");
        } else {
          setStatus("Crie um canvas");
        }
      })
      .catch(() => setStatus("Erro ao carregar canvas"));

    return () => {
      mounted = false;
      clearAutoSave();
      clearCollaborationUpdate();
      clearInitialCollaborationApply();
      clearCollaborationCursorUpdate();
      if (themeApplyTimerRef.current) {
        window.clearTimeout(themeApplyTimerRef.current);
        themeApplyTimerRef.current = null;
      }
      if (remoteApplyTimerRef.current) {
        window.clearTimeout(remoteApplyTimerRef.current);
        remoteApplyTimerRef.current = null;
      }
    };
  }, [
    clearAutoSave,
    clearCollaborationCursorUpdate,
    clearCollaborationUpdate,
    clearInitialCollaborationApply,
  ]);

  const handleCanvasChange = useCallback(
    (
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      const previousElements = elementsRef.current;
      const themedAppState = {
        ...appState,
        theme: getExcalidrawTheme(appTheme),
      } as AppState;
      const currentCollaboration = collaborationStateRef.current;

      if (
        currentCollaboration.readOnly &&
        currentCollaboration.role === "guest" &&
        !applyingRemoteSceneRef.current
      ) {
        const changedIds = getChangedElementIds(previousElements, elements);

        if (changedIds.size) {
          const api = excalidrawApiRef.current;
          elementsRef.current = previousElements;
          appStateRef.current = themedAppState;
          filesRef.current = files;
          syncSceneViewport(themedAppState);

          if (api) {
            api.updateScene({
              elements: previousElements,
              appState: themedAppState,
              captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            });
            api.refresh();
          }

          setStatus("Somente visualizacao");
          logCollaborationDebug(
            `local_change_blocked reason=read_only changedElements=${Array.from(changedIds).join(",")}`,
          );
          return;
        }
      }

      elementsRef.current = elements;
      appStateRef.current = themedAppState;
      filesRef.current = files;
      syncSceneViewport(themedAppState);

      if (appState.theme === getExcalidrawTheme(appTheme) && appState.viewBackgroundColor) {
        const currentBg = appState.viewBackgroundColor;
        if (appTheme === "light" && currentBg !== lastLightBg) {
          setLastLightBg(currentBg);
          localStorage.setItem(LAST_LIGHT_BG_KEY, currentBg);
        } else if (appTheme === "dark" && currentBg !== lastDarkBg) {
          setLastDarkBg(currentBg);
          localStorage.setItem(LAST_DARK_BG_KEY, currentBg);
        }
      }

      if (
        appState.theme !== getExcalidrawTheme(appTheme)
      ) {
        applyCanvasTheme(appTheme, undefined, { forceBackground: true });
      }

      if (applyingRemoteSceneRef.current) {
        const remoteSignature = getProjectSignature(
          elements,
          themedAppState,
          attachmentsRef.current,
        );
        lastKnownSignatureRef.current = remoteSignature;
        return;
      }

      if (!activeProjectRef.current) {
        return;
      }

      const signature = getProjectSignature(
        elements,
        themedAppState,
        attachmentsRef.current,
      );

      if (signature === lastKnownSignatureRef.current) {
        return;
      }

      lastKnownSignatureRef.current = signature;
      scheduleCollaborationUpdate();

      if (signature === lastSavedSignatureRef.current) {
        setIsDirty(false);
        return;
      }

      if (collaborationStateRef.current.role === "guest") {
        isDirtyRef.current = false;
        setIsDirty(false);
        setStatus("Colaborando");
        return;
      }

      setIsDirty(true);
      setStatus("Editando");
      scheduleAutoSave();
    },
    [appTheme, applyCanvasTheme, scheduleAutoSave, scheduleCollaborationUpdate, lastLightBg, lastDarkBg, syncSceneViewport],
  );

  useEffect(() => {
    getStorageSettings()
      .then(setStorageSettings)
      .catch(() => setStatus("Erro ao carregar configurações"));
  }, []);

  useEffect(() => {
    if (!videoPlayerAttachment) {
      return;
    }

    setVideoPlaybackError("");

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setVideoPlayerAttachment(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [videoPlayerAttachment]);

  const handleManualSave = useCallback(async () => {
    if (isGuestCollaborationState(collaborationStateRef.current)) {
      setStatus("Visitante nao salva localmente");
      return;
    }

    clearAutoSave();
    setStatus("Salvando");
    await persistProject();
  }, [clearAutoSave, persistProject]);

  const applyCollaborationPayload = useCallback(
    (payload: string, role?: CollaborationRole | null, canvasId?: string | null) => {
      try {
        const parsed = JSON.parse(payload);
        const api = excalidrawApiRef.current;
        const localAppState = api?.getAppState() ?? appStateRef.current;
        const restoredAttachments = getStoredCanvasAttachments(parsed);
        const mergedPayloadFiles = mergeBinaryFiles(filesRef.current, getPayloadFiles(parsed));
        if (Object.keys(mergedPayloadFiles).length > 0) {
          parsed.files = mergedPayloadFiles;
        }
        const restored = restore(parsed, null, null, {
          refreshDimensions: true,
          repairBindings: true,
        });
        const restoredFiles = restored.files ?? mergedPayloadFiles;
        const restoredElements = restored.elements;
        const title =
          (typeof restored.appState?.name === "string" && restored.appState.name.trim()) ||
          activeProjectRef.current?.title ||
          "Canvas colaborativo";
        const canvasAppState = preserveLocalViewport(
          {
            ...restored.appState,
            name: title,
            theme: getExcalidrawTheme(appTheme),
            viewBackgroundColor: getThemeAwareCanvasBackground(
              restored.appState.viewBackgroundColor,
              appTheme,
              lastLightBg,
              lastDarkBg,
            ),
          },
          localAppState,
        ) as AppState;
        const isGuest = role === "guest" || collaborationStateRef.current.role === "guest";
        const project =
          isGuest && canvasId
            ? createGuestCollaborationProject(canvasId, title)
            : activeProjectRef.current;

        applyingRemoteSceneRef.current = true;
        if (remoteApplyTimerRef.current) {
          window.clearTimeout(remoteApplyTimerRef.current);
        }
        remoteApplyTimerRef.current = window.setTimeout(() => {
          applyingRemoteSceneRef.current = false;
          remoteApplyTimerRef.current = null;
        }, COLLABORATION_REMOTE_APPLY_GUARD_MS);

        if (
          project &&
          (!activeProjectRef.current ||
            activeProjectRef.current.id !== project.id ||
            activeProjectRef.current.title !== project.title)
        ) {
          activeProjectRef.current = project;
          setActiveProject(project);
          setActiveFolderId(getProjectFolderId(project));
        }

        if (api) {
          api.addFiles(Object.values(restoredFiles));
          api.updateScene({
            elements: restoredElements,
            appState: canvasAppState,
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
          });
          api.refresh();
        } else {
          setCanvasInitialData({
            elements: restoredElements,
            appState: canvasAppState,
            files: restoredFiles,
          });
        }

        elementsRef.current = restoredElements;
        appStateRef.current = api?.getAppState() ?? canvasAppState;
        filesRef.current = restoredFiles;
        lastCollaborationFilesSignatureRef.current = getFilesSignature(restoredFiles);
        attachmentsRef.current = restoredAttachments;
        setAttachments(restoredAttachments);
        setSelectedAttachmentId(null);
        syncSceneViewport(appStateRef.current);

        const currentAppState = appStateRef.current ?? canvasAppState;
        const signature = getProjectSignature(
          restoredElements,
          currentAppState,
          restoredAttachments,
        );
        lastKnownSignatureRef.current = signature;
        setCanvasInitialData({
          elements: restoredElements,
          appState: canvasAppState,
          files: restoredFiles,
        });

        if (isGuest) {
          lastSavedSignatureRef.current = signature;
          isDirtyRef.current = false;
          setIsDirty(false);
          setStatus("Colaborando");
        } else {
          isDirtyRef.current = true;
          setIsDirty(true);
          setStatus("Atualizado por visitante");
          scheduleAutoSave();
        }
      } catch (error) {
        console.error("Failed to apply collaboration payload", error);
        logCollaborationDebug(
          `apply_error incomingRole=${role ?? "none"} error=${error instanceof Error ? error.message : String(error)}`,
        );
        setCollaboration((state) => ({
          ...state,
          status: state.status === "idle" ? "idle" : "error",
          message: "Nao foi possivel aplicar a cena recebida.",
        }));
      }
    },
    [appTheme, lastLightBg, lastDarkBg, scheduleAutoSave, syncSceneViewport],
  );

  const queueInitialCollaborationApply = useCallback(
    (payload: string, canvasId: string, sessionId: string) => {
      clearInitialCollaborationApply();
      collaborationInitialApplyTimerRef.current = window.setTimeout(() => {
        collaborationInitialApplyTimerRef.current = null;
        const current = collaborationStateRef.current;

        if (
          current.role !== "guest" ||
          current.sessionId !== sessionId ||
          current.canvasId !== canvasId ||
          current.status !== "connected"
        ) {
          logCollaborationDebug(
            `initial_reapply_skip status=${current.status} role=${current.role ?? "none"} session=${current.sessionId ?? "none"} canvas=${current.canvasId ?? "none"}`,
          );
          return;
        }

        logCollaborationDebug(
          `initial_reapply_start session=${sessionId} canvas=${canvasId} ${summarizeCollaborationPayload(payload)}`,
        );
        applyCollaborationPayload(payload, "guest", canvasId);
      }, 220);
    },
    [applyCollaborationPayload, clearInitialCollaborationApply],
  );

  const handleStartCollaboration = useCallback(async () => {
    const project = activeProjectRef.current;
    const payload = getCurrentCollaborationPayload({ includeFiles: true });

    if (!project || !payload) {
      logCollaborationDebug("start_ui_rejected reason=no_active_canvas_or_payload");
      setCollaboration({
        status: "error",
        message: "Abra um canvas antes de iniciar a colaboracao.",
      });
      return;
    }

    setCollaboration((state) => ({
      ...state,
      status: "starting",
      message: "Iniciando colaboracao",
    }));

    try {
      logCollaborationDebug(
        `start_ui_request canvas=${project.id} ${summarizeCollaborationPayload(payload)}`,
      );
      const info = await startCollaborationSession(project.id, payload, {
        requireApproval: collaborationRequireApproval,
        defaultReadOnly: collaborationDefaultReadOnly,
      });
      lastCollaborationFilesSignatureRef.current = getFilesSignature(filesRef.current);
      setPendingCollaborationRequests([]);
      setCollaboration(getCollaborationStateFromInfo(info, "hosting"));
      setIsCollaborationOpen(true);
      setStatus("Colaboracao ativa");
      logCollaborationDebug(
        `start_ui_ok session=${info.sessionId} canvas=${info.canvasId} peer=${info.peerId} endpoints=${info.endpoints.join(",")}`,
      );
    } catch (error) {
      console.error("Failed to start collaboration", error);
      logCollaborationDebug(
        `start_ui_error error=${error instanceof Error ? error.message : String(error)}`,
      );
      setCollaboration({
        status: "error",
        message: error instanceof Error ? error.message : "Nao foi possivel iniciar.",
      });
    }
  }, [collaborationDefaultReadOnly, collaborationRequireApproval, getCurrentCollaborationPayload]);

  const handleJoinCollaboration = useCallback(async () => {
    const code = joinCode.trim();

    if (!code) {
      logCollaborationDebug("join_ui_rejected reason=empty_code");
      setCollaboration({
        status: "error",
        message: "Informe o codigo de colaboracao.",
      });
      return;
    }

    clearAutoSave();
    if (
      activeProjectRef.current &&
      isDirtyRef.current &&
      collaborationStateRef.current.role !== "guest"
    ) {
      await persistProject(activeProjectRef.current);
    }

    setCollaboration((state) => ({
      ...state,
      status: "joining",
      message: "Conectando ao host",
    }));

    try {
      logCollaborationDebug(`join_ui_request code_chars=${code.length}`);
      const info = await joinCollaborationSession(code);
      const connectedState = getCollaborationStateFromInfo(info, "connected");
      collaborationStateRef.current = connectedState;
      setCollaboration(connectedState);
      setIsCollaborationOpen(true);
      logCollaborationDebug(
        `join_ui_ok session=${info.sessionId} canvas=${info.canvasId} peer=${info.peerId} initial=${summarizeCollaborationPayload(info.initialPayload)}`,
      );

      if (info.initialPayload) {
        applyCollaborationPayload(info.initialPayload, "guest", info.canvasId);
        queueInitialCollaborationApply(info.initialPayload, info.canvasId, info.sessionId);
      }
    } catch (error) {
      console.error("Failed to join collaboration", error);
      logCollaborationDebug(
        `join_ui_error error=${error instanceof Error ? error.message : String(error)}`,
      );
      setCollaboration({
        status: "error",
        message: error instanceof Error ? error.message : "Nao foi possivel conectar.",
      });
    }
  }, [
    applyCollaborationPayload,
    clearAutoSave,
    joinCode,
    persistProject,
    queueInitialCollaborationApply,
  ]);

  const handleStopCollaboration = useCallback(async () => {
    const wasGuest = collaborationStateRef.current.role === "guest";
    logCollaborationDebug(
      `stop_ui_request status=${collaborationStateRef.current.status} role=${collaborationStateRef.current.role ?? "none"} wasGuest=${wasGuest}`,
    );

    setCollaboration((state) => ({
      ...state,
      status: "stopping",
      message: "Encerrando colaboracao",
    }));

    try {
      clearCollaborationUpdate();
      clearInitialCollaborationApply();
      clearCollaborationCursorUpdate();
      await stopCollaborationSession();
      logCollaborationDebug("stop_ui_native_ok");
    } finally {
      lastCollaborationFilesSignatureRef.current = "";
      setCollaboration({ status: "idle" });
      setPendingCollaborationRequests([]);
      setRemoteCursors([]);
      setJoinCode("");
      setStatus("Colaboracao encerrada");

      if (wasGuest) {
        logCollaborationDebug("stop_ui_clear_guest_canvas");
        await clearActiveCanvas("Colaboracao encerrada");
      }
    }
  }, [
    clearActiveCanvas,
    clearCollaborationCursorUpdate,
    clearCollaborationUpdate,
    clearInitialCollaborationApply,
  ]);

  const handleOpenCollaborationLog = useCallback(async () => {
    try {
      const path = await getCollaborationDebugLogPath();
      if (!path) {
        return;
      }

      setCollaborationLogPath(path);
      logCollaborationDebug(`open_log path=${path}`);
      try {
        await revealItemInDir(path);
      } catch {
        await openPath(path);
      }
    } catch (error) {
      logCollaborationDebug(
        `open_log_error error=${error instanceof Error ? error.message : String(error)}`,
      );
      setCollaboration((state) => ({
        ...state,
        message: "Nao foi possivel abrir o log.",
      }));
    }
  }, []);

  const handleCopyCollaborationCode = useCallback(async () => {
    const code = collaborationStateRef.current.code;

    if (!code) {
      return;
    }

    try {
      await navigator.clipboard.writeText(code);
      setCollaboration((state) => ({
        ...state,
        message: "Codigo copiado",
      }));
    } catch {
      setCollaboration((state) => ({
        ...state,
        message: "Nao foi possivel copiar automaticamente.",
      }));
    }
  }, []);

  const handleRespondCollaborationRequest = useCallback(
    async (
      request: PendingCollaborationRequest,
      approved: boolean,
      readOnly: boolean,
    ) => {
      setPendingCollaborationRequests((current) =>
        current.filter((item) => item.requestId !== request.requestId),
      );

      try {
        await respondCollaborationJoinRequest(request.requestId, approved, readOnly);
        setCollaboration((state) => ({
          ...state,
          message: approved
            ? readOnly
              ? "Visitante aprovado em somente visualizacao"
              : "Visitante aprovado para editar"
            : "Visitante recusado",
        }));
      } catch (error) {
        logCollaborationDebug(
          `approval_ui_error request=${request.requestId} error=${error instanceof Error ? error.message : String(error)}`,
        );
        setCollaboration((state) => ({
          ...state,
          message:
            error instanceof Error
              ? error.message
              : "Nao foi possivel responder ao pedido.",
        }));
      }
    },
    [],
  );

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let active = true;
    let unlisten: (() => void) | null = null;

    listen<CollaborationEvent>("collaboration-event", (event) => {
      if (!active) {
        return;
      }

      const payload = event.payload;
      if (payload.kind !== "cursorUpdate" && payload.kind !== "sceneUpdate") {
        logCollaborationDebug(
          `event_received kind=${payload.kind} role=${payload.role ?? "none"} session=${payload.sessionId ?? "none"} canvas=${payload.canvasId ?? "none"} peers=${payload.peerCount ?? "none"} message=${payload.message ?? "none"} ${summarizeCollaborationPayload(payload.payload)}`,
        );
      }

      if (payload.kind === "sceneUpdate" && payload.payload) {
        applyCollaborationPayload(payload.payload, payload.role, payload.canvasId);
        return;
      }

      if (payload.kind === "cursorUpdate" && payload.peerId) {
        const peerId = payload.peerId;
        const cursor = parseCollaborationCursorPayload(payload.payload);

        if (!cursor || !cursor.visible) {
          setRemoteCursors((current) =>
            current.filter((item) => item.peerId !== peerId),
          );
          return;
        }

        setRemoteCursors((current) => {
          const nextCursor: RemoteCursor = {
            peerId,
            label: getRemoteCursorLabel(peerId),
            color: getRemoteCursorColor(peerId),
            x: cursor.x,
            y: cursor.y,
            visible: true,
            updatedAt: Date.now(),
          };
          const existingIndex = current.findIndex(
            (item) => item.peerId === peerId,
          );

          if (existingIndex === -1) {
            return [...current, nextCursor];
          }

          const next = current.slice();
          next[existingIndex] = nextCursor;
          return next;
        });
        return;
      }

      if (payload.kind === "joinRequest" && payload.requestId) {
        const requestId = payload.requestId;
        setPendingCollaborationRequests((current) => {
          if (current.some((request) => request.requestId === requestId)) {
            return current;
          }

          return [
            ...current,
            {
              requestId,
              peerId: payload.peerId ?? "visitante",
              message: payload.message ?? "Visitante aguardando aprovacao.",
              defaultReadOnly: Boolean(payload.readOnly),
              createdAt: Date.now(),
            },
          ];
        });
        setCollaboration((state) => ({
          ...state,
          message: payload.message ?? "Visitante aguardando aprovacao.",
        }));
        setIsCollaborationOpen(true);
        return;
      }

      if (payload.kind === "peerConnected" || payload.kind === "peerDisconnected") {
        if (payload.peerId) {
          setPendingCollaborationRequests((current) =>
            current.filter((request) => request.peerId !== payload.peerId),
          );
          if (payload.kind === "peerDisconnected") {
            setRemoteCursors((current) =>
              current.filter((cursor) => cursor.peerId !== payload.peerId),
            );
          }
        }
        setCollaboration((state) => ({
          ...state,
          peerCount: payload.peerCount ?? state.peerCount,
          message: payload.message ?? state.message,
        }));
        return;
      }

      if (payload.kind === "disconnected") {
        const wasGuest = collaborationStateRef.current.role === "guest";
        logCollaborationDebug(
          `event_disconnected wasGuest=${wasGuest} currentStatus=${collaborationStateRef.current.status} message=${payload.message ?? "none"}`,
        );
        lastCollaborationFilesSignatureRef.current = "";
        setPendingCollaborationRequests([]);
        setRemoteCursors([]);
        setCollaboration({
          status: "idle",
          message: payload.message ?? "Conexao encerrada.",
        });

        if (wasGuest) {
          logCollaborationDebug("event_disconnected_clear_guest_canvas");
          void clearActiveCanvas("Colaboracao encerrada");
        }
        return;
      }

      if (payload.kind === "error") {
        setCollaboration((state) => ({
          ...state,
          status: state.status === "idle" ? "idle" : "error",
          message: payload.message ?? "Erro na colaboracao.",
        }));
      }
    })
      .then((fn) => {
        if (active) {
          unlisten = fn;
        } else {
          fn();
        }
      })
      .catch(console.error);

    getCollaborationStatus()
      .then((info) => {
        if (!active || !info) {
          return;
        }

        setCollaboration(
          getCollaborationStateFromInfo(
            info,
            info.role === "host" ? "hosting" : "connected",
          ),
        );
      })
      .catch(console.error);

    return () => {
      active = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, [applyCollaborationPayload, clearActiveCanvas]);

  useEffect(() => {
    return () => {
      logCollaborationDebug("app_cleanup_stop_collaboration");
      clearCollaborationUpdate();
      clearCollaborationCursorUpdate();
      void stopCollaborationSession();
    };
  }, [clearCollaborationCursorUpdate, clearCollaborationUpdate]);

  useEffect(() => {
    if (collaboration.status !== "hosting" && collaboration.status !== "connected") {
      setRemoteCursors([]);
      return;
    }

    const interval = window.setInterval(() => {
      const now = Date.now();
      setRemoteCursors((current) =>
        current.filter((cursor) => now - cursor.updatedAt < REMOTE_CURSOR_TTL_MS),
      );
    }, 1_000);

    return () => window.clearInterval(interval);
  }, [collaboration.status]);

  const getAttachmentInsertPosition = useCallback(
    (size: { width: number; height: number }) => {
      const host = canvasHostRef.current;
      const viewportWidth = host?.clientWidth || 900;
      const viewportHeight = host?.clientHeight || 640;
      const zoom = sceneViewport.zoom || 1;

      return {
        x: (viewportWidth / 2 - sceneViewport.scrollX) / zoom - size.width / 2,
        y: (viewportHeight / 2 - sceneViewport.scrollY) / zoom - size.height / 2,
      };
    },
    [sceneViewport],
  );

  const markAttachmentsChanged = useCallback(
    (nextAttachments: CanvasAttachment[], nextStatus: string) => {
      attachmentsRef.current = nextAttachments;
      setAttachments(nextAttachments);

      const appState = appStateRef.current;
      if (appState) {
        lastKnownSignatureRef.current = getProjectSignature(
          elementsRef.current,
          appState,
          nextAttachments,
        );
      }

      isDirtyRef.current = true;
      setStatus(nextStatus);
      scheduleCollaborationUpdate();

      if (collaborationStateRef.current.role === "guest") {
        isDirtyRef.current = false;
        setIsDirty(false);
        return;
      }

      setIsDirty(true);
      scheduleAutoSave();
    },
    [scheduleAutoSave, scheduleCollaborationUpdate],
  );

  const removeAttachmentById = useCallback(
    async (attachmentId: string) => {
      if (collaborationStateRef.current.readOnly) {
        setStatus("Somente visualizacao");
        return;
      }

      const attachment = attachmentsRef.current.find((item) => item.id === attachmentId);

      if (!attachment || attachment.displayMode === "native") {
        return;
      }

      const nextAttachments = attachmentsRef.current.filter(
        (item) => item.id !== attachmentId,
      );

      setSelectedAttachmentId((current) =>
        current === attachmentId ? null : current,
      );
      markAttachmentsChanged(nextAttachments, "Anexo removido");

      try {
        await deleteAttachmentFile(attachment.path);
      } catch (error) {
        console.warn("Failed to delete attachment file", error);
      }
    },
    [markAttachmentsChanged],
  );

  useEffect(() => {
    if (!selectedAttachmentId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }

      if (isEditableKeyboardTarget(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void removeAttachmentById(selectedAttachmentId);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [removeAttachmentById, selectedAttachmentId]);

  const insertNativeAttachmentPreview = useCallback(
    (asset: AttachmentAsset, result: NativePreviewResult) => {
      const api = excalidrawApiRef.current;

      if (!api || !result.pages.length) {
        throw new Error("Nao foi possivel inserir o preview nativo.");
      }

      const attachmentId = crypto.randomUUID();
      const layout = getNativePreviewLayout(result);
      const position = getAttachmentInsertPosition({
        width: layout.width,
        height: layout.height,
      });
      const nextFiles: BinaryFiles = { ...filesRef.current };
      const binaryFiles: BinaryFileData[] = [];
      const nextElements: ExcalidrawElement[] = [...elementsRef.current];
      let nextY = position.y;

      result.pages.forEach((page, pageIndex) => {
        const size = layout.sizes[pageIndex];
        const fileId = crypto.randomUUID() as FileId;
        const binaryFile: BinaryFileData = {
          id: fileId,
          dataURL: page.dataURL as DataURL,
          mimeType: page.mimeType,
          created: Date.now(),
        };
        const x = position.x + (layout.width - size.width) / 2;
        const element = createNativePreviewImageElement({
          attachmentId,
          attachmentKind: asset.kind,
          attachmentName: asset.name,
          fileId,
          height: size.height,
          pageIndex,
          sourcePath: asset.path,
          width: size.width,
          x,
          y: nextY,
        });

        nextFiles[fileId] = binaryFile;
        binaryFiles.push(binaryFile);
        nextElements.push(element);
        nextY += size.height + NATIVE_PREVIEW_PAGE_GAP;
      });

      const selectedElementIds = Object.fromEntries(
        nextElements
          .slice(-result.pages.length)
          .map((element) => [element.id, true]),
      );
      const nextAppState = {
        ...api.getAppState(),
        selectedElementIds,
      } as AppState;

      api.addFiles(binaryFiles);
      api.updateScene({
        elements: nextElements,
        appState: nextAppState,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      api.refresh();

      elementsRef.current = nextElements;
      appStateRef.current = nextAppState;
      filesRef.current = nextFiles;
      syncSceneViewport(nextAppState);

      const attachment: CanvasAttachment = {
        ...asset,
        id: attachmentId,
        displayMode: "native",
        x: position.x,
        y: position.y,
        width: layout.width,
        height: layout.height,
        createdAt: Date.now(),
        nativeElementIds: nextElements
          .slice(-result.pages.length)
          .map((element) => element.id),
        nativePageCount: result.pages.length,
        nativeSourcePageCount: result.sourcePageCount,
      };
      const nextAttachments = [...attachmentsRef.current, attachment];
      const status = result.truncated
        ? `Preview nativo inserido (${result.pages.length}/${result.sourcePageCount} paginas)`
        : "Preview nativo inserido";

      markAttachmentsChanged(nextAttachments, status);
    },
    [getAttachmentInsertPosition, markAttachmentsChanged, syncSceneViewport],
  );

  const handleChooseAttachment = useCallback(async () => {
    if (!activeProjectRef.current) {
      setStatus("Selecione um canvas");
      return;
    }

    if (isGuestCollaborationState(collaborationStateRef.current)) {
      setStatus("Visitante nao anexa arquivos");
      return;
    }

    if (!isTauri()) {
      setStatus("Anexos estao disponiveis no app desktop");
      return;
    }

    const selected = await openDialog({
      title: "Anexar arquivo",
      multiple: false,
      filters: [
        {
          name: "Arquivos suportados",
          extensions: [
            "txt",
            "text",
            "md",
            "log",
            "csv",
            "json",
            "pdf",
            "png",
            "jpg",
            "jpeg",
            "gif",
            "webp",
            "bmp",
            "svg",
            "ico",
            "avif",
            "jfif",
            "mp4",
            "m4v",
            "mov",
            "webm",
            "avi",
            "mkv",
            "wmv",
          ],
        },
      ],
    });
    const selectedPath = typeof selected === "string" ? selected : null;

    if (selectedPath) {
      setPendingAttachment({
        type: "path",
        path: selectedPath,
        name: getFileNameFromPath(selectedPath),
      });
    }
  }, []);

  const handleConfirmAttachment = useCallback(
    async (displayMode: AttachmentDisplayMode) => {
      const project = activeProjectRef.current;
      const source = pendingAttachment;

      if (!project || !source) {
        return;
      }

      if (isGuestCollaborationState(collaborationStateRef.current)) {
        setPendingAttachment(null);
        setStatus("Visitante nao anexa arquivos");
        return;
      }

      clearAutoSave();
      setStatus("Anexando arquivo");

      try {
        if (displayMode === "preview") {
          setPreviewConversion({
            fileName: source.name,
            label: "Copiando arquivo",
            progress: 3,
          });
        }

        if (isDirtyRef.current) {
          await persistProject(project);
        }

        const asset =
          source.type === "path"
            ? await attachFileToProject(project.id, source.path)
            : await attachFileBytesToProject(project.id, source.fileName, source.bytes);

        setPendingAttachment(null);

        if (displayMode === "preview" && canRenderNativeAttachmentPreview(asset)) {
          const handleProgress = (progress: NativePreviewProgress) => {
            setPreviewConversion({
              fileName: asset.name,
              label: progress.phase,
              progress: progress.progress,
            });
            setStatus(progress.phase);
          };

          setStatus("Convertendo preview local");
          setPreviewConversion({
            fileName: asset.name,
            label: "Convertendo preview local",
            progress: 6,
          });
          const nativePreview = await renderAttachmentNativePreview(asset, {
            onProgress: handleProgress,
          });
          setPreviewConversion({
            fileName: asset.name,
            label: "Inserindo no canvas",
            progress: 98,
          });
          insertNativeAttachmentPreview(asset, nativePreview);
          setPreviewConversion(null);
          return;
        }

        const finalDisplayMode =
          displayMode === "preview" && canPreviewAttachment(asset.kind)
            ? "preview"
            : "icon";
        const size = getAttachmentSize(asset.kind, finalDisplayMode);
        const position = getAttachmentInsertPosition(size);
        const attachment: CanvasAttachment = {
          ...asset,
          id: crypto.randomUUID(),
          displayMode: finalDisplayMode,
          ...position,
          ...size,
          createdAt: Date.now(),
        };
        const nextAttachments = [...attachmentsRef.current, attachment];

        markAttachmentsChanged(nextAttachments, "Arquivo anexado");
      } catch (error) {
        console.error("Failed to attach file", error);
        setStatus(displayMode === "preview" ? "Erro ao gerar preview" : "Erro ao anexar arquivo");
        setPreviewConversion(null);
      }
    },
    [
      clearAutoSave,
      getAttachmentInsertPosition,
      insertNativeAttachmentPreview,
      markAttachmentsChanged,
      pendingAttachment,
      persistProject,
    ],
  );

  const getCanvasScenePoint = useCallback((clientX: number, clientY: number) => {
    const host = canvasHostRef.current;
    const appState = excalidrawApiRef.current?.getAppState() ?? appStateRef.current;

    if (!host || !appState) {
      return null;
    }

    const rect = host.getBoundingClientRect();
    const zoom = getZoomValue(appState);

    return {
      x: (clientX - rect.left - Number(appState.scrollX || 0)) / zoom,
      y: (clientY - rect.top - Number(appState.scrollY || 0)) / zoom,
    };
  }, []);

  const handleCanvasPointerMoveCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const point = getCanvasScenePoint(event.clientX, event.clientY);

      if (!point) {
        return;
      }

      scheduleCollaborationCursorUpdate({
        ...point,
        visible: true,
      });
    },
    [getCanvasScenePoint, scheduleCollaborationCursorUpdate],
  );

  const handleCanvasPointerLeaveCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const point = getCanvasScenePoint(event.clientX, event.clientY);

      if (!point) {
        return;
      }

      scheduleCollaborationCursorUpdate({
        ...point,
        visible: false,
      });
    },
    [getCanvasScenePoint, scheduleCollaborationCursorUpdate],
  );

  const handleCanvasFileDrag = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasDraggedFiles(event)) {
        return;
      }

      stopFileDragEvent(event);
      event.dataTransfer.dropEffect =
        activeProjectRef.current && !isGuestCollaborationState(collaborationStateRef.current)
          ? "copy"
          : "none";
    },
    [],
  );

  const handleCanvasFileDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasDraggedFiles(event)) {
        return;
      }

      stopFileDragEvent(event);

      const project = activeProjectRef.current;
      if (!project) {
        setStatus("Selecione um canvas");
        return;
      }

      if (isGuestCollaborationState(collaborationStateRef.current)) {
        setStatus("Visitante nao anexa arquivos");
        return;
      }

      if (!isTauri()) {
        setStatus("Anexos estao disponiveis no app desktop");
        return;
      }

      const file = event.dataTransfer.files.item(0);
      if (!file) {
        return;
      }

      const extension = getExtensionFromPath(file.name);
      if (getAttachmentKindFromExtension(extension) === "file") {
        setStatus("Formato de arquivo nao suportado");
        return;
      }

      const droppedPath = getDroppedFilePath(file);
      if (droppedPath) {
        setPendingAttachment({
          type: "path",
          path: droppedPath,
          name: getFileNameFromPath(droppedPath),
        });
        return;
      }

      if (file.size > MAX_DROPPED_ATTACHMENT_BYTES) {
        setStatus("Arquivo grande demais para arrastar. Use Anexar.");
        return;
      }

      setStatus("Preparando anexo");
      try {
        const bytes = await blobToBytes(file);
        setPendingAttachment({
          type: "bytes",
          fileName: file.name,
          name: file.name,
          bytes,
        });
      } catch {
        setStatus("Nao foi possivel ler o arquivo");
      }
    },
    [],
  );

  const handleOpenAttachment = useCallback(async (attachment: CanvasAttachment) => {
    try {
      await openAttachmentFile(attachment.path);
    } catch {
      setStatus("Nao foi possivel abrir o arquivo");
    }
  }, []);

  const handleCanvasDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const api = excalidrawApiRef.current;
      const host = canvasHostRef.current;
      const appState = api?.getAppState() ?? appStateRef.current;

      if (!host || !appState) {
        return;
      }

      const rect = host.getBoundingClientRect();
      const zoom = getZoomValue(appState);
      const sceneX = (event.clientX - rect.left - appState.scrollX) / zoom;
      const sceneY = (event.clientY - rect.top - appState.scrollY) / zoom;
      const attachment = getNativeVideoAttachmentAtPoint(
        attachmentsRef.current,
        elementsRef.current,
        sceneX,
        sceneY,
      );

      if (!attachment) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setVideoPlayerAttachment(attachment);
    },
    [],
  );

  const handleAttachmentSelect = useCallback((attachmentId: string) => {
    setSelectedAttachmentId(attachmentId);

    const api = excalidrawApiRef.current;
    if (!api) {
      return;
    }

    const currentAppState = api.getAppState();
    if (!Object.keys(currentAppState.selectedElementIds || {}).length) {
      return;
    }

    const nextAppState = {
      ...currentAppState,
      selectedElementIds: {},
    } as AppState;

    api.updateScene({
      appState: nextAppState,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    appStateRef.current = nextAppState;
  }, []);

  const handleCanvasPointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".attachment-card")
      ) {
        return;
      }

      setSelectedAttachmentId(null);
    },
    [],
  );

  const handleAttachmentDragStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, attachmentId: string) => {
      if (event.button !== 0) {
        return;
      }

      if (collaborationStateRef.current.readOnly) {
        setStatus("Somente visualizacao");
        return;
      }

      handleAttachmentSelect(attachmentId);
      event.preventDefault();
      event.stopPropagation();

      let lastX = event.clientX;
      let lastY = event.clientY;

      const handleMove = (moveEvent: PointerEvent) => {
        const zoom = sceneViewport.zoom || 1;
        const deltaX = (moveEvent.clientX - lastX) / zoom;
        const deltaY = (moveEvent.clientY - lastY) / zoom;
        const point = getCanvasScenePoint(moveEvent.clientX, moveEvent.clientY);

        lastX = moveEvent.clientX;
        lastY = moveEvent.clientY;

        if (point) {
          scheduleCollaborationCursorUpdate({
            ...point,
            visible: true,
          });
        }

        const nextAttachments = attachmentsRef.current.map((attachment) =>
          attachment.id === attachmentId
            ? {
                ...attachment,
                x: attachment.x + deltaX,
                y: attachment.y + deltaY,
              }
            : attachment,
        );

        attachmentsRef.current = nextAttachments;
        setAttachments(nextAttachments);
        scheduleCollaborationUpdate();
      };

      const handleEnd = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleEnd);
        window.removeEventListener("pointercancel", handleEnd);
        markAttachmentsChanged(attachmentsRef.current, "Anexo movido");
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleEnd);
      window.addEventListener("pointercancel", handleEnd);
    },
    [
      getCanvasScenePoint,
      handleAttachmentSelect,
      markAttachmentsChanged,
      sceneViewport.zoom,
      scheduleCollaborationUpdate,
      scheduleCollaborationCursorUpdate,
    ],
  );

  const handleRename = useCallback(
    async (title: string) => {
      const project = activeProjectRef.current;

      if (!project) {
        return;
      }

      if (isGuestCollaborationState(collaborationStateRef.current)) {
        setActiveProject(project);
        setStatus("Visitante nao renomeia canvas");
        return;
      }

      const trimmed = title.trim() || "Sem título";
      const nextProject = normalizeProject({
        ...project,
        title: trimmed,
        updatedAt: Date.now(),
      });

      setActiveProject(nextProject);
      setProjects((current) => upsertProject(current, nextProject));

      if (excalidrawApiRef.current) {
        excalidrawApiRef.current.updateScene({
          appState: { name: trimmed },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        appStateRef.current = excalidrawApiRef.current.getAppState();
      }

      await persistProject(nextProject);
    },
    [persistProject],
  );

  const requestDeleteProject = useCallback((project: ProjectMetadata) => {
    setProjectPendingDelete(normalizeProject(project));
  }, []);

  const cancelDeleteProject = useCallback(() => {
    if (!isDeletingProject) {
      setProjectPendingDelete(null);
    }
  }, [isDeletingProject]);

  const confirmDeleteProject = useCallback(async () => {
    const project = projectPendingDelete;

    if (!project) {
      return;
    }

    clearAutoSave();
    setIsDeletingProject(true);
    setStatus("Excluindo");

    try {
      const active = activeProjectRef.current;
      const isDeletingActiveProject = active?.id === project.id;

      if (isDeletingActiveProject) {
        await stopCollaborationForCanvasSwitch();
      }

      if (active && !isDeletingActiveProject && isDirtyRef.current) {
        await persistProject(active);
      }

      const remaining = sortProjects(await deleteProject(project.id));
      projectsRef.current = remaining;
      setProjects(remaining);
      setProjectPendingDelete(null);

      if (isDeletingActiveProject) {
        activeProjectRef.current = null;
        isDirtyRef.current = false;
        elementsRef.current = [];
        appStateRef.current = null;
        filesRef.current = EMPTY_FILES;
        attachmentsRef.current = [];
        excalidrawApiRef.current = null;
        lastKnownSignatureRef.current = "";
        lastSavedSignatureRef.current = "";
        setActiveProject(null);
        setCanvasInitialData(null);
        setAttachments([]);
        setSelectedAttachmentId(null);
        setActiveFolderId(getProjectFolderId(project));
        setExportedPath(null);
        setIsDirty(false);
        setStatus("Canvas excluído");
      } else {
        setStatus("Canvas excluído");
      }
    } catch (error) {
      console.error("Failed to delete project", error);
      setStatus("Erro ao excluir");
    } finally {
      setIsDeletingProject(false);
    }
  }, [
    clearAutoSave,
    persistProject,
    projectPendingDelete,
    stopCollaborationForCanvasSwitch,
  ]);

  const handleCreateFolder = useCallback(() => {
    setNewFolderName("Nova pasta");
    setIsCreateFolderOpen(true);
  }, []);

  const handleConfirmCreateFolder = useCallback(async () => {
    const trimmedTitle = newFolderName.trim();

    if (!trimmedTitle) {
      return;
    }

    const folder: ProjectFolder = {
      id: crypto.randomUUID(),
      title: trimmedTitle,
      projects: [],
      createdAt: Date.now(),
      sortOrder: Date.now(),
    };

    setFolders((current) => mergeFolders(current, [folder]));
    setActiveFolderId(folder.id);
    setIsCreateFolderOpen(false);
    await clearActiveCanvas("Pasta criada");

    if (createProjectAfterFolderRef.current) {
      createProjectAfterFolderRef.current = false;
      await createAndOpenProject(folder);
    }
  }, [newFolderName, clearActiveCanvas, createAndOpenProject]);

  const executeDeleteFolder = useCallback(
    async (folder: ProjectFolder) => {
      setIsDeletingFolder(true);
      setStatus("Excluindo pasta");
      try {
        if (isTauri()) {
          const remaining = sortProjects(
            await invoke<ProjectMetadata[]>("delete_folder", {
              folderId: folder.id,
              folderTitle: folder.title,
            }),
          );
          setProjects(remaining);
        } else {
          // fallback
          const remaining = projectsRef.current.filter(
            (p) => getProjectFolderId(p) !== folder.id,
          );
          setProjects(remaining);
        }

        setFolders((current) => current.filter((f) => f.id !== folder.id));
        if (activeFolderId === folder.id) {
          setActiveFolderId("");
          await clearActiveCanvas("Pasta excluída");
        } else {
          setStatus("Pasta excluída");
        }
      } catch (error) {
        console.error(error);
        setStatus("Erro ao excluir pasta");
      } finally {
        setIsDeletingFolder(false);
        setFolderPendingDelete(null);
      }
    },
    [activeFolderId, clearActiveCanvas],
  );

  const handleDeleteFolder = useCallback(
    async (folder: ProjectFolder) => {
      if (folder.projects && folder.projects.length > 0) {
        setFolderPendingDelete(folder);
      } else {
        await executeDeleteFolder(folder);
      }
    },
    [executeDeleteFolder],
  );

  const cancelDeleteFolder = useCallback(() => {
    if (!isDeletingFolder) {
      setFolderPendingDelete(null);
    }
  }, [isDeletingFolder]);

  const confirmDeleteFolder = useCallback(async () => {
    if (folderPendingDelete) {
      await executeDeleteFolder(folderPendingDelete);
    }
  }, [folderPendingDelete, executeDeleteFolder]);

  const handleOpenColorPicker = useCallback((folder: ProjectFolder) => {
    setColorPickerFolder(folder);
    setSelectedColor(folder.color || "");
    setIsColorPickerOpen(true);
  }, []);

  const handleConfirmColor = useCallback(() => {
    if (!colorPickerFolder) return;

    setFolders((current) =>
      current.map((f) =>
        f.id === colorPickerFolder.id
          ? { ...f, color: selectedColor || undefined }
          : f
      )
    );
    setIsColorPickerOpen(false);
    setColorPickerFolder(null);
  }, [colorPickerFolder, selectedColor]);

  const handleDragStart = useCallback((e: React.DragEvent, project: ProjectMetadata) => {
    setDraggedProjectId(project.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", project.id);
  }, []);

  const clearDragPreview = useCallback(() => {
    setDragOverFolderId(null);
    setDragOverProjectId(null);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedProjectId(null);
    clearDragPreview();
  }, [clearDragPreview]);

  const previewDropOnFolder = useCallback(
    (event: React.DragEvent<HTMLElement>, folder: ProjectFolder) => {
      if (!draggedProjectId) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "move";

      if (hasProjectDropTarget(event.target)) {
        setDragOverFolderId(null);
        return;
      }

      const draggedProject = projectsRef.current.find(
        (project) => project.id === draggedProjectId,
      );

      if (draggedProject && getProjectFolderId(draggedProject) === folder.id) {
        setDragOverFolderId(null);
        return;
      }

      setDragOverFolderId(folder.id);
      setDragOverProjectId(null);
    },
    [draggedProjectId],
  );

  const previewDropOnProject = useCallback(
    (event: React.DragEvent<HTMLElement>, project: ProjectMetadata) => {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";

      if (!draggedProjectId || draggedProjectId === project.id) {
        setDragOverProjectId(null);
        setDragOverFolderId(null);
        return;
      }

      setDragOverProjectId(project.id);
      setDragOverFolderId(null);
    },
    [draggedProjectId],
  );

  const handleFolderDragLeave = useCallback(
    (event: React.DragEvent<HTMLElement>, folderId: string) => {
      if (isDragInsideCurrentTarget(event)) {
        return;
      }

      setDragOverFolderId((current) => (current === folderId ? null : current));
    },
    [],
  );

  const handleProjectDragLeave = useCallback(
    (event: React.DragEvent<HTMLElement>, projectId: string) => {
      event.stopPropagation();

      if (isDragInsideCurrentTarget(event)) {
        return;
      }

      setDragOverProjectId((current) => (current === projectId ? null : current));
    },
    [],
  );

  const handleDropOnFolder = useCallback(
    async (e: React.DragEvent, targetFolder: ProjectFolder) => {
      e.preventDefault();
      e.stopPropagation();

      const projectId = draggedProjectId || e.dataTransfer.getData("text/plain");
      clearDragPreview();
      setDraggedProjectId(null);

      if (!projectId) return;

      const project = projectsRef.current.find((p) => p.id === projectId);
      if (!project) return;

      if (getProjectFolderId(project) === targetFolder.id) {
        return;
      }

      setStatus("Movendo canvas");
      try {
        let sorted: ProjectMetadata[] = [];
        if (isTauri()) {
          const updatedProjects = await invoke<ProjectMetadata[]>("move_project", {
            projectId: project.id,
            newFolderId: targetFolder.id,
            newFolderTitle: targetFolder.title,
          });
          sorted = sortProjects(updatedProjects);
        } else {
          // Browser fallback
          const updated = projectsRef.current.map((p) => {
            if (p.id === project.id) {
              return {
                ...p,
                folderId: targetFolder.id,
                folderTitle: targetFolder.title,
              };
            }
            return p;
          });
          localStorage.setItem("excalibur.projects.index", JSON.stringify(updated));
          sorted = sortProjects(updated);
        }

        setProjects(sorted);

        if (activeProjectRef.current && activeProjectRef.current.id === project.id) {
          const updatedActive = sorted.find((p) => p.id === project.id);
          if (updatedActive) {
            setActiveProject(updatedActive);
            setActiveFolderId(updatedActive.folderId || "");
          }
        }
        setStatus("Movido com sucesso");
      } catch (error) {
        console.error("Erro ao mover canvas", error);
        setStatus(`Erro ao mover: ${error}`);
      }
    },
    [clearDragPreview, draggedProjectId],
  );

  const handleDropOnProject = useCallback(
    async (e: React.DragEvent, targetProject: ProjectMetadata) => {
      e.preventDefault();
      e.stopPropagation();

      const projectId = draggedProjectId || e.dataTransfer.getData("text/plain");
      clearDragPreview();
      setDraggedProjectId(null);

      if (!projectId || projectId === targetProject.id) return;

      const sourceProject = projectsRef.current.find((p) => p.id === projectId);
      if (!sourceProject) return;

      const sourceFolderId = getProjectFolderId(sourceProject);
      const targetFolderId = getProjectFolderId(targetProject);

      let currentProjectsList = [...projectsRef.current];

      if (sourceFolderId !== targetFolderId) {
        setStatus("Movendo canvas");
        try {
          if (isTauri()) {
            const movedProjects = await invoke<ProjectMetadata[]>("move_project", {
              projectId: sourceProject.id,
              newFolderId: targetFolderId,
              newFolderTitle: targetProject.folderTitle,
            });
            currentProjectsList = movedProjects;
            if (activeProjectRef.current && activeProjectRef.current.id === sourceProject.id) {
              const updatedActive = movedProjects.find((p) => p.id === sourceProject.id);
              if (updatedActive) {
                setActiveProject(normalizeProject(updatedActive));
                setActiveFolderId(updatedActive.folderId || "");
              }
            }
          } else {
            // Browser fallback
            currentProjectsList = currentProjectsList.map((p) => {
              if (p.id === sourceProject.id) {
                return {
                  ...p,
                  folderId: targetFolderId,
                  folderTitle: targetProject.folderTitle,
                };
              }
              return p;
            });
            localStorage.setItem("excalibur.projects.index", JSON.stringify(currentProjectsList));
            if (activeProjectRef.current && activeProjectRef.current.id === sourceProject.id) {
              const updatedActive = currentProjectsList.find((p) => p.id === sourceProject.id);
              if (updatedActive) {
                setActiveProject(normalizeProject(updatedActive));
                setActiveFolderId(updatedActive.folderId || "");
              }
            }
          }
        } catch (error) {
          console.error("Erro ao mover canvas", error);
          setStatus(`Erro ao mover: ${error}`);
          return;
        }
      }

      const folderProjects = sortProjects(currentProjectsList).filter(
        (p) => getProjectFolderId(p) === targetFolderId
      );

      const sourceIdx = folderProjects.findIndex((p) => p.id === projectId);
      const targetIdx = folderProjects.findIndex((p) => p.id === targetProject.id);

      if (sourceIdx !== -1 && targetIdx !== -1) {
        const [moved] = folderProjects.splice(sourceIdx, 1);
        folderProjects.splice(targetIdx, 0, moved);

        const orderedIds = folderProjects.map((p) => p.id);
        setStatus("Reordenando");
        try {
          if (isTauri()) {
            const reorderedProjects = await invoke<ProjectMetadata[]>("reorder_projects", {
              orderedIds,
            });
            setProjects(sortProjects(reorderedProjects));
          } else {
            // Browser fallback
            const updated = currentProjectsList.map((p) => {
              const idx = orderedIds.indexOf(p.id);
              if (idx !== -1) {
                return {
                  ...p,
                  sortOrder: idx + 1,
                };
              }
              return p;
            });
            localStorage.setItem("excalibur.projects.index", JSON.stringify(updated));
            setProjects(sortProjects(updated));
          }
          setStatus("Reordenado");
        } catch (error) {
          console.error("Erro ao reordenar", error);
          setStatus(`Erro ao reordenar: ${error}`);
        }
      }
    },
    [clearDragPreview, draggedProjectId],
  );

  const toggleFolder = useCallback((folderId: string) => {
    setCollapsedFolderIds((current) => {
      const next = new Set(current);

      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }

      return next;
    });
  }, []);

  const handleFolderSelect = useCallback(
    async (folder: ProjectFolder) => {
      setActiveFolderId(folder.id);
      toggleFolder(folder.id);
      await clearActiveCanvas("Selecione ou crie um canvas");
    },
    [clearActiveCanvas, toggleFolder],
  );

  const openFirstCanvasInActiveFolder = useCallback(async () => {
    const sortedProjects = sortProjects(projectsRef.current);
    const projectInFolder =
      sortedProjects.find((project) => getProjectFolderId(project) === activeFolderId) ??
      sortedProjects.find((project) => !getProjectFolderId(project) || getProjectFolderId(project) === DEFAULT_FOLDER_ID) ??
      sortedProjects[0];

    if (!projectInFolder) {
      setStatus("Nenhum canvas salvo");
      return;
    }

    await openProject(projectInFolder);
  }, [activeFolderId, openProject]);

  const toggleTheme = useCallback(() => {
    setAppTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  const buildExportPayload = useCallback(
    async (format: ExportFormat) => {
      const project = activeProjectRef.current;
      const appState = appStateRef.current;
      const elements = elementsRef.current.filter((element) => !element.isDeleted);

      if (isGuestCollaborationState(collaborationStateRef.current)) {
        setStatus("Visitante nao exporta canvas");
        return null;
      }

      if (!project || !appState || !elements.length) {
        setStatus("Nada para exportar");
        return null;
      }

      clearAutoSave();
      await persistProject(project);
      setStatus(`Exportando ${getExportLabel(format)}`);

      const blob = await exportToBlob({
        elements,
        appState: {
          ...getCleanAppState(appState),
          exportBackground: true,
          viewBackgroundColor:
            appState.viewBackgroundColor || getCanvasBackground(appTheme),
        },
        files: filesRef.current,
        mimeType: getExportMimeType(format),
        quality: 0.94,
        exportPadding: 24,
      });
      const bytes = await blobToBytes(blob);

      return {
        blob,
        bytes,
        fileName: getExportFileName(project.title, format),
        project,
      };
    },
    [appTheme, clearAutoSave, persistProject],
  );

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      setIsExportMenuOpen(false);

      try {
        const payload = await buildExportPayload(format);

        if (!payload) {
          return;
        }

        const exported = await saveExport(
          payload.project.id,
          payload.fileName,
          payload.bytes,
          payload.blob,
        );

        setExportedPath(exported.path);
        setStatus("Exportado");
      } catch (error) {
        console.error(error);
        setStatus("Falha ao exportar");
      }
    },
    [buildExportPayload],
  );

  const handleExportToPath = useCallback(
    async (format: ExportFormat) => {
      setIsExportMenuOpen(false);

      try {
        const payload = await buildExportPayload(format);

        if (!payload) {
          return;
        }

        let targetPath = payload.fileName;

        if (isTauri()) {
          const selectedPath = await saveDialog({
            defaultPath: payload.fileName,
            filters: [
              {
                name: getExportLabel(format),
                extensions: [getExportExtension(format)],
              },
            ],
            title: `Exportar ${getExportLabel(format)} para`,
          });

          if (!selectedPath) {
            setStatus("Exportacao cancelada");
            return;
          }

          targetPath = withExportPathExtension(selectedPath, format);
        }

        const exported = await saveExportToPath(targetPath, payload.bytes, payload.blob);

        setExportedPath(exported.path);
        setStatus("Exportado");
      } catch (error) {
        console.error(error);
        setStatus("Falha ao exportar");
      }
    },
    [buildExportPayload],
  );

  const revealExport = useCallback(async () => {
    if (!exportedPath) {
      return;
    }

    try {
      await revealItemInDir(exportedPath);
    } catch {
      setStatus("Arquivo exportado");
    }
  }, [exportedPath]);

  const refreshProjectsFromStorage = useCallback(async () => {
    const storedProjects = sortProjects(await listProjects());

    setProjects(storedProjects);
    setFolders((current) => mergeFolders(current, foldersFromProjects(storedProjects)));

    if (storedProjects[0]) {
      setActiveFolderId(getProjectFolderId(storedProjects[0]));
      await clearActiveCanvas("Selecione um canvas");
    } else {
      await clearActiveCanvas("Crie um canvas");
    }
  }, [clearActiveCanvas]);

  const handleChooseStorageRoot = useCallback(async () => {
    clearAutoSave();

    let selectedPath: string | null = null;

    if (isTauri()) {
      const selected = await openDialog({
        title: "Escolher pasta do Excalibur",
        directory: true,
        multiple: false,
        defaultPath: storageSettings?.storageRoot,
      });

      selectedPath = typeof selected === "string" ? selected : null;
    } else {
      selectedPath = window.prompt(
        "Pasta padrão",
        storageSettings?.storageRoot ?? "",
      );
    }

    if (!selectedPath) {
      return;
    }

    setStatus("Atualizando local");
    const nextSettings = await setStorageRoot(selectedPath);
    setStorageSettings(nextSettings);

    if (activeProjectRef.current) {
      await persistProject(activeProjectRef.current);
    }

    await refreshProjectsFromStorage();
    setStatus("Local atualizado");
  }, [
    clearAutoSave,
    persistProject,
    refreshProjectsFromStorage,
    storageSettings?.storageRoot,
  ]);

  const handleResetStorageRoot = useCallback(async () => {
    clearAutoSave();
    setStatus("Voltando para Documentos");
    const nextSettings = await resetStorageRoot();
    setStorageSettings(nextSettings);

    if (activeProjectRef.current) {
      await persistProject(activeProjectRef.current);
    }

    await refreshProjectsFromStorage();
    setStatus("Local atualizado");
  }, [clearAutoSave, persistProject, refreshProjectsFromStorage]);

  const handleOpenStorageRoot = useCallback(async () => {
    if (!storageSettings?.storageRoot || !isTauri()) {
      return;
    }

    try {
      await openPath(storageSettings.storageRoot);
    } catch {
      setStatus("Não foi possível abrir a pasta");
    }
  }, [storageSettings?.storageRoot]);

  const pendingAttachmentName = pendingAttachment?.name ?? "";
  const pendingAttachmentExtension = pendingAttachment
    ? getExtensionFromPath(pendingAttachment.name)
    : "";
  const pendingAttachmentKind = getAttachmentKindFromExtension(pendingAttachmentExtension);
  const pendingAttachmentCanPreview = canPreviewAttachment(pendingAttachmentKind);
  const videoPlayerSource = videoPlayerAttachment
    ? getAttachmentAssetUrl(videoPlayerAttachment.path)
    : "";
  const isCollaborationActive =
    collaboration.status === "hosting" || collaboration.status === "connected";
  const isGuestCollaboration =
    collaboration.role === "guest" && collaboration.status === "connected";
  const isReadOnlyCollaboration =
    collaboration.role === "guest" &&
    collaboration.status === "connected" &&
    Boolean(collaboration.readOnly);
  const isCollaborationBusy =
    collaboration.status === "starting" ||
    collaboration.status === "joining" ||
    collaboration.status === "stopping";

  return (
    <main
      className={`app-shell ${isSidebarCompact ? "sidebar-compact" : ""}`}
      data-theme={appTheme}
      style={isSidebarCompact ? undefined : { gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)` }}
    >
      <aside
        className={`sidebar ${draggedProjectId ? "is-dragging" : ""}`}
        aria-label="Pastas e canvas"
      >
        <div className="sidebar-header">
          <button
            className="icon-button"
            onClick={() => setIsSidebarCompact((value) => !value)}
            title="Alternar sidebar"
            type="button"
          >
            <Layers3 size={18} />
          </button>
          <div className="brand">
            <strong>Excalibur</strong>
            <span>
              {projectFolders.length} pastas / {projects.length} canvas
            </span>
          </div>
        </div>

        <div className="sidebar-actions">
          <button
            className="primary-action"
            onClick={() => createAndOpenProject(activeFolder)}
            type="button"
          >
            <Plus size={17} />
            <span>Novo canvas</span>
          </button>
          <button
            className="folder-create-action"
            onClick={handleCreateFolder}
            title="Nova pasta"
            type="button"
          >
            <FolderPlus size={17} />
            <span>Nova pasta</span>
          </button>
        </div>

        <label className="search-box">
          <Search size={16} />
          <input
            aria-label="Buscar canvas"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Buscar"
            value={query}
          />
        </label>

        <div className="project-list">
          {projectFolders.map((folder) => {
            const isCollapsed = collapsedFolderIds.has(folder.id) && !query.trim();

            return (
              <section
                className={`folder-group ${
                  dragOverFolderId === folder.id ? "drop-folder" : ""
                }`}
                data-folder-id={folder.id}
                key={folder.id}
                onDragEnter={(event) => previewDropOnFolder(event, folder)}
                onDragLeave={(event) => handleFolderDragLeave(event, folder.id)}
                onDragOver={(event) => previewDropOnFolder(event, folder)}
                onDrop={(event) => {
                  if (hasProjectDropTarget(event.target)) {
                    return;
                  }

                  void handleDropOnFolder(event, folder);
                }}
              >
                <div
                  className={`folder-row ${
                    activeFolderId === folder.id ? "active" : ""
                  } ${dragOverFolderId === folder.id ? "drag-over" : ""}`}
                  style={{ gridTemplateColumns: "minmax(0, 1fr) 24px 24px 24px" }}
                >
                  <button
                    aria-expanded={!isCollapsed}
                    className="folder-toggle"
                    onClick={() => {
                      void handleFolderSelect(folder);
                    }}
                    type="button"
                  >
                    <ChevronDown size={14} />
                    <Folder
                      size={15}
                      style={
                        folder.color
                          ? { color: `var(--folder-color-${folder.color})` }
                          : undefined
                      }
                    />
                    <span>{folder.title}</span>
                  </button>
                  <button
                    className="folder-add"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleOpenColorPicker(folder);
                    }}
                    title="Editar cor da pasta"
                    type="button"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    className="folder-add"
                    onClick={(event) => {
                      event.stopPropagation();
                      void createAndOpenProject(folder);
                    }}
                    title="Novo canvas nesta pasta"
                    type="button"
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    className="folder-add"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDeleteFolder(folder);
                    }}
                    title="Excluir pasta"
                    type="button"
                    style={{ color: "var(--danger)" }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                {!isCollapsed ? (
                  <div className="folder-projects">
                    {folder.projects.map((project) => (
                      <div
                        className={`project-item ${
                          activeProject?.id === project.id ? "selected" : ""
                        } ${dragOverProjectId === project.id ? "drag-over" : ""}`}
                        data-project-id={project.id}
                        key={project.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, project)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(event) => previewDropOnProject(event, project)}
                        onDragEnter={(event) => previewDropOnProject(event, project)}
                        onDragLeave={(event) => handleProjectDragLeave(event, project.id)}
                        onDrop={(event) => {
                          void handleDropOnProject(event, project);
                        }}
                      >
                        <div
                          className="project-row"
                          onClick={() => openProject(project)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              void openProject(project);
                            }
                          }}
                        >
                          <span className="project-icon">
                            <FileImage size={14} />
                          </span>
                          <span className="project-info">
                            <strong>{project.title}</strong>
                            <span>
                              {project.elementsCount} itens ·{" "}
                              {formatRelativeTime(project.updatedAt)}
                            </span>
                          </span>
                        </div>
                        <button
                          aria-label={`Excluir ${project.title}`}
                          className="project-delete"
                          onClick={(event) => {
                            event.stopPropagation();
                            requestDeleteProject(project);
                          }}
                          title="Excluir canvas"
                          type="button"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}

          {rootProjects.length > 0 ? (
            <div className="folder-projects" style={{ paddingLeft: 0, marginTop: "4px" }}>
              {rootProjects.map((project) => (
                <div
                  className={`project-item ${
                    activeProject?.id === project.id ? "selected" : ""
                  } ${dragOverProjectId === project.id ? "drag-over" : ""}`}
                  data-project-id={project.id}
                  key={project.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, project)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(event) => previewDropOnProject(event, project)}
                  onDragEnter={(event) => previewDropOnProject(event, project)}
                  onDragLeave={(event) => handleProjectDragLeave(event, project.id)}
                  onDrop={(event) => {
                    void handleDropOnProject(event, project);
                  }}
                >
                  <div
                    className="project-row"
                    onClick={() => openProject(project)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void openProject(project);
                      }
                    }}
                  >
                    <span className="project-icon">
                      <FileImage size={14} />
                    </span>
                    <span className="project-info">
                      <strong>{project.title}</strong>
                      <span>
                        {project.elementsCount} itens ·{" "}
                        {formatRelativeTime(project.updatedAt)}
                      </span>
                    </span>
                  </div>
                  <button
                    aria-label={`Excluir ${project.title}`}
                    className="project-delete"
                    onClick={(event) => {
                      event.stopPropagation();
                      requestDeleteProject(project);
                    }}
                    title="Excluir canvas"
                    type="button"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="sidebar-footer">
          <button
            className="settings-entry"
            onClick={() => setIsSettingsOpen(true)}
            type="button"
          >
            <Settings size={17} />
            <span>Configurações</span>
          </button>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={appTheme === "dark" ? "Modo claro" : "Modo escuro"}
            type="button"
          >
            {appTheme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
        {!isSidebarCompact && (
          <div
            className={`sidebar-resizer ${isResizing ? "is-resizing" : ""}`}
            onMouseDown={handleMouseDown}
          />
        )}
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="title-cluster">
            {activeProject ? (
              <input
                aria-label="Nome do canvas"
                className="project-title-input"
                disabled={isGuestCollaboration}
                maxLength={50}
                onBlur={(event) => handleRename(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
                onChange={(event) =>
                  setActiveProject((project) =>
                    project ? { ...project, title: event.currentTarget.value } : project,
                  )
                }
                value={activeProject.title}
              />
            ) : (
              <div className="canvas-title-placeholder">Nenhum canvas selecionado</div>
            )}
            <span className="project-meta">
              <Clock3 size={14} />
              {activeProject ? (
                <>
                  {formatRelativeTime(activeProject.updatedAt)} · {bytesToLabel(activeProject.bytes)} ·{" "}
                  <span className={isDirty ? "status-dirty" : ""}>{status}</span>
                </>
              ) : (
                status
              )}
            </span>
          </div>

          <div className="topbar-actions">
            <button
              className="toolbar-button"
              disabled={!activeProject || isGuestCollaboration}
              onClick={handleManualSave}
              type="button"
            >
              <Save size={16} />
              <span>Salvar</span>
            </button>
            <button
              className="toolbar-button"
              disabled={!activeProject || isGuestCollaboration}
              onClick={handleChooseAttachment}
              type="button"
            >
              <Paperclip size={16} />
              <span>Anexar</span>
            </button>
            <button
              className={`toolbar-button collaboration-trigger ${
                isCollaborationActive ? "is-live" : ""
              }`}
              disabled={isCollaborationBusy}
              onClick={() => setIsCollaborationOpen(true)}
              type="button"
            >
              <Users size={16} />
              <span>{isCollaborationActive ? "Ao vivo" : "Colaborar"}</span>
            </button>
            <div className="export-menu" ref={exportMenuRef}>
              <button
                aria-expanded={isExportMenuOpen}
                aria-haspopup="menu"
                className="toolbar-button export-trigger"
                disabled={!activeProject || isGuestCollaboration}
                onClick={() => setIsExportMenuOpen((current) => !current)}
                type="button"
              >
                <ImageDown size={16} />
                <span>Exportar</span>
                <ChevronDown className="export-chevron" size={14} />
              </button>
              {isExportMenuOpen && activeProject && !isGuestCollaboration ? (
                <div className="export-menu-popover" role="menu">
                  <button
                    className="export-menu-item"
                    onClick={() => void handleExport("png")}
                    role="menuitem"
                    type="button"
                  >
                    <ImageDown size={15} />
                    <span>PNG</span>
                  </button>
                  <button
                    className="export-menu-item"
                    onClick={() => void handleExport("jpeg")}
                    role="menuitem"
                    type="button"
                  >
                    <ImageDown size={15} />
                    <span>JPG</span>
                  </button>
                  <div className="export-menu-divider" />
                  <button
                    className="export-menu-item"
                    onClick={() => void handleExportToPath("png")}
                    role="menuitem"
                    type="button"
                  >
                    <FolderOpen size={15} />
                    <span>PNG para...</span>
                  </button>
                  <button
                    className="export-menu-item"
                    onClick={() => void handleExportToPath("jpeg")}
                    role="menuitem"
                    type="button"
                  >
                    <FolderOpen size={15} />
                    <span>JPG para...</span>
                  </button>
                  {exportedPath ? (
                    <>
                      <div className="export-menu-divider" />
                      <button
                        className="export-menu-item"
                        onClick={() => {
                          setIsExportMenuOpen(false);
                          void revealExport();
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <FolderOpen size={15} />
                        <span>Mostrar ultimo export</span>
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
            <button
              className="icon-button danger"
              disabled={!activeProject || isGuestCollaboration}
              onClick={() => activeProject && requestDeleteProject(activeProject)}
              title="Excluir canvas"
              type="button"
            >
              <Trash2 size={17} />
            </button>
          </div>
        </header>

        <div
          className="canvas-host"
          onDoubleClickCapture={handleCanvasDoubleClick}
          onDragEnterCapture={handleCanvasFileDrag}
          onDragOverCapture={handleCanvasFileDrag}
          onDropCapture={handleCanvasFileDrop}
          onPointerDownCapture={handleCanvasPointerDownCapture}
          onPointerLeave={handleCanvasPointerLeaveCapture}
          onPointerMoveCapture={handleCanvasPointerMoveCapture}
          ref={canvasHostRef}
        >
          {activeProject ? (
            <>
              <Excalidraw
                key={activeProject.id}
                aiEnabled={false}
                autoFocus
                excalidrawAPI={(api) => {
                  excalidrawApiRef.current = api;
                }}
                gridModeEnabled={false}
                handleKeyboardGlobally
                initialData={
                  canvasInitialData ?? {
                    appState: {
                      name: activeProject.title,
                      theme: getExcalidrawTheme(appTheme),
                      viewBackgroundColor: appTheme === "dark" ? lastDarkBg : lastLightBg,
                    },
                    elements: [],
                    files: EMPTY_FILES,
                  }
                }
                langCode="pt-BR"
                name={activeProject.title}
                onChange={handleCanvasChange}
                theme={getExcalidrawTheme(appTheme)}
                viewModeEnabled={isReadOnlyCollaboration}
                UIOptions={{
                  canvasActions: {
                    clearCanvas: true,
                    changeViewBackgroundColor: true,
                    export: {
                      saveFileToDisk: true,
                    },
                    loadScene: true,
                    saveAsImage: true,
                    saveToActiveFile: false,
                    toggleTheme: false,
                  },
                  tools: {
                    image: true,
                  },
                }}
              >
                <ExcaliburMainMenu />
              </Excalidraw>
              <div className="attachment-layer" aria-label="Anexos do canvas">
                {attachments
                  .filter((attachment) => attachment.displayMode !== "native")
                  .map((attachment) => (
                    <AttachmentPreview
                      attachment={attachment}
                      key={attachment.id}
                      left={attachment.x * sceneViewport.zoom + sceneViewport.scrollX}
                      onDelete={(attachmentId) => {
                        void removeAttachmentById(attachmentId);
                      }}
                      onDragHandlePointerDown={handleAttachmentDragStart}
                      onOpen={handleOpenAttachment}
                      onSelect={handleAttachmentSelect}
                      selected={selectedAttachmentId === attachment.id}
                      top={attachment.y * sceneViewport.zoom + sceneViewport.scrollY}
                      zoom={sceneViewport.zoom}
                    />
                  ))}
              </div>
              <div className="remote-cursor-layer" aria-hidden="true">
                {remoteCursors.map((cursor) => (
                  <div
                    className="remote-cursor"
                    key={cursor.peerId}
                    style={{
                      color: cursor.color,
                      transform: `translate3d(${cursor.x * sceneViewport.zoom + sceneViewport.scrollX}px, ${cursor.y * sceneViewport.zoom + sceneViewport.scrollY}px, 0)`,
                    }}
                  >
                    <MousePointer2 size={18} />
                    <span style={{ backgroundColor: cursor.color }}>{cursor.label}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-canvas-state">
              <div className="empty-canvas-content">
                <strong>Nenhum canvas selecionado</strong>
                <div className="empty-canvas-actions">
                  <button
                    className="toolbar-button"
                    onClick={() => createAndOpenProject(activeFolder)}
                    type="button"
                  >
                    <Plus size={16} />
                    <span>Novo canvas</span>
                  </button>
                  <button
                    className="toolbar-button"
                    disabled={!projects.length}
                    onClick={openFirstCanvasInActiveFolder}
                    type="button"
                  >
                    <FolderOpen size={16} />
                    <span>Abrir canvas existente</span>
                  </button>
                  <button
                    className="toolbar-button"
                    onClick={handleCreateFolder}
                    type="button"
                  >
                    <FolderPlus size={16} />
                    <span>Nova pasta</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {isSettingsOpen ? (
        <div className="settings-backdrop" onMouseDown={() => setIsSettingsOpen(false)}>
          <section
            aria-label="Configurações"
            className="settings-panel"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="settings-header">
              <div>
                <strong>Configurações</strong>
                <span>Salvamento</span>
              </div>
              <button
                className="icon-button"
                onClick={() => setIsSettingsOpen(false)}
                title="Fechar"
                type="button"
              >
                <X size={17} />
              </button>
            </header>

            <div className="settings-body">
              <div className="settings-section">
                <div className="settings-row">
                  <span>Local padrão</span>
                  <code>{storageSettings?.storageRoot ?? "Carregando"}</code>
                </div>
                <div className="settings-row">
                  <span>Padrão do Windows</span>
                  <code>{storageSettings?.defaultStorageRoot ?? "Documentos\\Excalibur"}</code>
                </div>
                <div className="settings-actions">
                  <button
                    className="toolbar-button"
                    onClick={handleChooseStorageRoot}
                    type="button"
                  >
                    <FolderOpen size={16} />
                    <span>Alterar local</span>
                  </button>
                  <button
                    className="toolbar-button"
                    disabled={!storageSettings?.storageRoot || !isTauri()}
                    onClick={handleOpenStorageRoot}
                    type="button"
                  >
                    <ExternalLink size={16} />
                    <span>Abrir pasta</span>
                  </button>
                  <button
                    className="toolbar-button"
                    onClick={handleResetStorageRoot}
                    type="button"
                  >
                    <RotateCcw size={16} />
                    <span>Usar Documentos</span>
                  </button>
                </div>
              </div>

              <div className="settings-section folder-layout">
                <span>Estrutura</span>
                <code>projects\\pasta\\canvas\\scene.excalidraw</code>
                <code>projects\\pasta\\canvas\\exports\\png</code>
                <code>projects\\pasta\\canvas\\exports\\jpg</code>
              </div>

              <div className="settings-section license-credits" style={{ borderTop: "1px solid var(--border-color)", paddingTop: "14px", marginTop: "14px" }}>
                <span>Sobre & Licenças</span>
                <p style={{ fontSize: "12.5px", margin: "6px 0", color: "var(--text-muted)", lineHeight: "1.4" }}>
                  Este projeto utiliza o <strong>Excalidraw</strong>, que é publicado sob a licença MIT.
                </p>
                <div style={{ display: "flex", gap: "16px", marginTop: "8px" }}>
                  <a
                    href="https://github.com/excalidraw/excalidraw"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      if (isTauri()) {
                        e.preventDefault();
                        void openUrl("https://github.com/excalidraw/excalidraw").catch(console.error);
                      }
                    }}
                    style={{ fontSize: "12px", color: "var(--accent)", textDecoration: "none", display: "flex", alignItems: "center", gap: "4px", fontWeight: 500 }}
                  >
                    <ExternalLink size={12} />
                    <span>Excalidraw GitHub</span>
                  </a>
                  <a
                    href="https://github.com/excalidraw/excalidraw/blob/master/LICENSE"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      if (isTauri()) {
                        e.preventDefault();
                        void openUrl("https://github.com/excalidraw/excalidraw/blob/master/LICENSE").catch(console.error);
                      }
                    }}
                    style={{ fontSize: "12px", color: "var(--accent)", textDecoration: "none", display: "flex", alignItems: "center", gap: "4px", fontWeight: 500 }}
                  >
                    <ExternalLink size={12} />
                    <span>Licença MIT</span>
                  </a>
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {isCollaborationOpen ? (
        <div
          className="confirm-backdrop"
          onMouseDown={() => setIsCollaborationOpen(false)}
        >
          <section
            aria-label="Colaboracao"
            aria-modal="true"
            className="confirm-panel collaboration-panel"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="confirm-header">
              <strong>Colaboracao</strong>
              <button
                className="icon-button"
                onClick={() => setIsCollaborationOpen(false)}
                title="Fechar"
                type="button"
              >
                <X size={17} />
              </button>
            </header>
            <div className="confirm-body collaboration-body">
              {isCollaborationActive ? (
                <div className="collaboration-status-card">
                  <div>
                    <span>
                      {collaboration.role === "host"
                        ? "Hospedando sessao"
                        : "Conectado como visitante"}
                    </span>
                    <strong>
                      {collaboration.role === "host"
                        ? `${collaboration.peerCount ?? 0} visitante(s)`
                        : collaboration.readOnly
                          ? "Somente visualizacao"
                          : "Edicao permitida"}
                    </strong>
                  </div>
                  <span className="collaboration-live-dot" />
                </div>
              ) : null}

              {isCollaborationActive ? (
                <div className="collaboration-security-row">
                  <span>
                    <ShieldCheck size={14} />
                    Mensagens criptografadas
                  </span>
                  {collaboration.role === "guest" && collaboration.readOnly ? (
                    <span>
                      <Eye size={14} />
                      Somente visualizacao
                    </span>
                  ) : null}
                </div>
              ) : null}

              {collaboration.role === "host" && pendingCollaborationRequests.length ? (
                <div className="collaboration-section">
                  <label>Pedidos de entrada</label>
                  <div className="collaboration-request-list">
                    {pendingCollaborationRequests.map((request) => (
                      <div className="collaboration-request" key={request.requestId}>
                        <div>
                          <strong>{request.peerId}</strong>
                          <span>{request.message}</span>
                        </div>
                        <div className="collaboration-request-actions">
                          <button
                            className="toolbar-button"
                            onClick={() => {
                              void handleRespondCollaborationRequest(
                                request,
                                true,
                                false,
                              );
                            }}
                            type="button"
                          >
                            Editar
                          </button>
                          <button
                            className="toolbar-button"
                            onClick={() => {
                              void handleRespondCollaborationRequest(
                                request,
                                true,
                                true,
                              );
                            }}
                            type="button"
                          >
                            Visualizar
                          </button>
                          <button
                            className="toolbar-button danger-action"
                            onClick={() => {
                              void handleRespondCollaborationRequest(
                                request,
                                false,
                                request.defaultReadOnly,
                              );
                            }}
                            type="button"
                          >
                            Recusar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {collaboration.role === "host" && collaboration.code ? (
                <div className="collaboration-section">
                  <label htmlFor="collaboration-code">Codigo</label>
                  <textarea
                    id="collaboration-code"
                    readOnly
                    value={collaboration.code}
                  />
                  <div className="collaboration-actions-row">
                    <button
                      className="toolbar-button"
                      onClick={handleCopyCollaborationCode}
                      type="button"
                    >
                      <Copy size={16} />
                      <span>Copiar codigo</span>
                    </button>
                    <button
                      className="toolbar-button danger-action"
                      disabled={isCollaborationBusy}
                      onClick={() => {
                        void handleStopCollaboration();
                      }}
                      type="button"
                    >
                      <WifiOff size={16} />
                      <span>Parar</span>
                    </button>
                  </div>
                </div>
              ) : null}

              {collaboration.role === "guest" && isCollaborationActive ? (
                <div className="collaboration-section">
                  <button
                    className="toolbar-button danger-action"
                    disabled={isCollaborationBusy}
                    onClick={() => {
                      void handleStopCollaboration();
                    }}
                    type="button"
                  >
                    <WifiOff size={16} />
                    <span>Sair da colaboracao</span>
                  </button>
                </div>
              ) : null}

              {!isCollaborationActive ? (
                <>
                  <div className="collaboration-section">
                    <div className="collaboration-options">
                      <label className="collaboration-option">
                        <input
                          checked={collaborationRequireApproval}
                          onChange={(event) =>
                            setCollaborationRequireApproval(event.currentTarget.checked)
                          }
                          type="checkbox"
                        />
                        <span>Exigir aprovacao do host</span>
                      </label>
                      <label className="collaboration-option">
                        <input
                          checked={collaborationDefaultReadOnly}
                          onChange={(event) =>
                            setCollaborationDefaultReadOnly(event.currentTarget.checked)
                          }
                          type="checkbox"
                        />
                        <span>Visitantes entram somente visualizacao</span>
                      </label>
                    </div>
                    <button
                      className="toolbar-button"
                      disabled={!activeProject || isCollaborationBusy}
                      onClick={() => {
                        void handleStartCollaboration();
                      }}
                      type="button"
                    >
                      <Users size={16} />
                      <span>
                        {collaboration.status === "starting"
                          ? "Iniciando"
                          : "Iniciar colaboracao"}
                      </span>
                    </button>
                  </div>
                  <div className="collaboration-section">
                    <label htmlFor="join-collaboration-code">Entrar com codigo</label>
                    <textarea
                      id="join-collaboration-code"
                      onChange={(event) => setJoinCode(event.currentTarget.value)}
                      placeholder="Cole o codigo"
                      value={joinCode}
                    />
                    <button
                      className="toolbar-button"
                      disabled={isCollaborationBusy || !joinCode.trim()}
                      onClick={() => {
                        void handleJoinCollaboration();
                      }}
                      type="button"
                    >
                      <Users size={16} />
                      <span>
                        {collaboration.status === "joining" ? "Conectando" : "Conectar"}
                      </span>
                    </button>
                  </div>
                </>
              ) : null}

              {collaboration.message ? (
                <p className="collaboration-message">{collaboration.message}</p>
              ) : null}

              <div className="collaboration-actions-row">
                <button
                  className="toolbar-button"
                  onClick={() => {
                    void handleOpenCollaborationLog();
                  }}
                  type="button"
                >
                  <ExternalLink size={16} />
                  <span>Abrir log</span>
                </button>
              </div>

              {collaborationLogPath ? (
                <p className="collaboration-message">Log: {collaborationLogPath}</p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {pendingAttachment ? (
        <div className="confirm-backdrop" onMouseDown={() => setPendingAttachment(null)}>
          <section
            aria-label="Anexar arquivo"
            aria-modal="true"
            className="confirm-panel"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="confirm-header">
              <strong>Anexar arquivo</strong>
              <button
                className="icon-button"
                onClick={() => setPendingAttachment(null)}
                title="Fechar"
                type="button"
              >
                <X size={17} />
              </button>
            </header>
            <div className="confirm-body">
              <div className="attachment-choice">
                <span>{pendingAttachmentName}</span>
                <small>
                  {pendingAttachmentExtension.toUpperCase() || "ARQUIVO"}
                  {pendingAttachmentCanPreview ? " com preview disponivel" : ""}
                </small>
              </div>
            </div>
            <footer className="confirm-actions">
              <button
                className="toolbar-button"
                onClick={() => {
                  void handleConfirmAttachment("icon");
                }}
                type="button"
              >
                Arquivo
              </button>
              <button
                className="toolbar-button"
                disabled={!pendingAttachmentCanPreview}
                onClick={() => {
                  void handleConfirmAttachment("preview");
                }}
                type="button"
              >
                Preview
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {previewConversion ? (
        <div className="conversion-progress-backdrop">
          <section
            aria-label="Convertendo preview"
            aria-live="polite"
            className="conversion-progress-panel"
            role="status"
          >
            <div className="conversion-progress-header">
              <strong>Convertendo preview</strong>
              <span>{previewConversion.fileName}</span>
            </div>
            <div
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={previewConversion.progress}
              className="conversion-progress-track"
              role="progressbar"
            >
              <div
                className="conversion-progress-bar"
                style={{ width: `${previewConversion.progress}%` }}
              />
            </div>
            <small>{previewConversion.label}</small>
          </section>
        </div>
      ) : null}

      {videoPlayerAttachment ? (
        <div
          className="video-player-backdrop"
          onMouseDown={() => setVideoPlayerAttachment(null)}
        >
          <section
            aria-label="Reproduzir video"
            aria-modal="true"
            className="video-player-panel"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="video-player-header">
              <div>
                <strong>{videoPlayerAttachment.name}</strong>
                <span>{videoPlayerAttachment.extension.toUpperCase() || "VIDEO"}</span>
              </div>
              <button
                className="icon-button"
                onClick={() => setVideoPlayerAttachment(null)}
                title="Fechar"
                type="button"
              >
                <X size={17} />
              </button>
            </header>
            <video
              autoPlay
              className="video-player-media"
              controls
              key={videoPlayerAttachment.path}
              onCanPlay={() => setVideoPlaybackError("")}
              onError={() => {
                setVideoPlaybackError(
                  "Nao foi possivel reproduzir este video no app.",
                );
              }}
              playsInline
              preload="metadata"
            >
              <source
                src={videoPlayerSource}
                type={videoPlayerAttachment.mimeType || undefined}
              />
            </video>
            <footer className="video-player-actions">
              {videoPlaybackError ? (
                <span className="video-player-error">{videoPlaybackError}</span>
              ) : null}
              <button
                className="toolbar-button"
                onClick={() => {
                  void handleOpenAttachment(videoPlayerAttachment);
                }}
                type="button"
              >
                <ExternalLink size={16} />
                <span>Abrir no Windows</span>
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {projectPendingDelete ? (
        <div className="confirm-backdrop" onMouseDown={cancelDeleteProject}>
          <section
            aria-label="Confirmar exclusão"
            aria-modal="true"
            className="confirm-panel"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="confirm-header">
              <strong>Excluir canvas?</strong>
              <button
                className="icon-button"
                disabled={isDeletingProject}
                onClick={cancelDeleteProject}
                title="Fechar"
                type="button"
              >
                <X size={17} />
              </button>
            </header>
            <div className="confirm-body">
              <p>
                Isso remove <strong>{projectPendingDelete.title}</strong> da pasta{" "}
                <strong>{getProjectFolderTitle(projectPendingDelete)}</strong>,
                incluindo o arquivo do canvas e exports salvos.
              </p>
            </div>
            <footer className="confirm-actions">
              <button
                className="toolbar-button"
                disabled={isDeletingProject}
                onClick={cancelDeleteProject}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="toolbar-button danger-action"
                disabled={isDeletingProject}
                onClick={confirmDeleteProject}
                type="button"
              >
                <Trash2 size={16} />
                <span>{isDeletingProject ? "Excluindo" : "Excluir"}</span>
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {folderPendingDelete ? (
        <div className="confirm-backdrop" onMouseDown={cancelDeleteFolder}>
          <section
            aria-label="Confirmar exclusão de pasta"
            aria-modal="true"
            className="confirm-panel"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="confirm-header">
              <strong>Excluir pasta?</strong>
              <button
                className="icon-button"
                disabled={isDeletingFolder}
                onClick={cancelDeleteFolder}
                title="Fechar"
                type="button"
              >
                <X size={17} />
              </button>
            </header>
            <div className="confirm-body">
              <p>
                Deseja excluir a pasta <strong>{folderPendingDelete.title}</strong> e todos os seus canvas?
              </p>
            </div>
            <footer className="confirm-actions">
              <button
                className="toolbar-button"
                disabled={isDeletingFolder}
                onClick={cancelDeleteFolder}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="toolbar-button danger-action"
                disabled={isDeletingFolder}
                onClick={confirmDeleteFolder}
                type="button"
              >
                <Trash2 size={16} />
                <span>{isDeletingFolder ? "Excluindo" : "Excluir"}</span>
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {isCreateFolderOpen ? (
        <div className="confirm-backdrop" onMouseDown={() => setIsCreateFolderOpen(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleConfirmCreateFolder();
            }}
            className="confirm-panel"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="confirm-header">
              <strong>Nova pasta</strong>
              <button
                className="icon-button"
                onClick={() => setIsCreateFolderOpen(false)}
                title="Fechar"
                type="button"
              >
                <X size={17} />
              </button>
            </header>
            <div className="confirm-body">
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label htmlFor="folder-name-input" style={{ fontSize: "13px", fontWeight: 600 }}>
                  Nome da pasta
                </label>
                <input
                  id="folder-name-input"
                  autoFocus
                  className="project-title-input"
                  style={{
                    width: "100%",
                    border: "1px solid var(--control-border)",
                    background: "var(--control-bg)",
                    color: "var(--fg)",
                    borderRadius: "6px",
                    padding: "8px 10px",
                    fontSize: "14px"
                  }}
                  maxLength={40}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  value={newFolderName}
                />
              </div>
            </div>
            <footer className="confirm-actions">
              <button
                className="toolbar-button"
                onClick={() => setIsCreateFolderOpen(false)}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="toolbar-button"
                style={{
                  background: "var(--accent)",
                  color: appTheme === "dark" ? "#212121" : "#ffffff",
                  border: "none",
                  fontWeight: "700"
                }}
                type="submit"
              >
                Criar
              </button>
            </footer>
          </form>
        </div>
      ) : null}

      {isCreateProjectModalOpen && projectTargetFolder ? (
        <div className="confirm-backdrop" onMouseDown={() => setIsCreateProjectModalOpen(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleConfirmCreateProject();
            }}
            className="confirm-panel"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="confirm-header">
              <strong>Novo canvas</strong>
              <button
                className="icon-button"
                onClick={() => setIsCreateProjectModalOpen(false)}
                title="Fechar"
                type="button"
              >
                <X size={17} />
              </button>
            </header>
            <div className="confirm-body">
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label htmlFor="canvas-name-input" style={{ fontSize: "13px", fontWeight: 600 }}>
                  Nome do canvas (na pasta: {projectTargetFolder.title})
                </label>
                <input
                  id="canvas-name-input"
                  autoFocus
                  className="project-title-input"
                  style={{
                    width: "100%",
                    border: "1px solid var(--control-border)",
                    background: "var(--control-bg)",
                    color: "var(--fg)",
                    borderRadius: "6px",
                    padding: "8px 10px",
                    fontSize: "14px"
                  }}
                  maxLength={50}
                  onChange={(event) => setNewProjectTitle(event.target.value)}
                  value={newProjectTitle}
                />
              </div>
            </div>
            <footer className="confirm-actions">
              <button
                className="toolbar-button"
                onClick={() => setIsCreateProjectModalOpen(false)}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="toolbar-button"
                style={{
                  background: "var(--accent)",
                  color: appTheme === "dark" ? "#212121" : "#ffffff",
                  border: "none",
                  fontWeight: "700"
                }}
                type="submit"
              >
                Confirmar
              </button>
            </footer>
          </form>
        </div>
      ) : null}

      {isColorPickerOpen && colorPickerFolder ? (
        <div className="confirm-backdrop" onMouseDown={() => setIsColorPickerOpen(false)}>
          <div
            className="confirm-panel"
            onMouseDown={(event) => event.stopPropagation()}
            style={{ maxWidth: "380px" }}
          >
            <header className="confirm-header">
              <strong>Cor da pasta</strong>
              <button
                className="icon-button"
                onClick={() => setIsColorPickerOpen(false)}
                title="Fechar"
                type="button"
              >
                <X size={17} />
              </button>
            </header>
            <div className="confirm-body">
              <p style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "16px" }}>
                Selecione uma cor para destacar a pasta <strong>{colorPickerFolder.title}</strong> na barra lateral.
              </p>
              <div className="color-picker-grid">
                {PREDEFINED_COLORS.map((color) => {
                  const isSelected = selectedColor === color.key;
                  return (
                    <button
                      key={color.key}
                      className={`color-dot ${isSelected ? "selected" : ""}`}
                      style={{
                        backgroundColor: color.key ? `var(--folder-color-${color.key})` : "var(--muted)",
                      }}
                      onClick={() => setSelectedColor(color.key)}
                      title={color.name}
                      type="button"
                    />
                  );
                })}
              </div>
            </div>
            <footer className="confirm-actions">
              <button
                className="toolbar-button"
                onClick={() => setIsColorPickerOpen(false)}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="toolbar-button"
                style={{
                  background: "var(--accent)",
                  color: appTheme === "dark" ? "#212121" : "#ffffff",
                  border: "none",
                  fontWeight: "700"
                }}
                onClick={handleConfirmColor}
                type="button"
              >
                Confirmar
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default App;
