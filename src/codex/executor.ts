import {
  convertToExcalidrawElements,
  newElementWith,
} from "@excalidraw/excalidraw";
import type { BinaryFileData } from "@excalidraw/excalidraw/types";
import type {
  BoundElement,
  ExcalidrawElement,
  ExcalidrawLinearElement,
  ExcalidrawTextElement,
  PointBinding,
} from "@excalidraw/excalidraw/element/types";
import type { ElementUpdate } from "@excalidraw/excalidraw/element/mutateElement";
import type {
  CanvasCommand,
  CanvasExecutionChange,
  CanvasExecutionResult,
  CanvasPlan,
  GeneratedImageAsset,
} from "./types";
import { parseCanvasPlan } from "./validation";

export type CanvasExecutorOptions = {
  /** Rejects every plan when the current project/collaboration is read-only. */
  readOnly?: boolean;
  /** Existing IDs the plan may address (for example, the current selection). */
  allowedElementIds?: ReadonlySet<string>;
  /** Locked elements are protected unless the host explicitly overrides this. */
  allowLockedElements?: boolean;
  /** ImageGeneration items materialized and validated by the Tauri bridge. */
  generatedImages?: readonly GeneratedImageAsset[];
  /** Injectable for deterministic unit tests or host-specific ID policies. */
  idFactory?: (request: {
    kind: "text" | "shape" | "image" | "arrow" | "group" | "duplicate";
    commandIndex: number;
    sourceId?: string;
  }) => string;
};

export class CanvasExecutionError extends Error {
  readonly commandIndex: number;
  readonly commandType: CanvasCommand["type"] | null;

  constructor(
    message: string,
    commandIndex = -1,
    commandType: CanvasCommand["type"] | null = null,
  ) {
    super(message);
    this.name = "CanvasExecutionError";
    this.commandIndex = commandIndex;
    this.commandType = commandType;
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const DEFAULT_STROKE_COLOR = "#1b1b1f";
const DEFAULT_BACKGROUND_COLOR = "transparent";
const ARROW_BINDING_GAP = 8;
const ARROW_LABEL_FONT_SIZE = 16;

function hashString(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function updateElement<T extends ExcalidrawElement>(
  element: T,
  updates: ElementUpdate<T>,
) {
  return newElementWith(element, updates);
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function cloneElement(element: ExcalidrawElement): ExcalidrawElement {
  return JSON.parse(JSON.stringify(element)) as ExcalidrawElement;
}

function getCenter(element: ExcalidrawElement) {
  return {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  };
}

type ScenePoint = { x: number; y: number };

function rotateVector(point: ScenePoint, angle: number): ScenePoint {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
  };
}

/**
 * Finds the point where a ray from an element's center exits its outline.
 * Connections created from center to center remain visible inside the bound
 * shapes because Excalidraw renders the supplied linear points verbatim. Keep
 * the bindings for later edits, but give the arrow edge-to-edge geometry.
 */
function getBoundaryPoint(
  element: ExcalidrawElement,
  toward: ScenePoint,
): ScenePoint {
  const center = getCenter(element);
  const worldDirection = {
    x: toward.x - center.x,
    y: toward.y - center.y,
  };
  const worldLength = Math.hypot(worldDirection.x, worldDirection.y);
  const normalizedWorldDirection = worldLength > 0
    ? {
        x: worldDirection.x / worldLength,
        y: worldDirection.y / worldLength,
      }
    : { x: 0, y: 1 };
  const localDirection = rotateVector(normalizedWorldDirection, -element.angle);
  const halfWidth = Math.max(Math.abs(element.width) / 2, 0.5);
  const halfHeight = Math.max(Math.abs(element.height) / 2, 0.5);

  let distance: number;
  if (element.type === "ellipse") {
    distance = 1 / Math.sqrt(
      (localDirection.x * localDirection.x) / (halfWidth * halfWidth) +
        (localDirection.y * localDirection.y) / (halfHeight * halfHeight),
    );
  } else if (element.type === "diamond") {
    distance = 1 / (
      Math.abs(localDirection.x) / halfWidth +
        Math.abs(localDirection.y) / halfHeight
    );
  } else {
    const horizontalDistance = Math.abs(localDirection.x) > Number.EPSILON
      ? halfWidth / Math.abs(localDirection.x)
      : Number.POSITIVE_INFINITY;
    const verticalDistance = Math.abs(localDirection.y) > Number.EPSILON
      ? halfHeight / Math.abs(localDirection.y)
      : Number.POSITIVE_INFINITY;
    distance = Math.min(horizontalDistance, verticalDistance);
  }

  const localBoundary = {
    x: localDirection.x * distance,
    y: localDirection.y * distance,
  };
  const worldBoundary = rotateVector(localBoundary, element.angle);
  return {
    x: center.x + worldBoundary.x,
    y: center.y + worldBoundary.y,
  };
}

function isBindable(element: ExcalidrawElement) {
  return ![
    "selection",
    "line",
    "arrow",
    "freedraw",
  ].includes(element.type);
}

function makeBinding(elementId: string): PointBinding {
  return { elementId, focus: 0, gap: ARROW_BINDING_GAP };
}

function makeSeed(id: string) {
  return Math.max(1, hashString(id) & 0x7fffffff);
}

function buildArrowGeometry(from: ExcalidrawElement, to: ExcalidrawElement) {
  const fromCenter = getCenter(from);
  const toCenter = getCenter(to);
  const centerDistance = Math.hypot(
    toCenter.x - fromCenter.x,
    toCenter.y - fromCenter.y,
  );
  const direction = centerDistance > 0
    ? {
        x: (toCenter.x - fromCenter.x) / centerDistance,
        y: (toCenter.y - fromCenter.y) / centerDistance,
      }
    : { x: 0, y: 1 };
  const startBoundary = getBoundaryPoint(from, toCenter);
  const endBoundary = getBoundaryPoint(to, fromCenter);
  const availableSpan =
    (endBoundary.x - startBoundary.x) * direction.x +
    (endBoundary.y - startBoundary.y) * direction.y;
  // Do not invert a very short connection when shapes nearly touch. A reduced
  // gap is preferable and remains consistent with the binding metadata.
  const gap = Math.max(
    0,
    Math.min(ARROW_BINDING_GAP, (availableSpan - 2) / 2),
  );
  const start = {
    x: startBoundary.x + direction.x * gap,
    y: startBoundary.y + direction.y * gap,
  };
  const end = {
    x: endBoundary.x - direction.x * gap,
    y: endBoundary.y - direction.y * gap,
  };
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
    points: [
      [start.x - x, start.y - y],
      [end.x - x, end.y - y],
    ] as unknown as ExcalidrawLinearElement["points"],
  };
}

function isTextContainer(
  element: ExcalidrawElement,
): element is ExcalidrawElement & { type: "rectangle" | "ellipse" | "diamond" | "arrow" } {
  return ["rectangle", "ellipse", "diamond", "arrow"].includes(element.type);
}

/** Reuses Excalidraw's own bound-text layout instead of measuring as free text. */
function reflowBoundText(
  label: ExcalidrawTextElement,
  container: ExcalidrawElement,
  originalText = label.originalText || label.text,
) {
  if (!isTextContainer(container)) {
    return updateElement(label, {
      x: container.x + (container.width - label.width) / 2,
      y: container.y + (container.height - label.height) / 2,
    });
  }

  const skeleton: NonNullable<Parameters<typeof convertToExcalidrawElements>[0]>[number] = {
    ...cloneElement(container),
    boundElements: null,
    label: {
      text: originalText,
      fontSize: label.fontSize,
      fontFamily: label.fontFamily,
      textAlign: label.textAlign,
      verticalAlign: label.verticalAlign,
    },
  } as NonNullable<Parameters<typeof convertToExcalidrawElements>[0]>[number];
  const measuredElement = convertToExcalidrawElements([skeleton], {
    regenerateIds: false,
  }).find(
    (element) => element.type === "text" && element.containerId === container.id,
  );
  if (!measuredElement || measuredElement.type !== "text") {
    return label;
  }
  const measured = measuredElement as ExcalidrawTextElement;
  return updateElement(label, {
    text: measured.text,
    originalText: measured.originalText,
    width: measured.width,
    height: measured.height,
    x: measured.x,
    y: measured.y,
    autoResize: measured.autoResize,
    lineHeight: measured.lineHeight,
  });
}

function replaceElement(
  elements: readonly ExcalidrawElement[],
  replacement: ExcalidrawElement,
) {
  return elements.map((element) =>
    element.id === replacement.id ? replacement : element,
  );
}

function getLiveElement(
  elements: readonly ExcalidrawElement[],
  id: string,
  commandIndex: number,
  commandType: CanvasCommand["type"],
) {
  const element = elements.find((candidate) => candidate.id === id);
  if (!element || element.isDeleted) {
    throw new CanvasExecutionError(
      `O elemento "${id}" nao existe ou foi excluido.`,
      commandIndex,
      commandType,
    );
  }
  return element;
}

function reserveId(
  requestedId: string | undefined,
  fallbackPrefix: string,
  command: CanvasCommand,
  commandIndex: number,
  reservedIds: Set<string>,
  options: CanvasExecutorOptions,
  kind: Parameters<NonNullable<CanvasExecutorOptions["idFactory"]>>[0]["kind"],
  sourceId?: string,
) {
  let candidate = requestedId;
  const isExplicit = candidate !== undefined;
  if (!candidate) {
    candidate = options.idFactory?.({ kind, commandIndex, sourceId });
  }
  if (!candidate) {
    const fingerprint = JSON.stringify({ command, commandIndex, sourceId });
    candidate = `${fallbackPrefix}-${hashString(fingerprint).toString(36)}`;
  }
  if (!ID_PATTERN.test(candidate) || candidate.length > 128) {
    throw new CanvasExecutionError(
      `O ID gerado "${candidate}" e invalido.`,
      commandIndex,
      command.type,
    );
  }
  if (reservedIds.has(candidate)) {
    if (isExplicit || options.idFactory) {
      throw new CanvasExecutionError(
        `O ID "${candidate}" ja esta em uso.`,
        commandIndex,
        command.type,
      );
    }
    const base = candidate;
    let suffix = 2;
    while (reservedIds.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
  }
  reservedIds.add(candidate);
  return candidate;
}

function remapGeneratedLabel(
  converted: readonly ExcalidrawElement[],
  containerId: string,
  labelId: string,
) {
  const generatedLabel = converted.find(
    (element) => element.type === "text" && element.containerId === containerId,
  );
  if (!generatedLabel) {
    return [...converted];
  }
  return converted.map((element) => {
    if (element.id === generatedLabel.id) {
      return { ...element, id: labelId, index: null } as ExcalidrawElement;
    }
    if (element.id === containerId) {
      return {
        ...element,
        index: null,
        boundElements:
          element.boundElements?.map((bound) =>
            bound.id === generatedLabel.id ? { ...bound, id: labelId } : bound,
          ) ?? null,
      } as ExcalidrawElement;
    }
    return { ...element, index: null } as ExcalidrawElement;
  });
}

function addBoundElement(
  element: ExcalidrawElement,
  bound: BoundElement,
) {
  const current = element.boundElements ?? [];
  if (current.some((item) => item.id === bound.id)) {
    return element;
  }
  return updateElement(element, { boundElements: [...current, bound] });
}

function assertAllowed(
  ids: readonly string[],
  createdIds: ReadonlySet<string>,
  command: CanvasCommand,
  commandIndex: number,
  options: CanvasExecutorOptions,
) {
  if (!options.allowedElementIds) {
    return;
  }
  const forbidden = ids.filter(
    (id) => !options.allowedElementIds?.has(id) && !createdIds.has(id),
  );
  if (forbidden.length > 0) {
    throw new CanvasExecutionError(
      `O comando tentou acessar elementos fora do escopo permitido: ${forbidden.join(", ")}.`,
      commandIndex,
      command.type,
    );
  }
}

function assertEditable(
  elements: readonly ExcalidrawElement[],
  ids: readonly string[],
  command: CanvasCommand,
  commandIndex: number,
  options: CanvasExecutorOptions,
) {
  const targets = ids.map((id) =>
    getLiveElement(elements, id, commandIndex, command.type),
  );
  if (!options.allowLockedElements) {
    const locked = targets.filter((element) => element.locked).map((element) => element.id);
    if (locked.length > 0) {
      throw new CanvasExecutionError(
        `Elementos bloqueados nao podem ser alterados: ${locked.join(", ")}.`,
        commandIndex,
        command.type,
      );
    }
  }
  return targets;
}

function assertGeometryCanChange(
  targets: readonly ExcalidrawElement[],
  commandIndex: number,
  commandType: CanvasCommand["type"],
) {
  const boundLinearIds = targets
    .filter(
      (element) =>
        (element.type === "arrow" || element.type === "line") &&
        (element.startBinding || element.endBinding),
    )
    .map((element) => element.id);
  if (boundLinearIds.length > 0) {
    throw new CanvasExecutionError(
      `Conexoes vinculadas nao podem ter a geometria alterada diretamente: ${boundLinearIds.join(", ")}. Mova os elementos conectados.`,
      commandIndex,
      commandType,
    );
  }
}

function assertConnectedGeometryCanRefresh(
  elements: readonly ExcalidrawElement[],
  targetIds: readonly string[],
  commandIndex: number,
  commandType: CanvasCommand["type"],
) {
  const targetSet = new Set(targetIds);
  const unsupported = elements
    .filter(
      (element) =>
        !element.isDeleted &&
        (element.type === "arrow" || element.type === "line") &&
        ((element.startBinding && targetSet.has(element.startBinding.elementId)) ||
          (element.endBinding && targetSet.has(element.endBinding.elementId))) &&
        (element.points.length !== 2 || !element.startBinding || !element.endBinding),
    )
    .map((element) => element.id);
  if (unsupported.length > 0) {
    throw new CanvasExecutionError(
      `Conexoes complexas nao podem ser reposicionadas com seguranca: ${unsupported.join(", ")}.`,
      commandIndex,
      commandType,
    );
  }
}

function expandBoundTextIds(
  elements: readonly ExcalidrawElement[],
  ids: readonly string[],
) {
  const expanded = new Set(ids);
  for (const id of ids) {
    const element = elements.find((candidate) => candidate.id === id);
    for (const bound of element?.boundElements ?? []) {
      if (bound.type === "text") {
        expanded.add(bound.id);
      }
    }
  }
  return [...expanded];
}

function refreshConnectedArrows(
  elements: readonly ExcalidrawElement[],
  movedTargetIds: ReadonlySet<string>,
) {
  let next = elements;
  const updatedIds: string[] = [];
  for (const candidate of next) {
    if (
      candidate.isDeleted ||
      (candidate.type !== "arrow" && candidate.type !== "line") ||
      candidate.points.length !== 2 ||
      !candidate.startBinding ||
      !candidate.endBinding ||
      (!movedTargetIds.has(candidate.startBinding.elementId) &&
        !movedTargetIds.has(candidate.endBinding.elementId))
    ) {
      continue;
    }
    const from = next.find(
      (element) =>
        element.id === candidate.startBinding?.elementId && !element.isDeleted,
    );
    const to = next.find(
      (element) => element.id === candidate.endBinding?.elementId && !element.isDeleted,
    );
    if (!from || !to) {
      continue;
    }
    const geometry = buildArrowGeometry(from, to);
    const arrow = updateElement(candidate, geometry);
    next = replaceElement(next, arrow);
    updatedIds.push(arrow.id);

    for (const bound of arrow.boundElements ?? []) {
      if (bound.type !== "text") continue;
      const label = next.find((element) => element.id === bound.id);
      if (!label || label.isDeleted || label.type !== "text") continue;
      const reflowedLabel = reflowBoundText(label, arrow);
      next = replaceElement(next, reflowedLabel);
      updatedIds.push(reflowedLabel.id);
    }
  }
  return { elements: next, updatedIds };
}

function applyPositionDeltas(
  elements: readonly ExcalidrawElement[],
  directDeltas: ReadonlyMap<string, { x: number; y: number }>,
) {
  const deltas = new Map(directDeltas);
  for (const [id, delta] of directDeltas) {
    const container = elements.find((element) => element.id === id);
    for (const bound of container?.boundElements ?? []) {
      if (bound.type === "text" && !deltas.has(bound.id)) {
        deltas.set(bound.id, delta);
      }
    }
  }

  let next = elements;
  const updatedIds: string[] = [];
  for (const [id, delta] of deltas) {
    const element = next.find((candidate) => candidate.id === id);
    if (!element || element.isDeleted || (delta.x === 0 && delta.y === 0)) {
      continue;
    }
    const moved = updateElement(element, {
      x: element.x + delta.x,
      y: element.y + delta.y,
    });
    next = replaceElement(next, moved);
    updatedIds.push(id);
  }
  const refreshed = refreshConnectedArrows(next, new Set(directDeltas.keys()));
  return {
    elements: refreshed.elements,
    updatedIds: unique([...updatedIds, ...refreshed.updatedIds]),
  };
}

function createChange(
  commandIndex: number,
  command: CanvasCommand,
  createdElementIds: readonly string[] = [],
  updatedElementIds: readonly string[] = [],
  deletedElementIds: readonly string[] = [],
): CanvasExecutionChange {
  return {
    commandIndex,
    commandType: command.type,
    affectedElementIds: unique([
      ...createdElementIds,
      ...updatedElementIds,
      ...deletedElementIds,
    ]),
    createdElementIds: unique(createdElementIds),
    updatedElementIds: unique(updatedElementIds),
    deletedElementIds: unique(deletedElementIds),
  };
}

function duplicateSelection(
  elements: readonly ExcalidrawElement[],
  sourceIds: readonly string[],
  newIds: readonly string[],
  offsetX: number,
  offsetY: number,
  command: CanvasCommand,
  commandIndex: number,
  reservedIds: Set<string>,
) {
  const sourceMap = new Map(
    sourceIds.map((id) => [
      id,
      getLiveElement(elements, id, commandIndex, command.type),
    ]),
  );
  const idMap = new Map(sourceIds.map((id, index) => [id, newIds[index]]));
  const groupMap = new Map<string, string>();
  const remapGroup = (groupId: string) => {
    let mapped = groupMap.get(groupId);
    if (!mapped) {
      const base = `codex-group-${hashString(`${groupId}:${commandIndex}`).toString(36)}`;
      mapped = base;
      let suffix = 2;
      while (reservedIds.has(mapped)) {
        mapped = `${base}-${suffix}`;
        suffix += 1;
      }
      reservedIds.add(mapped);
      groupMap.set(groupId, mapped);
    }
    return mapped;
  };

  return sourceIds.map((sourceId) => {
    const source = sourceMap.get(sourceId);
    const newId = idMap.get(sourceId);
    if (!source || !newId) {
      throw new CanvasExecutionError(
        "Falha ao mapear elementos duplicados.",
        commandIndex,
        command.type,
      );
    }
    const base = cloneElement(source);
    const remappedBoundElements = base.boundElements
      ?.filter((bound) => idMap.has(bound.id))
      .map((bound) => ({ ...bound, id: idMap.get(bound.id) as string })) ?? null;
    let duplicate = {
      ...base,
      id: newId,
      x: base.x + offsetX,
      y: base.y + offsetY,
      seed: makeSeed(newId),
      version: 1,
      versionNonce: makeSeed(`${newId}:nonce`),
      updated: Date.now(),
      index: null,
      isDeleted: false,
      groupIds: base.groupIds.map(remapGroup),
      frameId: base.frameId ? idMap.get(base.frameId) ?? null : null,
      boundElements: remappedBoundElements,
    } as ExcalidrawElement;

    if (duplicate.type === "text") {
      duplicate = {
        ...duplicate,
        containerId: duplicate.containerId
          ? idMap.get(duplicate.containerId) ?? null
          : null,
      } as ExcalidrawTextElement;
    } else if (duplicate.type === "arrow" || duplicate.type === "line") {
      duplicate = {
        ...duplicate,
        startBinding: duplicate.startBinding && idMap.has(duplicate.startBinding.elementId)
          ? { ...duplicate.startBinding, elementId: idMap.get(duplicate.startBinding.elementId) as string }
          : null,
        endBinding: duplicate.endBinding && idMap.has(duplicate.endBinding.elementId)
          ? { ...duplicate.endBinding, elementId: idMap.get(duplicate.endBinding.elementId) as string }
          : null,
      } as ExcalidrawLinearElement;
    }
    return duplicate;
  });
}

/**
 * Applies a validated plan without mutating the input array/elements. The host
 * should preview result.elements and apply that exact array after confirmation,
 * so generated IDs remain identical between preview and commit.
 */
export function executeCanvasPlan(
  inputElements: readonly ExcalidrawElement[],
  inputPlan: CanvasPlan,
  options: CanvasExecutorOptions = {},
): CanvasExecutionResult {
  if (options.readOnly) {
    throw new CanvasExecutionError("O canvas esta em modo somente leitura.");
  }
  const plan = parseCanvasPlan(inputPlan);
  let elements: readonly ExcalidrawElement[] = [...inputElements];
  const originalById = new Map(inputElements.map((element) => [element.id, element]));
  const reservedIds = new Set(
    inputElements.flatMap((element) => [element.id, ...element.groupIds]),
  );
  const createdIds = new Set<string>();
  const usedGeneratedImageIndexes = new Set<number>();
  const generatedFiles: BinaryFileData[] = [];
  const changes: CanvasExecutionChange[] = [];

  for (let commandIndex = 0; commandIndex < plan.commands.length; commandIndex += 1) {
    const command = plan.commands[commandIndex];

    switch (command.type) {
      case "createText": {
        const id = reserveId(command.id, "codex-text", command, commandIndex, reservedIds, options, "text");
        const skeletons: NonNullable<Parameters<typeof convertToExcalidrawElements>[0]> = [{
          type: "text",
          id,
          text: command.text,
          x: command.x,
          y: command.y,
          fontSize: command.fontSize,
          strokeColor: command.color ?? DEFAULT_STROKE_COLOR,
          seed: makeSeed(id),
          customData: { excaliburCodex: { source: "codex" } },
        }];
        const created = convertToExcalidrawElements(skeletons, { regenerateIds: false })
          .map((element) => ({ ...element, index: null }) as ExcalidrawElement);
        elements = [...elements, ...created];
        created.forEach((element) => createdIds.add(element.id));
        changes.push(createChange(commandIndex, command, created.map((element) => element.id)));
        break;
      }
      case "createShape": {
        const id = reserveId(command.id, "codex-shape", command, commandIndex, reservedIds, options, "shape");
        const labelId = command.label
          ? reserveId(undefined, `${id}-label`, command, commandIndex, reservedIds, options, "text", id)
          : null;
        const skeletons: NonNullable<Parameters<typeof convertToExcalidrawElements>[0]> = [{
          type: command.shape,
          id,
          x: command.x,
          y: command.y,
          width: command.width,
          height: command.height,
          strokeColor: command.strokeColor ?? DEFAULT_STROKE_COLOR,
          backgroundColor: command.backgroundColor ?? DEFAULT_BACKGROUND_COLOR,
          seed: makeSeed(id),
          label: command.label ? { text: command.label } : undefined,
          customData: { excaliburCodex: { source: "codex" } },
        }];
        const converted = convertToExcalidrawElements(skeletons, { regenerateIds: false });
        const created = labelId
          ? remapGeneratedLabel(converted, id, labelId)
          : converted.map((element) => ({ ...element, index: null }) as ExcalidrawElement);
        elements = [...elements, ...created];
        created.forEach((element) => createdIds.add(element.id));
        changes.push(createChange(commandIndex, command, created.map((element) => element.id)));
        break;
      }
      case "createGeneratedImage": {
        const source = options.generatedImages?.[command.sourceIndex];
        if (!source) {
          throw new CanvasExecutionError(
            `A imagem gerada ${command.sourceIndex} nao esta disponivel.`,
            commandIndex,
            command.type,
          );
        }
        if (usedGeneratedImageIndexes.has(command.sourceIndex)) {
          throw new CanvasExecutionError(
            `A imagem gerada ${command.sourceIndex} ja foi usada neste plano.`,
            commandIndex,
            command.type,
          );
        }
        if (
          source.mimeType !== "image/png" ||
          !source.dataURL.startsWith("data:image/png;base64,") ||
          !Number.isFinite(source.width) ||
          !Number.isFinite(source.height) ||
          source.width <= 0 ||
          source.height <= 0
        ) {
          throw new CanvasExecutionError(
            "A imagem gerada nao passou pela validacao local.",
            commandIndex,
            command.type,
          );
        }

        const id = reserveId(
          command.id,
          "codex-image",
          command,
          commandIndex,
          reservedIds,
          options,
          "image",
        );
        const requestedWidth = command.width ?? Math.min(640, source.width);
        const maxGeneratedImageDimension = 2_048;
        const scale = Math.min(
          requestedWidth / source.width,
          maxGeneratedImageDimension / source.height,
        );
        const width = source.width * scale;
        const height = source.height * scale;
        if (width < 1 || height < 1) {
          throw new CanvasExecutionError(
            "A proporcao da imagem gerada nao e suportada pelo canvas.",
            commandIndex,
            command.type,
          );
        }
        const now = Date.now();
        const element = {
          id,
          type: "image",
          x: command.x,
          y: command.y,
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
          seed: makeSeed(id),
          version: 1,
          versionNonce: makeSeed(`${id}:nonce`),
          isDeleted: false,
          boundElements: null,
          updated: now,
          link: null,
          locked: false,
          fileId: source.fileId,
          status: "saved",
          scale: [1, 1],
          crop: null,
          customData: {
            excaliburCodex: {
              source: "codex",
              generatedImage: true,
              altText: command.altText ?? null,
              revisedPrompt: source.revisedPrompt ?? null,
            },
          },
        } as ExcalidrawElement;
        const file: BinaryFileData = {
          id: source.fileId,
          dataURL: source.dataURL,
          mimeType: source.mimeType,
          created: now,
        };

        usedGeneratedImageIndexes.add(command.sourceIndex);
        generatedFiles.push(file);
        elements = [...elements, element];
        createdIds.add(element.id);
        changes.push(createChange(commandIndex, command, [element.id]));
        break;
      }
      case "moveElements": {
        assertAllowed(command.elementIds, createdIds, command, commandIndex, options);
        const targets = assertEditable(elements, command.elementIds, command, commandIndex, options);
        assertGeometryCanChange(targets, commandIndex, command.type);
        assertConnectedGeometryCanRefresh(
          elements,
          command.elementIds,
          commandIndex,
          command.type,
        );
        const deltas = new Map(command.elementIds.map((id) => [id, { x: command.deltaX, y: command.deltaY }]));
        const moved = applyPositionDeltas(elements, deltas);
        elements = moved.elements;
        changes.push(createChange(commandIndex, command, [], moved.updatedIds));
        break;
      }
      case "updateText": {
        assertAllowed([command.elementId], createdIds, command, commandIndex, options);
        const target = assertEditable(elements, [command.elementId], command, commandIndex, options)[0];
        if (target.type !== "text") {
          throw new CanvasExecutionError(`O elemento "${target.id}" nao e texto.`, commandIndex, command.type);
        }
        const container = target.containerId
          ? elements.find((element) => element.id === target.containerId && !element.isDeleted)
          : null;
        let updated: ExcalidrawTextElement;
        if (container) {
          updated = reflowBoundText(target, container, command.text);
        } else {
          const measureSkeleton: NonNullable<Parameters<typeof convertToExcalidrawElements>[0]> = [{
            type: "text",
            id: target.id,
            text: command.text,
            x: target.x,
            y: target.y,
            fontSize: target.fontSize,
            fontFamily: target.fontFamily,
            lineHeight: target.lineHeight,
            textAlign: target.textAlign,
            verticalAlign: target.verticalAlign,
            autoResize: target.autoResize,
            strokeColor: target.strokeColor,
            seed: target.seed,
          }];
          const measured = convertToExcalidrawElements(measureSkeleton, {
            regenerateIds: false,
          })[0] as ExcalidrawTextElement;
          updated = updateElement(target, {
            text: command.text,
            originalText: command.text,
            width: target.autoResize ? measured.width : target.width,
            height: target.autoResize ? measured.height : target.height,
          });
        }
        elements = replaceElement(elements, updated);
        changes.push(createChange(commandIndex, command, [], [updated.id]));
        break;
      }
      case "resizeElement": {
        assertAllowed([command.elementId], createdIds, command, commandIndex, options);
        const target = assertEditable(elements, [command.elementId], command, commandIndex, options)[0];
        assertGeometryCanChange([target], commandIndex, command.type);
        assertConnectedGeometryCanRefresh(
          elements,
          [command.elementId],
          commandIndex,
          command.type,
        );
        let updated: ExcalidrawElement;
        if (target.type === "arrow" || target.type === "line") {
          const scaleX = target.width === 0 ? 1 : command.width / target.width;
          const scaleY = target.height === 0 ? 1 : command.height / target.height;
          updated = updateElement(target, {
            width: command.width,
            height: command.height,
            points: target.points.map(([x, y]) => [x * scaleX, y * scaleY]) as unknown as ExcalidrawLinearElement["points"],
          });
        } else {
          updated = updateElement(target, { width: command.width, height: command.height });
        }
        elements = replaceElement(elements, updated);
        const updatedIds = [updated.id];
        for (const bound of updated.boundElements ?? []) {
          if (bound.type !== "text") continue;
          const label = elements.find((element) => element.id === bound.id);
          if (!label || label.isDeleted || label.type !== "text") continue;
          const reflowedLabel = reflowBoundText(label, updated);
          elements = replaceElement(elements, reflowedLabel);
          updatedIds.push(reflowedLabel.id);
        }
        const refreshed = refreshConnectedArrows(elements, new Set([updated.id]));
        elements = refreshed.elements;
        changes.push(createChange(commandIndex, command, [], [...updatedIds, ...refreshed.updatedIds]));
        break;
      }
      case "deleteElements": {
        assertAllowed(command.elementIds, createdIds, command, commandIndex, options);
        assertEditable(elements, command.elementIds, command, commandIndex, options);
        const deletedIds = expandBoundTextIds(elements, command.elementIds);
        const deletedSet = new Set(deletedIds);
        const updatedIds: string[] = [];
        elements = elements.map((element) =>
          deletedSet.has(element.id) && !element.isDeleted
            ? updateElement(element, { isDeleted: true })
            : element,
        );
        elements = elements.map((element) => {
          if (element.isDeleted) return element;
          let next = element;
          if (next.boundElements?.some((bound) => deletedSet.has(bound.id))) {
            next = updateElement(next, {
              boundElements: next.boundElements.filter((bound) => !deletedSet.has(bound.id)),
            });
          }
          if (next.type === "text" && next.containerId && deletedSet.has(next.containerId)) {
            next = updateElement(next, { containerId: null });
          } else if (next.type === "arrow" || next.type === "line") {
            const startBinding = next.startBinding && deletedSet.has(next.startBinding.elementId)
              ? null
              : next.startBinding;
            const endBinding = next.endBinding && deletedSet.has(next.endBinding.elementId)
              ? null
              : next.endBinding;
            if (startBinding !== next.startBinding || endBinding !== next.endBinding) {
              next = updateElement(next, { startBinding, endBinding });
            }
          }
          if (next !== element) updatedIds.push(next.id);
          return next;
        });
        changes.push(createChange(commandIndex, command, [], updatedIds, deletedIds));
        break;
      }
      case "connectElements": {
        assertAllowed([command.fromElementId, command.toElementId], createdIds, command, commandIndex, options);
        const [from, to] = assertEditable(elements, [command.fromElementId, command.toElementId], command, commandIndex, options);
        if (!isBindable(from) || !isBindable(to)) {
          throw new CanvasExecutionError("Somente formas, textos, imagens e frames podem receber conexoes.", commandIndex, command.type);
        }
        const id = reserveId(command.id, "codex-arrow", command, commandIndex, reservedIds, options, "arrow");
        const labelId = command.label
          ? reserveId(undefined, `${id}-label`, command, commandIndex, reservedIds, options, "text", id)
          : null;
        const geometry = buildArrowGeometry(from, to);
        const skeletons: NonNullable<Parameters<typeof convertToExcalidrawElements>[0]> = [{
          type: "arrow",
          id,
          ...geometry,
          strokeColor: command.strokeColor ?? DEFAULT_STROKE_COLOR,
          seed: makeSeed(id),
          startBinding: makeBinding(from.id),
          endBinding: makeBinding(to.id),
          label: command.label
            ? { text: command.label, fontSize: ARROW_LABEL_FONT_SIZE }
            : undefined,
          customData: { excaliburCodex: { source: "codex", managedConnection: true } },
        }];
        const converted = convertToExcalidrawElements(skeletons, {
          regenerateIds: false,
        }).map((element) =>
          element.id === id && element.type === "arrow"
            ? ({
                ...element,
                startBinding: makeBinding(from.id),
                endBinding: makeBinding(to.id),
              } as ExcalidrawElement)
            : element,
        );
        const created = labelId
          ? remapGeneratedLabel(converted, id, labelId)
          : converted.map((element) => ({ ...element, index: null }) as ExcalidrawElement);
        elements = [...elements, ...created];
        created.forEach((element) => createdIds.add(element.id));
        const updatedFrom = addBoundElement(from, { id, type: "arrow" });
        const updatedTo = addBoundElement(to, { id, type: "arrow" });
        elements = replaceElement(elements, updatedFrom);
        elements = replaceElement(elements, updatedTo);
        changes.push(createChange(commandIndex, command, created.map((element) => element.id), [from.id, to.id]));
        break;
      }
      case "alignElements": {
        assertAllowed(command.elementIds, createdIds, command, commandIndex, options);
        const targets = assertEditable(elements, command.elementIds, command, commandIndex, options);
        assertGeometryCanChange(targets, commandIndex, command.type);
        assertConnectedGeometryCanRefresh(
          elements,
          command.elementIds,
          commandIndex,
          command.type,
        );
        const left = Math.min(...targets.map((element) => element.x));
        const top = Math.min(...targets.map((element) => element.y));
        const right = Math.max(...targets.map((element) => element.x + element.width));
        const bottom = Math.max(...targets.map((element) => element.y + element.height));
        const deltas = new Map<string, { x: number; y: number }>();
        for (const element of targets) {
          let x = 0;
          let y = 0;
          if (command.alignment === "left") x = left - element.x;
          if (command.alignment === "center") x = (left + right) / 2 - (element.x + element.width / 2);
          if (command.alignment === "right") x = right - (element.x + element.width);
          if (command.alignment === "top") y = top - element.y;
          if (command.alignment === "middle") y = (top + bottom) / 2 - (element.y + element.height / 2);
          if (command.alignment === "bottom") y = bottom - (element.y + element.height);
          deltas.set(element.id, { x, y });
        }
        const aligned = applyPositionDeltas(elements, deltas);
        elements = aligned.elements;
        changes.push(createChange(commandIndex, command, [], aligned.updatedIds));
        break;
      }
      case "distributeElements": {
        assertAllowed(command.elementIds, createdIds, command, commandIndex, options);
        const targets = assertEditable(elements, command.elementIds, command, commandIndex, options);
        assertGeometryCanChange(targets, commandIndex, command.type);
        assertConnectedGeometryCanRefresh(
          elements,
          command.elementIds,
          commandIndex,
          command.type,
        );
        const horizontal = command.direction === "horizontal";
        const sorted = [...targets].sort((a, b) =>
          horizontal ? a.x - b.x : a.y - b.y,
        );
        const size = (element: ExcalidrawElement) => horizontal ? element.width : element.height;
        const position = (element: ExcalidrawElement) => horizontal ? element.x : element.y;
        const totalSize = sorted.reduce((sum, element) => sum + size(element), 0);
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const span = position(last) + size(last) - position(first);
        const gap = command.gap ?? (sorted.length > 1 ? (span - totalSize) / (sorted.length - 1) : 0);
        let cursor = position(first);
        const deltas = new Map<string, { x: number; y: number }>();
        for (const element of sorted) {
          const delta = cursor - position(element);
          deltas.set(element.id, horizontal ? { x: delta, y: 0 } : { x: 0, y: delta });
          cursor += size(element) + gap;
        }
        const distributed = applyPositionDeltas(elements, deltas);
        elements = distributed.elements;
        changes.push(createChange(commandIndex, command, [], distributed.updatedIds));
        break;
      }
      case "groupElements": {
        assertAllowed(command.elementIds, createdIds, command, commandIndex, options);
        assertEditable(elements, command.elementIds, command, commandIndex, options);
        const groupId = reserveId(command.groupId, "codex-group", command, commandIndex, reservedIds, options, "group");
        const targetIds = new Set(expandBoundTextIds(elements, command.elementIds));
        elements = elements.map((element) =>
          targetIds.has(element.id)
            ? updateElement(element, { groupIds: [...element.groupIds, groupId] })
            : element,
        );
        changes.push(createChange(commandIndex, command, [], [...targetIds]));
        break;
      }
      case "updateStyle": {
        assertAllowed(command.elementIds, createdIds, command, commandIndex, options);
        assertEditable(elements, command.elementIds, command, commandIndex, options);
        const targetIds = new Set(command.elementIds);
        elements = elements.map((element) => {
          if (!targetIds.has(element.id)) return element;
          return updateElement(element, {
            strokeColor: command.strokeColor ?? element.strokeColor,
            backgroundColor: command.backgroundColor ?? element.backgroundColor,
            opacity: command.opacity ?? element.opacity,
            strokeWidth: command.strokeWidth ?? element.strokeWidth,
          });
        });
        changes.push(createChange(commandIndex, command, [], command.elementIds));
        break;
      }
      case "duplicateElements": {
        assertAllowed(command.elementIds, createdIds, command, commandIndex, options);
        assertEditable(elements, command.elementIds, command, commandIndex, options);
        const sourceIds = expandBoundTextIds(elements, command.elementIds);
        const requestedIds = new Map(
          command.elementIds.map((sourceId, index) => [sourceId, command.newIds?.[index]]),
        );
        const newIds = sourceIds.map((sourceId) =>
          reserveId(
            requestedIds.get(sourceId),
            "codex-copy",
            command,
            commandIndex,
            reservedIds,
            options,
            "duplicate",
            sourceId,
          ),
        );
        const duplicates = duplicateSelection(
          elements,
          sourceIds,
          newIds,
          command.offsetX ?? 32,
          command.offsetY ?? 32,
          command,
          commandIndex,
          reservedIds,
        );
        elements = [...elements, ...duplicates];
        duplicates.forEach((element) => createdIds.add(element.id));
        changes.push(createChange(commandIndex, command, duplicates.map((element) => element.id)));
        break;
      }
    }
  }

  const createdElementIds = elements
    .filter((element) => !element.isDeleted && !originalById.has(element.id))
    .map((element) => element.id);
  const deletedElementIds = elements
    .filter((element) => {
      const original = originalById.get(element.id);
      return Boolean(original && !original.isDeleted && element.isDeleted);
    })
    .map((element) => element.id);
  const deletedSet = new Set(deletedElementIds);
  const updatedElementIds = elements
    .filter((element) => {
      const original = originalById.get(element.id);
      return Boolean(
        original &&
          !original.isDeleted &&
          !element.isDeleted &&
          !deletedSet.has(element.id) &&
          original.version !== element.version,
      );
    })
    .map((element) => element.id);

  return {
    elements,
    files: generatedFiles,
    changes,
    affectedElementIds: unique([
      ...createdElementIds,
      ...updatedElementIds,
      ...deletedElementIds,
    ]),
    createdElementIds,
    updatedElementIds,
    deletedElementIds,
  };
}
