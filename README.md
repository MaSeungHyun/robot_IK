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
hand03 stays fixed at its exported pose. Blender XYZ X angles are limited to
[-90, 90] degrees for hand01 and [-240, -50] degrees for hand02. Initial
GLB quaternions are converted back to Blender XYZ to measure absolute angles,
so these limits are not offsets from the imported pose. hand04 has no mechanical
angle limit: the planner prefers keeping it still and minimizing rotation.
When the shorter path is obstructed it also considers the opposite wrist bend.
`src/features/robotIK.ts` builds a separate kinematic chain from the GLB
transforms and uses `closed-chain-ik/core` with an SVD damped-least-squares
solver. A translational Z joint represents the base rail. Rotational X joints
represent hand01/02/04; hand03 and other model transforms are fixed links.
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
fixed hand03, GLB/IK transform alignment, floor/approach clearance, rejection of
unreachable targets, collision-free transfers, body and overlapping cargo
obstacles, and runtime rollback. It reads actual GLB triangle geometry without
decoding textures; it does not validate visual appearance.
