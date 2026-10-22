import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, Vector3 } from "three";
import { FACTORY_ROOM as C } from "@/constants/factoryRoom";
import { createRoomTexture } from "@/objects/room/roomTextures";
import { useRoomMaps } from "@/objects/room/roomMaterials";
import RoomFrame from "./RoomFrame";
import useSceneGlow from "@/viewport/useSceneGlow";
import { GLOW_GAIN } from "@/constants/viewport";
import type { RoomBeam } from "./RoomFrame";
import type { WallOpening } from "@/domain/room/roomWalls";
import { clipBeams, cutBand, rectsGeometry } from "./wallCut";

const noRaycast = () => {};
const NO_OPENINGS: WallOpening[] = [];
/** `openings`: door cuts in wall-local metres; the wall, bands and frame are rebuilt around them. */
export default function RoomWall({ length, height, preview, openings = NO_OPENINGS }: { length: number; height: number; preview: boolean; openings?: WallOpening[] }) {
  const group = useRef<Group>(null);
  const glow = useSceneGlow();
  const cameraPoint = useMemo(() => new Vector3(), []);
  const texture = useMemo(() => createRoomTexture("wall", length / C.panelWidth, 1), [length]);
  useEffect(() => () => texture.dispose(), [texture]);
  // Light-grey painted panels (in-house PBR); flat procedural fallback on the performance tier.
  const pbr = useRoomMaps("wall", length, height);
  const baseHeight = Math.min(0.9, height * 0.22);
  const windowBottom = height * 0.67;
  const windowHeight = height * 0.22;
  const beams = useMemo(() => {
    const result: RoomBeam[] = [];
    const bays = Math.max(1, Math.ceil(length / C.baySpacing));
    const thickness = Math.min(0.12, length / 15, height / 15);
    for (let i = 0; i <= bays; i++) {
      const x = -length / 2 + length * i / bays;
      result.push({ from: [x, 0, 0.06], to: [x, height, 0.06], thickness });
    }
    for (const y of [baseHeight, windowBottom, windowBottom + windowHeight, height]) {
      result.push({ from: [-length / 2, y, 0.04], to: [length / 2, y, 0.04], thickness: thickness * 0.6 });
    }
    const panes = Math.ceil(length / C.panelWidth);
    for (let i = 1; i < panes; i++) {
      const x = -length / 2 + length * i / panes;
      result.push({ from: [x, windowBottom, 0.045], to: [x, windowBottom + windowHeight, 0.045], thickness: 0.025 });
    }
    return result;
  }, [length, height, baseHeight, windowBottom, windowHeight]);
  // Large-panel grid (~2 m wide × 1.5 m high modules): thin dark joint strips, one instanced set.
  const eaveBottom = height - Math.min(0.6, height * 0.08);
  const eaveHeight = Math.min(0.35, height * 0.05);
  const joints = useMemo(() => {
    const result: RoomBeam[] = [];
    const t = 0.02;
    const columns = Math.max(1, Math.round(length / 2));
    const bands: [number, number][] = [[baseHeight, windowBottom], [windowBottom + windowHeight, eaveBottom]];
    for (const [y0, y1] of bands) {
      if (y1 - y0 < 0.2) continue;
      for (let i = 1; i < columns; i++) {
        const x = -length / 2 + (length * i) / columns;
        result.push({ from: [x, y0, 0.01], to: [x, y1, 0.01], thickness: t });
      }
      const rows = Math.max(1, Math.round((y1 - y0) / 1.5));
      for (let r = 1; r < rows; r++) {
        const y = y0 + ((y1 - y0) * r) / rows;
        result.push({ from: [-length / 2, y, 0.01], to: [length / 2, y, 0.01], thickness: t });
      }
    }
    return result;
  }, [length, baseHeight, windowBottom, windowHeight, eaveBottom]);
  // Wall surface and bands as rect sets around the openings (one geometry each, wall-wide UVs).
  const surfaces = useMemo(() => {
    const band = (y0: number, y1: number) => rectsGeometry(cutBand(length, y0, y1, openings), length, height);
    return { wall: band(0, height), base: band(0, baseHeight), window: band(windowBottom, windowBottom + windowHeight), eave: band(eaveBottom, eaveBottom + eaveHeight) };
  }, [length, height, baseHeight, windowBottom, windowHeight, eaveBottom, eaveHeight, openings]);
  useEffect(() => () => { for (const geometry of Object.values(surfaces)) geometry.dispose(); }, [surfaces]);
  const frameBeams = useMemo(() => clipBeams(beams, openings), [beams, openings]);
  const jointBeams = useMemo(() => clipBeams(joints, openings), [joints, openings]);
  useFrame(({ camera }) => {
    if (group.current) {
      camera.getWorldPosition(cameraPoint);
      group.current.worldToLocal(cameraPoint);
      // Cut away the near wall, including its frame, when viewing from outside.
      group.current.visible = cameraPoint.z >= 0;
    }
  });
  return (
    <group ref={group}>
      <mesh geometry={surfaces.wall} raycast={preview ? noRaycast : undefined}>
        {pbr && !preview ? (
          <meshStandardMaterial key="pbr" {...pbr} color="#ffffff" roughness={1} metalness={0} />
        ) : (
          <meshStandardMaterial key="flat" map={texture} color={preview ? "#38bdf8" : C.wallColor} roughness={0.75} transparent={preview} opacity={0.35} depthWrite={!preview} />
        )}
      </mesh>
      {!preview && <>
        <mesh geometry={surfaces.base} position={[0, 0, 0.008]} raycast={noRaycast}>
          {/* Dado band: flat panels, no ribs. */}
          <meshStandardMaterial map={pbr ? null : texture} color={C.baseColor} roughness={0.65} metalness={pbr ? 0.2 : 0} />
        </mesh>
        <mesh geometry={surfaces.window} position={[0, 0, 0.012]} raycast={noRaycast}>
          {glow ? (
            <meshBasicMaterial key="glow" color={[0.86 * GLOW_GAIN.window, 0.92 * GLOW_GAIN.window, 0.94 * GLOW_GAIN.window]} toneMapped={false} />
          ) : (
            <meshStandardMaterial key="flat" color="#dcebf0" emissive="#b9d4e0" emissiveIntensity={0.3} roughness={0.25} metalness={0.15} />
          )}
        </mesh>
        {/* Continuous bright clerestory strip under the eaves (unlit, no real light). */}
        <mesh geometry={surfaces.eave} position={[0, 0, 0.012]} raycast={noRaycast}>
          {glow ? (
            <meshBasicMaterial key="glow" color={[GLOW_GAIN.eave, GLOW_GAIN.eave, GLOW_GAIN.eave]} toneMapped={false} />
          ) : (
            <meshBasicMaterial key="flat" color="#eef3f5" />
          )}
        </mesh>
        <RoomFrame beams={frameBeams} />
        {pbr && <RoomFrame beams={jointBeams} color="#8e979b" metalness={0} />}
      </>}
    </group>
  );
}


