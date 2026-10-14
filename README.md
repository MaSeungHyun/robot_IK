# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

## Palletizing demo

The scene starts with 10 boxes on the right pallet. It removes the upper
layer first and transfers each box onto the left pallet. Cargo attaches to
GripPoint only after the arm reaches the pickup point, preserves its world
contact pose, and detaches at its planned position. It lifts upright first,
then follows the gripper during transport and returns upright for placement.

`src/features/stacking.ts` compares the two uniform rectangular grid
orientations and selects the higher per-layer capacity. It fills each layer
from the center outward, with complete support from the layer below. This is
an optimum within uniform grids, not a general mixed-orientation packing solver.
Current model scales produce six boxes on the bottom layer and four above.

`src/features/Robot.tsx` uses glTF local +X rotation (Blender local +X) for hand01, hand02 and hand04;
hand03 can rotate freely around Blender local Z (glTF local Y), preferring its current pose until collision avoidance requires movement. Blender XYZ X angles are limited to
[-120, 120] degrees for hand01 and [-180, 180] degrees (one full turn) for hand02. Initial
GLB quaternions are converted back to Blender XYZ to measure absolute angles,
so these limits are not offsets from the imported pose. hand04 has no mechanical
angle limit: the planner prefers keeping it still and minimizing rotation.
When the shorter path is obstructed it also considers the opposite wrist bend.
`src/features/robotIK.ts` builds a separate kinematic chain from the GLB
transforms and uses `closed-chain-ik/core` with an SVD damped-least-squares
solver. A translational Z joint represents the base rail. Rotational X joints
represent hand01/02/04 around local X and hand03 around local Y; other model transforms are fixed links.
Both the rail position and arm angles are solved together for each waypoint.
At the destination hover and release points the goal also constrains gripper
orientation: hand04 is above GripPoint, pointing down toward the cargo.
The wrist mesh bounds must remain at least 0.03 units above the contact height
at those endpoints. Motors interpolate together so the aligned wrist stays
above the cargo during lowering; release waits for all motors to settle.
`src/features/collisions.ts` uses oriented cargo boxes and robot mesh BVHs to
check robot/cargo and held/placed cargo collisions. It permits the intended
hand05 top-face grasp and resting contacts (0.002-unit penetration tolerance).
When a direct path is blocked, opposite hand01/hand02 retreats are tested first,
with coordinated hand04 rotation, followed by deterministic RRT exploration.
All segments and payload reorientations are sampled before use; animation
checks intermediate steps again and rolls back if an obstacle has moved.
The demo is kinematic: robot self-collision, pallet/environment geometry and
contact forces are not modeled. Sampling is not continuous collision detection.

The scene initially stays at the exported robot pose. Use Start / Continue to run, Pause to inspect, and Restore initial pose to reset the demo. Box count, pallet positions and
model scales are configured in `src/features/Canvas.tsx`. Grid clearance is
configured in `planStack`. Joint and rail speeds are configured in `robotIK.ts`.



The planner warm-starts from the current pose, preferring a fixed wrist. If it
does not converge, alternative shoulder/elbow seeds are passed to the library.
Unreachable goals stop animation rather than attaching cargo or exceeding limits.
Candidate paths are sampled using the same motor speed limits as the animation.
The planner rejects paths where the grip dips more than 0.025 units below the
lower of its start/target heights, or hand02–hand05 mesh bounds cross the
0.015-unit floor clearance. This selects the alternative elbow bend when the
nearer solution sweeps downward. If no candidate passes, the demo stops.
The source pallet center is X=2.3 and destination center is
X=-1.6, keeping the targets inside this restricted workspace. Cargo attaches
only within the contact tolerance. Cargo is not snapped into an approximate
IK contact point, preventing wrist overlap on attachment. Collision detours may
lower the tip to 0.25 units, while checking arm and cargo clearance from the floor.

The IK dependency is pinned to upstream commit
`1132da3dc3ac774426e9af503e4915bc04ca413b` (package version 0.0.7).
Use `npm run test:ik` to verify all 10 transfers at 30/60 fps, joint limits,
hand03 axis/full-turn/collision rollback checks, GLB/IK transform alignment, floor/approach clearance, rejection of
unreachable targets, collision-free transfers, body and overlapping cargo
obstacles, and runtime rollback. It reads actual GLB triangle geometry without
decoding textures; it does not validate visual appearance.

The continuous demo first normalizes the GLB box to a 1×1×1 m base
with its origin at the top-face centre, then scales that base by X/Y/Z.
Box sizes in Three.js X/Y/Z are 2×1×2, 2×2×2, 3×1×2 and 3×2×2. Boxes keep moving along the spline at 0.5 m/s
with centre spacing configured in `src/features/constants.ts`; new boxes spawn indefinitely. The pallet is also normalized to a 1×1×1 m base, then scaled to the dimensions in STREAM_CONFIG (currently 8×1×8 m).
A 1 m grid on its top surface shows the shared measurement scale. A height-map packing heuristic selects supported, bounded
placements and horizontal rotations, preferring low layers and adjacent cargo.
Packing candidates retain that ranking instead of being reordered toward the
robot centre. All placements and collision retries use a 1 m lattice.
This is online packing, not a guaranteed global optimum for unknown future boxes.
Moving pickups use velocity prediction and repeated IK updates. The attachment
offset is compensated at placement, followed by an upward gripper retreat before
selecting the next box. Full planning considers reverse shoulder/elbow bends.
The numerical fixture also checks three successive moving pickups and placement
commits using actual model geometry. Visual box and pallet dimensions are
checked against packing dimensions. Perfect-tiling inventories are generated for the configured pallet dimensions
and height budget, then shuffled before conveyor spawning. Supply order remains
random, while the generated counts have a complete packing solution. Missed
conveyor pickups do not count as delivered inventory. The pure packing fixture uses a controlled sequence to verify
a controlled known-size sequence fills the configured pallet to 5 m without gaps without gaps. Missed moving pickups or collision
reroutes can reduce actual runtime utilization.

`src/features/constants.ts` manages box sizes, conveyor speed/spacing, pallet
scale, the 5 m stack height above the pallet surface, joint limits, motion
timing, IK settings and collision tolerances. Pallets participate in the
continuous demo's collision checks. Gripper/cargo contact is allowed only at
the cargo top face; carrying does not exempt the whole hand05 from collisions.
The exact final cargo transform is checked before release. When a packing
position causes a collision, alternate supported positions are tried before
stopping. Robot self-collision and the surrounding factory are not modelled.

Planning is incremental on the rendering thread: a soft 4 ms budget per frame,
with candidate solves and RRT iterations yielding between tasks. Collision paths
yield every 16 samples and restore the displayed pose before yielding. An individual
solver chunk (up to 25 iterations) or collision chunk can exceed the soft budget.
Every 200 ms of cumulative planning work, moving jobs yield a timeout result
that is distinct from collision/unreachability. The caller tries another packing
position when available; otherwise it resumes the same restored search. Runtime
collision stops trigger replanning, and blocked cargo orientation changes can
be completed after moving the arm to make room. Final release checks the exact
world cargo orientation rather than assuming the wrist converged perfectly. A Web Worker is
the next option if larger scenes still exceed the frame budget. Random arrivals do not guarantee a completely filled pallet.

Continuous pallet placement now fills the lowest supported layer from the far
edge toward the robot. The robot approaches from +X, so -X columns have priority;
Z is served by the moving base rail. Contact/compactness ranking breaks ties.
Collision fallback candidates keep this same far-to-near ranking. Unreachable
positions may still be skipped in favour of the next safe candidate.

When none of the four configured box variants has a supported placement,
the idle station dispatches the pallet with all placed boxes to -X. A fresh
normalized pallet then moves into position, the height map resets, and
picking resumes. Exchange starts after the robot's release/retreat finishes;
active transfers cannot trigger it. Conveyor boxes continue moving during
exchange. HUD counters track pallet number and completed dispatches. Exchange
speed and distance are configured in constants.ts.

Placement retries include both 0° and 90° cargo orientations and all supported
grid candidates. A rotated footprint at the same centre is tested separately;
retry enumeration no longer excludes it by centre distance or an arbitrary
24-attempt cap. Selecting a rotated candidate updates the cargo yaw used by
rotation collision checks and final placement.

Bottom-first placement is enforced across IK retry phases: exhaust the lowest
supported level with quick probes, then retry that same level with full planning,
then advance to the next supported level. Full-planning timeouts resume the same
candidate rather than treating an unfinished search as impossible. Unfilled lower
cells remain available to subsequent smaller boxes. When several conveyor boxes
are in range, the box with the lowest supported placement takes priority; rail
proximity breaks ties. Compact adjacency precedes side-to-side balance in scoring.

Far-side access is now a primary priority immediately after supported height.
Fragmentation and balance scores cannot reorder a near band ahead of a far band.
Quick and full IK passes exhaust the same height/access band before advancing
closer to the robot; upper levels are considered after all lower bands.

The packing heuristic includes a bounded exact-cover lookahead on each
flat height level using the known 2×2 and 3×2 footprints (including 90° rotation).
If a level is tileable, candidates that make its remaining cells unfillable are
rejected before IK; existing non-tileable levels retain supported fallback cells.
Search-limit exhaustion is unknown, not a rejection. Random arrivals and robot
accessibility still determine whether the physical pallet can be filled completely.

The exact-cover constraint describes packing feasibility only. If all gap-free
placements are rejected by the real gripper/arm, supported non-tileable robot
fallback positions are tried with collision checks still enabled. This can leave
gaps. A side gripper cannot be assumed to produce a zero-gap physical stack;
vacuum pickup or a revised finger envelope may be required for that guarantee.

`perfectTiling.ts` implements inventory-aware first-empty-cell DFS with memoized
occupancy/count states and Fisher-Yates randomization. Finite inventory requires
exact area equality; rotations are allowed and the input counts remain unchanged.
The scaled robot uses forward-kinematics-selected IK starts in addition to its
existing elbow alternatives. Far pallet corners have lower destination hover
points (cargo top + 0.65m); pickup lift height is planned separately. Thus a
reachable low placement is not rejected because its former 6.12m hover point
was outside the wrist-oriented workspace. All path/cargo collision checks remain.

Current collision policy (constants.ts): hand01–hand05, including the gripper,
ignore cargo boxes except the actively carried box. Carried-box/robot
collision is enabled for body and all joints, with only intended hand05 top-face
grasp contact allowed. Carried cargo ignores conveyor cargo during movement,
rotation, descent preflight and lift-height selection. Conveyor/held/placed cargo
and pallets have explicit collision roles. Held cargo versus placed cargo and
pallets remains checked; robot base/body versus boxes, arm versus pallets, floor
clearance, joint limits and support/overlap constraints also remain checked.

The right-side native Canvas panel shows the current 1m height grid, placed
footprints, ranked candidate anchors, the current candidate and rejected regions.
It receives real planning events and rejection reasons from the robot and station,
including IK error, wrist orientation/clearance, floor/path clearance, carried-box
interference, and unfinished time-budget searches. Height-map and 0–4m layer views
are selectable; click a cell to inspect its height. Capacity fill, floor fill and
candidate inspection progress are separate percentages. Inspection progress is
not an optimality probability or a proof that all robot paths were explored.

Hand02 and hand03 use continuous rotation across the ±180° display seam. Equivalent IK angles are checked along the shortest turn first; a longer turn is retained only if the short segment collides and the longer segment passes collision checking. Hand01 remains limited to ±120°.

Hand04 is restricted to Blender local X angles from −330° to −30°. Initial pose, IK seeds, direct motion and detour paths all respect this interval. Collision checks remain active.
