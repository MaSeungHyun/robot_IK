import { useEffect, useState } from "react";
import { DoubleSide, LinearSRGBColorSpace, MeshStandardMaterial, NoColorSpace, RepeatWrapping, SRGBColorSpace, TextureLoader } from "three";
import type { Texture } from "three";
import { useViewportSettingsStore } from "@/stores/useViewportSettingsStore";
// Exact copies of factory.glb "Enviroment" materials (images extracted byte-for-byte from the glb):
//  - "wall"     (Enviroment wall primitive): baseColor 15, normal 14, metallicRoughness 16, emission 13 x strength 3
//  - "BG_Floor" (Enviroment floor primitive): baseColor 20, normal 19, metallicRoughness 21, KHR_texture_transform scale 5, offset (0,-4)
// glTF textures are not flipped (flipY = false), so kit geometry carries the glb's raw UVs.
import wallColor from "@/assets/textures/room/factory_wall_atlas_color.png?url";
import wallNormal from "@/assets/textures/room/factory_wall_atlas_normal.png?url";
import wallMr from "@/assets/textures/room/factory_wall_atlas_mr.png?url";
import wallEmissive from "@/assets/textures/room/factory_wall_atlas_emissive.png?url";
import floorColor from "@/assets/textures/room/factory_floor_color.png?url";
import floorNormal from "@/assets/textures/room/factory_floor_normal.png?url";
import floorMr from "@/assets/textures/room/factory_floor_mr.png?url";

export type KitMaterials = { wall: MeshStandardMaterial; floor: MeshStandardMaterial };

const loader = new TextureLoader();
function load(url: string, color: boolean, transform?: { repeat: number; offset: [number, number] }) {
  return new Promise<Texture>((resolve, reject) => loader.load(url, (texture) => {
    texture.flipY = false;
    texture.colorSpace = color ? SRGBColorSpace : url === wallMr || url === floorMr ? LinearSRGBColorSpace : NoColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.anisotropy = 4;
    if (transform) { texture.repeat.set(transform.repeat, transform.repeat); texture.offset.set(...transform.offset); }
    texture.needsUpdate = true;
    resolve(texture);
  }, undefined, reject));
}

let shared: Promise<KitMaterials | null> | null = null;
function loadKit() {
  shared ??= (async () => {
    const floorT = { repeat: 5, offset: [0, -4] as [number, number] };
    const [wc, wn, wm, we, fc, fn, fm] = await Promise.all([
      load(wallColor, true), load(wallNormal, false), load(wallMr, false), load(wallEmissive, true),
      load(floorColor, true, floorT), load(floorNormal, false, floorT), load(floorMr, false, floorT),
    ]);
    const wall = new MeshStandardMaterial({ name: "wall", map: wc, normalMap: wn, metalnessMap: wm, roughnessMap: wm, metalness: 1, roughness: 1, emissive: 0xffffff, emissiveMap: we, emissiveIntensity: 3, side: DoubleSide });
    const floor = new MeshStandardMaterial({ name: "BG_Floor", map: fc, normalMap: fn, metalnessMap: fm, roughnessMap: fm, metalness: 1, roughness: 1, side: DoubleSide });
    return { wall, floor };
  })().catch(() => null);
  return shared;
}

/** Shared Enviroment kit materials, or null while loading / on the "performance" tier / if images fail (procedural fallback). */
export function useKitMaterials(): KitMaterials | null {
  const lowQuality = useViewportSettingsStore((state) => state.renderQuality === "performance");
  const [kit, setKit] = useState<KitMaterials | null>(null);
  useEffect(() => {
    if (lowQuality) return;
    let live = true;
    void loadKit().then((value) => { if (live) setKit(value); });
    return () => { live = false; };
  }, [lowQuality]);
  return lowQuality ? null : kit;
}