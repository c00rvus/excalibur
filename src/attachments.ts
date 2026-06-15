import type { AttachmentAsset, AttachmentKind } from "./storage";

export type AttachmentDisplayMode = "icon" | "preview" | "native";

export type CanvasAttachment = AttachmentAsset & {
  id: string;
  displayMode: AttachmentDisplayMode;
  x: number;
  y: number;
  width: number;
  height: number;
  createdAt: number;
  nativeElementIds?: string[];
  nativePageCount?: number;
  nativeSourcePageCount?: number;
};

export const ATTACHMENTS_PAYLOAD_KEY = "excaliburAttachments";

export function canPreviewAttachment(kind: AttachmentKind) {
  return kind === "text" || kind === "pdf" || kind === "image" || kind === "video";
}

export function getFileNameFromPath(path: string) {
  return path.split(/[\\/]/).pop()?.trim() || "Arquivo";
}

export function getAttachmentKindFromExtension(extension: string): AttachmentKind {
  const normalized = extension.trim().toLowerCase();

  if (["txt", "text", "md", "log", "csv", "json"].includes(normalized)) {
    return "text";
  }

  if (normalized === "pdf") {
    return "pdf";
  }

  if (
    ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "avif", "jfif"].includes(
      normalized,
    )
  ) {
    return "image";
  }

  if (["mp4", "m4v", "mov", "webm", "avi", "mkv", "wmv"].includes(normalized)) {
    return "video";
  }

  return "file";
}

export function getExtensionFromPath(path: string) {
  return getFileNameFromPath(path).split(".").pop()?.trim().toLowerCase() || "";
}

export function getAttachmentSize(
  kind: AttachmentKind,
  displayMode: AttachmentDisplayMode,
) {
  if (displayMode === "icon") {
    return { width: 240, height: 74 };
  }

  if (kind === "video") {
    return { width: 460, height: 300 };
  }

  if (kind === "pdf") {
    return { width: 460, height: 620 };
  }

  if (kind === "image") {
    return { width: 460, height: 320 };
  }

  return { width: 420, height: 520 };
}

export function normalizeAttachments(value: unknown): CanvasAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Partial<CanvasAttachment> => {
      return Boolean(item && typeof item === "object");
    })
    .map((item) => {
      const kind = item.kind || "file";
      const displayMode: AttachmentDisplayMode =
        item.displayMode === "native"
          ? "native"
          : item.displayMode === "preview" && canPreviewAttachment(kind)
            ? "preview"
            : "icon";
      const size = getAttachmentSize(kind, displayMode);

      return {
        id: item.id || crypto.randomUUID(),
        name: item.name?.trim() || getFileNameFromPath(item.path || ""),
        path: item.path || "",
        extension: item.extension || "",
        mimeType: item.mimeType || "application/octet-stream",
        kind,
        size: Number(item.size || 0),
        displayMode,
        x: Number.isFinite(item.x) ? Number(item.x) : 0,
        y: Number.isFinite(item.y) ? Number(item.y) : 0,
        width: Number.isFinite(item.width) ? Number(item.width) : size.width,
        height: Number.isFinite(item.height) ? Number(item.height) : size.height,
        createdAt: Number(item.createdAt || Date.now()),
        nativeElementIds: Array.isArray(item.nativeElementIds)
          ? item.nativeElementIds.filter((id): id is string => typeof id === "string")
          : undefined,
        nativePageCount: Number.isFinite(item.nativePageCount)
          ? Number(item.nativePageCount)
          : undefined,
        nativeSourcePageCount: Number.isFinite(item.nativeSourcePageCount)
          ? Number(item.nativeSourcePageCount)
          : undefined,
      };
    })
    .filter((item) => item.path.trim());
}
