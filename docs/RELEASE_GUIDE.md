# Epoch Trail — GitHub Release Guide 🚀

This guide provides step-by-step instructions on how to build, package, and publish official release binaries to **GitHub Releases**.

---

## 📦 1. Quick Packaging Command

To build the entire application and package a standalone, zero-install portable Windows release ZIP with checksums:

```bash
npm run release:zip
```

### What This Command Does:
1. Compiles TypeScript React frontend (`tsc && vite build`).
2. Compiles Electron main & preload scripts (`tsconfig.electron.json`).
3. Packages Windows x64 binary dependencies (`electron-builder --win --dir`).
4. Creates a portable `.zip` archive:
   `release/Epoch-Trail-v1.0.0-Windows-x64-Portable.zip`
5. Computes and generates SHA256 integrity checksums:
   `release/SHA256SUMS.txt`

---

## 🏷️ 2. Publishing to GitHub Releases

### Option A: Using the GitHub Web UI (Recommended)

1. Go to your GitHub repository:
   `https://github.com/<your-org>/epoch-trail/releases/new`
2. **Choose / Create a Tag**: e.g. `v1.0.0` (target: `master` / `main`).
3. **Release Title**: `Epoch Trail v1.0.0 — Initial Release`
4. **Attach Release Assets**:
   Drag & drop the following files from your local `release/` directory:
   - `Epoch-Trail-v1.0.0-Windows-x64-Portable.zip`
   - `SHA256SUMS.txt`
5. **Paste Release Notes** (see template below).
6. Click **Publish release**.

---

### Option B: Using GitHub CLI (`gh`)

If you have the [GitHub CLI](https://cli.github.com/) installed and authenticated:

```bash
# 1. Create a tag and push it
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0

# 2. Publish release with attached assets
gh release create v1.0.0 \
  release/Epoch-Trail-v1.0.0-Windows-x64-Portable.zip \
  release/SHA256SUMS.txt \
  --title "Epoch Trail v1.0.0" \
  --notes-file docs/RELEASE_NOTES_TEMPLATE.md
```

---

## 📝 3. Release Notes Template

You can copy and paste the following release template into GitHub Releases:

```markdown
## 🎯 Epoch Trail v1.0.0

**Epoch Trail** is a zero-overhead tactical rolling buffer, audio DSP engine, and frame-by-frame video telestrator engineered for competitive gamers, teams, and esports coaches.

---

### ✨ Key Features
- **Zero-SSD Wear Circular RAM Buffer**: Continuous 1080p60 gameplay recording stored in memory, writing to disk only when clipped.
- **Instant Tactical Telestrator**: Freeze any round with **Alt+Shift+T** and draw vector brushes, arrows, player halos, zone boxes, and notes.
- **HTTP 206 Partial Content Streaming**: Custom `epoch-media://` protocol for zero-lag instant scrubbing across 4K/1080p60 clips with < 50MB RAM.
- **Zero-RAM Thumbnail Cache**: Disk-cached `.epoch_thumbnails/` prevent GPU decoder exhaustion in the Vault Gallery.
- **Multi-Stage Microphone Anti-Static DSP & Noise Gate**:
  - 85Hz 2nd-order high-pass rumble filter (cuts 50/60Hz AC electrical hum).
  - 13.5kHz anti-hiss shelf filter (removes USB preamp noise).
  - Adaptive Noise Gate with smooth decay for 100% silence when not speaking.
- **Studio Audio Bitrate & 96kHz Support**: WebCodecs AAC up to 384 kbps and sample rate matching (44.1k/48k/96k).
- **In-App Fullscreen Theater**: Press **F** to review and annotate clips edge-to-edge.
- **Input-Blocking In-App Trimmer**: Slices and exports sub-clips directly to your Vault folder with zero quality loss.
- **Close-to-Tray Execution**: Runs silently in the Windows system tray with interactive notification click redirection.

---

### 💾 Installation & Usage
1. Download **`Epoch-Trail-v1.0.0-Windows-x64-Portable.zip`** below.
2. Extract the ZIP folder anywhere on your PC (e.g. `C:\Games\Epoch Trail\` or `D:\Epoch Trail\`).
3. Run **`Epoch Trail.exe`**.
4. Press **Alt+Shift+T** in-game at any time to save a clip and open the tactical review overlay!

---

### 🔑 Checksums & Verification
Verify asset integrity using SHA256:
\`\`\`
sha256sum -c SHA256SUMS.txt
\`\`\`
```
