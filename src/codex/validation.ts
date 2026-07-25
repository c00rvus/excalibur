import type {
  Alignment,
  CanvasCommand,
  CanvasPlan,
  ShapeKind,
} from "./types";

export type CanvasPlanValidationIssue = {
  path: string;
  message: string;
};

export type CanvasPlanValidationResult =
  | { ok: true; value: CanvasPlan }
  | { ok: false; issues: CanvasPlanValidationIssue[] };

export class CanvasPlanValidationError extends Error {
  readonly issues: CanvasPlanValidationIssue[];

  constructor(issues: CanvasPlanValidationIssue[]) {
    super(
      `Plano do canvas invalido: ${issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "CanvasPlanValidationError";
    this.issues = issues;
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MAX_COORDINATE = 1_000_000;
const MAX_DIMENSION = 100_000;
const MAX_TEXT_LENGTH = 20_000;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertObject(
  value: unknown,
  path: string,
  issues: CanvasPlanValidationIssue[],
): JsonObject | null {
  if (!isObject(value)) {
    issues.push({ path, message: "deve ser um objeto" });
    return null;
  }
  return value;
}

function rejectUnknownKeys(
  value: JsonObject,
  allowed: readonly string[],
  path: string,
  issues: CanvasPlanValidationIssue[],
) {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      issues.push({ path: `${path}.${key}`, message: "propriedade desconhecida" });
    }
  }
}

function readString(
  value: unknown,
  path: string,
  issues: CanvasPlanValidationIssue[],
  options: { maxLength: number; optional?: boolean; preserveWhitespace?: boolean },
): string | undefined {
  if ((value === undefined || value === null) && options.optional) {
    return undefined;
  }
  if (typeof value !== "string") {
    issues.push({ path, message: "deve ser texto" });
    return undefined;
  }

  const normalized = value.replace(/\r\n?/g, "\n");
  const inspected = normalized.trim();
  if (inspected.length === 0) {
    issues.push({ path, message: "nao pode estar vazio" });
    return undefined;
  }
  if (normalized.length > options.maxLength) {
    issues.push({ path, message: `deve ter no maximo ${options.maxLength} caracteres` });
    return undefined;
  }
  return options.preserveWhitespace ? normalized : inspected;
}

function readId(
  value: unknown,
  path: string,
  issues: CanvasPlanValidationIssue[],
  optional = false,
): string | undefined {
  const id = readString(value, path, issues, { maxLength: 128, optional });
  if (id !== undefined && !ID_PATTERN.test(id)) {
    issues.push({
      path,
      message: "deve comecar com letra ou numero e conter apenas letras, numeros, ponto, dois-pontos, hifen ou sublinhado",
    });
    return undefined;
  }
  return id;
}

function readNumber(
  value: unknown,
  path: string,
  issues: CanvasPlanValidationIssue[],
  options: { min: number; max: number; optional?: boolean; exclusiveMin?: boolean },
): number | undefined {
  if ((value === undefined || value === null) && options.optional) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push({ path, message: "deve ser um numero finito" });
    return undefined;
  }
  const belowMinimum = options.exclusiveMin ? value <= options.min : value < options.min;
  if (belowMinimum || value > options.max) {
    const comparator = options.exclusiveMin ? "maior que" : "maior ou igual a";
    issues.push({
      path,
      message: `deve ser ${comparator} ${options.min} e menor ou igual a ${options.max}`,
    });
    return undefined;
  }
  return value;
}

function readIdList(
  value: unknown,
  path: string,
  issues: CanvasPlanValidationIssue[],
  minItems = 1,
): string[] | undefined {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "deve ser uma lista de IDs" });
    return undefined;
  }
  if (value.length < minItems || value.length > 500) {
    issues.push({
      path,
      message: `deve conter entre ${minItems} e 500 IDs`,
    });
  }
  const ids = value
    .map((item, index) => readId(item, `${path}[${index}]`, issues))
    .filter((id): id is string => id !== undefined);
  if (new Set(ids).size !== ids.length) {
    issues.push({ path, message: "nao pode conter IDs repetidos" });
  }
  return ids;
}

function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  issues: CanvasPlanValidationIssue[],
): T | undefined {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    issues.push({ path, message: `deve ser um de: ${allowed.join(", ")}` });
    return undefined;
  }
  return value as T;
}

function readOptionalColor(
  value: unknown,
  path: string,
  issues: CanvasPlanValidationIssue[],
) {
  return readString(value, path, issues, { maxLength: 64, optional: true });
}

function parseCommand(
  raw: unknown,
  index: number,
  issues: CanvasPlanValidationIssue[],
): CanvasCommand | null {
  const path = `commands[${index}]`;
  const value = assertObject(raw, path, issues);
  if (!value) {
    return null;
  }
  if (typeof value.type !== "string") {
    issues.push({ path: `${path}.type`, message: "deve ser texto" });
    return null;
  }

  switch (value.type) {
    case "createText": {
      rejectUnknownKeys(value, ["type", "id", "text", "x", "y", "fontSize", "color"], path, issues);
      const id = readId(value.id, `${path}.id`, issues, true);
      const text = readString(value.text, `${path}.text`, issues, {
        maxLength: MAX_TEXT_LENGTH,
        preserveWhitespace: true,
      });
      const x = readNumber(value.x, `${path}.x`, issues, { min: -MAX_COORDINATE, max: MAX_COORDINATE });
      const y = readNumber(value.y, `${path}.y`, issues, { min: -MAX_COORDINATE, max: MAX_COORDINATE });
      const fontSize = readNumber(value.fontSize, `${path}.fontSize`, issues, {
        min: 8,
        max: 200,
        optional: true,
      });
      const color = readOptionalColor(value.color, `${path}.color`, issues);
      if (text === undefined || x === undefined || y === undefined) return null;
      return { type: "createText", id, text, x, y, fontSize, color };
    }
    case "createShape": {
      rejectUnknownKeys(value, ["type", "id", "shape", "x", "y", "width", "height", "label", "strokeColor", "backgroundColor"], path, issues);
      const id = readId(value.id, `${path}.id`, issues, true);
      const shape = readEnum<ShapeKind>(value.shape, ["rectangle", "ellipse", "diamond"], `${path}.shape`, issues);
      const x = readNumber(value.x, `${path}.x`, issues, { min: -MAX_COORDINATE, max: MAX_COORDINATE });
      const y = readNumber(value.y, `${path}.y`, issues, { min: -MAX_COORDINATE, max: MAX_COORDINATE });
      const width = readNumber(value.width, `${path}.width`, issues, { min: 0, max: MAX_DIMENSION, exclusiveMin: true });
      const height = readNumber(value.height, `${path}.height`, issues, { min: 0, max: MAX_DIMENSION, exclusiveMin: true });
      const label = readString(value.label, `${path}.label`, issues, {
        maxLength: MAX_TEXT_LENGTH,
        optional: true,
        preserveWhitespace: true,
      });
      const strokeColor = readOptionalColor(value.strokeColor, `${path}.strokeColor`, issues);
      const backgroundColor = readOptionalColor(value.backgroundColor, `${path}.backgroundColor`, issues);
      if (!shape || x === undefined || y === undefined || width === undefined || height === undefined) return null;
      return { type: "createShape", id, shape, x, y, width, height, label, strokeColor, backgroundColor };
    }
    case "createGeneratedImage": {
      rejectUnknownKeys(
        value,
        ["type", "id", "sourceIndex", "x", "y", "width", "altText"],
        path,
        issues,
      );
      const id = readId(value.id, `${path}.id`, issues, true);
      const sourceIndex = readNumber(value.sourceIndex, `${path}.sourceIndex`, issues, {
        min: 0,
        max: 3,
      });
      if (sourceIndex !== undefined && !Number.isInteger(sourceIndex)) {
        issues.push({ path: `${path}.sourceIndex`, message: "deve ser um numero inteiro" });
      }
      const x = readNumber(value.x, `${path}.x`, issues, {
        min: -MAX_COORDINATE,
        max: MAX_COORDINATE,
      });
      const y = readNumber(value.y, `${path}.y`, issues, {
        min: -MAX_COORDINATE,
        max: MAX_COORDINATE,
      });
      const width = readNumber(value.width, `${path}.width`, issues, {
        min: 64,
        max: 2_048,
        optional: true,
      });
      const altText = readString(value.altText, `${path}.altText`, issues, {
        maxLength: 500,
        optional: true,
      });
      if (
        sourceIndex === undefined ||
        !Number.isInteger(sourceIndex) ||
        x === undefined ||
        y === undefined
      ) {
        return null;
      }
      return {
        type: "createGeneratedImage",
        id,
        sourceIndex,
        x,
        y,
        width,
        altText,
      };
    }
    case "moveElements": {
      rejectUnknownKeys(value, ["type", "elementIds", "deltaX", "deltaY"], path, issues);
      const elementIds = readIdList(value.elementIds, `${path}.elementIds`, issues);
      const deltaX = readNumber(value.deltaX, `${path}.deltaX`, issues, { min: -MAX_COORDINATE, max: MAX_COORDINATE });
      const deltaY = readNumber(value.deltaY, `${path}.deltaY`, issues, { min: -MAX_COORDINATE, max: MAX_COORDINATE });
      if (!elementIds || deltaX === undefined || deltaY === undefined) return null;
      return { type: "moveElements", elementIds, deltaX, deltaY };
    }
    case "updateText": {
      rejectUnknownKeys(value, ["type", "elementId", "text"], path, issues);
      const elementId = readId(value.elementId, `${path}.elementId`, issues);
      const text = readString(value.text, `${path}.text`, issues, {
        maxLength: MAX_TEXT_LENGTH,
        preserveWhitespace: true,
      });
      if (!elementId || text === undefined) return null;
      return { type: "updateText", elementId, text };
    }
    case "resizeElement": {
      rejectUnknownKeys(value, ["type", "elementId", "width", "height"], path, issues);
      const elementId = readId(value.elementId, `${path}.elementId`, issues);
      const width = readNumber(value.width, `${path}.width`, issues, { min: 0, max: MAX_DIMENSION, exclusiveMin: true });
      const height = readNumber(value.height, `${path}.height`, issues, { min: 0, max: MAX_DIMENSION, exclusiveMin: true });
      if (!elementId || width === undefined || height === undefined) return null;
      return { type: "resizeElement", elementId, width, height };
    }
    case "deleteElements": {
      rejectUnknownKeys(value, ["type", "elementIds"], path, issues);
      const elementIds = readIdList(value.elementIds, `${path}.elementIds`, issues);
      if (!elementIds) return null;
      return { type: "deleteElements", elementIds };
    }
    case "connectElements": {
      rejectUnknownKeys(value, ["type", "id", "fromElementId", "toElementId", "label", "strokeColor"], path, issues);
      const id = readId(value.id, `${path}.id`, issues, true);
      const fromElementId = readId(value.fromElementId, `${path}.fromElementId`, issues);
      const toElementId = readId(value.toElementId, `${path}.toElementId`, issues);
      const label = readString(value.label, `${path}.label`, issues, {
        maxLength: MAX_TEXT_LENGTH,
        optional: true,
        preserveWhitespace: true,
      });
      const strokeColor = readOptionalColor(value.strokeColor, `${path}.strokeColor`, issues);
      if (!fromElementId || !toElementId) return null;
      if (fromElementId === toElementId) {
        issues.push({ path, message: "origem e destino devem ser diferentes" });
      }
      return { type: "connectElements", id, fromElementId, toElementId, label, strokeColor };
    }
    case "alignElements": {
      rejectUnknownKeys(value, ["type", "elementIds", "alignment"], path, issues);
      const elementIds = readIdList(value.elementIds, `${path}.elementIds`, issues, 2);
      const alignment = readEnum<Alignment>(value.alignment, ["left", "center", "right", "top", "middle", "bottom"], `${path}.alignment`, issues);
      if (!elementIds || !alignment) return null;
      return { type: "alignElements", elementIds, alignment };
    }
    case "distributeElements": {
      rejectUnknownKeys(value, ["type", "elementIds", "direction", "gap"], path, issues);
      const elementIds = readIdList(value.elementIds, `${path}.elementIds`, issues, 2);
      const direction = readEnum(value.direction, ["horizontal", "vertical"], `${path}.direction`, issues);
      const gap = readNumber(value.gap, `${path}.gap`, issues, { min: 0, max: MAX_DIMENSION, optional: true });
      if (!elementIds || !direction) return null;
      return { type: "distributeElements", elementIds, direction, gap };
    }
    case "groupElements": {
      rejectUnknownKeys(value, ["type", "elementIds", "groupId"], path, issues);
      const elementIds = readIdList(value.elementIds, `${path}.elementIds`, issues, 2);
      const groupId = readId(value.groupId, `${path}.groupId`, issues, true);
      if (!elementIds) return null;
      return { type: "groupElements", elementIds, groupId };
    }
    case "updateStyle": {
      rejectUnknownKeys(value, ["type", "elementIds", "strokeColor", "backgroundColor", "opacity", "strokeWidth"], path, issues);
      const elementIds = readIdList(value.elementIds, `${path}.elementIds`, issues);
      const strokeColor = readOptionalColor(value.strokeColor, `${path}.strokeColor`, issues);
      const backgroundColor = readOptionalColor(value.backgroundColor, `${path}.backgroundColor`, issues);
      const opacity = readNumber(value.opacity, `${path}.opacity`, issues, {
        min: 0,
        max: 100,
        optional: true,
      });
      const strokeWidth = readNumber(value.strokeWidth, `${path}.strokeWidth`, issues, {
        min: 0.5,
        max: 10,
        optional: true,
      });
      if (
        strokeColor === undefined &&
        backgroundColor === undefined &&
        opacity === undefined &&
        strokeWidth === undefined
      ) {
        issues.push({ path, message: "deve informar ao menos uma propriedade de estilo" });
      }
      if (!elementIds) return null;
      return { type: "updateStyle", elementIds, strokeColor, backgroundColor, opacity, strokeWidth };
    }
    case "duplicateElements": {
      rejectUnknownKeys(value, ["type", "elementIds", "newIds", "offsetX", "offsetY"], path, issues);
      const elementIds = readIdList(value.elementIds, `${path}.elementIds`, issues);
      const newIds = value.newIds === undefined || value.newIds === null
        ? undefined
        : readIdList(value.newIds, `${path}.newIds`, issues);
      const offsetX = readNumber(value.offsetX, `${path}.offsetX`, issues, {
        min: -MAX_COORDINATE,
        max: MAX_COORDINATE,
        optional: true,
      });
      const offsetY = readNumber(value.offsetY, `${path}.offsetY`, issues, {
        min: -MAX_COORDINATE,
        max: MAX_COORDINATE,
        optional: true,
      });
      if (elementIds && newIds && elementIds.length !== newIds.length) {
        issues.push({ path: `${path}.newIds`, message: "deve ter a mesma quantidade de IDs de elementIds" });
      }
      if (!elementIds) return null;
      return { type: "duplicateElements", elementIds, newIds, offsetX, offsetY };
    }
    default:
      issues.push({ path: `${path}.type`, message: `comando nao suportado: ${value.type}` });
      return null;
  }
}

export function validateCanvasPlan(input: unknown): CanvasPlanValidationResult {
  const issues: CanvasPlanValidationIssue[] = [];
  const value = assertObject(input, "$", issues);
  if (!value) {
    return { ok: false, issues };
  }

  rejectUnknownKeys(value, ["summary", "commands"], "$", issues);
  const summary = readString(value.summary, "summary", issues, { maxLength: 1_000 });
  if (!Array.isArray(value.commands)) {
    issues.push({ path: "commands", message: "deve ser uma lista" });
    return { ok: false, issues };
  }
  if (value.commands.length > 100) {
    issues.push({ path: "commands", message: "deve conter entre 0 e 100 comandos" });
  }
  const commands = value.commands
    .map((command, index) => parseCommand(command, index, issues))
    .filter((command): command is CanvasCommand => command !== null);

  if (issues.length > 0 || summary === undefined || commands.length !== value.commands.length) {
    return { ok: false, issues };
  }
  return { ok: true, value: { summary, commands } };
}

export function parseCanvasPlan(input: unknown): CanvasPlan {
  const result = validateCanvasPlan(input);
  if (!result.ok) {
    throw new CanvasPlanValidationError(result.issues);
  }
  return result.value;
}
