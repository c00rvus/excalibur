import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const packageRoot = join(
  process.cwd(),
  "node_modules",
  "@excalidraw",
  "excalidraw",
);

const files = {
  devCore: join(packageRoot, "dist", "dev", "chunk-4FTI6OG3.js"),
  prodCore: join(packageRoot, "dist", "prod", "chunk-K2UTITRG.js"),
  devIndex: join(packageRoot, "dist", "dev", "index.js"),
  prodIndex: join(packageRoot, "dist", "prod", "index.js"),
  types: join(packageRoot, "dist", "types", "excalidraw", "types.d.ts"),
  elementTypes: join(
    packageRoot,
    "dist",
    "types",
    "excalidraw",
    "element",
    "types.d.ts",
  ),
  constantsTypes: join(
    packageRoot,
    "dist",
    "types",
    "excalidraw",
    "constants.d.ts",
  ),
};

const audioDrawerDev = String.raw`
var formatExcaliburAudioDuration = (durationMs) => {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "Audio";
  }
  const totalSeconds = Math.max(0, Math.round(durationMs / 1e3));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return minutes + ":" + seconds;
};
var drawExcaliburRoundedRect = (context, x, y, width, height, radius) => {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  if (context.roundRect) {
    context.roundRect(x, y, width, height, safeRadius);
    return;
  }
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
};
var drawExcaliburAudioElement = (element, context, appState) => {
  const attachment = element.customData?.excaliburAttachment || {};
  const isDark = appState?.theme === "dark";
  const rawWidth = Number.isFinite(element.width) ? element.width : 148;
  const rawHeight = Number.isFinite(element.height) ? element.height : 58;
  const signX = rawWidth < 0 ? -1 : 1;
  const signY = rawHeight < 0 ? -1 : 1;
  const width = Math.max(1, Math.abs(rawWidth || 148));
  const height = Math.max(1, Math.abs(rawHeight || 58));
  const radius = Math.min(10, width / 7, height / 4);
  const cardFill = isDark ? "#2f3433" : "#ffffff";
  const iconFill = isDark ? "#1f2423" : "#eef7f6";
  const primary = "#80cbc4";
  const text = isDark ? "#eaffff" : "#102322";
  const muted = isDark ? "#b8c6c4" : "#526461";
  context.save();
  if (signX < 0 || signY < 0) {
    context.scale(signX, signY);
    context.translate(signX < 0 ? -width : 0, signY < 0 ? -height : 0);
  }
  context.lineWidth = 1.5;
  context.fillStyle = cardFill;
  context.strokeStyle = primary;
  drawExcaliburRoundedRect(context, 0.75, 0.75, width - 1.5, height - 1.5, radius);
  context.fill();
  context.stroke();
  drawExcaliburRoundedRect(context, 0.75, 0.75, width - 1.5, height - 1.5, radius);
  context.clip();
  const baseWidth = 148;
  const baseHeight = 58;
  const padding = Math.min(12, Math.max(4, Math.min(width, height) * 0.08));
  const contentScale = Math.max(
    0.18,
    Math.min(
      3,
      Math.min(
        Math.max(1, width - padding * 2) / baseWidth,
        Math.max(1, height - padding * 2) / baseHeight,
      ),
    ),
  );
  context.translate(
    (width - baseWidth * contentScale) / 2,
    (height - baseHeight * contentScale) / 2,
  );
  context.scale(contentScale, contentScale);
  const centerY = baseHeight / 2;
  const iconRadius = 17;
  const iconX = 27;
  context.beginPath();
  context.arc(iconX, centerY, iconRadius, 0, Math.PI * 2);
  context.fillStyle = iconFill;
  context.fill();
  context.strokeStyle = primary;
  context.stroke();
  context.strokeStyle = text;
  context.lineWidth = 1.8;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(iconX - 3, centerY - 7);
  context.lineTo(iconX - 3, centerY + 4);
  context.moveTo(iconX + 3, centerY - 7);
  context.lineTo(iconX + 3, centerY + 4);
  context.moveTo(iconX - 7, centerY - 2);
  context.quadraticCurveTo(iconX - 11, centerY, iconX - 7, centerY + 3);
  context.moveTo(iconX + 7, centerY - 2);
  context.quadraticCurveTo(iconX + 11, centerY, iconX + 7, centerY + 3);
  context.stroke();
  context.strokeStyle = primary;
  context.lineWidth = 3;
  const waveformStart = 54;
  const waveHeights = [4, 13, 20, 12, 5];
  waveHeights.forEach((barHeight, index) => {
    const x = waveformStart + index * 9;
    context.beginPath();
    context.moveTo(x, centerY - barHeight / 2);
    context.lineTo(x, centerY + barHeight / 2);
    context.stroke();
  });
  context.fillStyle = text;
  context.font = "700 11px Arial, sans-serif";
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillText("AUDIO", 106, centerY - 4);
  context.fillStyle = muted;
  context.font = "10px Arial, sans-serif";
  context.fillText(formatExcaliburAudioDuration(attachment.durationMs), 106, centerY + 12);
  context.restore();
};
`;

const audioDrawerProd = String.raw`;var excaliburFormatAudioDuration = (durationMs) => {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "Audio";
  }
  const totalSeconds = Math.max(0, Math.round(durationMs / 1e3));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return minutes + ":" + seconds;
};
var excaliburDrawRoundedRect = (context, x, y, width, height, radius) => {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  if (context.roundRect) {
    context.roundRect(x, y, width, height, safeRadius);
    return;
  }
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
};
var excaliburDrawAudioElement = (element, context, appState) => {
  const attachment = element.customData?.excaliburAttachment || {};
  const isDark = appState?.theme === "dark";
  const rawWidth = Number.isFinite(element.width) ? element.width : 148;
  const rawHeight = Number.isFinite(element.height) ? element.height : 58;
  const signX = rawWidth < 0 ? -1 : 1;
  const signY = rawHeight < 0 ? -1 : 1;
  const width = Math.max(1, Math.abs(rawWidth || 148));
  const height = Math.max(1, Math.abs(rawHeight || 58));
  const radius = Math.min(10, width / 7, height / 4);
  const cardFill = isDark ? "#2f3433" : "#ffffff";
  const iconFill = isDark ? "#1f2423" : "#eef7f6";
  const primary = "#80cbc4";
  const text = isDark ? "#eaffff" : "#102322";
  const muted = isDark ? "#b8c6c4" : "#526461";
  context.save();
  if (signX < 0 || signY < 0) {
    context.scale(signX, signY);
    context.translate(signX < 0 ? -width : 0, signY < 0 ? -height : 0);
  }
  context.lineWidth = 1.5;
  context.fillStyle = cardFill;
  context.strokeStyle = primary;
  excaliburDrawRoundedRect(context, 0.75, 0.75, width - 1.5, height - 1.5, radius);
  context.fill();
  context.stroke();
  excaliburDrawRoundedRect(context, 0.75, 0.75, width - 1.5, height - 1.5, radius);
  context.clip();
  const baseWidth = 148;
  const baseHeight = 58;
  const padding = Math.min(12, Math.max(4, Math.min(width, height) * 0.08));
  const contentScale = Math.max(
    0.18,
    Math.min(
      3,
      Math.min(
        Math.max(1, width - padding * 2) / baseWidth,
        Math.max(1, height - padding * 2) / baseHeight,
      ),
    ),
  );
  context.translate(
    (width - baseWidth * contentScale) / 2,
    (height - baseHeight * contentScale) / 2,
  );
  context.scale(contentScale, contentScale);
  const centerY = baseHeight / 2;
  const iconRadius = 17;
  const iconX = 27;
  context.beginPath();
  context.arc(iconX, centerY, iconRadius, 0, Math.PI * 2);
  context.fillStyle = iconFill;
  context.fill();
  context.strokeStyle = primary;
  context.stroke();
  context.strokeStyle = text;
  context.lineWidth = 1.8;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(iconX - 3, centerY - 7);
  context.lineTo(iconX - 3, centerY + 4);
  context.moveTo(iconX + 3, centerY - 7);
  context.lineTo(iconX + 3, centerY + 4);
  context.moveTo(iconX - 7, centerY - 2);
  context.quadraticCurveTo(iconX - 11, centerY, iconX - 7, centerY + 3);
  context.moveTo(iconX + 7, centerY - 2);
  context.quadraticCurveTo(iconX + 11, centerY, iconX + 7, centerY + 3);
  context.stroke();
  context.strokeStyle = primary;
  context.lineWidth = 3;
  const waveformStart = 54;
  const waveHeights = [4, 13, 20, 12, 5];
  waveHeights.forEach((barHeight, index) => {
    const x = waveformStart + index * 9;
    context.beginPath();
    context.moveTo(x, centerY - barHeight / 2);
    context.lineTo(x, centerY + barHeight / 2);
    context.stroke();
  });
  context.fillStyle = text;
  context.font = "700 11px Arial, sans-serif";
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillText("AUDIO", 106, centerY - 4);
  context.fillStyle = muted;
  context.font = "10px Arial, sans-serif";
  context.fillText(excaliburFormatAudioDuration(attachment.durationMs), 106, centerY + 12);
  context.restore();
};
`;

function replaceOnce(content, search, replacement, file, label) {
  if (content.includes(replacement)) {
    return content;
  }

  const index = content.indexOf(search);
  if (index === -1) {
    throw new Error(`Could not find ${label} in ${file}`);
  }

  return content.slice(0, index) + replacement + content.slice(index + search.length);
}

function replaceAll(content, search, replacement, file, label) {
  if (content.includes(replacement) && !content.includes(search)) {
    return content;
  }

  const next = content.split(search).join(replacement);
  if (next === content) {
    throw new Error(`Could not find ${label} in ${file}`);
  }

  return next;
}

function replaceOptional(content, search, replacement) {
  if (content.includes(replacement)) {
    return content;
  }

  return content.includes(search) ? content.replace(search, replacement) : content;
}

function patchFile(file, transforms) {
  if (!existsSync(file)) {
    throw new Error(`Missing Excalidraw bundle file: ${file}`);
  }

  const original = readFileSync(file, "utf8");
  const patched = transforms.reduce((content, transform) => transform(content, file), original);

  if (patched !== original) {
    writeFileSync(file, patched);
    console.log(`patched ${file}`);
  }
}

const rep = (search, replacement, label) => (content, file) =>
  replaceOnce(content, search, replacement, file, label);
const repAll = (search, replacement, label) => (content, file) =>
  replaceAll(content, search, replacement, file, label);
const repOptional = (search, replacement) => (content) =>
  replaceOptional(content, search, replacement);

function patchDevAudioDrawer(content, file) {
  const startMarker = "\nvar formatExcaliburAudioDuration = (durationMs) => {";
  const drawMarker = "\nvar drawElementOnCanvas =";
  const start = content.indexOf(startMarker);
  const drawIndex = content.indexOf(drawMarker, start === -1 ? 0 : start);

  if (start !== -1 && drawIndex !== -1 && start < drawIndex) {
    return content.slice(0, start) + audioDrawerDev + content.slice(drawIndex);
  }

  return replaceOnce(
    content,
    drawMarker,
    `${audioDrawerDev}${drawMarker}`,
    file,
    "audio canvas drawer",
  );
}

function patchProdAudioDrawer(content, file) {
  const startMarkers = [
    ";var excaliburFormatAudioDuration=",
    ";var excaliburFormatAudioDuration =",
  ];
  const drawMarker = ";var ni=(e,t,n,r,o)=>{switch(e.type)";
  const start = startMarkers
    .map((marker) => content.indexOf(marker))
    .filter((index) => index !== -1)
    .sort((a, b) => a - b)[0] ?? -1;
  const drawIndex = content.indexOf(drawMarker, start === -1 ? 0 : start);

  if (start !== -1 && drawIndex !== -1 && start < drawIndex) {
    return content.slice(0, start) + audioDrawerProd + content.slice(drawIndex);
  }

  return replaceOnce(
    content,
    "},ni=(e,t,n,r,o)=>{switch(e.type)",
    `}${audioDrawerProd};var ni=(e,t,n,r,o)=>{switch(e.type)`,
    file,
    "prod audio canvas drawer",
  );
}

const devAudioShapeAfterEraser =
  'value: "image",\n    key: null,\n    numericKey: KEYS["9"],\n    fillable: false\n  },\n  {\n    icon: EraserIcon,\n    value: "eraser",\n    key: KEYS.E,\n    numericKey: KEYS["0"],\n    fillable: false\n  },\n  {\n    icon: microphoneIcon,\n    value: "audio",\n    key: null,\n    numericKey: null,\n    fillable: false\n  }\n];';

const prodAudioShapeAfterEraser =
  '{icon:Kd,value:"image",key:null,numericKey:Q[9],fillable:!1},{icon:Hd,value:"eraser",key:Q.E,numericKey:Q[0],fillable:!1},{icon:H4,value:"audio",key:null,numericKey:null,fillable:!1}]';

patchFile(files.devCore, [
  rep(
    '"image"\n]);',
    '"image",\n  "audio"\n]);',
    "library disabled audio type",
  ),
  rep(
    'image: "image",\n  eraser: "eraser",',
    'image: "image",\n  audio: "audio",\n  eraser: "eraser",',
    "TOOL_TYPE audio",
  ),
  rep(
    'return isDraggableFromInside || isImageElement(element);',
    'return isDraggableFromInside || isImageElement(element) || element.type === "audio";',
    "audio inside hit target",
  ),
  repOptional(
    'value: "image",\n    key: null,\n    numericKey: KEYS["9"],\n    fillable: false\n  },\n  {\n    icon: microphoneIcon,\n    value: "audio",\n    key: null,\n    numericKey: null,\n    fillable: false\n  },\n  {\n    icon: EraserIcon,\n    value: "eraser",\n    key: KEYS.E,\n    numericKey: KEYS["0"],\n    fillable: false\n  }\n];',
    devAudioShapeAfterEraser,
  ),
  rep(
    'value: "image",\n    key: null,\n    numericKey: KEYS["9"],\n    fillable: false\n  },\n  {\n    icon: EraserIcon,\n    value: "eraser",\n    key: KEYS.E,\n    numericKey: KEYS["0"],\n    fillable: false\n  }\n];',
    devAudioShapeAfterEraser,
    "audio toolbar shape",
  ),
  repAll(
    'element.type === "image" || element.type === "iframe"',
    'element.type === "image" || element.type === "audio" || element.type === "iframe"',
    "audio rectanguloid checks",
  ),
  rep(
    'case "magicframe":\n    case "image":\n    case "selection":',
    'case "magicframe":\n    case "image":\n    case "audio":\n    case "selection":',
    "audio element type check",
  ),
  rep(
    'case "embeddable":\n    case "image":\n    case "iframe":',
    'case "embeddable":\n    case "image":\n    case "audio":\n    case "iframe":',
    "audio polygon shape",
  ),
  rep(
    'case "rectangle":\n    case "image":\n    case "text":',
    'case "rectangle":\n    case "image":\n    case "audio":\n    case "text":',
    "audio rect intersection",
  ),
  patchDevAudioDrawer,
  rep(
    'case "image": {\n      const img =',
    'case "audio": {\n      drawExcaliburAudioElement(element, context, appState);\n      break;\n    }\n    case "image": {\n      const img =',
    "audio draw switch",
  ),
  rep(
    'case "arrow":\n    case "image":\n    case "text":',
    'case "arrow":\n    case "image":\n    case "audio":\n    case "text":',
    "audio render switch",
  ),
  rep(
    'case "text":\n    case "image": {',
    'case "text":\n    case "image":\n    case "audio": {',
    "audio null shape",
  ),
  rep(
    'image: true,\n  arrow: true,',
    'image: true,\n  audio: true,\n  arrow: true,',
    "audio restored active tool",
  ),
  rep(
    'case "image":\n      return restoreElementWithProperties(element, {\n        status: element.status || "pending",\n        fileId: element.fileId,\n        scale: element.scale || [1, 1],\n        crop: element.crop ?? null\n      });\n    case "line":',
    'case "image":\n      return restoreElementWithProperties(element, {\n        status: element.status || "pending",\n        fileId: element.fileId,\n        scale: element.scale || [1, 1],\n        crop: element.crop ?? null\n      });\n    case "audio":\n      return restoreElementWithProperties(element, {});\n    case "line":',
    "audio restore",
  ),
]);

patchFile(files.prodCore, [
  rep('JE=new Set(["iframe","embeddable","image"])', 'JE=new Set(["iframe","embeddable","image","audio"])', "prod library disabled audio type"),
  rep('image:"image",eraser:"eraser"', 'image:"image",audio:"audio",eraser:"eraser"', "prod TOOL_TYPE audio"),
  rep(
    'return e.type==="line"?t&&Kt(e.points):e.type==="freedraw"?t&&Kt(e.points):t||Ye(e)}',
    'return e.type==="line"?t&&Kt(e.points):e.type==="freedraw"?t&&Kt(e.points):t||Ye(e)||e.type==="audio"}',
    "prod audio inside hit target",
  ),
  repOptional(
    '{icon:Kd,value:"image",key:null,numericKey:Q[9],fillable:!1},{icon:H4,value:"audio",key:null,numericKey:null,fillable:!1},{icon:Hd,value:"eraser",key:Q.E,numericKey:Q[0],fillable:!1}]',
    prodAudioShapeAfterEraser,
  ),
  rep(
    '{icon:Kd,value:"image",key:null,numericKey:Q[9],fillable:!1},{icon:Hd,value:"eraser",key:Q.E,numericKey:Q[0],fillable:!1}]',
    prodAudioShapeAfterEraser,
    "prod audio toolbar shape",
  ),
  repAll(
    'e.type==="image"||e.type==="iframe"',
    'e.type==="image"||e.type==="audio"||e.type==="iframe"',
    "prod audio rectanguloid checks",
  ),
  rep(
    'case"magicframe":case"image":case"selection"',
    'case"magicframe":case"image":case"audio":case"selection"',
    "prod audio element type check",
  ),
  rep(
    'case"embeddable":case"image":case"iframe"',
    'case"embeddable":case"image":case"audio":case"iframe"',
    "prod audio polygon shape",
  ),
  rep(
    'case"rectangle":case"image":case"text":case"iframe":case"embeddable":case"frame":case"magicframe"',
    'case"rectangle":case"image":case"audio":case"text":case"iframe":case"embeddable":case"frame":case"magicframe"',
    "prod audio rect intersection",
  ),
  patchProdAudioDrawer,
  rep(
    'case"image":{let i=At(e)?r.imageCache.get(e.fileId)?.image:void 0;',
    'case"audio":{excaliburDrawAudioElement(e,n,o);break}case"image":{let i=At(e)?r.imageCache.get(e.fileId)?.image:void 0;',
    "prod audio draw switch",
  ),
  rep(
    'case"rectangle":case"diamond":case"ellipse":case"line":case"arrow":case"image":case"text":case"iframe":case"embeddable"',
    'case"rectangle":case"diamond":case"ellipse":case"line":case"arrow":case"image":case"audio":case"text":case"iframe":case"embeddable"',
    "prod audio render switch",
  ),
  rep(
    'case"frame":case"magicframe":case"text":case"image":return null;',
    'case"frame":case"magicframe":case"text":case"image":case"audio":return null;',
    "prod audio null shape",
  ),
  rep(
    'image:!0,arrow:!0',
    'image:!0,audio:!0,arrow:!0',
    "prod audio restored active tool",
  ),
  rep(
    'case"image":return wn(e,{status:e.status||"pending",fileId:e.fileId,scale:e.scale||[1,1],crop:e.crop??null});case"line":',
    'case"image":return wn(e,{status:e.status||"pending",fileId:e.fileId,scale:e.scale||[1,1],crop:e.crop??null});case"audio":return wn(e,{});case"line":',
    "prod audio restore",
  ),
]);

patchFile(files.devIndex, [
  rep(
    'const label = t(`toolBar.${value}`);',
    'const label = value === "audio" ? "Audio" : t(`toolBar.${value}`);',
    "dev audio toolbar label",
  ),
  rep(
    'label: t(`toolBar.${value}`),',
    'label: value === "audio" ? "Audio" : t(`toolBar.${value}`),',
    "dev audio command label",
  ),
]);

patchFile(files.prodIndex, [
  rep(
    'let b=g(`toolBar.${m}`),',
    'let b=m==="audio"?"Audio":g(`toolBar.${m}`),',
    "prod audio toolbar label",
  ),
  rep(
    'label:g(`toolBar.${ge}`),',
    'label:ge==="audio"?"Audio":g(`toolBar.${ge}`),',
    "prod audio command label",
  ),
]);

patchFile(files.types, [
  rep(
    '"image" | "eraser"',
    '"image" | "audio" | "eraser"',
    "audio ToolType",
  ),
]);

patchFile(files.constantsTypes, [
  rep(
    'readonly image: "image";\n    readonly eraser: "eraser";',
    'readonly image: "image";\n    readonly audio: "audio";\n    readonly eraser: "eraser";',
    "audio TOOL_TYPE declaration",
  ),
]);

patchFile(files.elementTypes, [
  rep(
    'export type InitializedExcalidrawImageElement = MarkNonNullable<ExcalidrawImageElement, "fileId">;\nexport type ExcalidrawFrameElement',
    'export type InitializedExcalidrawImageElement = MarkNonNullable<ExcalidrawImageElement, "fileId">;\nexport type ExcalidrawAudioElement = _ExcalidrawElementBase & Readonly<{\n    type: "audio";\n}>;\nexport type ExcalidrawFrameElement',
    "audio element declaration",
  ),
  rep(
    'ExcalidrawSelectionElement | ExcalidrawRectangleElement | ExcalidrawDiamondElement | ExcalidrawEllipseElement;',
    'ExcalidrawSelectionElement | ExcalidrawRectangleElement | ExcalidrawDiamondElement | ExcalidrawEllipseElement | ExcalidrawAudioElement;',
    "audio generic element union",
  ),
  rep(
    'ExcalidrawRectangleElement | ExcalidrawImageElement | ExcalidrawTextElement',
    'ExcalidrawRectangleElement | ExcalidrawImageElement | ExcalidrawAudioElement | ExcalidrawTextElement',
    "audio rectanguloid union",
  ),
  rep(
    'ExcalidrawImageElement | ExcalidrawFrameElement',
    'ExcalidrawImageElement | ExcalidrawAudioElement | ExcalidrawFrameElement',
    "audio element union",
  ),
  rep(
    'ExcalidrawTextElement | ExcalidrawImageElement | ExcalidrawIframeElement',
    'ExcalidrawTextElement | ExcalidrawImageElement | ExcalidrawAudioElement | ExcalidrawIframeElement',
    "audio bindable union",
  ),
]);
