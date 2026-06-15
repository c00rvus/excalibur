# Excalibur

Excalibur is a lightweight Windows desktop whiteboard built with Tauri, React,
Vite, and the official Excalidraw canvas package.

## Features

- **Local Sidebar Organization:** Manage folders and canvases/projects with support for creating, renaming, switching, searching, and deleting.
- **Drag & Drop Workspace:** Move canvases between folders by dragging them directly in the sidebar, or reorder them within a folder to organize your workflow. Folder movements on the OS filesystem level are processed instantly and safely by the Rust backend.
- **Custom Folder Colors:** Personalize each folder with a modern color palette from a custom picker, allowing for quick visual recognition in the sidebar.
- **Excalidraw Tools:** Full support for shapes, arrows, free drawing, sticky notes, text, frames, image imports, zoom, selection, undo/redo, and built-in scene actions.
- **Native Titlebar Color Sync:** On Windows, the native window titlebar automatically synchronizes and matches the sidebar's background color, adjusting instantly for both light and dark themes.
- **External Web Redirection:** External links and the Excalidraw library finder button automatically open in your default system web browser, allowing you to easily browse, download, and import libraries.
- **Autosave & Customizable Path:** Saves progress automatically to the disk. Uses `%USERPROFILE%\Documents\Excalibur` by default, but the storage path can be customized through the settings panel.
- **Export Options:** Easily export active boards to high-quality PNG or JPG files.
- **Lightweight Runtime:** Powered by Tauri and Windows WebView2 instead of Electron, utilizing minimal system resources.

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
