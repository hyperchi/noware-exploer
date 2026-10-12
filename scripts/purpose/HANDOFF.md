# Function-first homepage version

Branch: `codex/function-first-story`, based on current `origin/main` (`0beb4e0`, including the blue Made in America updates). Production was inspected on 2026-10-11. No deployment.

Run `npm run dev -- --port 5177`; open http://localhost:5177/home.html#what-it-does. The existing hero remains first, the continuous room story is second, and the expandable size comparison finishes the page. Both the original egg-size link and the new final size link open the same comparison; Escape returns focus correctly.

- `src/home.js`: mount order.
- `src/purpose/index.js`: scroll/manual/reduced-motion ownership, accessible chapter controls and final size prompt.
- `src/purpose/story.js`: the five narrative beats and verified measurement copy.
- `src/purpose/room.js`: original procedural room, independent AirCube model, lighting, particle illustration, reversible scene poses, camera/framing, lazy renderer and resource cleanup. The geometry itself is the rebuild script.
- `src/purpose/purpose.css`: site-matched white editorial layout, compact sticky sequence on desktop; explicit chapter controls on mobile/reduced motion.
- `src/scale/index.js`: comparison placement and two synchronized disclosure triggers. Existing comparison renderer and hero code are unchanged.
- `public/showcase/room/`: rendered fallback posters and provenance/accuracy documentation.
- `scripts/purpose/check.mjs`: desktop/mobile captures, chapters, keyboard, both size disclosures, forward/backward scroll.
- `captures/purpose/`: review screenshots and motion samples.

Build: `npm run build`; tests: `npm test`. No lint/typecheck script exists. Existing shared Three.js bundle-size warning remains. Chrome headless validates layout and behavior, not physical-device frame rate.

The owner confirmed a particle-sensing Noware revision on 2026-10-11. Room copy now explains generic particle changes. Sensor model, PM2.5 support, thresholds, and revised internal CAD remain unconfirmed. The existing hero/room GLB still represents the earlier assembly; no new sensor geometry is invented. See the asset README for the remaining boundaries.

## Continuous illustration update
The same room now plays once over 24 seconds when visible. Four overlapping air paths keep continuity between activities; each event stages ambient-air arrival, a particle sensing pulse, a delayed light response, and recovery. Pause/play and replay are available. Chapter controls skip within the same scene; Follow scroll explicitly hands progress to reversible scrolling. Reduced motion uses static chapter poses. Offscreen/hidden rendering pauses.

`src/purpose/flow.js` controls duration, source paths, overlap, and response timing. `room.js` controls particle visibility, the pulse, and materials. `tests/room-flow.test.js` checks overlapping source activity and detection ordering. `scripts/purpose/playback.mjs` verifies browser playback and captures the response. The visual paths and response timing are illustrative, not modeled particle transport or measured sensor latency.

### Latest owner clarification — PM2.5 in development
The owner subsequently clarified that PM2.5 sensing is still being developed, with the final sensor model and specifications undecided. Public copy therefore identifies this as a PM2.5 feature preview in development, rather than a shipping capability. No “high-end,” accuracy, certification, numeric concentration, threshold, or allergy-prevention claim is made. Earlier generic particle confirmation above is superseded by this development status.
