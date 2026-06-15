import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { AttachmentAsset } from "./storage";
import {
  getAttachmentAssetUrl,
  readAttachmentBytes,
  readAttachmentText,
} from "./storage";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const TEXT_PAGE_WIDTH = 900;
const TEXT_PAGE_HEIGHT = 1200;
const TEXT_PAGE_PADDING = 64;
const TEXT_HEADER_HEIGHT = 68;
const TEXT_FONT_SIZE = 24;
const TEXT_LINE_HEIGHT = 34;
const MAX_NATIVE_PREVIEW_PAGES = 60;
const MAX_IMAGE_CANVAS_EDGE = 1800;
const VIDEO_POSTER_WIDTH = 1280;
const VIDEO_POSTER_HEIGHT = 720;

export type NativePreviewPage = {
  dataURL: string;
  width: number;
  height: number;
  mimeType: "image/png";
};

export type NativePreviewResult = {
  pages: NativePreviewPage[];
  sourcePageCount: number;
  truncated: boolean;
};

export function canRenderNativeAttachmentPreview(asset: AttachmentAsset) {
  return (
    asset.kind === "text" ||
    asset.kind === "pdf" ||
    asset.kind === "image" ||
    asset.kind === "video"
  );
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  return canvas;
}

function fillCanvasBackground(context: CanvasRenderingContext2D, width: number, height: number) {
  context.save();
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.restore();
}

function wrapLine(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  if (!text.trim()) {
    return [""];
  }

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;

    if (context.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
      current = "";
    }

    if (context.measureText(word).width <= maxWidth) {
      current = word;
      continue;
    }

    let fragment = "";
    for (const character of word) {
      const nextFragment = `${fragment}${character}`;
      if (context.measureText(nextFragment).width > maxWidth && fragment) {
        lines.push(fragment);
        fragment = character;
      } else {
        fragment = nextFragment;
      }
    }
    current = fragment;
  }

  if (current) {
    lines.push(current);
  }

  return lines.length ? lines : [""];
}

function getWrappedTextLines(text: string) {
  const measureCanvas = createCanvas(1, 1);
  const context = measureCanvas.getContext("2d");

  if (!context) {
    return [text];
  }

  context.font = `${TEXT_FONT_SIZE}px Arial, sans-serif`;

  const maxWidth = TEXT_PAGE_WIDTH - TEXT_PAGE_PADDING * 2;
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .flatMap((line) => wrapLine(context, line, maxWidth));
}

function renderTextPage(
  lines: string[],
  fileName: string,
  pageNumber: number,
  pageCount: number,
) {
  const canvas = createCanvas(TEXT_PAGE_WIDTH, TEXT_PAGE_HEIGHT);
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Nao foi possivel criar o preview de texto.");
  }

  fillCanvasBackground(context, TEXT_PAGE_WIDTH, TEXT_PAGE_HEIGHT);

  context.fillStyle = "#111827";
  context.font = "600 26px Arial, sans-serif";
  context.fillText(fileName, TEXT_PAGE_PADDING, TEXT_PAGE_PADDING);

  context.fillStyle = "#6b7280";
  context.font = "18px Arial, sans-serif";
  context.fillText(
    `Pagina ${pageNumber} de ${pageCount}`,
    TEXT_PAGE_PADDING,
    TEXT_PAGE_PADDING + 34,
  );

  context.strokeStyle = "#e5e7eb";
  context.beginPath();
  context.moveTo(TEXT_PAGE_PADDING, TEXT_PAGE_PADDING + TEXT_HEADER_HEIGHT - 20);
  context.lineTo(
    TEXT_PAGE_WIDTH - TEXT_PAGE_PADDING,
    TEXT_PAGE_PADDING + TEXT_HEADER_HEIGHT - 20,
  );
  context.stroke();

  context.fillStyle = "#1f2937";
  context.font = `${TEXT_FONT_SIZE}px Consolas, "Courier New", monospace`;
  context.textBaseline = "top";

  let y = TEXT_PAGE_PADDING + TEXT_HEADER_HEIGHT;
  for (const line of lines) {
    context.fillText(line, TEXT_PAGE_PADDING, y);
    y += TEXT_LINE_HEIGHT;
  }

  return {
    dataURL: canvas.toDataURL("image/png"),
    width: TEXT_PAGE_WIDTH,
    height: TEXT_PAGE_HEIGHT,
    mimeType: "image/png" as const,
  };
}

async function renderTextPreview(asset: AttachmentAsset): Promise<NativePreviewResult> {
  const text = await readAttachmentText(asset.path);
  const lines = getWrappedTextLines(text);
  const linesPerPage = Math.floor(
    (TEXT_PAGE_HEIGHT - TEXT_PAGE_PADDING * 2 - TEXT_HEADER_HEIGHT) /
      TEXT_LINE_HEIGHT,
  );
  const sourcePageCount = Math.max(1, Math.ceil(lines.length / linesPerPage));
  const renderedPageCount = Math.min(sourcePageCount, MAX_NATIVE_PREVIEW_PAGES);
  const pages: NativePreviewPage[] = [];

  for (let pageIndex = 0; pageIndex < renderedPageCount; pageIndex += 1) {
    pages.push(
      renderTextPage(
        lines.slice(pageIndex * linesPerPage, (pageIndex + 1) * linesPerPage),
        asset.name,
        pageIndex + 1,
        sourcePageCount,
      ),
    );
  }

  return {
    pages,
    sourcePageCount,
    truncated: sourcePageCount > renderedPageCount,
  };
}

async function renderPdfPreview(asset: AttachmentAsset): Promise<NativePreviewResult> {
  const bytes = await readAttachmentBytes(asset.path);
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes) });
  const pages: NativePreviewPage[] = [];

  try {
    const pdf = await loadingTask.promise;
    const renderedPageCount = Math.min(pdf.numPages, MAX_NATIVE_PREVIEW_PAGES);

    for (let pageNumber = 1; pageNumber <= renderedPageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const renderScale = Math.min(
        2,
        Math.max(1, 1200 / Math.max(baseViewport.width, 1)),
      );
      const viewport = page.getViewport({ scale: renderScale });
      const pixelRatio = Math.max(window.devicePixelRatio || 1, 1);
      const canvas = createCanvas(
        viewport.width * pixelRatio,
        viewport.height * pixelRatio,
      );
      const context = canvas.getContext("2d");

      if (!context) {
        continue;
      }

      fillCanvasBackground(context, canvas.width, canvas.height);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      await page.render({
        canvas,
        canvasContext: context,
        viewport,
      }).promise;

      pages.push({
        dataURL: canvas.toDataURL("image/png"),
        width: viewport.width,
        height: viewport.height,
        mimeType: "image/png",
      });
    }

    return {
      pages,
      sourcePageCount: pdf.numPages,
      truncated: pdf.numPages > renderedPageCount,
    };
  } finally {
    await loadingTask.destroy();
  }
}

function loadImageFromUrl(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Nao foi possivel carregar a imagem."));
    image.src = url;
  });
}

async function renderImagePreview(asset: AttachmentAsset): Promise<NativePreviewResult> {
  const bytes = await readAttachmentBytes(asset.path);
  const blob = new Blob([new Uint8Array(bytes)], {
    type: asset.mimeType || "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);

  try {
    const image = await loadImageFromUrl(url);
    const naturalWidth = image.naturalWidth || image.width || 1;
    const naturalHeight = image.naturalHeight || image.height || 1;
    const scale = Math.min(
      1,
      MAX_IMAGE_CANVAS_EDGE / Math.max(naturalWidth, naturalHeight),
    );
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Nao foi possivel converter a imagem.");
    }

    fillCanvasBackground(context, width, height);
    context.drawImage(image, 0, 0, width, height);

    return {
      pages: [
        {
          dataURL: canvas.toDataURL("image/png"),
          width,
          height,
          mimeType: "image/png",
        },
      ],
      sourcePageCount: 1,
      truncated: false,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function waitForVideoEvent(
  video: HTMLVideoElement,
  eventName: "loadedmetadata" | "loadeddata" | "seeked",
  timeoutMs: number,
) {
  return new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Tempo esgotado ao carregar o video."));
    }, timeoutMs);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener(eventName, onReady);
      video.removeEventListener("error", onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Nao foi possivel carregar o video."));
    };

    video.addEventListener(eventName, onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function drawVideoPlayBadge(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(52, Math.min(width, height) * 0.11);
  const triangleSize = radius * 0.86;

  context.save();
  context.fillStyle = "rgba(0, 0, 0, 0.48)";
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#ffffff";
  context.beginPath();
  context.moveTo(centerX - triangleSize * 0.25, centerY - triangleSize * 0.48);
  context.lineTo(centerX - triangleSize * 0.25, centerY + triangleSize * 0.48);
  context.lineTo(centerX + triangleSize * 0.54, centerY);
  context.closePath();
  context.fill();
  context.restore();
}

function drawVideoFallbackPoster(asset: AttachmentAsset) {
  const canvas = createCanvas(VIDEO_POSTER_WIDTH, VIDEO_POSTER_HEIGHT);
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Nao foi possivel criar o poster do video.");
  }

  const gradient = context.createLinearGradient(0, 0, VIDEO_POSTER_WIDTH, VIDEO_POSTER_HEIGHT);
  gradient.addColorStop(0, "#202124");
  gradient.addColorStop(1, "#343837");
  context.fillStyle = gradient;
  context.fillRect(0, 0, VIDEO_POSTER_WIDTH, VIDEO_POSTER_HEIGHT);

  drawVideoPlayBadge(context, VIDEO_POSTER_WIDTH, VIDEO_POSTER_HEIGHT);

  context.fillStyle = "rgba(255, 255, 255, 0.92)";
  context.font = "600 42px Arial, sans-serif";
  context.textAlign = "center";
  context.fillText("Video", VIDEO_POSTER_WIDTH / 2, VIDEO_POSTER_HEIGHT - 132);

  context.fillStyle = "rgba(255, 255, 255, 0.7)";
  context.font = "28px Arial, sans-serif";
  const fileName = asset.name.length > 58 ? `${asset.name.slice(0, 55)}...` : asset.name;
  context.fillText(fileName, VIDEO_POSTER_WIDTH / 2, VIDEO_POSTER_HEIGHT - 86);

  return {
    dataURL: canvas.toDataURL("image/png"),
    width: VIDEO_POSTER_WIDTH,
    height: VIDEO_POSTER_HEIGHT,
    mimeType: "image/png" as const,
  };
}

async function renderVideoPosterPreview(asset: AttachmentAsset): Promise<NativePreviewResult> {
  const video = document.createElement("video");
  const sourceUrl = getAttachmentAssetUrl(asset.path);

  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.src = sourceUrl;

  try {
    video.load();
    await waitForVideoEvent(video, "loadedmetadata", 8_000);
    await waitForVideoEvent(video, "loadeddata", 5_000).catch(() => undefined);

    if (Number.isFinite(video.duration) && video.duration > 0.35) {
      video.currentTime = Math.min(0.35, video.duration / 3);
      await waitForVideoEvent(video, "seeked", 4_000).catch(() => undefined);
    }

    const naturalWidth = video.videoWidth || VIDEO_POSTER_WIDTH;
    const naturalHeight = video.videoHeight || VIDEO_POSTER_HEIGHT;
    const scale = Math.min(
      1,
      MAX_IMAGE_CANVAS_EDGE / Math.max(naturalWidth, naturalHeight),
    );
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Nao foi possivel converter o poster do video.");
    }

    fillCanvasBackground(context, width, height);
    context.drawImage(video, 0, 0, width, height);
    drawVideoPlayBadge(context, width, height);

    return {
      pages: [
        {
          dataURL: canvas.toDataURL("image/png"),
          width,
          height,
          mimeType: "image/png",
        },
      ],
      sourcePageCount: 1,
      truncated: false,
    };
  } catch {
    return {
      pages: [drawVideoFallbackPoster(asset)],
      sourcePageCount: 1,
      truncated: false,
    };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
}

export async function renderAttachmentNativePreview(
  asset: AttachmentAsset,
): Promise<NativePreviewResult> {
  if (asset.kind === "text") {
    return renderTextPreview(asset);
  }

  if (asset.kind === "pdf") {
    return renderPdfPreview(asset);
  }

  if (asset.kind === "image") {
    return renderImagePreview(asset);
  }

  if (asset.kind === "video") {
    return renderVideoPosterPreview(asset);
  }

  throw new Error("Este tipo de arquivo nao tem preview nativo.");
}
