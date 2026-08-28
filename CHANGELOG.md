# Changelog

All notable changes to the **3D Model Lens** extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-08-29

### Added

- **A navigation cube in the top-left corner.** It shows which way the camera is currently facing,
  and clicking it moves the camera there: the six labelled faces (`TOP`/`FRONT`/`RIGHT`/…) and the
  eight corners are click targets, and the camera slides to that view over 300ms rather than jumping.
  Because every destination has zero roll, clicking any face other than `TOP`/`BOTTOM` also levels a
  tilted view — the "return to level" the free-pose camera has been missing since 0.3.0.
- **Four direction arrows around the cube** rotate the view 90° about the screen axes, following the
  same sign convention as dragging and the arrow keys. They exist because the cube alone cannot reach
  a neighbouring face: once a face is head-on, the four faces beside it are exactly edge-on and stop
  being click targets.
- **A home button** to the lower right of the cube restores the initial framing — orientation, distance and target.
- **An RGB axis triad** shows where world X/Y/Z point. The letters are drawn next to the lines, so the
  axes stay identifiable without relying on colour.

### Changed

- **The starting view now shows the model's front.** It used to sit behind the model — the camera was
  on the `-Z` side, so the navigation cube would have opened reading `BACK`. The azimuth now splits
  `FRONT` and `RIGHT` evenly; the elevation is unchanged.

### Fixed

- **Zooming or panning during a camera transition no longer strands the view part-way.** Wheel zoom,
  right-drag pan and the modifier arrow keys were cancelling the whole transition rather than just the
  inertia tail, so a cube click followed by a scroll stopped at an arbitrary angle (measured: 40.63°
  short of the target). They now stop only the inertia; anything that actually takes over the
  orientation still cancels the transition, as before.

## [0.3.1] - 2026-08-28

### Fixed

- **Dragging rotated the model the wrong way on both axes.** The screen-relative rotation introduced
  in 0.3.0 inverted the drag convention: dragging right swung the camera right instead of left, and
  dragging down swung it down instead of up, so the model moved away from your hand rather than with
  it. Restored to the pre-0.3.0 convention, arrow keys included. (0.3.0 was never published, so this
  is the first release carrying the new rotation.)

### Note

- The direction is now pinned by a test that asserts the **absolute** convention, not just that the
  keyboard and the mouse agree with each other — the older test checked only their agreement, which
  is exactly why a both-axes inversion slipped through.

## [0.3.0] - 2026-08-27

### Changed

- **Rotation is now screen-relative** — dragging or arrow-keying left/right always turns the model
  about the axis you see as vertical on screen. It used to turn about the world's up axis, so the
  more the camera was tilted the more the input leaked into spinning the image instead of turning the
  model: at a near-top-down angle a `5.7°` input moved the view by `1.1°` and rolled the screen by
  `5.6°` (the relation is `turn ≈ θ·sin β`, `roll ≈ θ·cos β`, and roll wins below `β = 45°`).
  `ArcRotateCamera` cannot express this — it has no roll parameter — so the viewer now drives a
  free-orientation (quaternion) camera with its own pointer and keyboard handling. Vertical rotation
  is unbounded as before, and left-drag/right-drag/wheel keep their meanings.
- **The ground grid tilts with the view.** This is the accepted cost of screen-relative rotation, not
  a defect: a level grid requires locking the up axis to world Y, which is exactly what makes the
  rotation object-relative. The tilt doubles as the only cue for where world-up is.

### Fixed

- **Panning keeps its zoom-independent speed** and inertia still decays after a drag — both carried
  over to the new camera deliberately.

### Note

- A viewer tab open across this upgrade restores its measurements but re-frames the camera: the saved
  camera shape changed (angles → orientation), and the old shape is dropped rather than discarding
  the whole saved state.

## [0.2.1] - 2026-08-26

### Fixed

- **Arrow keys rotated the opposite way from dragging** — on both axes. Babylon accumulates a mouse
  drag as `-offsetX` but a right-arrow press as `+1`, so the right arrow orbited as if you had dragged
  left, and the down arrow as if you had dragged up. Arrow-key rotation now matches dragging.
  Panning (Ctrl) and zooming (Alt) are untouched: the key arrays are shared by all three, so the
  correction inverts only the rotation the keyboard contributed, not the shared key mapping.

## [0.2.0] - 2026-08-26

### Added

- **Toggle Viewer Panel** — a new `3D Model Lens: Toggle Viewer Panel` command, with a title-bar icon
  and an editor context-menu entry, hides the viewer panel and brings it back. The hidden state
  survives a reload, and the panel returns with its sections exactly as they were left.

### Changed

- **The viewer panel is now a section accordion** — its controls are grouped into three collapsible
  sections that start collapsed. Expanding one collapses the others, and which section was expanded
  is remembered across a reload. Turning measure mode on expands MEASURE automatically; turning it
  off leaves it expanded, because that is when you are reading the result.

## [0.1.3] - 2026-08-26

### Fixed

- **STL models are no longer mirrored** — STL stores right-handed coordinates, and the viewer was
  loading them unchanged into a left-handed scene, so every asymmetric STL rendered as its own
  left-right mirror image. STL meshes are now reflected once, which places them in exactly the same
  world space as the equivalent glTF. Reported dimensions and measured distances were never wrong —
  a reflection preserves both the bounding box and point-to-point distance — which is also why no
  existing test could see the bug; a new asymmetric fixture pair (`chiral.stl` / `chiral.glb`) and a
  world-vertex equality check now guard it. Still not corrected: a Z-up CAD STL appears lying on its
  side, because the STL format carries no up-axis information and guessing it would be a lie.

## [0.1.2] - 2026-08-25

### Changed

- **Balanced right-drag sensitivity** — reduced the zoom-independent panning speed to half of its
  initial calibrated value for finer camera positioning while preserving consistent movement at every
  zoom level.

## [0.1.1] - 2026-08-25

### Fixed

- **Camera navigation at every zoom level** — right-drag panning now scales with the camera radius, so
  the model moves smoothly and consistently whether it is zoomed in, zoomed out, large or small.
- **Continuous vertical orbit** — tilting no longer stops at Babylon's default top and bottom polar
  limits, and horizontal orbit remains available after crossing a pole.

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

[0.1.2]: https://github.com/gyuha/vscode-3d-model-lens/releases/tag/v0.1.2
[0.1.1]: https://github.com/gyuha/vscode-3d-model-lens/releases/tag/v0.1.1
[0.1.0]: https://github.com/gyuha/vscode-3d-model-lens/releases/tag/v0.1.0
