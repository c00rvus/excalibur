# Excalibur

Excalibur is a lightweight Windows desktop whiteboard built with Tauri, React,
Vite, and the official Excalidraw canvas package.

## Features

- Local sidebar with folders, projects/canvases, create, rename, switch,
  search, and delete.
- Excalidraw canvas tools for shapes, arrows, free draw, text, frames, images,
  zoom, selection, undo/redo, and built-in scene actions.
- Autosave to the Windows Documents folder by default, with a configurable
  storage root and a small metadata index for fast project listing.
- Export active boards to PNG or JPG.
- Desktop runtime through Windows WebView2 instead of Electron.

## Windows Development

This machine needs the Windows certificate store for npm and a Cargo revocation
check override for first-time Rust dependency downloads:

```powershell
$env:NODE_OPTIONS='--use-system-ca'
$env:CARGO_HTTP_CHECK_REVOKE='false'
npm.cmd install
npm.cmd run tauri:dev
```

For a production build:

```powershell
$env:NODE_OPTIONS='--use-system-ca'
$env:CARGO_HTTP_CHECK_REVOKE='false'
npm.cmd run tauri:build
```

Projects are stored under `%USERPROFILE%\Documents\Excalibur` by default. The
root can be changed from the settings panel.

Each project uses this structure:

```text
projects\<folder>\<project>\canvas\scene.excalidraw
projects\<folder>\<project>\exports\png
projects\<folder>\<project>\exports\jpg
```
