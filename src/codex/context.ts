import type { AppState } from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
  ExcalidrawTextElement,
} from "@excalidraw/excalidraw/element/types";
import type {
  CanvasContext,
  CanvasElementKind,
  CanvasElementSummary,
  CanvasScope,
  CanvasViewport,
} from "./types";

export type SerializeCanvasContextOptions = {
  elements: readonly ExcalidrawElement[];
  appState?: Partial<AppState> | null;
  scope: CanvasScope;
  viewport?: CanvasViewport | null;
  maxElements?: number;
  maxTextLength?: number;
};

function getZoom(appState: Partial<AppState> | null | undefined) {
  const zoom = appState?.zoom;
  if (typeof zoom === "number" && Number.isFinite(zoom) && zoom > 0) {
    return zoom;
  }
  if (
    typeof zoom === "object" &&
    zoom !== null &&
    "value" in zoom &&
    typeof zoom.value === "number" &&
    Number.isFinite(zoom.value) &&
    zoom.value > 0
  ) {
    return zoom.value;
  }
  return 1;
}

export function deriveCanvasViewport(
  appState: Partial<AppState> | null | undefined,
): CanvasViewport | null {
  if (
    !appState ||
    typeof appState.width !== "number" ||
    typeof appState.height !== "number" ||
    !Number.isFinite(appState.width) ||
    !Number.isFinite(appState.height) ||
    appState.width <= 0 ||
    appState.height <= 0
  ) {
    return null;
  }
  const zoom = getZoom(appState);
  const scrollX = typeof appState.scrollX === "number" ? appState.scrollX : 0;
  const scrollY = typeof appState.scrollY === "number" ? appState.scrollY : 0;

  return {
    x: -scrollX,
    y: -scrollY,
    width: appState.width / zoom,
    height: appState.height / zoom,
    zoom,
  };
}

function intersectsViewport(element: ExcalidrawElement, viewport: CanvasViewport) {
  const elementRight = element.x + element.width;
  const elementBottom = element.y + element.height;
  const viewportRight = viewport.x + viewport.width;
  const viewportBottom = viewport.y + viewport.height;
  return (
    elementRight >= viewport.x &&
    element.x <= viewportRight &&
    elementBottom >= viewport.y &&
    element.y <= viewportBottom
  );
}

function getElementKind(type: ExcalidrawElement["type"]): CanvasElementKind {
  switch (type) {
    case "rectangle":
    case "ellipse":
    case "diamond":
    case "text":
    case "arrow":
    case "line":
    case "image":
    case "freedraw":
    case "frame":
    case "embeddable":
      return type;
    default:
      return "other";
  }
}

function getElementText(element: ExcalidrawElement, maxLength: number) {
  let text: string | undefined;
  if (element.type === "text") {
    text = (element as ExcalidrawTextElement).text;
  } else if (element.type === "frame" || element.type === "magicframe") {
    text = element.name ?? undefined;
  }
  if (text === undefined || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function getBindingIds(element: ExcalidrawElement) {
  if (element.type !== "arrow" && element.type !== "line") {
    return {};
  }
  const linear = element as ExcalidrawLinearElement;
  return {
    startElementId: linear.startBinding?.elementId,
    endElementId: linear.endBinding?.elementId,
  };
}

function summarizeElement(
  element: ExcalidrawElement,
  maxTextLength: number,
): CanvasElementSummary {
  return {
    id: element.id,
    type: getElementKind(element.type),
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    angle: element.angle,
    text: getElementText(element, maxTextLength),
    strokeColor: element.strokeColor,
    backgroundColor: element.backgroundColor,
    opacity: element.opacity,
    groupIds: [...element.groupIds],
    frameId: element.frameId,
    locked: element.locked,
    ...getBindingIds(element),
    boundElementIds: element.boundElements?.map((bound) => bound.id) ?? [],
  };
}

function getBounds(elements: readonly ExcalidrawElement[]) {
  if (elements.length === 0) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const element of elements) {
    minX = Math.min(minX, element.x);
    minY = Math.min(minY, element.y);
    maxX = Math.max(maxX, element.x + element.width);
    maxY = Math.max(maxY, element.y + element.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Produces a small, JSON-safe canvas representation for an AI turn. Binary
 * files, customData and deleted elements are deliberately excluded.
 */
export function serializeCanvasContext({
  elements,
  appState,
  scope,
  viewport: suppliedViewport,
  maxElements = 500,
  maxTextLength = 4_000,
}: SerializeCanvasContextOptions): CanvasContext {
  const activeElements = elements.filter((element) => !element.isDeleted);
  const activeIds = new Set(activeElements.map((element) => element.id));
  const selectionIds = Object.entries(appState?.selectedElementIds ?? {})
    .filter(([, selected]) => selected)
    .map(([id]) => id)
    .filter((id) => activeIds.has(id));
  const selectionSet = new Set(selectionIds);
  for (const element of activeElements) {
    if (!selectionSet.has(element.id)) {
      continue;
    }
    for (const bound of element.boundElements ?? []) {
      if (bound.type === "text" && activeIds.has(bound.id)) {
        selectionSet.add(bound.id);
      }
    }
    if (
      element.type === "text" &&
      element.containerId &&
      activeIds.has(element.containerId)
    ) {
      selectionSet.add(element.containerId);
    }
  }
  const viewport = suppliedViewport ?? deriveCanvasViewport(appState);

  let scopedElements: readonly ExcalidrawElement[];
  switch (scope) {
    case "selection":
      scopedElements = activeElements.filter((element) => selectionSet.has(element.id));
      break;
    case "viewport":
      scopedElements = viewport
        ? activeElements.filter((element) => intersectsViewport(element, viewport))
        : activeElements;
      break;
    case "canvas":
      scopedElements = activeElements;
      break;
  }

  const normalizedMaxElements = Number.isFinite(maxElements) ? maxElements : 500;
  const normalizedMaxTextLength = Number.isFinite(maxTextLength) ? maxTextLength : 4_000;
  const safeMaxElements = Math.max(1, Math.min(5_000, Math.floor(normalizedMaxElements)));
  const safeMaxTextLength = Math.max(32, Math.min(20_000, Math.floor(normalizedMaxTextLength)));
  const includedElements = scopedElements.slice(0, safeMaxElements);

  return {
    version: 1,
    scope,
    viewport,
    selectionIds,
    elements: includedElements.map((element) => summarizeElement(element, safeMaxTextLength)),
    totalElementCount: scopedElements.length,
    omittedElementCount: Math.max(0, scopedElements.length - includedElements.length),
    bounds: getBounds(scopedElements),
  };
}
