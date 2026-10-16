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

Production uses robot.glb with a fixed robot root, a spline conveyor, a
1.1×1.1m T11 pallet centred at X=-0.7m, and 0.22×0.2×0.275m boxes.
FixedLayerPacker fills 20 slots per layer, farthest from the robot first,
then repeats the same order in the next layer. A blocked slot is not skipped.
The 5m stack limit is a packing limit, not a guarantee of physical robot reach.

### Motion planning

- robotKinematics.ts evaluates the actual GLB hierarchy in a separate FK model.
  Adaptive damped least squares, finite-difference Jacobians and multiple
  shoulder/elbow/roll starts solve position within 0.15mm. Numerical exploration
  never mutates the rendered robot.
- World downward orientation means the hand04-to-GripPoint shaft lies within
  a 5-degree cone around world -Y. It is not a local hand04 angle or a full
  world quaternion equality. Yaw is free. Transport does not impose this cone;
  final contact/release does. Intermediate high descent points can relax tilt
  when necessary, while the release pose must satisfy the cone.
- The planner checks endpoint collisions separately from swept joint paths.
  It tries short turns, collision-checked opposite turns for continuous joints,
  small Cartesian steps, then deterministic joint-space RRT detours.
  The hover pose is accepted only if it has a verified lowering route.
  Final lowering and withdrawal follow Cartesian steps; they do not fall back
  to arbitrary joint-space spins beside the load.
- Robot.tsx runs approach/contact, lift, transport, lower/release and withdrawal.
  A small contact offset is centred and collision-checked at pickup. Cargo
  is rigidly attached to GripPoint: local position and quaternion are fixed.
  Turning hand04 rotates both the gripper and the box together. There is no
  world-upright counter-rotation. Planning and animation use the same attachment.
  A release orientation mismatch is reported rather than snapping a substantially
  rotated box to the grid.
- Planning yields between numerical iterations and collision sample batches
  under a soft 4ms frame budget. This is not a hard real-time bound.
  Planning collision checks use denser angular samples and a small arm/pallet
  clearance; actual animation checks collisions again and rolls back on a hit.

hand01 uses Blender local X within -120..120 degrees. hand04 uses local X
within -100..80 degrees. hand00 and hand03 use Blender local Z (Three.js local Y).
hand00, hand02 and hand03 are continuous; hand03 is enabled. Limits and solver
settings live in constants.ts. The left-bottom panel provides local-angle sliders,
hand04 world Euler readings and the shaft's tilt from downward. Sliders pause
automatic motion and enforce joint limits, but allow collision inspection.
The right panel shows the real packing sequence and planning rejection reason.

Collision policy is unchanged: held cargo versus robot, placed cargo and pallet
is checked; arm versus other boxes and held cargo versus conveyor boxes is ignored.
Arm versus pallet and floor clearance remain checked. Only intended hand05
contact over the active box's top face is exempt. Failure messages distinguish
position search, downward-pose search, endpoint collision and route collision.
A search failure is not a proof that no geometric solution exists.

### Validation and limits

Run node scripts/verify-ik.mjs for the current production regression, or add
--packing-only for packing/kinematics/collision fixtures without moving pickups.
IK_FPS selects a simulated frame rate; IK_STREAM_TARGET and IK_STREAM_SECONDS
increase the target count and simulation duration. --legacy additionally runs
the historical differently-scaled 10-box demo, which is not a passing regression
for the current robot model.

The new solver passes actual-GLB FK parity under a transformed parent, reachable
and unreachable numerical targets, continuous-joint limits, collision rollback,
packing, support, order and pallet exchange fixtures. The rigid-grasp regression sweeps hand04 from -100 to 80 degrees and verifies
an invariant wrist/box relative transform and absence of new hand04 penetration.
The previous world-upright transport model could create false wrist/box collisions;
its successful 3/5-transfer runs are historical and do not validate rigid transport.
With the current 0.22×0.2×0.275m footprint and rigid attachment, the continuous
regression currently stops at a carried-box/pallet descent collision. The remaining
placement-orientation planning is unresolved; a full-pallet run is not passing.
Actual collisions and fixed far-to-near slot order remain enforced.
