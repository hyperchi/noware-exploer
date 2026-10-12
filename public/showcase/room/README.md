# Living-room story assets and measurement boundaries

This scene is original procedural Three.js geometry created for NOWARE: sofa and cushions, rug, wood floor, coffee/side tables, cat, plant, framed line drawing, window sash, kitchen cabinets and pan. Geometry and animation are reproducible directly from `src/purpose/room.js`; no stock imagery, paid assets, downloaded interior models or external physics library are used. It is a stylized architectural illustration, not a photographic reconstruction or fluid simulation.

The existing `../aircube-base.glb` is loaded as an independent instance and uniformly scaled from millimeters to meters (0.001), on the side table. Existing CAD provenance and license notices remain in `../README.md` and its referenced files. The 49 mm device is naturally small in the room; a DOM leader identifies its location rather than inflating it relative to the furniture.

## Hardware accuracy
On 2026-10-11, the owner confirmed that Noware uses a different revision with a particle sensor. This confirmation supersedes the former restriction to the public AirCube Base sensor list. The room narrative now illustrates particle activity in pet, dust, window, and cooking events. It does not identify the source automatically, identify allergens, or claim allergy prevention.

The particle sensor model, supported particle-size channels (including PM2.5), units, thresholds, and actual firmware behavior remain unconfirmed. No numeric readings, PM2.5 labels, or measured response times are shown. Light changes and air paths are an illustrative demo, not live measurements or validated fluid simulation.

The existing GLB is still the original Base enclosure/assembly. It has NOT been updated to represent the new revision’s internal sensor or sensing openings. Updated engineering files are needed to make the exploded internals revision-accurate. Source geometry provenance remains in `../README.md`.

## Posters
`poster.webp` and `poster-mobile.webp` are rendered from the same scene using `node scripts/purpose/check.mjs` with local Chrome. Run Vite at port 5177 first, or set `TEST_URL`. The static fallback preserves chapter copy and keyboard controls when GLB loading or WebGL is unavailable. It does not animate the room.

The continuous playback uses four overlapping paths configured in `src/purpose/flow.js`. Each event has an illustrative arrival, sensing pulse, light response, and recovery. Paths pass through the room without suction or filtration imagery. Playback runs once, with pause/replay and optional scroll control; reduced-motion visitors see static poses.

### Latest owner clarification — PM2.5 in development
The owner subsequently clarified that PM2.5 sensing is still being developed, with the final sensor model and specifications undecided. Public copy therefore identifies this as a PM2.5 feature preview in development, rather than a shipping capability. No “high-end,” accuracy, certification, numeric concentration, threshold, or allergy-prevention claim is made. Earlier generic particle confirmation above is superseded by this development status.
