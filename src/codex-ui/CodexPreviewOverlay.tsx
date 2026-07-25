import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { DataURL } from "@excalidraw/excalidraw/types";
import type { CSSProperties } from "react";

export type CodexPreviewKind = "created" | "updated" | "deleted";

export type CodexPreviewItem = {
  dataURL?: DataURL;
  element: ExcalidrawElement;
  kind: CodexPreviewKind;
};

type CodexPreviewViewport = {
  scrollX: number;
  scrollY: number;
  zoom: number;
  offsetLeft: number;
  offsetTop: number;
};

type CodexPreviewOverlayProps = {
  host: HTMLElement | null;
  items: CodexPreviewItem[];
  viewport: CodexPreviewViewport;
};

function elementLabel(element: ExcalidrawElement) {
  const text = (element as ExcalidrawElement & { text?: string }).text?.trim();
  if (text) {
    return text.length > 42 ? `${text.slice(0, 39)}...` : text;
  }

  const labels: Partial<Record<ExcalidrawElement["type"], string>> = {
    arrow: "Seta",
    diamond: "Losango",
    ellipse: "Elipse",
    line: "Linha",
    rectangle: "Retangulo",
    text: "Texto",
  };

  return labels[element.type] ?? "Elemento";
}

export function CodexPreviewOverlay({ host, items, viewport }: CodexPreviewOverlayProps) {
  const hostBounds = host?.getBoundingClientRect();

  return (
    <div aria-hidden="true" className="codex-preview-layer">
      {items.map(({ dataURL, element, kind }) => {
        const x =
          (element.x + viewport.scrollX) * viewport.zoom +
          viewport.offsetLeft -
          (hostBounds?.left ?? 0);
        const y =
          (element.y + viewport.scrollY) * viewport.zoom +
          viewport.offsetTop -
          (hostBounds?.top ?? 0);
        const width = Math.max(14, Math.abs(element.width) * viewport.zoom);
        const height = Math.max(14, Math.abs(element.height) * viewport.zoom);

        return (
          <div
            className={`codex-preview-element codex-preview-${kind}`}
            key={`${kind}-${element.id}`}
            style={{
              "--codex-preview-fill": element.backgroundColor,
              "--codex-preview-stroke": element.strokeColor,
              height: `${height}px`,
              transform: `translate3d(${x}px, ${y}px, 0) rotate(${element.angle}rad)`,
              width: `${width}px`,
            } as CSSProperties}
          >
            {dataURL && element.type === "image" ? (
              <img alt="" draggable={false} src={dataURL} />
            ) : null}
            <span>{elementLabel(element)}</span>
          </div>
        );
      })}
    </div>
  );
}
