/**
 * Removes textures/images from a binary glTF (GLB) so it parses without image decoding
 * (Node, Web Workers). Geometry and node hierarchy are all the headless simulation needs.
 */
export function stripGlbTextures(glb: ArrayBuffer): ArrayBuffer {
  const view = new DataView(glb);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength))) as Record<string, unknown> & {
    materials?: Record<string, unknown>[]; extensionsUsed?: string[]; extensionsRequired?: string[];
  };
  delete json.textures; delete json.images; delete json.samplers;
  for (const material of json.materials ?? []) {
    for (const key of Object.keys(material)) if (key.endsWith("Texture")) delete material[key];
    const pbr = material.pbrMetallicRoughness as Record<string, unknown> | undefined;
    if (pbr) for (const key of Object.keys(pbr)) if (key.endsWith("Texture")) delete pbr[key];
    delete material.extensions;
  }
  json.extensionsUsed = (json.extensionsUsed ?? []).filter((e) => !/texture|webp|basisu/i.test(e));
  json.extensionsRequired = (json.extensionsRequired ?? []).filter((e) => !/texture|webp|basisu/i.test(e));
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const padded = Math.ceil(encoded.length / 4) * 4;
  const rest = new Uint8Array(glb, 20 + jsonLength);
  const out = new Uint8Array(20 + padded + rest.length);
  const header = new DataView(out.buffer);
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, out.length, true);
  header.setUint32(12, padded, true); header.setUint32(16, 0x4e4f534a, true);
  out.set(encoded, 20); out.fill(0x20, 20 + encoded.length, 20 + padded); out.set(rest, 20 + padded);
  return out.buffer;
}
