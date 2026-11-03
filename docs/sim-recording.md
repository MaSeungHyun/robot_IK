# Simulation recording (schema v1)

Types: `src/domain/recording/simRecording.ts` (recorder: `src/domain/recording/SimRecorder.ts`).

Sources:
- Headless: `simulateTemplate(template, models, { seconds, warmup, record: true })` -> `result.recording`,
  or `node scripts/record-sim.mjs --template=N --seconds=60 [--out=file.json]`.
- In the app (opt-in): open with `?record=1` (or `localStorage.setItem("sf.record","1")` + reload), run the simulation, then
  `window.__sfRecording()` (the SimRecording) or `window.__sfRunCapture()` -> `{ version: 1, capturedAt, simTime, stats, recording }`.
  Recording restarts whenever the simulator is rebuilt (layout change). Off by default; nothing existing changes.

| field | shape | when |
|---|---|---|
| `suction` | `[t, robotId, on, boxId]` | SuctionRobotController ATTACH (`on=true`) / RELEASE (`false`) |
| `contacts` | `{t, robotId, boxId, tool, boxTop, distance, dy}` | each ATTACH: grip point vs box top-face centre (world m) |
| `boxParents` | `[t, boxId, kind, parentId, localPos, localQuat]` | box parent changes; kind `conveyor\|pallet\|arm\|amr\|rail` (+`rack\|dock\|world\|none`). `pallet` always has the pallet id, and then localPos/localQuat are relative to that pallet's stream pose: world = pos + rotY(yaw)?local, qWorld = qYaw?localQuat. Other kinds: local to the three.js parent |
| `boxKeyframes` | `{t, boxes:[[boxId,x,y,z,qx,qy,qz,qw]]}` | 1 Hz, world position + world quaternion (3 decimals) of boxes in the scene. Chunk exporter emits only boxes moved ? 1 cm or turned ? ~1? since their last emitted pose (hold last; chunk snapshot seeds) |
| `pallets` | `[t, palletId, create\|move\|ship, detail, worldPos, yaw, carrierKind, carrierId]` | record created, state change (detail = state), carrier change (detail = `kind:id`), and 1 Hz `move` while on `amr`/`rail`; shipped/retired |
| `palletParents` | `[t, palletId, carrierKind, carrierId]` | pallet group carrier changes (`amr\|rail\|arm\|station\|rack\|dock\|conveyor\|world`) |

Times are sim seconds; values rounded to 1 mm / 1e-3 (yaw in rad, world Y axis). Quaternions are `[x,y,z,w]`.
`worldPos`/`yaw` are the last known pose of the pallet group (null only if it was never in the scene).
Box parent kind comes from the scene graph first (robot mount -> `arm`, pallet group -> `pallet`), otherwise from the
CargoRegistry box state/holder. Pallet carriers come from `userData.sceneId` on ancestors (AMR/forklift carriers) or from
the rail network (rail items sit on the world root). `yaw`, `carrierKind`, `carrierId` and `palletParents` were appended
within v1; readers of the first v1 cut ignore them.

## Pallet ids and poses (fix 2026-11-03)

- A box's `pallet` parent id is its CargoRegistry pallet id (inbound pallets: synthetic `IN-xxxx`), and that id is bound to the group the box actually sits in; the `pallets` stream reports that same group's pose.
- `pallets` emits `move` whenever a pallet pose changes (? 5 mm / 0.005 rad), at most 2 Hz, forced on 1 Hz keyframe ticks and at box attaches. Inbound pallets are streamed with state `inbound`.
- Chunk snapshot `boxes` rows: `[id, parentKind, parentId, x, y, z, qx, qy, qz, qw, lx, ly, lz, lqx, lqy, lqz, lqw]` (positions cm, l* only for pallet parents).
- `node scripts/validate-recording.mjs <runDir>` checks on-pallet boxes against pallet pose + rotated local.

## Animated parts (chunk exporter, added 2026-11-03)

Generic channel for every moving sub-part of every device. Interface: `AnimatedPartSource.getAnimatedParts()` in
`src/domain/recording/animatedParts.ts`; registry: `FactorySimulator.getAnimatedParts()` (delegates to
`ForkliftController`, `CycleVehicle`, `RailNetwork`, plus doors and belts) and `SuctionRobotController.getAnimatedParts()`.
A new device type only implements `getAnimatedParts()` (and is added to the registry); `scripts/record-run.mjs` records whatever it returns.

- `manifest.animatedParts[i]`: `{ i, deviceId, kind, partName, channel, unit, rest, threshold, procedural?, parent?, restPos? }`.
  `partName` is the GLB node name as authored (GLTFLoader strips "." : `Forklift.Fork` loads as `ForkliftFork`, `AGV.Lift` as `AGVLift`; match alphanumerics).
  `channel`: `posX|posY|posZ|rotX|rotY|rotZ` (node local, m / rad), `quat` (node local `[x,y,z,w]`), `fraction` (0..1), `speed` (m/s).
- chunk `snapshot.parts[i]`: value of part i at chunk start (null = not present yet). chunk `tracks.parts`: rows `[t, i, value]`, sampled at
  10 Hz and emitted when the change since the last emitted value is >= `threshold` (pos 1 mm, rot/quat 0.1 deg, fraction 0.005, speed 0.001)
  or when the part settles; hold the last value between rows. `t` is absolute sim time like everything else.
- Old fields (`tracks.amrs`, `tracks.joints`, `recording.*`) are unchanged.

| kind | partName | channel | meaning |
|---|---|---|---|
| forklift | `Forklift.Fork` | posY | fork node local y (rest = FORKLIFT_CONFIG.fork.y); rack forklifts and cycle forklifts |
| agv | `AGV.Lift` | posY | lift plate local y under the carrier |
| transfer | `Transfer_Forklift_fork` | posY | fork node local y = 1.27529 - down * 0.731 |
| transfer | `stopper-x`, `stopper+x` | posY | procedural stopper boxes (0.08 x 0.12 x 1.0 m) under a `carriage` group that moves by (fork posY - 1.27529); `restPos` = local position; entry stopper drops while a pallet rolls on |
| door | `curtain` | fraction | roll-up opening 0..1 (max of the door's manual setting and forklift-driven opening); curtain scale.y = (1 - 0.5 * fraction) |
| conveyor | `belt` | speed | belt surface speed (0 when disabled or the line is halted at its stopper); integrate to scroll rollers / textures |
| robot | `hand00`..`hand04` | quat | joint node local quaternion (same motion as `tracks.joints`, rest = pose at first sample) |

Not covered: rail_condition.glb has no moving nodes (pallets on rails are in `pallets`); AMR.glb roller tops and scanners have no animated nodes in the app.

`node scripts/validate-recording.mjs <runDir>` also checks part declarations, value shapes, row order and duplicates when `animatedParts` is present.

## KPI stream (chunk exporter, added 2026-11-03)

Computed inside the sim by `KpiTracker` (`src/domain/recording/kpiStream.ts`), sampled at 1 Hz from sim t=0 (warm-up included), so every count is a **day total** and utilizations are over the whole elapsed day.

- `manifest.kpiSchema`: `{ version, sampleHz: 1, encoding, placeholders, stages, keys[] }`. `keys[]` = `{ key, unit, type (int|number|string|number|null), meaning }`; dotted paths, `<stage>|<scannerId>|<deviceId>|<vehicleId>|<robotId>` segments are map keys. `stages[]` describes each stage's unit, count, wip and progress reference.
- `manifest.sampleHz.kpi = 1`, `manifest.kpiEncoding`.
- Chunk `tracks.kpi`: rows `[t, sample]` (t absolute sim s, one per second, full sample each row). `snapshot.kpi`: latest sample at chunk start.
- Sample groups: `throughput` (processed = palletized boxes, perHour rolling 3600 s, perMinute rolling 60 s, avgPerHour), `stages.<stage>.{count,wip,progress}` for inbound, depalletize, scan, palletize, rackStore, outbound, ship; `wip`, `pallets.full`, `boxes.passed`, `scan` (total + `byScanner`), `rack`, `vehicles`, `devices.<id>.{kind,state,utilization}`, `robots.<id>.{cycles,cycleTimeLast,cycleTimeAvg,busyPerCycle,utilization}`.
- Invariants (checked by `scripts/validate-recording.mjs`): counts monotonic; inbound >= depalletize >= scanned >= palletize + passed (with scanners); pass + defect = scanned; per-scanner sums = totals; ship <= outbound <= rackStore <= pallets.full; wip >= 0; rack stored + reserved <= slots; % values in 0..100; every sample key declared and every declared key present.

Scanners: headless runs now register scan-tunnel sensors (`simulateLayout` + `ScanTunnel.glb`, same geometry as `Scanner.tsx`), so scan counts are real. This lowers throughput ~15% vs older headless runs (matches the app). `record-run.mjs --no-scanners` restores the legacy behaviour (scan KPIs 0, `scan.scanners = 0`).
