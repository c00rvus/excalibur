import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { File, FileImage, FileText, FileVideo } from "lucide-react";
import type { CanvasAttachment } from "./attachments";
import { getAttachmentAssetUrl, readAttachmentBytes, readAttachmentText } from "./storage";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type AttachmentPreviewProps = {
  attachment: CanvasAttachment;
  left: number;
  top: number;
  zoom: number;
  onOpen: (attachment: CanvasAttachment) => void;
  onDragHandlePointerDown: (
    event: PointerEvent<HTMLDivElement>,
    attachmentId: string,
  ) => void;
};

function splitTextPages(text: string) {
  const normalized = text.replace(/\r\n/g, "\n");
  const pageSize = 1800;
  const pages: string[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    const nextCursor = Math.min(cursor + pageSize, normalized.length);
    const slice = normalized.slice(cursor, nextCursor);
    const newlineIndex = slice.lastIndexOf("\n");
    const breakAt =
      nextCursor < normalized.length && newlineIndex > pageSize * 0.55
        ? cursor + newlineIndex + 1
        : nextCursor;

    pages.push(normalized.slice(cursor, breakAt).trimEnd());
    cursor = breakAt;
  }

  return pages.length ? pages : [""];
}

function AttachmentIcon({ attachment }: { attachment: CanvasAttachment }) {
  if (attachment.kind === "video") {
    return <FileVideo size={28} />;
  }

  if (attachment.kind === "text" || attachment.kind === "pdf") {
    return <FileText size={28} />;
  }

  if (attachment.kind === "image") {
    return <FileImage size={28} />;
  }

  return <File size={28} />;
}

function TextPreview({ attachment }: { attachment: CanvasAttachment }) {
  const [pages, setPages] = useState<string[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    setPages([]);
    setError("");

    readAttachmentText(attachment.path)
      .then((text) => {
        if (active) {
          setPages(splitTextPages(text));
        }
      })
      .catch(() => {
        if (active) {
          setError("Nao foi possivel carregar o texto.");
        }
      });

    return () => {
      active = false;
    };
  }, [attachment.path]);

  if (error) {
    return <div className="attachment-preview-error">{error}</div>;
  }

  if (!pages.length) {
    return <div className="attachment-preview-loading">Carregando texto</div>;
  }

  return (
    <div className="attachment-text-pages">
      {pages.map((page, index) => (
        <section className="attachment-text-page" key={`${attachment.id}-${index}`}>
          <span>Pagina {index + 1}</span>
          <pre>{page}</pre>
        </section>
      ))}
    </div>
  );
}

function PdfPreview({ attachment }: { attachment: CanvasAttachment }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("Carregando PDF");

  useEffect(() => {
    let disposed = false;
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;
    const host = hostRef.current;

    if (host) {
      host.textContent = "";
    }

    setStatus("Carregando PDF");

    async function renderPdf() {
      try {
        const bytes = await readAttachmentBytes(attachment.path);

        if (disposed || !host) {
          return;
        }

        loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes) });
        const pdf = await loadingTask.promise;

        if (disposed) {
          return;
        }

        setStatus(`${pdf.numPages} pagina${pdf.numPages === 1 ? "" : "s"}`);

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (disposed) {
            return;
          }

          const page = await pdf.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 0.82 });
          const pixelRatio = Math.max(window.devicePixelRatio || 1, 1);
          const pageNode = document.createElement("section");
          const label = document.createElement("span");
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");

          if (!context) {
            continue;
          }

          pageNode.className = "attachment-pdf-page";
          label.textContent = `Pagina ${pageNumber}`;
          canvas.width = Math.floor(viewport.width * pixelRatio);
          canvas.height = Math.floor(viewport.height * pixelRatio);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

          pageNode.append(label, canvas);
          host.append(pageNode);

          await page.render({
            canvas,
            canvasContext: context,
            viewport,
          }).promise;
        }

        setStatus("");
      } catch {
        if (!disposed) {
          setStatus("Nao foi possivel carregar o PDF.");
        }
      }
    }

    void renderPdf();

    return () => {
      disposed = true;
      void loadingTask?.destroy();
      if (host) {
        for (const canvas of Array.from(host.querySelectorAll("canvas"))) {
          canvas.width = 0;
          canvas.height = 0;
        }
        host.textContent = "";
      }
    };
  }, [attachment.path]);

  return (
    <div className="attachment-pdf-preview">
      {status ? <div className="attachment-preview-loading">{status}</div> : null}
      <div className="attachment-pdf-pages" ref={hostRef} />
    </div>
  );
}

function VideoPreview({ attachment }: { attachment: CanvasAttachment }) {
  const assetUrl = useMemo(
    () => getAttachmentAssetUrl(attachment.path),
    [attachment.path],
  );

  return (
    <video
      className="attachment-video"
      controls
      preload="metadata"
      src={assetUrl}
    />
  );
}

function AttachmentPreviewBody({ attachment }: { attachment: CanvasAttachment }) {
  if (attachment.displayMode === "icon") {
    return (
      <div className="attachment-icon-body">
        <AttachmentIcon attachment={attachment} />
        <div>
          <strong>{attachment.name}</strong>
          <span>{attachment.extension.toUpperCase() || "ARQUIVO"}</span>
        </div>
      </div>
    );
  }

  if (attachment.kind === "video") {
    return <VideoPreview attachment={attachment} />;
  }

  if (attachment.kind === "pdf") {
    return <PdfPreview attachment={attachment} />;
  }

  if (attachment.kind === "text") {
    return <TextPreview attachment={attachment} />;
  }

  return (
    <div className="attachment-preview-error">
      Preview indisponivel para este arquivo.
    </div>
  );
}

export function AttachmentPreview({
  attachment,
  left,
  top,
  zoom,
  onOpen,
  onDragHandlePointerDown,
}: AttachmentPreviewProps) {
  return (
    <article
      className={`attachment-card attachment-${attachment.displayMode}`}
      onDoubleClick={() => {
        if (attachment.displayMode === "icon") {
          onOpen(attachment);
        }
      }}
      style={{
        left,
        top,
        width: attachment.width,
        height: attachment.height,
        transform: `scale(${zoom})`,
      }}
    >
      <div
        className="attachment-titlebar"
        onDoubleClick={(event) => {
          event.stopPropagation();
          onOpen(attachment);
        }}
        onPointerDown={(event) => onDragHandlePointerDown(event, attachment.id)}
      >
        <span>{attachment.name}</span>
        <small>{attachment.displayMode === "preview" ? "Preview" : "Arquivo"}</small>
      </div>
      <div className="attachment-body">
        <AttachmentPreviewBody attachment={attachment} />
      </div>
    </article>
  );
}
