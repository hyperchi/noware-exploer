# Physical scale and asset provenance

One scene unit = one millimeter. `src/scale/config.js` owns all dimensions, camera framing, positions, timing and quality. The section instantiates the existing `/showcase/aircube-base.glb` independently; it never changes the hero's transforms or materials.

## Enclosure discrepancy
The existing engineering model's housing + diffuser bounds are **49 × 49 × 32 mm** (width × depth × height). Both a Node test and the live scene validate those bounds. The [retail AirCube page](https://stuckatprototype.com/products/aircube) lists **49 × 49 × 36 mm**. This section retains the source geometry and explicitly discloses the difference under “About the dimensions.” No axis is stretched. See ../README.md and existing license notices for CAD provenance and illustrative internals.

## Quarter
[US Mint specifications](https://www.usmint.gov/learn/coins-and-medals/circulating-coins/coin-specifications): diameter 24.26 mm, thickness 1.75 mm, 119 reeds. Two quarters span 48.52 mm, leaving 0.48 mm relative to the enclosure width. Rim/reeds stay inside the specified envelope. The procedural edge/rim and shallow image bump are illustrative, not engraved mint tooling. Only the obverse is detailed; the unseen reverse is plain.

Quarter-dollar coin image from the United States Mint. `quarter.png` is the Mint's Washington obverse, as cropped/background-removed in [Wikimedia Commons: 2006 Quarter Proof.png](https://commons.wikimedia.org/wiki/File:2006_Quarter_Proof.png), marked public domain (PD US money). Original creator: United States Mint. Source: https://upload.wikimedia.org/wikipedia/commons/a/a0/2006_Quarter_Proof.png . The [Mint's state-quarter image policy](https://www.usmint.gov/news/image-library/50-state-quarters-design-use-policy) permits these images with the applicable credit and no implication of endorsement. Credit also appears in the section's dimension disclosure. No Mint endorsement is claimed. Rebuild with `python3 scripts/scale/prepare-coin.py`.

## Egg
Original procedural lathe geometry in `src/scale/assets.js`, 58 mm long × 44 mm maximum diameter. Asymmetric profile and deterministic shell microtexture. These dimensions are an illustrative modeling assumption, not a standard egg size. Egg pose is placed from its computed world-space bounds so it contacts the shared table.

## Posters
`compare.webp`, `footprint.webp`, and mobile counterparts are original renders of exactly the same comparison scene. Run Vite, then `node scripts/scale/capture.mjs` to regenerate them and capture desktop/mobile checks. `TEST_URL` can override the default public homepage URL. No external stock photographs are used for the egg or product.
