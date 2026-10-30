import type { EquipmentKind } from "@/types/layout";
import { LINK_RULES, type LinkType } from "@/types/links";
import type { SceneTemplate } from "@/types/sceneTemplate";

const KINDS: ReadonlySet<string> = new Set<EquipmentKind>([
  "robot",
  "pallet",
  "conveyor",
  "amr",
  "dock",
  "scanner",
  "floor",
  "rack",
  "door",
  "rail",
  "transfer",
]);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Problems in one template (JSON data): kinds, finite poses, floor sizes, link types/indices against LINK_RULES. */
export function templateErrors(data: unknown): string[] {
  if (!record(data)) return ["template is not an object"];
  const errors: string[] = [];
  for (const key of ["id", "name", "description"] as const)
    if (typeof data[key] !== "string" || !data[key])
      errors.push(`${key} must be a non-empty string`);
  const equipment = Array.isArray(data.equipment) ? data.equipment : [];
  if (!equipment.length) errors.push("equipment must be a non-empty array");
  equipment.forEach((entry: unknown, i) => {
    if (
      !record(entry) ||
      typeof entry.kind !== "string" ||
      !KINDS.has(entry.kind)
    )
      return errors.push(`equipment[${i}]: unknown kind`);
    if (!finite(entry.x) || !finite(entry.z) || !finite(entry.yaw))
      errors.push(`equipment[${i}]: pose must be finite`);
    if (entry.settings !== undefined && !record(entry.settings))
      errors.push(`equipment[${i}]: settings must be an object`);
    if (entry.kind === "floor") {
      const floor = entry.floor;
      if (
        !record(floor) ||
        !Number.isInteger(floor.width) ||
        !Number.isInteger(floor.depth) ||
        !finite(floor.wallHeight) ||
        floor.wallHeight < 0
      )
        errors.push(
          `equipment[${i}]: floor needs integer width/depth and wallHeight >= 0`,
        );
    }
  });
  if (data.links !== undefined && !Array.isArray(data.links))
    errors.push("links must be an array");
  (Array.isArray(data.links) ? data.links : []).forEach((link: unknown, i) => {
    if (
      !record(link) ||
      typeof link.type !== "string" ||
      !(link.type in LINK_RULES)
    )
      return errors.push(`links[${i}]: unknown type`);
    const rule = LINK_RULES[link.type as LinkType],
      from = equipment[link.from as number],
      to = equipment[link.to as number];
    if (
      !Number.isInteger(link.from) ||
      !Number.isInteger(link.to) ||
      !record(from) ||
      !record(to)
    )
      return errors.push(`links[${i}]: index out of range`);
    if (from.kind !== rule.from || !rule.to.includes(to.kind as EquipmentKind))
      errors.push(
        `links[${i}]: ${link.type} cannot link ${from.kind} -> ${to.kind}`,
      );
  });
  if (data.lighting !== undefined && data.lighting !== "factory")
    errors.push('lighting must be "factory" when set');
  if (
    data.props !== undefined &&
    (!Array.isArray(data.props) ||
      data.props.some(
        (p: unknown) =>
          !record(p) ||
          (p.source !== "factory" &&
            p.source !== "railInOut" &&
            p.source !== "agv" &&
            p.source !== "robotBase" &&
            p.source !== "robotArmPlace") ||
          typeof p.node !== "string" ||
          !p.node,
      ))
  )
    errors.push(
      'props must be an array of { source: "factory" | "railInOut" | "agv", node, position?, yaw? }',
    );
  return errors;
}

/** Validates the template list (each template + unique ids); throws with every problem found. */
export function parseTemplates(
  list: readonly unknown[],
): readonly SceneTemplate[] {
  const errors: string[] = [],
    ids = new Set<string>();
  list.forEach((data, i) => {
    for (const error of templateErrors(data))
      errors.push(`template ${i}: ${error}`);
    const id = record(data) ? data.id : undefined;
    if (typeof id === "string") {
      if (ids.has(id)) errors.push(`template ${i}: duplicate id "${id}"`);
      ids.add(id);
    }
  });
  if (errors.length)
    throw new Error(`Invalid scene templates:\n${errors.join("\n")}`);
  return list as readonly SceneTemplate[];
}
