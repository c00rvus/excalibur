import { getCommonBounds } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { CanvasAttachment } from "./attachments";

type AttachmentElementData = {
  attachmentId?: string;
  pageIndex?: number;
};

type ElementWithAttachmentData = ExcalidrawElement & {
  customData?: (Record<string, unknown> & {
    excaliburAttachment?: AttachmentElementData;
  }) | null;
};

export type NativeAttachmentDuplicateResult = {
  attachments: CanvasAttachment[];
  elements: ExcalidrawElement[];
};

function getAttachmentData(element: ExcalidrawElement) {
  const data = (element as ElementWithAttachmentData).customData
    ?.excaliburAttachment;

  return data && typeof data === "object" ? data : null;
}

export function duplicateNativeAttachmentRecords(
  nextElements: readonly ExcalidrawElement[],
  previousElements: readonly ExcalidrawElement[],
  currentAttachments: readonly CanvasAttachment[],
  createId: () => string = () => crypto.randomUUID(),
  now = Date.now(),
  sourceAttachments: readonly CanvasAttachment[] = currentAttachments,
): NativeAttachmentDuplicateResult | null {
  const previousIds = new Set(previousElements.map((element) => element.id));
  const registeredElementIds = new Set(
    currentAttachments.flatMap((attachment) => attachment.nativeElementIds ?? []),
  );
  const attachmentById = new Map(
    [...sourceAttachments, ...currentAttachments]
      .filter((attachment) => attachment.displayMode === "native")
      .map((attachment) => [attachment.id, attachment]),
  );
  const sceneOrder = new Map(
    nextElements.map((element, index) => [element.id, index]),
  );
  const duplicateGroups = new Map<string, ExcalidrawElement[]>();

  for (const element of nextElements) {
    if (
      element.isDeleted ||
      previousIds.has(element.id) ||
      registeredElementIds.has(element.id)
    ) {
      continue;
    }

    const attachmentId = getAttachmentData(element)?.attachmentId;
    if (!attachmentId || !attachmentById.has(attachmentId)) {
      continue;
    }

    const group = duplicateGroups.get(attachmentId) ?? [];
    group.push(element);
    duplicateGroups.set(attachmentId, group);
  }

  if (!duplicateGroups.size) {
    return null;
  }

  const replacementAttachmentIds = new Map<string, string>();
  const duplicatedAttachments: CanvasAttachment[] = [];

  for (const [sourceAttachmentId, duplicatedElements] of duplicateGroups) {
    const sourceAttachment = attachmentById.get(sourceAttachmentId);
    if (!sourceAttachment) {
      continue;
    }

    const nextAttachmentId = createId();
    const orderedElements = [...duplicatedElements].sort((left, right) => {
      const leftPage = getAttachmentData(left)?.pageIndex;
      const rightPage = getAttachmentData(right)?.pageIndex;
      const leftPageOrder = Number.isFinite(leftPage)
        ? Number(leftPage)
        : Number.MAX_SAFE_INTEGER;
      const rightPageOrder = Number.isFinite(rightPage)
        ? Number(rightPage)
        : Number.MAX_SAFE_INTEGER;

      return (
        leftPageOrder - rightPageOrder ||
        (sceneOrder.get(left.id) ?? 0) - (sceneOrder.get(right.id) ?? 0)
      );
    });
    const [minX, minY, maxX, maxY] = getCommonBounds(orderedElements);

    orderedElements.forEach((element) => {
      replacementAttachmentIds.set(element.id, nextAttachmentId);
    });
    duplicatedAttachments.push({
      ...sourceAttachment,
      id: nextAttachmentId,
      createdAt: now,
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
      nativeElementIds: orderedElements.map((element) => element.id),
      nativePageCount: orderedElements.length,
    });
  }

  if (!duplicatedAttachments.length) {
    return null;
  }

  const elements = nextElements.map((element) => {
    const nextAttachmentId = replacementAttachmentIds.get(element.id);
    if (!nextAttachmentId) {
      return element;
    }

    const elementWithData = element as ElementWithAttachmentData;
    const attachmentData = getAttachmentData(element);

    return {
      ...element,
      customData: {
        ...(elementWithData.customData ?? {}),
        excaliburAttachment: {
          ...attachmentData,
          attachmentId: nextAttachmentId,
        },
      },
    } as ExcalidrawElement;
  });

  return {
    attachments: [...currentAttachments, ...duplicatedAttachments],
    elements,
  };
}
