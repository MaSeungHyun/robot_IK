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
