# Excalibur

Excalibur is a lightweight desktop whiteboard built on top of the official
Excalidraw canvas package. It keeps the familiar drawing experience while adding
local project organization, file attachments, export tools, and experimental
peer-to-peer collaboration.

## Download

Get the latest release from GitHub:

[Download Excalibur v0.4.4](https://github.com/c00rvus/excalibur/releases/tag/v0.4.4)

Common installers:

- [Windows setup `.exe`](https://github.com/c00rvus/excalibur/releases/download/v0.4.4/Excalibur_0.4.4_x64-setup.exe)
- [Windows `.msi`](https://github.com/c00rvus/excalibur/releases/download/v0.4.4/Excalibur_0.4.4_x64_en-US.msi)
- [macOS universal `.dmg`](https://github.com/c00rvus/excalibur/releases/download/v0.4.4/Excalibur_0.4.4_universal.dmg)
- [Linux AppImage](https://github.com/c00rvus/excalibur/releases/download/v0.4.4/Excalibur_0.4.4_amd64.AppImage)

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
- **Lightweight runtime:** powered by Tauri and the system WebView instead of
  Electron.

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

Install dependencies and run the desktop app in development mode:

```powershell
npm.cmd install
npm.cmd run tauri:dev
```

Create a production desktop build:

```powershell
npm.cmd run tauri:build
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
