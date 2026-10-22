import { BoxGeometry, CanvasTexture, Group, Mesh, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { DOOR_CONFIG as D } from "@/constants/door";

/** One slat (light face + dark groove) as a tiny shared texture; repeats once per D.slat metres. */
let slatTexture: CanvasTexture | null = null;
function slats() {
  if (slatTexture) return slatTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 32;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#c3c9cc";
  g.fillRect(0, 0, 4, 32);
  g.fillStyle = "#d4d9db";
  g.fillRect(0, 4, 4, 12);
  g.fillStyle = "#7d868a";
  g.fillRect(0, 28, 4, 4);
  slatTexture = new CanvasTexture(canvas);
  slatTexture.colorSpace = SRGBColorSpace;
  slatTexture.wrapS = slatTexture.wrapT = RepeatWrapping;
  return slatTexture;
}
const frameMaterial = new MeshStandardMaterial({ color: "#5d666b", metalness: 0.4, roughness: 0.5 });

export type DoorModel = { group: Group; setOpen: (fraction: number) => void; dispose: () => void };

/**
 * Roller-shutter door, local origin on the wall plane at floor level, X along the wall:
 * jambs + shutter box merged into one mesh, the slatted curtain a second mesh. `setOpen(0..1)`
 * rolls the curtain up into the box (scale + offset; texture repeat keeps the slat pitch).
 */
export function createDoorModel(width: number, height: number): DoorModel {
  const parts = [
    new BoxGeometry(D.jamb, height, D.frameDepth).translate(-(width + D.jamb) / 2, height / 2, 0),
    new BoxGeometry(D.jamb, height, D.frameDepth).translate((width + D.jamb) / 2, height / 2, 0),
    // Shutter box above the opening, mostly on the interior (+Z) side.
    new BoxGeometry(width + D.jamb * 2, D.boxHeight, D.boxDepth).translate(0, height + D.boxHeight / 2, D.boxDepth / 2 - D.frameDepth / 2),
  ];
  const frameGeometry = mergeGeometries(parts)!;
  parts.forEach((part) => part.dispose());
  const frame = new Mesh(frameGeometry, frameMaterial);

  const map = slats().clone();
  const curtainMaterial = new MeshStandardMaterial({ map, metalness: 0.3, roughness: 0.55 });
  const curtainGeometry = new BoxGeometry(width, 1, 0.04).translate(0, -0.5, 0); // hangs from its top edge
  const curtain = new Mesh(curtainGeometry, curtainMaterial);
  curtain.position.y = height;

  const group = new Group();
  group.add(frame, curtain);
  const setOpen = (fraction: number) => {
    const closed = Math.max(0.02, height * (1 - Math.min(1, Math.max(0, fraction))));
    curtain.scale.y = closed;
    curtain.visible = closed > 0.021;
    map.repeat.set(1, closed / D.slat);
  };
  setOpen(0);
  return {
    group,
    setOpen,
    dispose: () => {
      frameGeometry.dispose();
      curtainGeometry.dispose();
      curtainMaterial.dispose();
      map.dispose();
    },
  };
}