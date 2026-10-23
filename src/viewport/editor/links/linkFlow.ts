import { BufferAttribute, BufferGeometry, Color, DoubleSide, ShaderMaterial, Vector3 } from "three";

/** Shared clock for every link path (advanced once per frame by LinkOverlay). */
export const LINK_FLOW_TIME = { value: 0 };

/**
 * Glowing flow ribbon: a flat strip on the floor with a bright core, a soft additive falloff and
 * light streaks scrolling from start to end (link direction). No bloom: the glow is in the shader
 * (alpha-blended so it reads on the light concrete floor, double-sided, no depth write, not tone-mapped). All paths share one program and the time uniform.
 */
export function createLinkFlowMaterial(color: string) {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
    uniforms: {
      time: LINK_FLOW_TIME,
      color: { value: new Color(color) },
      opacity: { value: 0.75 },
      length: { value: 1 },
      /** 1 while the path is selected: wider core, faster/brighter streaks. */
      emphasis: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform float time; uniform vec3 color; uniform float opacity; uniform float length; uniform float emphasis;
      varying vec2 vUv;
      void main(){
        float across=abs(vUv.y*2.0-1.0);
        float core=1.0-smoothstep(0.08+0.06*emphasis,0.2+0.08*emphasis,across);
        float glow=exp(-across*across*7.0)*0.45;
        // Streaks every 0.9 m of path, moving start -> end at 1.2 m/s (faster when selected).
        float phase=fract(vUv.x*length/0.9-time*(1.2+0.8*emphasis)/0.9);
        float streak=smoothstep(0.0,0.75,phase)*(1.0-smoothstep(0.75,0.82,phase));
        // Fade the ends so the strip meets the equipment softly.
        float ends=smoothstep(0.0,0.04,vUv.x)*(1.0-smoothstep(0.96,1.0,vUv.x));
        // Alpha blending (additive vanished on the bright floor): solid core + soft halo, streaks
        // brighten the core towards white.
        float alpha=clamp(core*0.95+glow*0.9+streak*(core+glow*0.8),0.0,1.0)*ends*opacity;
        vec3 rgb=mix(color*0.55,color,core)+vec3(1.0)*streak*core*0.6;
        gl_FragColor=vec4(rgb,alpha);
      }`,
  });
}

/** Flat strip (XZ plane) of `width` along `points`; uv.x = arc length 0..1, uv.y = side 0..1. Returns its length too. */
export function createRibbon(points: Vector3[], width: number) {
  const n = points.length, half = width / 2;
  const position = new Float32Array(n * 6), uv = new Float32Array(n * 4), index: number[] = [];
  const lengths = [0];
  for (let i = 1; i < n; i++) lengths.push(lengths[i - 1] + points[i].distanceTo(points[i - 1]));
  const total = lengths[n - 1] || 1;
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const p = points[i];
    position.set([p.x - dz * half, p.y, p.z + dx * half, p.x + dz * half, p.y, p.z - dx * half], i * 6);
    uv.set([lengths[i] / total, 0, lengths[i] / total, 1], i * 4);
    if (i < n - 1) { const k = i * 2; index.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); } // CCW from above: faces up
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(position, 3));
  geometry.setAttribute("uv", new BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return { geometry, length: total };
}
/** Path colour (e.g. LINK_ACTIVE_COLOR while the link touches the selection). */
export function setLinkFlowColor(material: ShaderMaterial, color: string) {
  (material.uniforms.color.value as Color).set(color);
}
/** Per-path uniforms (opacity / dim, arc length for streak spacing, selection emphasis). */
export function setLinkFlowState(material: ShaderMaterial, opacity: number, length: number, selected: boolean) {
  material.uniforms.opacity.value = opacity;
  material.uniforms.length.value = length;
  material.uniforms.emphasis.value = selected ? 1 : 0;
}
