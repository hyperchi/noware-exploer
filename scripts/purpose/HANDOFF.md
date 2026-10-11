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

Important unresolved product-specification issue: current Base hardware has no documented particulate sensor. Requested numeric PM2.5 demonstrations and allergy-detection implications are not shipped in this version. The room/environment story is implemented, but those product claims require verified hardware support. See the asset README for sources and exact limitations.
