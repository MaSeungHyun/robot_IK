import { useEffect, useMemo, useState } from "react";
import { LinearSRGBColorSpace, NoColorSpace, RepeatWrapping, SRGBColorSpace, TextureLoader } from "three";
import type { Texture } from "three";
import { useViewportSettingsStore } from "@/stores/useViewportSettingsStore";
import floorColor from "@/assets/textures/room/floor_color.webp?url";
import floorNormal from "@/assets/textures/room/floor_normal.webp?url";
import floorRoughness from "@/assets/textures/room/floor_roughness.webp?url";
import wallColor from "@/assets/textures/room/wall_color.webp?url";
import wallNormal from "@/assets/textures/room/wall_normal.webp?url";
import wallRoughness from "@/assets/textures/room/wall_roughness.webp?url";
import ceilingColor from "@/assets/textures/room/ceiling_color.webp?url";
import ceilingNormal from "@/assets/textures/room/ceiling_normal.webp?url";
import ceilingRoughness from "@/assets/textures/room/ceiling_roughness.webp?url";

/** In-house PBR sets (see assets/textures/room/CREDITS.md) and the metres one tile covers (x × y). */
const SETS = {
  // Grey concrete with fine cracks; one 6 m slab per tile, saw-cut joint drawn on the tile edge.
  floor: { tileX: 6, tileY: 6, map: floorColor, normalMap: floorNormal, roughnessMap: floorRoughness },
  // Light-grey painted panel with a fine, non-directional grain: 3 m tile (grain stays a few mm).
  wall: { tileX: 3, tileY: 3, map: wallColor, normalMap: wallNormal, roughnessMap: wallRoughness },
  // Ribbed steel deck: 23 parallel lines per tile along the texture's U axis → ~22 cm pitch at 5 m.
  ceiling: { tileX: 5, tileY: 5, map: ceilingColor, normalMap: ceilingNormal, roughnessMap: ceilingRoughness },
} as const;
type Kind = keyof typeof SETS;
type Slot = "map" | "normalMap" | "roughnessMap";
export type RoomMaps = Record<Slot, Texture>;

const loader = new TextureLoader();
const base = new Map<string, Texture>();
const pending = new Map<string, Promise<void>>();
/** Resolves once every map of the set has its image (a clone made earlier has a null image, which WebGPU rejects). */
function loadSet(kind: Kind) {
  return Promise.all((["map", "normalMap", "roughnessMap"] as const).map((slot) => {
    const url = SETS[kind][slot];
    source(url, slot);
    return pending.get(url);
  }));
}
/** One loaded image per file; per-mesh clones share its Source, so the GPU upload happens once. */
function source(url: string, slot: Slot) {
  let texture = base.get(url);
  if (!texture) {
    let resolve!: () => void;
    pending.set(url, new Promise<void>((done) => (resolve = done)));
    // An error still resolves so the surface falls back to the flat look instead of waiting forever.
    texture = loader.load(url, () => resolve(), undefined, () => resolve());
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.colorSpace = slot === "map" ? SRGBColorSpace : slot === "normalMap" ? NoColorSpace : LinearSRGBColorSpace;
    texture.anisotropy = 4;
    base.set(url, texture);
  }
  return texture;
}

/**
 * World-scale PBR maps for a room surface `width` × `height` metres, or null on the
 * "performance" render tier (callers keep the flat procedural look there).
 */
export function useRoomMaps(kind: Kind, width: number, height: number): RoomMaps | null {
  const lowQuality = useViewportSettingsStore((state) => state.renderQuality === "performance");
  const [loaded, setLoaded] = useState<ReadonlySet<Kind>>(() => new Set());
  const ready = loaded.has(kind);
  useEffect(() => {
    if (lowQuality || ready) return;
    let live = true;
    void loadSet(kind).then(() => { if (live) setLoaded((prev) => new Set(prev).add(kind)); });
    return () => { live = false; };
  }, [kind, lowQuality, ready]);
  const maps = useMemo(() => {
    if (lowQuality || !ready) return null;
    const set = SETS[kind];
    const make = (slot: Slot) => {
      const texture = source(set[slot], slot).clone();
      texture.repeat.set(width / set.tileX, height / set.tileY);
      return texture;
    };
    return { map: make("map"), normalMap: make("normalMap"), roughnessMap: make("roughnessMap") };
  }, [kind, width, height, lowQuality, ready]);
  useEffect(() => () => {
    if (maps) for (const texture of Object.values(maps)) texture.dispose();
  }, [maps]);
  return maps;
}
