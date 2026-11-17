import { clearancePose, layoutPath } from './src/domain/amr/navigation/layoutNavigation.ts';
import { AMR_TRAFFIC } from './src/constants/simulatorLayout.ts';
import { CONVEYOR_LAYOUT as BELT } from './src/constants/conveyorLayoutConfig.ts';

const belt = { x: 1.23, z: 11.22, yaw: Math.PI };
const far = { x: 1e4, z: 1e4, yaw: 0 };
const layout = { robot: far, conveyor: belt, pallet: far, amr: far, dock: far };

const lines: string[] = [];
lines.push('BELT ' + BELT.width + ' ' + BELT.length);
lines.push('radii ' + AMR_TRAFFIC.emptyRadius + ' ' + AMR_TRAFFIC.loadedRadius);
lines.push('clear center ' + clearancePose(1.23, 11.22, 'conveyor', belt));
lines.push('clear +0.5x ' + clearancePose(1.23+0.5, 11.22, 'conveyor', belt));
lines.push('clear +0.9x ' + clearancePose(1.23+0.9, 11.22, 'conveyor', belt));
lines.push('clear +1.2x ' + clearancePose(1.23+1.2, 11.22, 'conveyor', belt));
const start = { x: 1.23 - 3, z: 11.22 };
const goal = { x: 1.23 + 3, z: 11.22 };
const path = layoutPath(layout, start, goal, false, []);
lines.push('cross ' + (path ? JSON.stringify(path.map(p => [+p.x.toFixed(2), +p.z.toFixed(2)])) : 'null'));
const a = { x: 1.23 + 1.0, z: 5 };
const b = { x: 1.23 + 1.0, z: 18 };
const along = layoutPath(layout, a, b, false, []);
lines.push('along+1 ' + !!along);
const a2 = { x: 1.23 + 0.5, z: 5 };
lines.push('start+0.5 clear ' + clearancePose(a2.x,a2.z,'conveyor',belt));
const along2 = layoutPath(layout, a2, { x: 1.23+0.5, z: 18 }, false, []);
lines.push('along+0.5 ' + (along2 ? 'yes' : 'null'));
import * as fs from 'fs';
fs.writeFileSync('tmp-nav-test.txt', lines.join('\n'));
