import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import {
  AmbientLight, Box3, Color, DirectionalLight, Group, Mesh, MeshBasicMaterial, PerspectiveCamera,
  PlaneGeometry, Scene, Sphere, SRGBColorSpace, Vector3, WebGLRenderTarget,
} from "three";
import type { Object3D } from "three";
import { createUnitPallet } from "@/lib/three/modelNormalization";
import { conveyorTemplate } from "@/objects/conveyor/conveyorTemplate";
import { createScannerModel } from "@/objects/scanner/scannerModel";
import { useThumbnailStore } from "@/stores/useThumbnailStore";
import { poseRobotHome } from "@/domain/robot/ik/joints";
import { log } from "@/stores/useLogStore";
import { useModelStore } from "@/stores/useModelStore";
import { useModelsSettled } from "@/stores/useModelStore";
import { MODEL } from "@/viewport/models/modelUrls";
import { createDoorModel } from "@/objects/door/doorModel";
import { DOOR_CONFIG } from "@/constants/door";
import { PALLET_CONVEYOR } from "@/constants/palletConveyor";
import { CONVEYOR_LAYOUT } from "@/constants/conveyorLayoutConfig";
import { AMR_DECK, CYCLE_ACCENT } from "@/constants/cycle";
import { createAgvModel, createRackMobileModel } from "@/lib/three/cycleModels";

const WIDTH = 192, HEIGHT = 144;
let baked = false;

function dockPlane(color: string) {
  const group = new Group(),
    mesh = new Mesh(new PlaneGeometry(1.3, 1.3), new MeshBasicMaterial({ color }));
  mesh.rotation.x = -Math.PI / 2;
  group.add(mesh);
  return group;
}

/**
 * Renders every asset model once, with the app's own renderer (no extra WebGL context), into an
 * offscreen target and publishes the images as data URLs for the asset rail. Renders nothing.
 */
export default function ThumbnailBaker() {
  const settled = useModelsSettled();
  const gl = useThree((state) => state.gl);
  const setThumbnails = useThumbnailStore((state) => state.setThumbnails);

  useEffect(() => {
    if (!settled || baked) return;
    baked = true;
    const scenes = useModelStore.getState().scenes;
    const models: Record<string, Object3D> = {};
    const disposers: (() => void)[] = [];
    // A missing (failed) model or a build error only drops that thumbnail; cards fall back to icons.
    const build = (key: string, source: Object3D | null | undefined, make: () => Object3D) => {
      if (source === null) return;
      try {
        models[key] = make();
      } catch (error) {
        log("warning", `썸네일 생성 실패: ${key}`, error instanceof Error ? error.message : String(error));
      }
    };
    const robot = scenes[MODEL.robot], amr = scenes[MODEL.amr], pallet = scenes[MODEL.pallet],
      scanner = scenes[MODEL.scanner], rack = scenes[MODEL.rack], forklift = scenes[MODEL.forklift];
    build("robot", robot, () => poseRobotHome(robot!.clone(true)));
    build("amr", amr, () => amr!.clone(true));
    build("pallet", pallet, () => {
      const model = createUnitPallet(pallet!);
      return model;
    });
    build("scanner", scanner, () => {
      const scannerModel = createScannerModel(scanner!);
      disposers.push(() => scannerModel.dispose());
      return scannerModel.model;
    });
    build("conveyor", undefined, () => conveyorTemplate("straight", scenes[MODEL.rail] ?? undefined).clone(true));
    // Inbound / outbound conveyors: the same rail.glb with their #02dfef markings (outbound shows a pallet on it).
    build("conveyor-inbound", undefined, () => conveyorTemplate("straight", scenes[MODEL.rail] ?? undefined, "inbound").clone(true));
    build("conveyor-outbound", undefined, () => {
      const group = new Group();
      group.add(conveyorTemplate("straight", scenes[MODEL.rail] ?? undefined, "outbound").clone(true));
      if (pallet) {
        const load = createUnitPallet(pallet);
        load.position.set(0, CONVEYOR_LAYOUT.height, 0);
        group.add(load);
      }
      return group;
    });
    build("forklift", forklift, () => forklift!.clone(true));
    build("rack", rack, () => rack!.clone(true));
    // Pallet-cycle assets: procedural AGV / Rack_m, and the shuttle AMR shown with a pallet on its AMR_point seat.
    build("agv", undefined, () => createAgvModel().root);
    build("rack-mobile", undefined, () => createRackMobileModel());
    build("shuttle", amr, () => {
      const group = new Group(), body = amr!.clone(true), bounds = new Box3().setFromObject(body);
      const center = bounds.getCenter(new Vector3());
      body.position.sub(new Vector3(center.x, bounds.min.y, center.z));
      group.add(body);
      if (pallet) {
        const load = createUnitPallet(pallet);
        load.position.set(0, AMR_DECK, 0);
        group.add(load);
      }
      return group;
    });
    models.dock = dockPlane("#075985");
    models["dock-defect"] = dockPlane("#f94258");
    models["dock-unload"] = dockPlane(PALLET_CONVEYOR.accent);
    for (const role of ["service", "palletSource", "rackDrop", "stage"]) models[`dock-${role}`] = dockPlane(CYCLE_ACCENT);
    build("door", undefined, () => {
      const door = createDoorModel(DOOR_CONFIG.width, DOOR_CONFIG.height);
      door.setOpen(0.35);
      disposers.push(door.dispose);
      return door.group;
    });

    const scene = new Scene(),
      camera = new PerspectiveCamera(30, WIDTH / HEIGHT, 0.01, 100);
    const sun = new DirectionalLight("#ffffff", 2.2);
    sun.position.set(3, 5, 4);
    scene.add(new AmbientLight("#ffffff", 1.4), sun);
    const target = new WebGLRenderTarget(WIDTH, HEIGHT, { samples: 4 });
    target.texture.colorSpace = SRGBColorSpace;
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4),
      canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext("2d")!,
      image = context.createImageData(WIDTH, HEIGHT);
    // Raw render, then trimmed to the model's opaque pixels and re-fitted into the card: bounding-
    // sphere framing left tall/asymmetric models (the raised robot arm) floating in empty space.
    const raw = document.createElement("canvas");
    raw.width = WIDTH;
    raw.height = HEIGHT;
    const rawContext = raw.getContext("2d")!;
    /** Crops to the opaque pixels and re-fits them into the card; null = keep the raw render. */
    const trimmed = (buffer: Uint8Array): string | null => {
      try {
        // Single pass over the GL buffer (rows bottom-up), no spreads or recursion.
        let minX = WIDTH, minY = HEIGHT, maxX = -1, maxY = -1;
        for (let i = 3, p = 0; i < buffer.length; i += 4, p++) {
          if (buffer[i] <= 8) continue;
          const x = p % WIDTH, y = HEIGHT - 1 - ((p - x) / WIDTH);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        if (maxX < 0) return null;
        const w = maxX - minX + 1, h = maxY - minY + 1, pad = 0.08;
        const fit = Math.min((WIDTH * (1 - pad * 2)) / w, (HEIGHT * (1 - pad * 2)) / h, 2);
        const dw = w * fit, dh = h * fit;
        context.clearRect(0, 0, WIDTH, HEIGHT);
        context.drawImage(raw, minX, minY, w, h, (WIDTH - dw) / 2, (HEIGHT - dh) / 2, dw, dh);
        return canvas.toDataURL("image/png");
      } catch {
        return null;
      }
    };
    const previousTarget = gl.getRenderTarget(),
      previousColor = gl.getClearColor(new Color()),
      previousAlpha = gl.getClearAlpha();
    const sphere = new Sphere(), direction = new Vector3(1, 0.8, 1.2).normalize();
    const result: Record<string, string> = {};
    try {
      gl.setClearColor(0x000000, 0);
      for (const [key, model] of Object.entries(models)) try {
        scene.add(model);
        model.updateMatrixWorld(true);
        new Box3().setFromObject(model).getBoundingSphere(sphere);
        const distance = (sphere.radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.05;
        camera.position.copy(sphere.center).addScaledVector(direction, distance);
        camera.lookAt(sphere.center);
        gl.setRenderTarget(target);
        gl.clear();
        gl.render(scene, camera);
        gl.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, pixels);
        // GL rows run bottom-up.
        for (let y = 0; y < HEIGHT; y++)
          image.data.set(pixels.subarray((HEIGHT - 1 - y) * WIDTH * 4, (HEIGHT - y) * WIDTH * 4), y * WIDTH * 4);
        rawContext.putImageData(image, 0, 0);
        result[key] = trimmed(pixels) ?? raw.toDataURL("image/png");
        scene.remove(model);
      } catch (error) {
        scene.remove(model);
        log("warning", `썸네일 렌더 실패: ${key}`, error instanceof Error ? (error.stack ?? error.message) : String(error));
      }
    } finally {
      gl.setRenderTarget(previousTarget);
      gl.setClearColor(previousColor, previousAlpha);
      target.dispose();
      for (const dispose of disposers) dispose();
      setThumbnails(result);
    }
  }, [settled, gl, setThumbnails]);

  return null;
}
