# NOWARE hardware showcase

Branch: `codex/hardware-showcase` in the separate `noware-codex-showcase` worktree.
The original `noware-exploer` checkout remains available for Claude Code.

Run `npm ci`, then `npm run dev -- --port 5177`. Open http://localhost:5177/ .
Production build: `npm run build`. The existing server and authentication remain
unchanged; this implements the repository's `/` homepage above its playground.
It does not modify the public login page or deploy to noware.so.

## Files and tuning

- `src/main.js`: mounts the showcase on the existing homepage.
- `src/showcase/index.js`: shared interaction state, accessible DOM, copy, and
  scroll/manual ownership. Manual chapter/explode choices persist until Resume
  scroll story. Air-quality choices never change automatically.
- `src/showcase/config.js`: colors, camera, exploded offsets, chapter copy,
  component labels, quality and particle settings.
- `src/showcase/scene.js`: lighting, materials, asset loading, picking, limited
  drag rotation, camera framing, render lifecycle and projected leaders.
- `src/showcase/airflow.js`: seven soft animated streamlines and one batched point mesh.
- `src/showcase/showcase.css`: editorial layout, responsive styles, controls.
- `public/showcase/`: GLB, immediate rendered poster, extracted PCB, license and
  detailed provenance/approximation notes. Conversion scripts in `scripts/showcase/`.

Desktop: compact sticky story with about 1,000 px of native scroll. Mobile and
reduced-motion: explicit chapters, no pinned sequence. Vertical touch scrolling
is retained. Reduced motion disables continuous animation; controls render on
request. IntersectionObserver and visibility state suspend offscreen/hidden work.

## Verification

`npm run build`, `npm test`, `node scripts/showcase/check.mjs`.
The repository defines no lint or type-check command (plain JavaScript).
`TEST_URL` can point the browser checks and poster generator at another server.
The check uses locally installed Chrome through Playwright. Captures and measured
headless frame sample are in `captures/`; frame timing is machine-dependent,
not a claim about every device. The browser check covers assembled/exploded,
three colors, airflow, forward/backward scroll, component selection, keyboard,
drag/reset, 390×844 mobile, reduced motion, failed model load, and no WebGL.
`TEST_URL=http://localhost:5177 node scripts/browser-check.mjs` exercises the
pre-existing playground interactions.

## Limits

See `public/showcase/README.md` for revision differences, omitted hardware detail,
and illustrative materials/package heights. Optical scattering and airflow are
presentation approximations. No physical iPhone/Android GPU testing performed.
Three.js's shared bundle exceeds Vite's 500 kB advisory; it is dynamically loaded.
The separate authenticated live dashboard and production deployment are unchanged.

The PCB list and engineering tools are now collapsed by default under Hardware playground. The hero CTA opens them on demand. Component selection highlights the model without a persistent explanatory text row.

Airflow is always visible in every chapter and manual assembly state. There is no on/off control. Reduced motion keeps the same trails visible but stationary. The fallback poster includes airflow.

The final editorial pass unifies the header, hero, controls, and footer; adds the Made in America closing section; and moves the provenance link into the footer. The closing CTA opens the existing playground. Styles are consolidated in one readable stylesheet rather than stacked overrides.

## Noso family styling

Reviewed https://noso.so/ in a browser at desktop and mobile sizes on October 8, 2026. Adopted its white/graphite/gray palette, Inter 600 heading weight, monospace labels, subtle 64 px grid, and restrained #2563eb accent. The dark origin section echoes its contrasting editorial sections. NOWARE retains its own copy, geometry, rounded interaction controls, persistent airflow, small Login link, and Made in America presentation. No Noso imagery, tracking code, product claims, or layout components were imported.
