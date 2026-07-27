import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

export const EXCALIBUR_COPY_ID_MIME = "application/x-excalibur-copy-id";
export const EXCALIBUR_WEB_COPY_ID_MIME = `web ${EXCALIBUR_COPY_ID_MIME}`;
export const INTERNAL_CLIPBOARD_TTL_MS = 10 * 60 * 1000;

const COPY_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const COPY_MARKER_PATTERN = /<!--\s*excalibur-copy:([A-Za-z0-9_-]{8,128})\s*-->/i;
const COPY_ATTRIBUTE_PATTERN = /data-excalibur-copy-id\s*=\s*["']([A-Za-z0-9_-]{8,128})["']/i;

type ClipboardDataReader = {
  getData(type: string): string;
};

type ClipboardDataWriter = ClipboardDataReader & {
  setData(type: string, value: string): void;
};

type ElementWithClipboardRelations = ExcalidrawElement & {
  containerId?: string | null;
  fileId?: string | null;
  frameId?: string | null;
};

export type InternalClipboardSnapshot = {
  elements: readonly ExcalidrawElement[];
  json: string;
};

export type ClipboardRepresentationPayload = {
  copyId: string;
  html: string;
  imageBlob?: Blob | Promise<Blob> | null;
  onResolvedHtml?: (html: string) => void;
  plainText: string;
  renderImageBlobInHtml?: boolean;
};

export type ExternalClipboardSelectionMode =
  | "empty"
  | "raster"
  | "rich"
  | "text";

type ExternalClipboardHtmlPart =
  | {
      kind: "text";
      text: string;
    }
  | {
      dataURL: string;
      height: number;
      kind: "image";
      width: number;
    };

function isFrameLikeElement(element: ExcalidrawElement) {
  return element.type === "frame" || element.type === "magicframe";
}

function escapeClipboardHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeCopyId(value: string | null | undefined) {
  const candidate = value?.trim() ?? "";
  return COPY_ID_PATTERN.test(candidate) ? candidate : null;
}

function normalizeClipboardText(value: string) {
  return value.replace(/\r\n?/g, "\n");
}

function normalizeClipboardHtml(value: string) {
  const normalizedValue = normalizeClipboardText(value)
    .replace(/<!--\s*(?:Start|End)Fragment\s*-->/gi, "")
    .trim();

  if (!normalizedValue) {
    return "";
  }

  if (typeof DOMParser === "undefined") {
    return normalizedValue;
  }

  try {
    const parsed = new DOMParser().parseFromString(normalizedValue, "text/html");
    return parsed.body.innerHTML.trim();
  } catch {
    return normalizedValue;
  }
}

function hashClipboardValue(value: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }

  return `${value.length.toString(36)}:${first.toString(36)}:${second.toString(36)}`;
}

export function createClipboardContentSignature(plainText: string, html: string) {
  return [
    hashClipboardValue(normalizeClipboardText(plainText)),
    hashClipboardValue(normalizeClipboardHtml(html)),
  ].join(".");
}

export function getClipboardContentSignature(
  clipboardData: ClipboardDataReader | null,
) {
  if (!clipboardData) {
    return null;
  }

  try {
    return createClipboardContentSignature(
      clipboardData.getData("text/plain"),
      clipboardData.getData("text/html"),
    );
  } catch {
    return null;
  }
}

export function isInternalClipboardSnapshotFresh(
  createdAt: number,
  now = Date.now(),
) {
  return (
    Number.isFinite(createdAt) &&
    now >= createdAt &&
    now - createdAt < INTERNAL_CLIPBOARD_TTL_MS
  );
}

export function createClipboardCopyId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `copy_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

export function getExternalClipboardSelectionMode(
  elements: readonly ExcalidrawElement[],
  content: {
    hasImage: boolean;
    hasText: boolean;
  },
): ExternalClipboardSelectionMode {
  const copyableElements = elements.filter((element) => !element.isDeleted);

  if (!copyableElements.length) {
    return "empty";
  }

  if (
    copyableElements.some(
      (element) => element.type !== "image" && element.type !== "text",
    )
  ) {
    return "raster";
  }

  if (content.hasImage) {
    return "rich";
  }

  if (content.hasText) {
    return "text";
  }

  // Preserve otherwise unreadable image/text elements through a visual fallback.
  return "raster";
}

export function getExternalClipboardHtml(
  parts: readonly ExternalClipboardHtmlPart[],
) {
  if (!parts.length) {
    return "";
  }

  const blocks = parts
    .map((part) => {
      if (part.kind === "text") {
        return `<div style="white-space:pre-wrap;margin:0 0 12px 0;">${escapeClipboardHtml(part.text)}</div>`;
      }

      return `<img src="${escapeClipboardHtml(part.dataURL)}" width="${part.width}" height="${part.height}" style="display:block;max-width:100%;height:auto;margin:0 0 12px 0;" />`;
    })
    .join("");

  return `<!doctype html><html><body><div>${blocks}</div></body></html>`;
}

export function collectInternalClipboardElements(
  sceneElements: readonly ExcalidrawElement[],
  selectedElementIds: Readonly<Record<string, boolean>>,
) {
  const selectedElements = sceneElements.filter((element) => {
    if (element.isDeleted) {
      return false;
    }

    if (selectedElementIds[element.id]) {
      return true;
    }

    const containerId = (element as ElementWithClipboardRelations).containerId;
    return (
      element.type === "text" &&
      Boolean(containerId && selectedElementIds[containerId])
    );
  });
  const selectedIds = new Set(selectedElements.map((element) => element.id));

  if (!selectedElements.some(isFrameLikeElement)) {
    return selectedElements;
  }

  return selectedElements.flatMap((element) => {
    if (!isFrameLikeElement(element)) {
      return [element];
    }

    const children = sceneElements.filter(
      (candidate) =>
        !candidate.isDeleted &&
        !selectedIds.has(candidate.id) &&
        (candidate as ElementWithClipboardRelations).frameId === element.id,
    );
    return [...children, element];
  });
}

export function serializeInternalClipboard(
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles,
): InternalClipboardSnapshot {
  const copiedFrameIds = new Set(
    elements.filter(isFrameLikeElement).map((element) => element.id),
  );
  const normalizedElements = elements.map((element) => {
    const frameId = (element as ElementWithClipboardRelations).frameId;

    if (frameId && !copiedFrameIds.has(frameId)) {
      return {
        ...element,
        frameId: null,
      } as ExcalidrawElement;
    }

    return element;
  });
  const referencedFiles: BinaryFiles = {};

  for (const element of normalizedElements) {
    const fileId = (element as ElementWithClipboardRelations).fileId;
    if (fileId && files[fileId]) {
      referencedFiles[fileId] = files[fileId];
    }
  }

  return {
    elements: normalizedElements,
    json: JSON.stringify({
      type: "excalidraw/clipboard",
      elements: normalizedElements,
      files: referencedFiles,
    }),
  };
}

export function embedInternalClipboardMarker(html: string, copyId: string) {
  const normalizedCopyId = normalizeCopyId(copyId);
  if (!normalizedCopyId) {
    throw new Error("Invalid clipboard copy id");
  }

  const marker = `<!--excalibur-copy:${normalizedCopyId}--><span data-excalibur-copy-id="${normalizedCopyId}" style="display:none!important"></span>`;
  const trimmedHtml = html.trim();

  if (!trimmedHtml) {
    return `<!doctype html><html><body>${marker}</body></html>`;
  }

  if (/<body(?:\s[^>]*)?>/i.test(trimmedHtml)) {
    return trimmedHtml.replace(/<body(?:\s[^>]*)?>/i, (bodyTag) => `${bodyTag}${marker}`);
  }

  return `<!doctype html><html><body>${marker}${trimmedHtml}</body></html>`;
}

export function extractInternalClipboardCopyId(clipboardData: ClipboardDataReader | null) {
  if (!clipboardData) {
    return null;
  }

  for (const type of [EXCALIBUR_COPY_ID_MIME, EXCALIBUR_WEB_COPY_ID_MIME]) {
    try {
      const copyId = normalizeCopyId(clipboardData.getData(type));
      if (copyId) {
        return copyId;
      }
    } catch {
      // Custom clipboard formats are optional in WebViews.
    }
  }

  let html = "";
  try {
    html = clipboardData.getData("text/html");
  } catch {
    return null;
  }

  const markerMatch = html.match(COPY_MARKER_PATTERN);
  const attributeMatch = html.match(COPY_ATTRIBUTE_PATTERN);
  return normalizeCopyId(markerMatch?.[1] ?? attributeMatch?.[1]);
}

export function isWritableClipboardTarget(target: EventTarget | null) {
  if (!target || typeof target !== "object") {
    return false;
  }

  const element = target as HTMLElement;
  const tagName = typeof element.tagName === "string" ? element.tagName.toLowerCase() : "";
  const inputType =
    tagName === "input" && typeof (element as HTMLInputElement).type === "string"
      ? (element as HTMLInputElement).type.toLowerCase()
      : "";

  if (tagName === "textarea" || tagName === "select" || tagName === "br") {
    return true;
  }

  if (
    tagName === "input" &&
    ["text", "number", "password", "search", "email", "url", "tel"].includes(
      inputType,
    )
  ) {
    return true;
  }

  if (element.getAttribute?.("data-type") === "wysiwyg") {
    return true;
  }

  if (element.isContentEditable) {
    return true;
  }

  return Boolean(element.closest?.('[contenteditable="true"], [data-type="wysiwyg"]'));
}

export function setClipboardEventRepresentations(
  clipboardData: ClipboardDataWriter | null,
  payload: ClipboardRepresentationPayload,
) {
  if (!clipboardData) {
    return false;
  }

  clipboardData.setData("text/plain", payload.plainText);
  clipboardData.setData("text/html", payload.html);

  for (const type of [EXCALIBUR_COPY_ID_MIME, EXCALIBUR_WEB_COPY_ID_MIME]) {
    try {
      clipboardData.setData(type, payload.copyId);
    } catch {
      // The HTML marker remains the cross-WebView fallback.
    }
  }

  return true;
}

function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read image blob"));
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Image blob did not produce a data URL"));
    };
    reader.readAsDataURL(blob);
  });
}

async function createImageClipboardHtml(imageBlob: Blob, copyId: string) {
  const dataUrl = await readBlobAsDataUrl(imageBlob);
  return embedInternalClipboardMarker(
    `<img src="${dataUrl}" style="display:block;max-width:100%;height:auto;" />`,
    copyId,
  );
}

export async function writeAsyncClipboardRepresentations(
  payload: ClipboardRepresentationPayload,
) {
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard?.write ||
    typeof ClipboardItem === "undefined"
  ) {
    return false;
  }

  const imageBlob = payload.imageBlob ? Promise.resolve(payload.imageBlob) : null;
  const resolvedHtml =
    payload.renderImageBlobInHtml && imageBlob
      ? imageBlob.then((blob) => createImageClipboardHtml(blob, payload.copyId))
      : Promise.resolve(payload.html);
  const htmlBlob = resolvedHtml.then((html) => {
    payload.onResolvedHtml?.(html);
    return new Blob([html], { type: "text/html" });
  });
  const representations: Record<string, Blob | Promise<Blob>> = {
    "text/html": htmlBlob,
    "text/plain": new Blob([payload.plainText], { type: "text/plain" }),
  };

  if (imageBlob) {
    representations["image/png"] = imageBlob;
  }

  await navigator.clipboard.write([new ClipboardItem(representations)]);
  return true;
}

export function createInternalPasteEvent(internalJson: string) {
  const clipboardData = new DataTransfer();
  clipboardData.setData("text/plain", internalJson);

  return new ClipboardEvent("paste", {
    bubbles: true,
    cancelable: true,
    clipboardData,
  });
}
