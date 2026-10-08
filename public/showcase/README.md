# Homepage showcase model

`noware.glb` is built by `node scripts/prepare-showcase-models.mjs` from the hyperchi/AirCube clone (`../aircube-source`). Units are millimetres (quantised to 0.01 mm with KHR_mesh_quantization), Y up, origin at the enclosure footprint centre on the PCB underside. Every node carries vertex colours; the page assigns materials at runtime.

## Sources

| Node(s) | Source | Licence | Notes |
|---|---|---|---|
| `top`, `bottom`, `airWall`, `lightWall`, `button` | `mechanical/pro/STEP/*.step` in StuckAtPrototype/AirCube | Apache-2.0 | Exact enclosure geometry; all five files share one assembly frame. |
| `pcb` | `kicad/Base/AirCube.step`, node `AirCube_PCB` | Apache-2.0 | Bare board body. The Pro board shares the same 45 × 45 mm outline; its layout is used for placements. |
| Component placements | `kicad/Pro/AirCube.kicad_pcb` (v2.1) | Apache-2.0 | Position and rotation of every front-side footprint. Fiducials, mounting holes and silkscreen logos are skipped. |
| `U7` | Espressif ESP32-H2-MINI-1 STEP | CC BY-SA 4.0 with KiCad exception | Via `public/models/esp32-h2-mini-1.json`. |
| `P1`, `R*`, `C*`, `Q1`, `D5`, `U4`, `U6` | KiCad packages3D library | CC BY-SA 4.0 with library exception | USB4105 receptacle, 0603 passives, SOT-23, SOD-523, SOT-23-5. |
| `S3` | E-Switch TL1016 CAD | Manufacturer reference geometry | Not relicensed. |
| `LED1`–`LED3` | Original AirCube assembly STEP (IN-PI15 package) | Apache-2.0 | Colours assigned for legibility. |
| `U2`, `U10` | Datasheet reconstructions (`public/models/ens161.json`, `ens210.json`) | Original work | Nominal ScioSense package dimensions; cover details illustrative. |
| `U3` (SCD41), `U1` (VCNL4040) | **Illustrative boxes** at datasheet nominal size | — | No CAD in the project. 10.1 × 10.1 × 6.5 mm and 4 × 2 × 1.1 mm; membrane, windows and markings omitted. Flagged `approximate` in node extras and marked ≈ on the page. |

See `public/models/README.md` for the full provenance of each component mesh.

## Known approximations

- The board sits at z = 0 with its top face at 1.6 mm; the real standoff height inside the tray was not measured.
- The ESP32 module yaw follows the KiCad footprint (antenna toward the board edge beside the USB-C edge).
- Materials, lighting, the LED glow gradient, airflow particles and the three air-quality states are illustrations for the website, not measurements.
- `hero-fallback.jpg` is a render of this model, shown when WebGL is unavailable.
