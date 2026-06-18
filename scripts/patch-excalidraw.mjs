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

const richTextRendererDev = String.raw`
var getExcaliburTextColorRanges = (element) => {
  const ranges = element.customData?.excaliburTextColorRanges;
  if (!Array.isArray(ranges)) {
    return null;
  }
  const textLength = String(element.originalText ?? element.text ?? "").replace(/\r\n?/g, "\n").length;
  const normalizedRanges = ranges
    .map((range) => ({
      start: Math.max(0, Math.min(textLength, Number(range.start))),
      end: Math.max(0, Math.min(textLength, Number(range.end))),
      color: typeof range.color === "string" ? range.color : "",
    }))
    .filter((range) => range.color && Number.isFinite(range.start) && Number.isFinite(range.end) && range.start < range.end)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  return normalizedRanges.length ? normalizedRanges : null;
};
var getExcaliburColorAtTextOffset = (ranges, offset, fallbackColor) => {
  if (offset == null) {
    return fallbackColor;
  }
  for (let index = ranges.length - 1; index >= 0; index--) {
    const range = ranges[index];
    if (offset >= range.start && offset < range.end) {
      return range.color;
    }
  }
  return fallbackColor;
};
var pushExcaliburRichTextChar = (line, char, color) => {
  const lastSegment = line[line.length - 1];
  if (lastSegment && lastSegment.color === color) {
    lastSegment.text += char;
  } else {
    line.push({ text: char, color });
  }
};
var alignExcaliburOriginalTextOffset = (originalText, renderedChar, originalOffset) => {
  if (originalText[originalOffset] === renderedChar) {
    return originalOffset;
  }
  const maxProbe = Math.min(originalText.length, originalOffset + 16);
  for (let probe = originalOffset + 1; probe < maxProbe; probe++) {
    if (originalText[probe] === renderedChar && originalText.slice(originalOffset, probe).trim() === "") {
      return probe;
    }
  }
  return originalOffset;
};
var getExcaliburRichTextLines = (element) => {
  const ranges = getExcaliburTextColorRanges(element);
  if (!ranges || isRTL(element.text)) {
    return null;
  }
  const renderedText = String(element.text ?? "").replace(/\r\n?/g, "\n");
  const originalText = String(element.originalText ?? element.text ?? "").replace(/\r\n?/g, "\n");
  const lines = [[]];
  let originalOffset = 0;
  for (let index = 0; index < renderedText.length; index++) {
    const char = renderedText[index];
    if (char === "\n") {
      if (originalText[originalOffset] === "\n") {
        originalOffset++;
      }
      lines.push([]);
      continue;
    }
    const alignedOffset = alignExcaliburOriginalTextOffset(originalText, char, originalOffset);
    const color = getExcaliburColorAtTextOffset(ranges, alignedOffset, element.strokeColor);
    pushExcaliburRichTextChar(lines[lines.length - 1], char, color);
    originalOffset = Math.min(originalText.length, alignedOffset + 1);
  }
  return lines;
};
var drawExcaliburRichTextOnCanvas = (element, context, horizontalOffset, lineHeightPx, verticalOffset) => {
  const richTextLines = getExcaliburRichTextLines(element);
  if (!richTextLines) {
    return false;
  }
  const previousTextAlign = context.textAlign;
  context.textAlign = "left";
  for (let index = 0; index < richTextLines.length; index++) {
    const line = richTextLines[index];
    const fullLine = line.map((segment) => segment.text).join("");
    const lineWidth = context.measureText(fullLine).width;
    let cursorX = horizontalOffset;
    if (element.textAlign === "center") {
      cursorX = horizontalOffset - lineWidth / 2;
    } else if (element.textAlign === "right") {
      cursorX = horizontalOffset - lineWidth;
    }
    const y = index * lineHeightPx + verticalOffset;
    for (const segment of line) {
      context.fillStyle = segment.color;
      context.fillText(segment.text, cursorX, y);
      cursorX += context.measureText(segment.text).width;
    }
  }
  context.textAlign = previousTextAlign;
  return true;
};
`;

const richTextRendererProd = String.raw`;var excaliburGetTextColorRanges=e=>{let t=e.customData?.excaliburTextColorRanges;if(!Array.isArray(t))return null;let n=String(e.originalText??e.text??"").replace(/\r\n?/g,"\n").length,r=t.map(o=>({start:Math.max(0,Math.min(n,Number(o.start))),end:Math.max(0,Math.min(n,Number(o.end))),color:typeof o.color=="string"?o.color:""})).filter(o=>o.color&&Number.isFinite(o.start)&&Number.isFinite(o.end)&&o.start<o.end).sort((o,i)=>o.start-i.start||o.end-i.end);return r.length?r:null},excaliburGetColorAtTextOffset=(e,t,n)=>{if(t==null)return n;for(let r=e.length-1;r>=0;r--){let o=e[r];if(t>=o.start&&t<o.end)return o.color}return n},excaliburPushRichTextChar=(e,t,n)=>{let r=e[e.length-1];r&&r.color===n?r.text+=t:e.push({text:t,color:n})},excaliburAlignOriginalTextOffset=(e,t,n)=>{if(e[n]===t)return n;let r=Math.min(e.length,n+16);for(let o=n+1;o<r;o++)if(e[o]===t&&e.slice(n,o).trim()==="")return o;return n},excaliburGetRichTextLines=e=>{let t=excaliburGetTextColorRanges(e);if(!t||Po(e.text))return null;let n=String(e.text??"").replace(/\r\n?/g,"\n"),r=String(e.originalText??e.text??"").replace(/\r\n?/g,"\n"),o=[[]],i=0;for(let a=0;a<n.length;a++){let s=n[a];if(s==="\n"){r[i]==="\n"&&i++,o.push([]);continue}let d=excaliburAlignOriginalTextOffset(r,s,i),c=excaliburGetColorAtTextOffset(t,d,e.strokeColor);excaliburPushRichTextChar(o[o.length-1],s,c),i=Math.min(r.length,d+1)}return o},excaliburDrawRichTextOnCanvas=(e,t,n,r,o)=>{let i=excaliburGetRichTextLines(e);if(!i)return!1;let a=t.textAlign;t.textAlign="left";for(let s=0;s<i.length;s++){let d=i[s],c=d.map(p=>p.text).join(""),l=t.measureText(c).width,U=n;e.textAlign==="center"?U=n-l/2:e.textAlign==="right"&&(U=n-l);let p=s*r+o;for(let m of d)t.fillStyle=m.color,t.fillText(m.text,U,p),U+=t.measureText(m.text).width}return t.textAlign=a,!0};`;

const richTextStrokeDev = String.raw`
var EXCALIBUR_RICH_TEXT_SELECTION_MAX_AGE = 15e3;
var getExcaliburRichTextSelectionTarget = () => {
  return typeof window !== "undefined" ? window : globalThis;
};
var getExcaliburRichTextSelectionState = () => {
  return getExcaliburRichTextSelectionTarget().__excaliburRichTextSelection ?? null;
};
var setExcaliburRichTextSelectionState = (selection) => {
  getExcaliburRichTextSelectionTarget().__excaliburRichTextSelection = selection;
};
var clearExcaliburRichTextSelectionState = () => {
  delete getExcaliburRichTextSelectionTarget().__excaliburRichTextSelection;
};
var getExcaliburWysiwygSelection = (editable) => {
  const cachedStart = Number(editable.dataset.excaliburSelectionStart);
  const cachedEnd = Number(editable.dataset.excaliburSelectionEnd);
  const liveStart = editable.selectionStart;
  const liveEnd = editable.selectionEnd;
  const start = Number.isFinite(liveStart) && liveStart !== liveEnd ? liveStart : cachedStart;
  const end = Number.isFinite(liveEnd) && liveStart !== liveEnd ? liveEnd : cachedEnd;
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  return {
    start: Math.max(0, Math.min(start, end)),
    end: Math.max(0, Math.max(start, end)),
  };
};
var rememberExcaliburWysiwygSelection = (elementId, editable) => {
  const liveStart = editable.selectionStart;
  const liveEnd = editable.selectionEnd;
  if (Number.isFinite(liveStart) && Number.isFinite(liveEnd) && liveStart !== liveEnd) {
    editable.dataset.excaliburSelectionStart = String(Math.min(liveStart, liveEnd));
    editable.dataset.excaliburSelectionEnd = String(Math.max(liveStart, liveEnd));
  }
  const selection = getExcaliburWysiwygSelection(editable);
  if (selection && selection.start !== selection.end) {
    setExcaliburRichTextSelectionState({
      elementId,
      start: selection.start,
      end: selection.end,
      text: normalizeText(editable.value),
      updatedAt: Date.now(),
    });
  }
  return selection;
};
var getExcaliburStoredWysiwygSelection = (appState) => {
  const storedSelection = getExcaliburRichTextSelectionState();
  if (!storedSelection || Date.now() - storedSelection.updatedAt > EXCALIBUR_RICH_TEXT_SELECTION_MAX_AGE) {
    return null;
  }
  const editingTextElementId = appState.editingTextElement?.id;
  if (editingTextElementId && editingTextElementId !== storedSelection.elementId) {
    return null;
  }
  const selectedElementIds = appState.selectedElementIds || {};
  if (
    !editingTextElementId &&
    Object.keys(selectedElementIds).length > 0 &&
    !selectedElementIds[storedSelection.elementId]
  ) {
    return null;
  }
  return storedSelection;
};
var normalizeExcaliburTextColorRanges = (ranges, textLength) => {
  if (!Array.isArray(ranges)) {
    return [];
  }
  return ranges
    .map((range) => ({
      start: Math.max(0, Math.min(textLength, Number(range.start))),
      end: Math.max(0, Math.min(textLength, Number(range.end))),
      color: typeof range.color === "string" ? range.color : "",
    }))
    .filter((range) => range.color && Number.isFinite(range.start) && Number.isFinite(range.end) && range.start < range.end)
    .sort((a, b) => a.start - b.start || a.end - b.end);
};
var mergeExcaliburTextColorRanges = (ranges) => {
  const merged = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && previous.end === range.start && previous.color === range.color) {
      previous.end = range.end;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
};
var applyExcaliburTextColorRange = (element, start, end, color, textLength) => {
  const previousRanges = normalizeExcaliburTextColorRanges(
    element.customData?.excaliburTextColorRanges,
    textLength,
  );
  const nextRanges = [];
  for (const range of previousRanges) {
    if (range.end <= start || range.start >= end) {
      nextRanges.push(range);
      continue;
    }
    if (range.start < start) {
      nextRanges.push({ start: range.start, end: start, color: range.color });
    }
    if (range.end > end) {
      nextRanges.push({ start: end, end: range.end, color: range.color });
    }
  }
  if (color !== element.strokeColor) {
    nextRanges.push({ start, end, color });
  }
  return mergeExcaliburTextColorRanges(
    nextRanges
      .filter((range) => range.start < range.end)
      .sort((a, b) => a.start - b.start || a.end - b.end),
  );
};
var getExcaliburWysiwygTextColorRanges = (element, textValue) => {
  const normalizedText = normalizeText(String(textValue ?? element.originalText ?? element.text ?? ""));
  return normalizeExcaliburTextColorRanges(
    element.customData?.excaliburTextColorRanges,
    normalizedText.length,
  );
};
var getExcaliburWysiwygColorAtOffset = (ranges, offset, fallbackColor) => {
  for (let index = ranges.length - 1; index >= 0; index--) {
    const range = ranges[index];
    if (offset >= range.start && offset < range.end) {
      return range.color;
    }
  }
  return fallbackColor;
};
var appendExcaliburWysiwygMirrorSegment = (mirror, text, color) => {
  const span = mirror.ownerDocument.createElement("span");
  span.textContent = text;
  span.style.color = color;
  mirror.appendChild(span);
};
var renderExcaliburWysiwygMirrorText = (mirror, text, ranges, fallbackColor) => {
  mirror.replaceChildren();
  const normalizedText = normalizeText(String(text ?? ""));
  if (!normalizedText) {
    appendExcaliburWysiwygMirrorSegment(mirror, "\u200b", fallbackColor);
    return;
  }
  let pendingText = "";
  let pendingColor = null;
  const flushPending = () => {
    if (pendingText) {
      appendExcaliburWysiwygMirrorSegment(mirror, pendingText, pendingColor || fallbackColor);
      pendingText = "";
    }
  };
  for (let offset = 0; offset < normalizedText.length; offset++) {
    const char = normalizedText[offset];
    if (char === "\n") {
      flushPending();
      mirror.appendChild(mirror.ownerDocument.createElement("br"));
      if (offset === normalizedText.length - 1) {
        appendExcaliburWysiwygMirrorSegment(mirror, "\u200b", fallbackColor);
      }
      continue;
    }
    const color = getExcaliburWysiwygColorAtOffset(ranges, offset, fallbackColor);
    if (pendingColor !== color) {
      flushPending();
      pendingColor = color;
    }
    pendingText += char;
  }
  flushPending();
};
var createExcaliburWysiwygMirror = () => {
  const mirror = document.createElement("div");
  mirror.className = "excalibur-rich-text-wysiwyg-mirror";
  Object.assign(mirror.style, {
    position: "absolute",
    display: "none",
    minHeight: "1em",
    backfaceVisibility: "hidden",
    margin: 0,
    padding: 0,
    border: 0,
    outline: 0,
    resize: "none",
    background: "transparent",
    overflow: "hidden",
    pointerEvents: "none",
    userSelect: "none",
    zIndex: "var(--zIndex-wysiwyg)",
    boxSizing: "content-box",
  });
  return mirror;
};
var syncExcaliburWysiwygMirror = (mirror, editable, element, updatedTextElement = element) => {
  const sourceElement = updatedTextElement || element;
  const ranges = getExcaliburWysiwygTextColorRanges(sourceElement, editable.value);
  editable.style.caretColor = sourceElement.strokeColor;
  if (!ranges.length) {
    mirror.style.display = "none";
    editable.style.color = sourceElement.strokeColor;
    editable.style.webkitTextFillColor = "";
    return;
  }
  const copiedStyleProperties = [
    "font",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "lineHeight",
    "width",
    "height",
    "left",
    "top",
    "transform",
    "textAlign",
    "verticalAlign",
    "opacity",
    "filter",
    "maxHeight",
    "wordBreak",
    "whiteSpace",
    "overflowWrap",
  ];
  for (const property of copiedStyleProperties) {
    mirror.style[property] = editable.style[property];
  }
  mirror.dir = editable.dir;
  mirror.style.display = editable.style.display || "inline-block";
  mirror.style.color = sourceElement.strokeColor;
  renderExcaliburWysiwygMirrorText(mirror, editable.value, ranges, sourceElement.strokeColor);
  editable.style.color = "transparent";
  editable.style.webkitTextFillColor = "transparent";
};
var createExcaliburPartialTextStrokeResult = (elements, appState, value, app) => {
  const nextColor = value?.currentItemStrokeColor;
  const editingTextElement = appState.editingTextElement;
  if (!nextColor) {
    return null;
  }
  let targetElementId = editingTextElement && isTextElement(editingTextElement) ? editingTextElement.id : null;
  let selection = null;
  let textValue = null;
  const editable = app?.excalidrawContainerRef?.current?.querySelector("textarea.excalidraw-wysiwyg");
  const editableElementId = editable instanceof HTMLTextAreaElement ? editable.dataset.excaliburElementId : null;
  if (editable instanceof HTMLTextAreaElement && (targetElementId || editableElementId)) {
    targetElementId = targetElementId || editableElementId;
    selection = rememberExcaliburWysiwygSelection(targetElementId, editable);
    textValue = normalizeText(editable.value);
  }
  const storedSelection = getExcaliburStoredWysiwygSelection(appState);
  if ((!selection || selection.start === selection.end || !targetElementId) && storedSelection) {
    targetElementId = storedSelection.elementId;
    selection = {
      start: storedSelection.start,
      end: storedSelection.end,
    };
    textValue = normalizeText(storedSelection.text ?? "");
  }
  if (!selection || selection.start === selection.end || !targetElementId) {
    return null;
  }
  const element = elements.find((candidate) => candidate.id === targetElementId);
  if (!element || !isTextElement(element)) {
    return null;
  }
  textValue = textValue || normalizeText(element.originalText ?? element.text ?? "");
  const textLength = textValue.length;
  const selectedStart = Math.min(selection.start, textValue.length);
  const selectedEnd = Math.min(selection.end, textValue.length);
  if (selectedStart === selectedEnd) {
    return null;
  }
  const isWholeTextSelection = selectedStart === 0 && selectedEnd === textLength;
  const nextRanges = isWholeTextSelection
    ? []
    : applyExcaliburTextColorRange(element, selectedStart, selectedEnd, nextColor, textLength);
  const nextCustomData = { ...(element.customData || {}) };
  if (nextRanges.length) {
    nextCustomData.excaliburTextColorRanges = nextRanges;
  } else {
    delete nextCustomData.excaliburTextColorRanges;
  }
  const nextElement = newElementWith(
    element,
    {
      strokeColor: isWholeTextSelection ? nextColor : element.strokeColor,
      customData: nextCustomData,
    },
    true,
  );
  clearExcaliburRichTextSelectionState();
  if (editable instanceof HTMLTextAreaElement) {
    window.setTimeout(() => {
      editable.dispatchEvent(new Event("excalibur-rich-text-format-applied"));
    });
  }
  return {
    elements: elements.map((candidate) => candidate.id === element.id ? nextElement : candidate),
    appState: {
      ...appState,
      ...value,
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  };
};
`;

const richTextStrokeProd = String.raw`;var EXCALIBUR_RICH_TEXT_SELECTION_MAX_AGE=15e3,excaliburGetRichTextSelectionTarget=()=>typeof window!="undefined"?window:globalThis,excaliburGetRichTextSelectionState=()=>excaliburGetRichTextSelectionTarget().__excaliburRichTextSelection??null,excaliburSetRichTextSelectionState=e=>{excaliburGetRichTextSelectionTarget().__excaliburRichTextSelection=e},excaliburClearRichTextSelectionState=()=>{delete excaliburGetRichTextSelectionTarget().__excaliburRichTextSelection},excaliburGetWysiwygSelection=e=>{let o=Number(e.dataset.excaliburSelectionStart),t=Number(e.dataset.excaliburSelectionEnd),r=e.selectionStart,n=e.selectionEnd,i=Number.isFinite(r)&&r!==n?r:o,a=Number.isFinite(n)&&r!==n?n:t;return Number.isFinite(i)&&Number.isFinite(a)?{start:Math.max(0,Math.min(i,a)),end:Math.max(0,Math.max(i,a))}:null},excaliburRememberWysiwygSelection=(e,o)=>{let t=o.selectionStart,r=o.selectionEnd;Number.isFinite(t)&&Number.isFinite(r)&&t!==r&&(o.dataset.excaliburSelectionStart=String(Math.min(t,r)),o.dataset.excaliburSelectionEnd=String(Math.max(t,r)));let n=excaliburGetWysiwygSelection(o);return n&&n.start!==n.end&&excaliburSetRichTextSelectionState({elementId:e,start:n.start,end:n.end,text:tn(o.value),updatedAt:Date.now()}),n},excaliburGetStoredWysiwygSelection=e=>{let o=excaliburGetRichTextSelectionState();if(!o||Date.now()-o.updatedAt>EXCALIBUR_RICH_TEXT_SELECTION_MAX_AGE)return null;let t=e.editingTextElement?.id,r=e.selectedElementIds||{};return t&&t!==o.elementId?null:!t&&Object.keys(r).length>0&&!r[o.elementId]?null:o},excaliburNormalizeTextColorRanges=(e,o)=>Array.isArray(e)?e.map(t=>({start:Math.max(0,Math.min(o,Number(t.start))),end:Math.max(0,Math.min(o,Number(t.end))),color:typeof t.color=="string"?t.color:""})).filter(t=>t.color&&Number.isFinite(t.start)&&Number.isFinite(t.end)&&t.start<t.end).sort((t,r)=>t.start-r.start||t.end-r.end):[],excaliburMergeTextColorRanges=e=>{let o=[];for(let t of e){let r=o[o.length-1];r&&r.end===t.start&&r.color===t.color?r.end=t.end:o.push({...t})}return o},excaliburApplyTextColorRange=(e,o,t,r,n)=>{let i=excaliburNormalizeTextColorRanges(e.customData?.excaliburTextColorRanges,n),a=[];for(let l of i)l.end<=o||l.start>=t?a.push(l):(l.start<o&&a.push({start:l.start,end:o,color:l.color}),l.end>t&&a.push({start:t,end:l.end,color:l.color}));return r!==e.strokeColor&&a.push({start:o,end:t,color:r}),excaliburMergeTextColorRanges(a.filter(l=>l.start<l.end).sort((l,s)=>l.start-s.start||l.end-s.end))},excaliburGetWysiwygTextColorRanges=(e,o)=>excaliburNormalizeTextColorRanges(e.customData?.excaliburTextColorRanges,tn(String(o??e.originalText??e.text??"")).length),excaliburGetWysiwygColorAtOffset=(e,o,t)=>{for(let r=e.length-1;r>=0;r--){let n=e[r];if(o>=n.start&&o<n.end)return n.color}return t},excaliburAppendWysiwygMirrorSegment=(e,o,t)=>{let r=e.ownerDocument.createElement("span");r.textContent=o,r.style.color=t,e.appendChild(r)},excaliburRenderWysiwygMirrorText=(e,o,t,r)=>{e.replaceChildren();let n=tn(String(o??""));if(!n){excaliburAppendWysiwygMirrorSegment(e,"\u200b",r);return}let i="",a=null,l=()=>{i&&(excaliburAppendWysiwygMirrorSegment(e,i,a||r),i="")};for(let s=0;s<n.length;s++){let c=n[s];if(c==="\n"){l(),e.appendChild(e.ownerDocument.createElement("br")),s===n.length-1&&excaliburAppendWysiwygMirrorSegment(e,"\u200b",r);continue}let m=excaliburGetWysiwygColorAtOffset(t,s,r);a!==m&&(l(),a=m),i+=c}l()},excaliburCreateWysiwygMirror=()=>{let e=document.createElement("div");return e.className="excalibur-rich-text-wysiwyg-mirror",Object.assign(e.style,{position:"absolute",display:"none",minHeight:"1em",backfaceVisibility:"hidden",margin:0,padding:0,border:0,outline:0,resize:"none",background:"transparent",overflow:"hidden",pointerEvents:"none",userSelect:"none",zIndex:"var(--zIndex-wysiwyg)",boxSizing:"content-box"}),e},excaliburSyncWysiwygMirror=(e,o,t,r=t)=>{let n=r||t,i=excaliburGetWysiwygTextColorRanges(n,o.value);if(o.style.caretColor=n.strokeColor,!i.length){e.style.display="none",o.style.color=n.strokeColor,o.style.webkitTextFillColor="";return}for(let a of["font","fontFamily","fontSize","fontWeight","fontStyle","lineHeight","width","height","left","top","transform","textAlign","verticalAlign","opacity","filter","maxHeight","wordBreak","whiteSpace","overflowWrap"])e.style[a]=o.style[a];e.dir=o.dir,e.style.display=o.style.display||"inline-block",e.style.color=n.strokeColor,excaliburRenderWysiwygMirrorText(e,o.value,i,n.strokeColor),o.style.color="transparent",o.style.webkitTextFillColor="transparent"},excaliburPartialTextStroke=(e,o,t,r)=>{let n=t?.currentItemStrokeColor;if(!n)return null;let i=o.editingTextElement,a=i&&Y(i)?i.id:null,l=null,s=null,c=r?.excalidrawContainerRef?.current?.querySelector("textarea.excalidraw-wysiwyg"),m=c instanceof HTMLTextAreaElement?c.dataset.excaliburElementId:null;c instanceof HTMLTextAreaElement&&(a||m)&&(a=a||m,l=excaliburRememberWysiwygSelection(a,c),s=tn(c.value));let d=excaliburGetStoredWysiwygSelection(o);if((!l||l.start===l.end||!a)&&d&&(a=d.elementId,l={start:d.start,end:d.end},s=tn(d.text??"")),!l||l.start===l.end||!a)return null;let p=e.find(u=>u.id===a);if(!p||!Y(p))return null;s=s||tn(p.originalText??p.text??"");let u=s.length,h=Math.min(l.start,u),f=Math.min(l.end,u);if(h===f)return null;let b=h===0&&f===u,x=b?[]:excaliburApplyTextColorRange(p,h,f,n,u),T={...(p.customData||{})};x.length?T.excaliburTextColorRanges=x:delete T.excaliburTextColorRanges;let w=q(p,{strokeColor:b?n:p.strokeColor,customData:T},!0);return excaliburClearRichTextSelectionState(),c instanceof HTMLTextAreaElement&&setTimeout(()=>{c.dispatchEvent(new Event("excalibur-rich-text-format-applied"))}),{elements:e.map(C=>C.id===p.id?w:C),appState:{...o,...t},captureUpdate:L.IMMEDIATELY}};`;

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

function patchDevRichTextRenderer(content, file) {
  const startMarker = "\nvar getExcaliburTextColorRanges =";
  const drawMarker = "\nvar drawElementOnCanvas =";
  const start = content.indexOf(startMarker);
  const drawIndex = content.indexOf(drawMarker, start === -1 ? 0 : start);

  if (start !== -1 && drawIndex !== -1 && start < drawIndex) {
    return content.slice(0, start) + richTextRendererDev + content.slice(drawIndex);
  }

  return replaceOnce(
    content,
    drawMarker,
    `${richTextRendererDev}${drawMarker}`,
    file,
    "rich text canvas renderer",
  );
}

function patchProdRichTextRenderer(content, file) {
  const startMarker = ";var excaliburGetTextColorRanges=";
  const drawMarker = ";var ni=(e,t,n,r,o)=>{switch(e.type)";
  const start = content.indexOf(startMarker);
  const drawIndex = content.indexOf(drawMarker, start === -1 ? 0 : start);

  if (start !== -1 && drawIndex !== -1 && start < drawIndex) {
    return content.slice(0, start) + richTextRendererProd + content.slice(drawIndex);
  }

  return replaceOnce(
    content,
    drawMarker,
    `${richTextRendererProd}${drawMarker}`,
    file,
    "prod rich text canvas renderer",
  );
}

function patchDevRichTextStrokeHelper(content, file) {
  const startMarker = "\nvar EXCALIBUR_RICH_TEXT_SELECTION_MAX_AGE =";
  const legacyStartMarker = "\nvar getExcaliburWysiwygSelection =";
  const actionMarker = "\nvar actionChangeStrokeColor = register({";
  let start = content.indexOf(startMarker);
  if (start === -1) {
    start = content.indexOf(legacyStartMarker);
  }
  const actionIndex = content.indexOf(actionMarker, start === -1 ? 0 : start);

  if (start !== -1 && actionIndex !== -1 && start < actionIndex) {
    return content.slice(0, start) + richTextStrokeDev + content.slice(actionIndex);
  }

  return replaceOnce(
    content,
    actionMarker,
    `${richTextStrokeDev}${actionMarker}`,
    file,
    "dev partial text stroke helper",
  );
}

function patchProdRichTextStrokeHelper(content, file) {
  const startMarker = ";var EXCALIBUR_RICH_TEXT_SELECTION_MAX_AGE=";
  const legacyStartMarker = ";var excaliburGetWysiwygSelection=";
  const actionMarker = 'var U2=D({name:"changeStrokeColor"';
  let start = content.indexOf(startMarker);
  if (start === -1) {
    start = content.indexOf(legacyStartMarker);
  }
  const actionIndex = content.indexOf(actionMarker, start === -1 ? 0 : start);

  if (start !== -1 && actionIndex !== -1 && start < actionIndex) {
    return content.slice(0, start) + richTextStrokeProd + content.slice(actionIndex);
  }

  return replaceOnce(
    content,
    ',U2=D({name:"changeStrokeColor"',
    `${richTextStrokeProd}var U2=D({name:"changeStrokeColor"`,
    file,
    "prod partial text stroke helper",
  );
}

function patchDevRichTextWysiwygMirror(content, file) {
  content = replaceOnce(
    content,
    '      if (isTestEnv()) {\n        editable.style.fontFamily = getFontFamilyString(updatedTextElement);\n      }\n      mutateElement(updatedTextElement, { x: coordX, y: coordY });',
    '      if (isTestEnv()) {\n        editable.style.fontFamily = getFontFamilyString(updatedTextElement);\n      }\n      syncExcaliburWysiwygMirror(excaliburWysiwygMirror, editable, element, updatedTextElement);\n      mutateElement(updatedTextElement, { x: coordX, y: coordY });',
    file,
    "dev rich text wysiwyg mirror sync",
  );
  content = replaceOnce(
    content,
    '  Object.assign(editable.style, {\n    position: "absolute",\n    display: "inline-block",\n    minHeight: "1em",\n    backfaceVisibility: "hidden",\n    margin: 0,\n    padding: 0,\n    border: 0,\n    outline: 0,\n    resize: "none",\n    background: "transparent",\n    overflow: "hidden",\n    // must be specified because in dark mode canvas creates a stacking context\n    zIndex: "var(--zIndex-wysiwyg)",\n    wordBreak,\n    // prevent line wrapping (`whitespace: nowrap` doesn\'t work on FF)\n    whiteSpace,\n    overflowWrap: "break-word",\n    boxSizing: "content-box"\n  });\n  editable.dataset.excaliburElementId = element.id;',
    '  Object.assign(editable.style, {\n    position: "absolute",\n    display: "inline-block",\n    minHeight: "1em",\n    backfaceVisibility: "hidden",\n    margin: 0,\n    padding: 0,\n    border: 0,\n    outline: 0,\n    resize: "none",\n    background: "transparent",\n    overflow: "hidden",\n    // must be specified because in dark mode canvas creates a stacking context\n    zIndex: "var(--zIndex-wysiwyg)",\n    wordBreak,\n    // prevent line wrapping (`whitespace: nowrap` doesn\'t work on FF)\n    whiteSpace,\n    overflowWrap: "break-word",\n    boxSizing: "content-box"\n  });\n  const excaliburWysiwygMirror = createExcaliburWysiwygMirror();\n  editable.dataset.excaliburElementId = element.id;',
    file,
    "dev rich text wysiwyg mirror creation",
  );
  content = replaceOnce(
    content,
    '      onChange(editable.value);\n    };',
    '      onChange(editable.value);\n      syncExcaliburWysiwygMirror(excaliburWysiwygMirror, editable, element);\n    };',
    file,
    "dev rich text wysiwyg mirror input sync",
  );
  content = replaceOnce(
    content,
    '    unbindUpdate();\n    unbindOnScroll();\n    editable.remove();',
    '    unbindUpdate();\n    unbindOnScroll();\n    excaliburWysiwygMirror.remove();\n    editable.remove();',
    file,
    "dev rich text wysiwyg mirror cleanup",
  );
  return replaceOnce(
    content,
    '  excalidrawContainer?.querySelector(".excalidraw-textEditorContainer").appendChild(editable);',
    '  const textEditorContainer = excalidrawContainer?.querySelector(".excalidraw-textEditorContainer");\n  textEditorContainer?.appendChild(excaliburWysiwygMirror);\n  textEditorContainer?.appendChild(editable);',
    file,
    "dev rich text wysiwyg mirror append",
  );
}

function patchProdRichTextWysiwygMirror(content, file) {
  content = replaceOnce(
    content,
    'sa()&&(d.style.fontFamily=Xr(O)),P(O,{x:ne,y:ge})',
    'sa()&&(d.style.fontFamily=Xr(O)),excaliburSyncWysiwygMirror(excaliburWysiwygMirror,d,n,O),P(O,{x:ne,y:ge})',
    file,
    "prod rich text wysiwyg mirror sync",
  );
  content = replaceOnce(
    content,
    'Object.assign(d.style,{position:"absolute",display:"inline-block",minHeight:"1em",backfaceVisibility:"hidden",margin:0,padding:0,border:0,outline:0,resize:"none",background:"transparent",overflow:"hidden",zIndex:"var(--zIndex-wysiwyg)",wordBreak:u,whiteSpace:p,overflowWrap:"break-word",boxSizing:"content-box"}),d.dataset.excaliburElementId=n.id,',
    'Object.assign(d.style,{position:"absolute",display:"inline-block",minHeight:"1em",backfaceVisibility:"hidden",margin:0,padding:0,border:0,outline:0,resize:"none",background:"transparent",overflow:"hidden",zIndex:"var(--zIndex-wysiwyg)",wordBreak:u,whiteSpace:p,overflowWrap:"break-word",boxSizing:"content-box"});let excaliburWysiwygMirror=excaliburCreateWysiwygMirror();d.dataset.excaliburElementId=n.id,',
    file,
    "prod rich text wysiwyg mirror creation",
  );
  content = replaceOnce(
    content,
    'if(d.value!==F){let O=d.selectionStart;d.value=F,d.selectionStart=O,d.selectionEnd=O}o(d.value)}),d.onkeydown=',
    'if(d.value!==F){let O=d.selectionStart;d.value=F,d.selectionStart=O,d.selectionEnd=O}o(d.value),excaliburSyncWysiwygMirror(excaliburWysiwygMirror,d,n)}),d.onkeydown=',
    file,
    "prod rich text wysiwyg mirror input sync",
  );
  content = replaceOnce(
    content,
    'N(),G(),d.remove()},k=',
    'N(),G(),excaliburWysiwygMirror.remove(),d.remove()},k=',
    file,
    "prod rich text wysiwyg mirror cleanup",
  );
  return replaceOnce(
    content,
    ',a?.querySelector(".excalidraw-textEditorContainer").appendChild(d)};var aT=',
    ';let excaliburTextEditorContainer=a?.querySelector(".excalidraw-textEditorContainer");excaliburTextEditorContainer?.appendChild(excaliburWysiwygMirror),excaliburTextEditorContainer?.appendChild(d)};var aT=',
    file,
    "prod rich text wysiwyg mirror append",
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
  patchDevRichTextRenderer,
  rep(
    'case "image": {\n      const img =',
    'case "audio": {\n      drawExcaliburAudioElement(element, context, appState);\n      break;\n    }\n    case "image": {\n      const img =',
    "audio draw switch",
  ),
  rep(
    '        for (let index = 0; index < lines.length; index++) {\n          context.fillText(\n            lines[index],\n            horizontalOffset,\n            index * lineHeightPx + verticalOffset\n          );\n        }',
    '        if (!drawExcaliburRichTextOnCanvas(element, context, horizontalOffset, lineHeightPx, verticalOffset)) {\n          for (let index = 0; index < lines.length; index++) {\n            context.fillText(\n              lines[index],\n              horizontalOffset,\n              index * lineHeightPx + verticalOffset\n            );\n          }\n        }',
    "rich text canvas draw",
  ),
  rep(
    '        const lines = element.text.replace(/\\r\\n?/g, "\\n").split("\\n");',
    '        const richTextLines = getExcaliburRichTextLines(element);\n        const lines = richTextLines ? richTextLines.map((line) => line.map((segment) => segment.text).join("")) : element.text.replace(/\\r\\n?/g, "\\n").split("\\n");',
    "rich text svg lines",
  ),
  rep(
    '          text.textContent = lines[i];',
    '          const richTextLine = richTextLines?.[i];\n          if (richTextLine) {\n            richTextLine.forEach((segment) => {\n              const tspan = svgRoot.ownerDocument.createElementNS(SVG_NS, "tspan");\n              tspan.textContent = segment.text;\n              tspan.setAttribute("fill", segment.color);\n              text.appendChild(tspan);\n            });\n          } else {\n            text.textContent = lines[i];\n          }',
    "rich text svg tspans",
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
  patchProdRichTextRenderer,
  rep(
    'case"image":{let i=At(e)?r.imageCache.get(e.fileId)?.image:void 0;',
    'case"audio":{excaliburDrawAudioElement(e,n,o);break}case"image":{let i=At(e)?r.imageCache.get(e.fileId)?.image:void 0;',
    "prod audio draw switch",
  ),
  rep(
    'n.fillStyle=e.strokeColor,n.textAlign=e.textAlign;let s=e.text.replace(/\\r\\n?/g,`\n`).split(`\n`),d=e.textAlign==="center"?e.width/2:e.textAlign==="right"?e.width:0,c=Zn(e.fontSize,e.lineHeight),l=Go(e.fontFamily,e.fontSize,c);for(let U=0;U<s.length;U++)n.fillText(s[U],d,U*c+l);n.restore()',
    'n.fillStyle=e.strokeColor,n.textAlign=e.textAlign;let s=e.text.replace(/\\r\\n?/g,`\n`).split(`\n`),d=e.textAlign==="center"?e.width/2:e.textAlign==="right"?e.width:0,c=Zn(e.fontSize,e.lineHeight),l=Go(e.fontFamily,e.fontSize,c);if(!excaliburDrawRichTextOnCanvas(e,n,d,c,l))for(let U=0;U<s.length;U++)n.fillText(s[U],d,U*c+l);n.restore()',
    "prod rich text canvas draw",
  ),
  rep(
    'let w=e.text.replace(/\\r\\n?/g,`\n`).split(`\n`),I=Zn(e.fontSize,e.lineHeight),S=e.textAlign==="center"?e.width/2:e.textAlign==="right"?e.width:0,v=Go(e.fontFamily,e.fontSize,I),D=Po(e.text)?"rtl":"ltr",$=e.textAlign==="center"?"middle":e.textAlign==="right"||D==="rtl"?"end":"start";',
    'let excaliburRichLines=excaliburGetRichTextLines(e),w=excaliburRichLines?excaliburRichLines.map(N=>N.map(B=>B.text).join("")):e.text.replace(/\\r\\n?/g,`\n`).split(`\n`),I=Zn(e.fontSize,e.lineHeight),S=e.textAlign==="center"?e.width/2:e.textAlign==="right"?e.width:0,v=Go(e.fontFamily,e.fontSize,I),D=Po(e.text)?"rtl":"ltr",$=e.textAlign==="center"?"middle":e.textAlign==="right"||D==="rtl"?"end":"start";',
    "prod rich text svg lines",
  ),
  rep(
    '_.textContent=w[B],_.setAttribute("x",`${S}`)',
    '(excaliburRichLines?.[B]?excaliburRichLines[B].forEach(N=>{let j=r.ownerDocument.createElementNS(re,"tspan");j.textContent=N.text,j.setAttribute("fill",N.color),_.appendChild(j)}):_.textContent=w[B]),_.setAttribute("x",`${S}`)',
    "prod rich text svg tspans",
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
  repOptional(
    '  const cacheExcaliburTextSelection = () => {\n    editable.dataset.excaliburSelectionStart = String(editable.selectionStart);\n    editable.dataset.excaliburSelectionEnd = String(editable.selectionEnd);\n  };\n  ["select", "keyup", "mouseup", "pointerup", "input"].forEach((eventName) => {\n    editable.addEventListener(eventName, cacheExcaliburTextSelection);\n  });\n  editable.value = element.originalText;\n  cacheExcaliburTextSelection();\n  updateWysiwygStyle();',
    '  editable.dataset.excaliburElementId = element.id;\n  const cacheExcaliburTextSelection = () => {\n    rememberExcaliburWysiwygSelection(element.id, editable);\n  };\n  ["select", "keyup", "mouseup", "pointerup", "input", "blur"].forEach((eventName) => {\n    editable.addEventListener(eventName, cacheExcaliburTextSelection);\n  });\n  editable.value = element.originalText;\n  cacheExcaliburTextSelection();\n  updateWysiwygStyle();',
  ),
  repOptional(
    '  const cacheExcaliburTextSelection = () => {\n    rememberExcaliburWysiwygSelection(element.id, editable);\n  };\n  ["select", "keyup", "mouseup", "pointerup", "input", "blur"].forEach((eventName) => {\n    editable.addEventListener(eventName, cacheExcaliburTextSelection);\n  });\n  editable.value = element.originalText;\n  cacheExcaliburTextSelection();\n  updateWysiwygStyle();',
    '  editable.dataset.excaliburElementId = element.id;\n  const cacheExcaliburTextSelection = () => {\n    rememberExcaliburWysiwygSelection(element.id, editable);\n  };\n  ["select", "keyup", "mouseup", "pointerup", "input", "blur"].forEach((eventName) => {\n    editable.addEventListener(eventName, cacheExcaliburTextSelection);\n  });\n  editable.value = element.originalText;\n  cacheExcaliburTextSelection();\n  updateWysiwygStyle();',
  ),
  rep(
    '  editable.value = element.originalText;\n  updateWysiwygStyle();',
    '  editable.dataset.excaliburElementId = element.id;\n  const cacheExcaliburTextSelection = () => {\n    rememberExcaliburWysiwygSelection(element.id, editable);\n  };\n  ["select", "keyup", "mouseup", "pointerup", "input", "blur"].forEach((eventName) => {\n    editable.addEventListener(eventName, cacheExcaliburTextSelection);\n  });\n  editable.value = element.originalText;\n  cacheExcaliburTextSelection();\n  updateWysiwygStyle();',
    "dev wysiwyg selection cache",
  ),
  repOptional(
    '  let isDestroyed = false;\n  editable.addEventListener("excalibur-rich-text-split", () => {\n    if (isDestroyed) {\n      return;\n    }\n    isDestroyed = true;\n    cleanup();\n  });\n  if (autoSelect) {',
    '  let isDestroyed = false;\n  editable.addEventListener("excalibur-rich-text-format-applied", () => {\n    if (isDestroyed) {\n      return;\n    }\n    handleSubmit();\n  });\n  if (autoSelect) {',
  ),
  repOptional(
    '  let isDestroyed = false;\n  if (autoSelect) {',
    '  let isDestroyed = false;\n  editable.addEventListener("excalibur-rich-text-format-applied", () => {\n    if (isDestroyed) {\n      return;\n    }\n    handleSubmit();\n  });\n  if (autoSelect) {',
  ),
  patchDevRichTextStrokeHelper,
  patchDevRichTextWysiwygMirror,
  rep(
    '  perform: (elements, appState, value) => {\n    return {',
    '  perform: (elements, appState, value, app) => {\n    const partialTextStrokeResult = createExcaliburPartialTextStrokeResult(elements, appState, value, app);\n    if (partialTextStrokeResult) {\n      return partialTextStrokeResult;\n    }\n    return {',
    "dev partial text stroke action",
  ),
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
  repOptional(
    'd.value=n.originalText;let excaliburCacheTextSelection=()=>{d.dataset.excaliburSelectionStart=String(d.selectionStart),d.dataset.excaliburSelectionEnd=String(d.selectionEnd)};["select","keyup","mouseup","pointerup","input"].forEach(F=>{d.addEventListener(F,excaliburCacheTextSelection)}),excaliburCacheTextSelection(),m(),o&&',
    'd.dataset.excaliburElementId=n.id,d.value=n.originalText;let excaliburCacheTextSelection=()=>{excaliburRememberWysiwygSelection(n.id,d)};["select","keyup","mouseup","pointerup","input","blur"].forEach(F=>{d.addEventListener(F,excaliburCacheTextSelection)}),excaliburCacheTextSelection(),m(),o&&',
  ),
  repOptional(
    'd.value=n.originalText;let excaliburCacheTextSelection=()=>{excaliburRememberWysiwygSelection(n.id,d)};["select","keyup","mouseup","pointerup","input","blur"].forEach(F=>{d.addEventListener(F,excaliburCacheTextSelection)}),excaliburCacheTextSelection(),m(),o&&',
    'd.dataset.excaliburElementId=n.id,d.value=n.originalText;let excaliburCacheTextSelection=()=>{excaliburRememberWysiwygSelection(n.id,d)};["select","keyup","mouseup","pointerup","input","blur"].forEach(F=>{d.addEventListener(F,excaliburCacheTextSelection)}),excaliburCacheTextSelection(),m(),o&&',
  ),
  rep(
    'd.value=n.originalText,m(),o&&',
    'd.dataset.excaliburElementId=n.id,d.value=n.originalText;let excaliburCacheTextSelection=()=>{excaliburRememberWysiwygSelection(n.id,d)};["select","keyup","mouseup","pointerup","input","blur"].forEach(F=>{d.addEventListener(F,excaliburCacheTextSelection)}),excaliburCacheTextSelection(),m(),o&&',
    "prod wysiwyg selection cache",
  ),
  repOptional(
    'G=l.onScrollChangeEmitter.on(()=>{m()}),H=!1,d.addEventListener("excalibur-rich-text-split",()=>{H||(H=!0,O())});s&&d.select(),k();',
    'G=l.onScrollChangeEmitter.on(()=>{m()}),H=!1;d.addEventListener("excalibur-rich-text-format-applied",()=>{H||I()}),s&&d.select(),k();',
  ),
  repOptional(
    'G=l.onScrollChangeEmitter.on(()=>{m()}),H=!1;d.addEventListener("excalibur-rich-text-split",()=>{H||(H=!0,O())});s&&d.select(),k();',
    'G=l.onScrollChangeEmitter.on(()=>{m()}),H=!1;d.addEventListener("excalibur-rich-text-format-applied",()=>{H||I()}),s&&d.select(),k();',
  ),
  repOptional(
    'G=l.onScrollChangeEmitter.on(()=>{m()}),H=!1;s&&d.select(),k();',
    'G=l.onScrollChangeEmitter.on(()=>{m()}),H=!1;d.addEventListener("excalibur-rich-text-format-applied",()=>{H||I()}),s&&d.select(),k();',
  ),
  repOptional(
    'G=l.onScrollChangeEmitter.on(()=>{m()}),H=!1,d.addEventListener("excalibur-rich-text-format-applied",()=>{H||I()}),s&&d.select(),k();',
    'G=l.onScrollChangeEmitter.on(()=>{m()}),H=!1;d.addEventListener("excalibur-rich-text-format-applied",()=>{H||I()}),s&&d.select(),k();',
  ),
  patchProdRichTextStrokeHelper,
  patchProdRichTextWysiwygMirror,
  rep(
    'perform:(e,o,t)=>({...t.currentItemStrokeColor&&{elements:wt(e,o,r=>Ia(r.type)?q(r,{strokeColor:t.currentItemStrokeColor}):r,!0)},appState:{...o,...t},captureUpdate:t.currentItemStrokeColor?L.IMMEDIATELY:L.EVENTUALLY})',
    'perform:(e,o,t,r)=>excaliburPartialTextStroke(e,o,t,r)||({...t.currentItemStrokeColor&&{elements:wt(e,o,n=>Ia(n.type)?q(n,{strokeColor:t.currentItemStrokeColor}):n,!0)},appState:{...o,...t},captureUpdate:t.currentItemStrokeColor?L.IMMEDIATELY:L.EVENTUALLY})',
    "prod partial text stroke action",
  ),
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
