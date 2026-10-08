# AirCube Base showcase assets

## Sources and permission

Hardware source: https://github.com/StuckAtPrototype/AirCube at commit
`2135e5bc3ff6f6542cf9e252a7453c81917ff706`.
Copyright StuckAtPrototype contributors. Apache-2.0; full license is in
[AIRCUBE-LICENSE.txt](./AIRCUBE-LICENSE.txt). Retain the repository's LICENSE and NOTICE.

`aircube-base.glb` contains independently named housing, diffuser, airwall and PCB
nodes. Enclosure geometry is tessellated from `mechanical/base/STEP`:
- `AirCube bottom_prod_12-11.step`
- `AirCube_top-8-31-26.step`
- `AirCube_air_wall_8-31-26.step`

PCB outline and passive packages come from `kicad/Base/AirCube.step`.
`board.json` is extracted from that commit's Base KiCad PCB; placement and copper
lines use this data. The enclosure origin differs by 5 mm in Y from the PCB:
the conversion translates the PCB consistently, rather than independently
centering each part. All dimensions are millimetres.

Additional models already in this project: ESP32-H2 (Espressif CC BY-SA 4.0 with
KiCad exception); USB4105 and SOT-23-5 (KiCad CC BY-SA 4.0 with library exception).
See [component provenance](../models/README.md) and
[Espressif license](../models/ESPRESSIF-LICENSE.md) for source revisions and notices.
KiCad licensing: https://www.kicad.org/libraries/license/ .
ENS161, ENS210, and RKB2 are original datasheet reconstructions from the project's
existing assets. No BG95 or manufacturer-only E-Switch CAD is imported here.

`poster.webp` is our own Three.js render of the same model. Product-page and
assembly photographs were inspected as visual references only, not redistributed
or used as textures. The site product photographs have not been assumed to share
the hardware source license.

## Fidelity and assumptions

This is the **Base** source assembly, not Pro: ENS161, ENS210, and ESP32-H2.
There is no SCD41, VCNL4040, extra light wall, or invented layer. Electronics stay
on the PCB during separation. The Base assembly guide describes three printed
pieces and a PCB; a button-cap CAD also exists in the folder but the guide calls
that a Pro assembly part, so it is not added to this Base presentation.

No user-supplied photographs were attached. The assembly photos show a v1.2
silkscreen while the repo's existing playground identifies v1.1; the showcase
uses the pinned Base engineering files, not a claim of a verified photographed
production revision. Current enclosure CAD bounds are 49 × 49 × 32 mm assembled;
the product page advertises 36 mm height. The source CAD is preserved; only the
verified 49 × 49 footprint is displayed.

Enclosure seams, openings, walls, and mounting geometry are real CAD. Material
finish, print texture, optical diffusion, LED spill, and contact shadows are
illustrative. Sensor package reconstructions and centered package mounting
heights are visual approximations, not fabrication references. USB shell details
retain simplified material groups. S3 actuator, individual mounting screws,
solder fillets, silkscreen printing, and underside copper are not reproduced.

Airflow follows seven exterior paths around the front and sides, with two approaching the sensing-side corner;
no internal fluid path is claimed. In exploded mode, the paths rise with the PCB.
Particles represent ambient air, not dust counts, CO₂ molecules, air cleaning,
forced ventilation, or measured velocity. Color controls are explicitly a demo,
independent of the existing playground simulator and any live dashboard.

## Rebuild

From the project root:

```sh
git clone https://github.com/StuckAtPrototype/AirCube /tmp/aircube-source
git -C /tmp/aircube-source checkout 2135e5bc3ff6f6542cf9e252a7453c81917ff706
python3 scripts/showcase/extract-board.py /tmp/aircube-source/kicad/Base/AirCube.kicad_pcb
node scripts/showcase/build-assets.mjs /tmp/aircube-source
npm run dev -- --port 5177
# In another terminal, with local Chrome installed:
node scripts/showcase/poster.mjs
```

OpenCascade (`occt-import-js`) tessellates STEP into indexed Three.js geometry;
GLTFExporter writes binary glTF. The browser never parses CAD. Meshes sharing
materials are merged within selectable component groups, preserving assembly
identity. The GLB is approximately 3.64 MB uncompressed. There are no image
textures in the model. Poster generation uses a local browser, not a photograph.
