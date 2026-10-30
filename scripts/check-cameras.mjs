// Spot check of the Caltrans cameras near the office. Writes a Markdown report
// to the path in argv[2] and exits 1 when any camera is failing.
import fs from 'node:fs';
import { CameraDirectory, checkCameras, withinKm } from '../lib/cameras.js';

const OFFICE_AREA = { latitude: 37.8, longitude: -122.4 };
const nearby = withinKm(await new CameraDirectory().load(), OFFICE_AREA);
if (!nearby.length) throw new Error('The Caltrans camera list is empty near the office.');
const results = (await checkCameras(nearby)).sort((a, b) => a.name.localeCompare(b.name));
const bad = results.filter(r => !r.ok);
const report = [`Checked ${results.length} cameras within 5 km of the office area on ${new Date().toUTCString()}.`, '', `**${results.length - bad.length} working, ${bad.length} failing.**`, '',
  ...(bad.length ? ['| Failing camera | Reason |', '|---|---|', ...bad.map(r => `| ${r.name} | ${r.reason} |`), ''] : []),
  'A frozen or blank picture can still pass if Caltrans keeps sending video segments.'].join('\n');
console.log(report);
if (process.argv[2]) fs.writeFileSync(process.argv[2], report + '\n');
process.exitCode = bad.length ? 1 : 0;
