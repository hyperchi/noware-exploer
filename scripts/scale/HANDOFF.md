# Size comparison handoff

Run `npm install`, `npm run dev -- --port 5177`, then open **http://localhost:5177/home.html** and click **About the size of an egg**. The comparison is hidden and its 3D scene is not loaded until opened. Close or Escape collapses it and returns focus to the caption. The development `/` route is the signed-in engineering entry; production Express serves the public homepage at `/` for visitors. No deployment is part of this change.

## Changed files
- `src/home.js`: mounts this additive section immediately after the existing showcase.
- `src/scale/index.js`, `scale.css`: copy, accessible controls, fallback, lazy loading and responsive layout.
- `src/scale/config.js`: physical dimensions, positions, camera and timing.
- `src/scale/scene.js`: isolated GLB instance, shared millimeter scene, orthographic camera pullback/view transition, shadows, deterministic rolling coin, on-demand rendering and cleanup.
- `src/scale/assets.js`: procedural asymmetric egg and thin reeded quarter. Product is the existing GLB, with its original housing material and matching translucent-top material settings.
- `public/showcase/scale/`: quarter image, rendered desktop/mobile posters and provenance README.
- `tests/scale.test.js`: physical bounds, two-quarter relationship, coin support during settlement.
- `scripts/scale/`: coin retrieval, capture/regression scripts, this handoff.
- `captures/scale/`: desktop/mobile views, animation samples, reduced motion and fallback evidence.

## Checks
`npm run build` then `npm test` (server tests depend on current built HTML). `node scripts/scale/capture.mjs` regenerates posters and checks both modes at 1440×900 and 390×844, repeated reversals, keyboard activation, replay and overflow. `node scripts/scale/check.mjs` exercises existing hero controls, entrance frames, reduced motion, blocked model load and unavailable WebGL. Chrome is selected explicitly because no Playwright-managed browser is installed. No lint or TypeScript check is configured in this JavaScript repository. Build retains the existing large Three.js shared-chunk warning.

## Intentional limits
CAD enclosure is 49×49×32 mm, while retail lists 36 mm high; both are disclosed. Egg 58×44 mm is approximate. Coin relief is a face-image bump with procedural rim/reeds; reverse is not detailed. Motion is keyframed, not a physics simulation. Comparison renders only during reveal/view changes/resize, and pauses offscreen or in hidden tabs; no continuous ambient animation. Mobile and reduced-motion visitors get the completed composition immediately. Hardware/browser performance varies; no 60 fps claim. Coin source license and credit are recorded in the asset README and page disclosure.

## Comparison interaction refinement
Compare now supports bounded camera orbit by mouse drag, horizontal touch swipe, or arrow keys with the canvas focused. All objects remain fixed at the same physical scale. Vertical touch gestures retain page scrolling. Footprint mode locks the camera overhead and preserves the previous Compare angle; Reset view restores the default, and Replay resets the angle before the reveal. Limits and sensitivity are in `scaleConfig.interaction`. `node scripts/scale/drag.mjs` checks mouse/touch input, normal mobile scrolling, keyboard, reset, footprint lock, and restored orbit. The refined header, grouped secondary actions and primary view selector remain within the optional disclosure. Posters have been regenerated for the adjusted composition and diffuser material.
