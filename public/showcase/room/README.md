# Living-room story assets and measurement boundaries

This scene is original procedural Three.js geometry created for NOWARE: sofa and cushions, rug, wood floor, coffee/side tables, cat, plant, framed line drawing, window sash, kitchen cabinets and pan. Geometry and animation are reproducible directly from `src/purpose/room.js`; no stock imagery, paid assets, downloaded interior models or external physics library are used. It is a stylized architectural illustration, not a photographic reconstruction or fluid simulation.

The existing `../aircube-base.glb` is loaded as an independent instance and uniformly scaled from millimeters to meters (0.001), on the side table. Existing CAD provenance and license notices remain in `../README.md` and its referenced files. The 49 mm device is naturally small in the room; a DOM leader identifies its location rather than inflating it relative to the furniture.

## Hardware accuracy
Verified 2026-10-11 against the [current manufacturer page](https://stuckatprototype.com/products/aircube), [source repository](https://github.com/StuckAtPrototype/AirCube), and the local assembly: Base senses VOCs, temperature and humidity; Pro adds direct CO₂ and ambient-light sensing. Neither documented package includes a PM2.5 sensor.

The requested PM2.5 numbers, particle-activity detection, and allergy-related claims are therefore not implemented. Pets, disturbed cushions and incoming window air are environmental illustrations, explicitly distinct from measurements. Only the cooking chapter illustrates a VOC-related light response and recovery. There are no invented concentrations, pollutant thresholds or allergen identifications. Particle positions, counts, colors and speeds do not represent sensor data. This distinction must remain unless a different particle-sensing hardware revision is verified.

The user has been asked whether a different PM-capable revision exists; that question remains unresolved. Scene copy is isolated in `src/purpose/story.js` for an evidence-based update when specifications are supplied.

## Posters
`poster.webp` and `poster-mobile.webp` are rendered from the same scene using `node scripts/purpose/check.mjs` with local Chrome. Run Vite at port 5177 first, or set `TEST_URL`. The static fallback preserves chapter copy and keyboard controls when GLB loading or WebGL is unavailable. It does not animate the room.

The continuous playback uses four overlapping paths configured in `src/purpose/flow.js`. Cooking air passes above the enclosure and continues beyond it; it is not sucked into the device. A schematic ring identifies the sensing area, followed by a diffuser response. The path, timing, pulse, and light response are explanatory animation, not a validated internal flow route or measured sensor latency. Playback runs once, with pause/replay and optional scroll control; reduced-motion visitors see static poses.
