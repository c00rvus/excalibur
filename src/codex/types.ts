import type { BinaryFileData, DataURL } from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  FileId,
} from "@excalidraw/excalidraw/element/types";

export type CanvasScope = "selection" | "viewport" | "canvas";

export type CanvasElementKind =
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "text"
  | "arrow"
  | "line"
  | "image"
  | "freedraw"
  | "frame"
  | "embeddable"
  | "other";

export type CanvasViewport = {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
};

export type CanvasElementSummary = {
  id: string;
  type: CanvasElementKind;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  text?: string;
  strokeColor: string;
  backgroundColor: string;
  opacity: number;
  groupIds: string[];
  frameId: string | null;
  locked: boolean;
  startElementId?: string;
  endElementId?: string;
  boundElementIds: string[];
};

export type CanvasContext = {
  version: 1;
  scope: CanvasScope;
  viewport: CanvasViewport | null;
  selectionIds: string[];
  elements: CanvasElementSummary[];
  totalElementCount: number;
  omittedElementCount: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
};

export type ShapeKind = "rectangle" | "ellipse" | "diamond";

export type CreateTextCommand = {
  type: "createText";
  id?: string;
  text: string;
  x: number;
  y: number;
  fontSize?: number;
  color?: string;
};

export type CreateShapeCommand = {
  type: "createShape";
  id?: string;
  shape: ShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  strokeColor?: string;
  backgroundColor?: string;
};

export type CreateGeneratedImageCommand = {
  type: "createGeneratedImage";
  id?: string;
  /** Zero-based index of the imageGeneration item completed in this turn. */
  sourceIndex: number;
  x: number;
  y: number;
  /** Display width. The natural aspect ratio is always preserved. */
  width?: number;
  altText?: string;
};

export type GeneratedImageAsset = {
  fileId: FileId;
  dataURL: DataURL;
  mimeType: "image/png";
  width: number;
  height: number;
  revisedPrompt?: string;
};

export type MoveElementsCommand = {
  type: "moveElements";
  elementIds: string[];
  deltaX: number;
  deltaY: number;
};

export type UpdateTextCommand = {
  type: "updateText";
  elementId: string;
  text: string;
};

export type ResizeElementCommand = {
  type: "resizeElement";
  elementId: string;
  width: number;
  height: number;
};

export type DeleteElementsCommand = {
  type: "deleteElements";
  elementIds: string[];
};

export type ConnectElementsCommand = {
  type: "connectElements";
  id?: string;
  fromElementId: string;
  toElementId: string;
  label?: string;
  strokeColor?: string;
};

export type Alignment =
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom";

export type AlignElementsCommand = {
  type: "alignElements";
  elementIds: string[];
  alignment: Alignment;
};

export type DistributeElementsCommand = {
  type: "distributeElements";
  elementIds: string[];
  direction: "horizontal" | "vertical";
  gap?: number;
};

export type GroupElementsCommand = {
  type: "groupElements";
  elementIds: string[];
  groupId?: string;
};

export type UpdateStyleCommand = {
  type: "updateStyle";
  elementIds: string[];
  strokeColor?: string;
  backgroundColor?: string;
  opacity?: number;
  strokeWidth?: number;
};

export type DuplicateElementsCommand = {
  type: "duplicateElements";
  elementIds: string[];
  newIds?: string[];
  offsetX?: number;
  offsetY?: number;
};

export type CanvasCommand =
  | CreateTextCommand
  | CreateShapeCommand
  | CreateGeneratedImageCommand
  | MoveElementsCommand
  | UpdateTextCommand
  | ResizeElementCommand
  | DeleteElementsCommand
  | ConnectElementsCommand
  | AlignElementsCommand
  | DistributeElementsCommand
  | GroupElementsCommand
  | UpdateStyleCommand
  | DuplicateElementsCommand;

export type CanvasPlan = {
  summary: string;
  commands: CanvasCommand[];
};

export type CanvasExecutionChange = {
  commandIndex: number;
  commandType: CanvasCommand["type"];
  affectedElementIds: string[];
  createdElementIds: string[];
  updatedElementIds: string[];
  deletedElementIds: string[];
};

export type CanvasExecutionResult = {
  elements: readonly ExcalidrawElement[];
  files: readonly BinaryFileData[];
  changes: CanvasExecutionChange[];
  affectedElementIds: string[];
  createdElementIds: string[];
  updatedElementIds: string[];
  deletedElementIds: string[];
};
