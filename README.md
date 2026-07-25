# Excalibur

Excalibur is a lightweight desktop whiteboard built on top of the official
Excalidraw canvas package. It keeps the familiar drawing experience while adding
local project organization, file attachments, export tools, and experimental
peer-to-peer collaboration.

## Download

Get the latest release from GitHub:

[Download Excalibur v0.4.9](https://github.com/c00rvus/excalibur/releases/tag/v0.4.9)

Common installers:

- [Windows setup `.exe`](https://github.com/c00rvus/excalibur/releases/download/v0.4.9/Excalibur_0.4.9_x64-setup.exe)
- [Windows `.msi`](https://github.com/c00rvus/excalibur/releases/download/v0.4.9/Excalibur_0.4.9_x64_en-US.msi)
- [macOS universal `.dmg`](https://github.com/c00rvus/excalibur/releases/download/v0.4.9/Excalibur_0.4.9_universal.dmg)
- [Linux AppImage](https://github.com/c00rvus/excalibur/releases/download/v0.4.9/Excalibur_0.4.9_amd64.AppImage)

## Highlights

- **Excalidraw drawing tools:** shapes, arrows, freehand drawing, text, frames,
  images, selection, zoom, undo/redo, and scene actions.
- **Folder-based workspace:** organize canvases into folders, search them,
  reorder them, and move canvases between folders with drag and drop.
- **File attachments:** attach files as icons or previews. Text, PDF, images,
  and supported native previews are converted into canvas elements when
  possible. Videos can be opened in the built-in player from the canvas.
- **Export tools:** export the full canvas or drag-select an area and save it as
  PNG or JPG. Exports can go into the project folder or to a path you choose.
- **Local-first storage:** projects are saved on disk by default under
  `Documents\Excalibur`, with a settings option to choose another location.
- **Light and dark themes:** theme-aware UI and canvas background handling.
- **Peer-to-peer collaboration:** host a session, approve guests, allow
  edit-only or view-only access, and optionally allow guests to save a local copy
  of the shared canvas.
- **Multi-provider canvas assistant:** use ChatGPT authentication or an API key
  from OpenAI, Anthropic, or Google Gemini. Describe a change in natural
  language and let the assistant create diagrams, add or rewrite text, move,
  resize, connect, align, style, duplicate, group, remove canvas elements, or
  generate a real PNG image and place it on the canvas. Every change is
  validated and previewed before it can be applied.
- **Lightweight runtime:** powered by Tauri and the system WebView instead of
  Electron.

## Codex Assistant

Open **Codex** from the top bar or press `Ctrl+K`. Choose whether the request
should use the current selection, the visible area, or the whole canvas, then
write the request in the panel. The proposed operations appear as a visual
preview; use **Apply** to commit the exact preview or **Cancel** to discard it.
The last applied plan also has a guarded **Undo** action, in addition to the
normal canvas history.

Requests for a **diagram** or **flowchart** create editable vector elements.
Requests that explicitly ask to create or generate an **image** use Codex
ImageGen and insert the resulting PNG as an image element. For example,
`Crie uma imagem de um fluxo de autenticacao e adicione ao canvas` generates
one raster image instead of approximating it with another vector flowchart.
Image generation can take a few minutes. Its usage is charged to the selected
ChatGPT account or API provider. Claude can analyze canvas content and create
editable vector diagrams, but the Claude API does not generate images. When an
image request is detected with Claude selected, the composer shows a subtle
notice and keeps the request disabled until ChatGPT, OpenAI, or Gemini is
selected.

### Authentication and models

Open the provider settings from the assistant header and choose one of these
modes:

| Provider | Authentication | Image generation | Local Codex required |
| --- | --- | --- | --- |
| ChatGPT | ChatGPT sign-in through the existing Codex flow | Yes, through Codex ImageGen | Yes |
| OpenAI | OpenAI Platform API key | Yes | No |
| Claude | Anthropic API key | No | No |
| Gemini | Google AI Studio API key | Yes | No |

ChatGPT authentication remains isolated in the Excalibur Codex profile. Direct
API modes do not start Codex CLI and use the selected provider's API directly.
API subscriptions and ChatGPT subscriptions are billed separately by their
respective providers.

The composer footer contains **Provider**, **Model**, and **Reasoning effort**
selectors. Only combinations supported by the selected model are displayed.
The current catalog includes GPT-5.6 variants, Claude Sonnet 5, Claude Opus 4.8,
Claude Haiku 4.5, Gemini 3.5 Flash, Gemini 3.1 models, and Gemini 2.5 models.
Claude Haiku uses automatic reasoning; the other Claude models expose their
supported effort levels. Gemini effort levels also vary by model, so unsupported
values cannot be selected.

### API key security

API keys are handled only by the native Tauri backend. They are never returned
to the WebView, written to a project, or stored in browser `localStorage`.
Non-secret preferences such as provider, model, and reasoning effort may be
stored locally. Each operating system uses its native credential service:

- Windows Credential Manager on Windows;
- Keychain on macOS;
- Secret Service-compatible keyring on Linux (for example GNOME Keyring or
  KWallet with a Secret Service backend).

If the native credential service is unavailable or locked, Excalibur reports
that the key could not be saved instead of falling back to a plaintext file.
On Linux, start or unlock the desktop Secret Service and restart Excalibur
before trying again.
Provider, model, and reasoning values are checked against backend allowlists,
provider errors are sanitized, and generated image bytes are size- and
format-validated before reaching the canvas preview.

The assistant sends only the simplified canvas snapshot needed for planning.
The ChatGPT mode runs Codex with an empty workspace and without shell,
arbitrary local-file, browsing, app, plugin, MCP, or dynamic-tool access. Only
the built-in ImageGen tool is enabled for explicit image requests. Direct API
modes call fixed provider endpoints from the native backend and use the same
validated canvas-plan schema.

## Storage Layout

By default, Excalibur stores projects under:

```text
%USERPROFILE%\Documents\Excalibur
```

Each saved project uses a predictable folder structure:

```text
projects\<folder>\<project>\canvas\scene.excalidraw
projects\<folder>\<project>\attachments
projects\<folder>\<project>\exports\png
projects\<folder>\<project>\exports\jpg
projects\<folder>\<project>\exports\files
```

You can change the storage root from the settings panel.

## Development

Requirements:

- Node.js and npm
- Rust and Cargo
- Tauri prerequisites for your platform
- Codex desktop app or Codex CLI (only for ChatGPT authentication; direct API
  providers do not require it)

Install dependencies and run the desktop app in development mode:

```powershell
npm.cmd install
npm.cmd run tauri:dev
```

Create a production desktop build:

```powershell
npm.cmd run tauri:build
```

With the Vite development server running, the provider smoke verifies the
allowlisted catalog, model-specific effort normalization, image routing, the
Claude notice, and the three selectors without using real credentials:

```powershell
npx.cmd --yes --package @playwright/cli playwright-cli open http://127.0.0.1:1420
npx.cmd --yes --package @playwright/cli playwright-cli run-code --filename scripts/codex-provider-smoke.js
```

On some Windows environments, first-time dependency downloads may need the
system certificate store or a Cargo revocation-check override:

```powershell
$env:NODE_OPTIONS='--use-system-ca'
$env:CARGO_HTTP_CHECK_REVOKE='false'
```

## Release Builds

Pushing a tag like `v0.4.4` runs the GitHub Actions release workflow and
publishes installers for Windows, macOS, and Linux.
