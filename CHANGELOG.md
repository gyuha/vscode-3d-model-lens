# Changelog

All notable changes to the **3D Model Lens** extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-23

First release.

### Added

- **Viewer** — a read-only custom editor for `.gltf`, `.glb` and `.stl`, built on Babylon.js.
  `.gltf` resolves its external `.bin` and texture references; `.stl` reads both ASCII and binary.
  Clicking a model file opens the viewer; `Reopen Editor With… → Text Editor` still gives you the source.
- **Dimensions** — the bounding box is shown as `X / Y / Z` the moment a file opens, with no interaction
  needed. It is never labeled "width × height × depth", because the glTF loader's coordinate-system
  conversion and the Z-up convention in CAD-origin files would make those names wrong half the time.
- **Unit system** — `Auto` shows meters for glTF/GLB (the spec defines it) and plain unlabeled numbers for
  STL (the format has no unit field, so claiming millimeters would be a guess). `mm` / `cm` / `m` / `in`
  can be picked from the viewer panel, and the choice is remembered **per file**. Only the displayed label
  changes; no geometry is transformed.
- **Distance measurement** — pick two points on the surface to create one distance. Dragging to orbit still
  works in measure mode: movement past a threshold does not place a point. Measurements accumulate in a
  list you can select from, remove one at a time, or clear entirely, and lines and markers are drawn
  *through* the model so they stay visible. Marker size scales with the model, so it reads on both tiny and
  huge models. Changing the unit relabels measurements you already made.
- **Vertex snap** (on by default) — snaps a measurement point to the nearest of the three vertices of the
  triangle you clicked, which is what makes corner and edge dimensions accurate.
- **Measure mode has three entry points that stay in sync** — the `Measure` checkbox in the viewer panel,
  the measure icon in the editor title bar, and `3D Model Lens: Toggle Measure Mode` in the command palette.
- **Babylon Inspector** — toggle it from the viewer panel checkbox, the title bar icon, or
  `3D Model Lens: Toggle Inspector`, for the node hierarchy, materials, textures and rendering state.
  It ships as a separate chunk that loads **only when you turn it on**, so viewing a model never downloads
  or parses it. You can keep measuring while it is open. Node and GUI editors are unsupported (this is a
  read-only viewer), which also removed roughly 10 MB and several external CDN dependencies.
- **Ground grid** — sized proportionally to the model's bounding box, toggleable from the viewer panel.
- **Background mode** — `theme` follows the VS Code editor background, while `light` (`#ffffff`) and `dark`
  (`#1f1f1f`) pin it regardless of the active color theme.
- **Settings** — `modelLens.background`, `modelLens.grid`, `modelLens.inspectorOnStart`, `modelLens.unit`
  and `modelLens.decimals`. Background and grid are saved globally from the viewer panel and apply to every
  open viewer immediately.
- **Idle rendering gate** — when nothing has changed among the camera, measurements and display settings,
  no frame is drawn, so a stationary model costs no GPU. Any interaction redraws immediately. While the
  Inspector is open we render continuously, because its fps counter and gizmos depend on the render loop.
- **Background tabs are not kept alive** — VS Code is allowed to destroy a hidden tab's webview
  (`retainContextWhenHidden` is off), so WebGL contexts do not pile up with the number of open tabs. In
  exchange, measurements, camera position, display toggles and measure mode are all restored when you come
  back. Restarting VS Code clears them.
- **No external network access** — model loading, environment lighting (IBL) and the Inspector use only
  resources bundled with the extension. The webview CSP blocks outbound requests structurally with
  `default-src 'none'`, and `npm run check:bundle` fails the build if a new external dependency creeps into
  the output.

### Deliberate omissions

These are decisions, not gaps. Each is explained in the README.

- **No angle, volume or surface-area measurement.** On non-watertight meshes volume produces a meaningless
  number, and showing a plausible wrong answer is worse than having no feature. Angles reuse the existing
  picking/snapping/label infrastructure, so they stay cheap to add later.
- **Measurements are session-scoped** and are not written to a file.
- **No OBJ / OFF / PLY / PCD / XYZ.** They fall outside Babylon's built-in loaders, and point clouds need a
  fundamentally different measurement UX.
- **No Draco / meshopt compression, no KTX2 / Basis textures.** Their decoders are fetched from external
  CDNs, which the webview CSP blocks. By not registering them we report a clear "unsupported extension"
  instead of failing silently.
- **STL axes are used exactly as the file states them.** Babylon swaps STL's Y and Z by default (STL is
  Z-up, Babylon is Y-up), but then the file says `Z=30` while the viewer shows `Y=30`. In a measurement
  tool that is a lie, so Z-up CAD files may appear to lie on their side.

[0.1.0]: https://github.com/gyuha/vscode-3d-model-lens/releases/tag/v0.1.0
