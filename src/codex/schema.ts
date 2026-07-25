/*
 * Keep this schema intentionally structural. Codex App Server 0.144 accepts a
 * smaller Structured Outputs subset than a general JSON Schema validator.
 * Lengths, ranges, ID syntax and cross-field rules remain enforced by
 * validation.ts after the response is received.
 */
const stringSchema = { type: "string" } as const;
const numberSchema = { type: "number" } as const;
const nullableStringSchema = { type: ["string", "null"] } as const;
const nullableNumberSchema = { type: ["number", "null"] } as const;

const elementIdsSchema = {
  type: "array",
  items: stringSchema,
} as const;

const nullableElementIdsSchema = {
  type: ["array", "null"],
  items: stringSchema,
} as const;

const createGeneratedImageCommandSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type", "id", "sourceIndex", "x", "y", "width", "altText"],
  properties: {
    type: { enum: ["createGeneratedImage"] },
    id: nullableStringSchema,
    sourceIndex: numberSchema,
    x: numberSchema,
    y: numberSchema,
    width: nullableNumberSchema,
    altText: nullableStringSchema,
  },
} as const;

const commandSchemas = [
  {
    type: "object",
    additionalProperties: false,
    required: ["type", "id", "text", "x", "y", "fontSize", "color"],
    properties: {
      type: { enum: ["createText"] },
      id: nullableStringSchema,
      text: stringSchema,
      x: numberSchema,
      y: numberSchema,
      fontSize: nullableNumberSchema,
      color: nullableStringSchema,
    },
  },
  {
    type: "object",
    additionalProperties: false,
    required: [
      "type",
      "id",
      "shape",
      "x",
      "y",
      "width",
      "height",
      "label",
      "strokeColor",
      "backgroundColor",
    ],
    properties: {
      type: { enum: ["createShape"] },
      id: nullableStringSchema,
      shape: { enum: ["rectangle", "ellipse", "diamond"] },
      x: numberSchema,
      y: numberSchema,
      width: numberSchema,
      height: numberSchema,
      label: nullableStringSchema,
      strokeColor: nullableStringSchema,
      backgroundColor: nullableStringSchema,
    },
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["type", "elementIds", "deltaX", "deltaY"],
    properties: {
      type: { enum: ["moveElements"] },
      elementIds: elementIdsSchema,
      deltaX: numberSchema,
      deltaY: numberSchema,
    },
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["type", "elementId", "text"],
    properties: {
      type: { enum: ["updateText"] },
      elementId: stringSchema,
      text: stringSchema,
    },
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["type", "elementId", "width", "height"],
    properties: {
      type: { enum: ["resizeElement"] },
      elementId: stringSchema,
      width: numberSchema,
      height: numberSchema,
    },
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["type", "elementIds"],
    properties: {
      type: { enum: ["deleteElements"] },
      elementIds: elementIdsSchema,
    },
  },
  {
    type: "object",
    additionalProperties: false,
    required: [
      "type",
      "id",
      "fromElementId",
      "toElementId",
      "label",
      "strokeColor",
    ],
    properties: {
      type: { enum: ["connectElements"] },
      id: nullableStringSchema,
      fromElementId: stringSchema,
      toElementId: stringSchema,
      label: nullableStringSchema,
      strokeColor: nullableStringSchema,
    },
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["type", "elementIds", "alignment"],
    properties: {
      type: { enum: ["alignElements"] },
      elementIds: elementIdsSchema,
      alignment: {
        enum: ["left", "center", "right", "top", "middle", "bottom"],
      },
    },
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["type", "elementIds", "direction", "gap"],
    properties: {
      type: { enum: ["distributeElements"] },
      elementIds: elementIdsSchema,
      direction: { enum: ["horizontal", "vertical"] },
      gap: nullableNumberSchema,
    },
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["type", "elementIds", "groupId"],
    properties: {
      type: { enum: ["groupElements"] },
      elementIds: elementIdsSchema,
      groupId: nullableStringSchema,
    },
  },
  {
    type: "object",
    additionalProperties: false,
    required: [
      "type",
      "elementIds",
      "strokeColor",
      "backgroundColor",
      "opacity",
      "strokeWidth",
    ],
    properties: {
      type: { enum: ["updateStyle"] },
      elementIds: elementIdsSchema,
      strokeColor: nullableStringSchema,
      backgroundColor: nullableStringSchema,
      opacity: nullableNumberSchema,
      strokeWidth: nullableNumberSchema,
    },
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["type", "elementIds", "newIds", "offsetX", "offsetY"],
    properties: {
      type: { enum: ["duplicateElements"] },
      elementIds: elementIdsSchema,
      newIds: nullableElementIdsSchema,
      offsetX: nullableNumberSchema,
      offsetY: nullableNumberSchema,
    },
  },
] as const;

/** JSON Schema passed to Codex App Server as a turn's structured output schema. */
export const CANVAS_PLAN_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "commands"],
  properties: {
    summary: stringSchema,
    commands: {
      type: "array",
      items: { anyOf: commandSchemas },
    },
  },
} as const;

/**
 * A separate schema makes an explicit image request fail clearly instead of
 * letting the model approximate it with a second vector diagram.
 */
export const GENERATED_IMAGE_PLAN_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "commands"],
  properties: {
    summary: stringSchema,
    commands: {
      type: "array",
      items: { anyOf: [createGeneratedImageCommandSchema] },
    },
  },
} as const;
