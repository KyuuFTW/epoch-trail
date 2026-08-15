# Epoch Trail — Architecture & Engineering Documentation

This document explains the technical architecture, design decisions, and optimizations behind **Epoch Trail**.

---

## 1. High-Level Architecture

```mermaid
graph TD
    A[Electron Main Process] -->|Global Hotkeys / Tray / Protocols| B[Chromium Renderer Window]
    B --> C[Screen & Audio Capture]
    C -->|Desktop Video + Loopback Audio| D[Mp4RollingEncoder]
    C -->|Microphone Stream| E[AudioMixer DSP Engine]
    E -->|Anti-Static + Noise Gate + Mixed Audio| D
    D -->|Circular RAM Buffer| F[In-Memory Video Chunks]
    F -->|On Clip Hotkey| G[MP4 Muxer / Disk Vault Storage]
    G -->|Extract Companion JPG| H[.epoch_thumbnails/ Cache]
    G -->|HTTP 206 Range Stream| I[Tactical Review & Telestrator]
    I -->|Canvas Drawing Overlay| J[Frame-Anchored Vector Annotations]
    I -->|Lossless In/Out Slicing| K[Export Engine]
```

---

## 2. Deep Dive: Core Engineering Decisions

### 2.1 Why Circular RAM Buffering Instead of Temporary Files?
- **Conventional Approach**: Tools like OBS Replay Buffer write chunks of temporary video directly to the hard drive or SSD constantly.
- **Problem**:
  1. A 60fps 1080p stream generates ~5–10 GB of video data every hour. Over long gaming sessions, this causes heavy SSD write amplification and shortens hardware lifespan.
  2. Windows disk cache flushing can cause intermittent micro-stutters during gameplay.
- **Epoch Trail Solution**:
  - Encoded video chunks (`EncodedVideoChunk` and `EncodedAudioChunk`) are retained in JavaScript typed arrays in memory.
  - Expired keyframes and delta frames older than the configured buffer duration (e.g. 60 seconds) are garbage collected.
  - Disk write occurs **only** when the user presses <kbd>Alt+Shift+T</kbd> or clicks "Save Clip to Vault".

---

### 2.2 Why HTTP 206 Range Streaming (`epoch-media://`)?
- **The Bug**: When users reviewed long 1080p60 gameplay clips (>300 MB) or opened older vault clips via `file:///` or Blob URLs, Chromium attempted to load the entire file buffer into RAM. This led to renderer crashes:
  `RESULT_CODE_KILLED_BAD_MESSAGE (Error code 5)`
- **The Solution**:
  - In `electron/main.ts`, we registered a custom privileged protocol: `epoch-media://get?path=...`.
  - The protocol reads the `Range` HTTP header sent by the `<video>` element (e.g. `bytes=1048576-2097151`).
  - Using Node.js `fs.createReadStream(filePath, { start, end })`, it streams only the requested chunk with HTTP status `206 Partial Content` and proper `Content-Range` headers.
  - **Result**: Sub-millisecond scrubbing, instant playback, and constant memory usage < 50MB regardless of file size.

---

### 2.3 Why Dedicated Disk-Cached Thumbnails (`.epoch_thumbnails/`)?
- **The Problem**: In video gallery interfaces, rendering `<video src="..." />` thumbnails spawns an active hardware video decoder for each card. After 8–10 cards, Chromium runs out of DirectX/Vulkan hardware decoder instances, crashing the UI.
- **The Solution**:
  - When any clip is saved or trimmed, a lightweight hidden `<video>` element extracts the frame at 0.5s into a canvas and writes a static JPEG image into `<vault>/.epoch_thumbnails/<clipId>.jpg`.
  - The gallery renders lightweight `<img />` tags backed by `epoch-media://` protocol.
  - **Result**: 0% GPU decoder load and 60fps smooth scrolling in the Vault Gallery with hundreds of clips.

---

### 2.4 Why Input-Blocking Modal During Trimming?
- **The Problem**: When slicing and re-encoding a video clip, navigating away or interacting with UI elements could cancel the export or leave partial chunks in memory.
- **The Solution**:
  - Added a full-screen input-blocking HUD modal via React `createPortal` with `z-[999999]`.
  - Displays real-time progress percentage (0–100%) and status text while `ExportEngine` processes frames.
  - Safely unlocks once the trimmed `.mp4` is written to disk and added to the Vault Gallery.

---

### 2.5 Close-to-Tray Lifecycle
- **The Problem**: Gamers expect clipping software to run silently in the background without cluttering the Windows Taskbar.
- **The Solution**:
  - `mainWindow.on('close')` intercepts window close events, calling `event.preventDefault()` and `mainWindow.hide()`.
  - A Windows System Tray icon provides quick access:
    - *Open Epoch Trail*
    - *Start / Stop Rolling Buffer*
    - *Open Clip Vault Folder*
    - *Quit Epoch Trail* (Performs full graceful cleanup).
