import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";
import { FACTORY_ROOM as C } from "@/constants/factoryRoom";

/** Small deterministic, seamless material maps. Repeated in metres, never stretched to the room. */
export function createRoomTexture(kind: "floor" | "wall" | "ceiling", repeatX: number, repeatY: number) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = C.textureSize;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Room textures require a 2D canvas context");
  const size = C.textureSize;
  const pixels = context.createImageData(size, size);
  let seed = 71;
  for (let i = 0; i < pixels.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const value = 240 + (seed % 13);
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
    pixels.data[i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  if (kind === "floor") {
    context.strokeStyle = "#c8cdcf";
    context.lineWidth = 1;
    context.strokeRect(0.5, 0.5, size - 1, size - 1);
  } else {
    context.fillStyle = kind === "wall" ? "#b9c0c3" : "#c3c9cb";
    context.fillRect(0, 0, kind === "wall" ? 3 : 8, size);
    context.fillStyle = "#ffffff";
    context.fillRect(kind === "wall" ? 3 : 8, 0, 2, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
