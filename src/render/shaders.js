// OWNER LANE: CORE-D. GLSL ES 3.00 sources for the chunk, entity, sky and outline materials (SPEC §5.5.3).
// three.js (ShaderMaterial, glslVersion GLSL3) prepends: precision, modelMatrix/viewMatrix/projectionMatrix/
// modelViewMatrix/cameraPosition uniforms and the attributes `position`, `normal`, `uv`.
// Pure strings: importable from Node unit tests.

import { FACE_SHADE } from '../core/constants.js';

/** Face shade by face bits (flags 0-2: E, W, up, down, S, N, 6 = plant), exactly as the mesher writes it (x255). */
const SHADE_GLSL = (() => {
  const s = [...FACE_SHADE.map((v) => Math.round(v * 255)), Math.round(0.9 * 255)].map((v) => (v / 255).toFixed(6));
  return `float bcFaceShade(float face) {
  return face < 0.5 ? ${s[0]} : face < 1.5 ? ${s[1]} : face < 2.5 ? ${s[2]} : face < 3.5 ? ${s[3]} : face < 4.5 ? ${s[4]} : face < 5.5 ? ${s[5]} : ${s[6]};
}`;
})();

/** Shared lighting + fog helpers (chunk and entity materials use the SAME curve). */
const LIGHT_FOG_GLSL = /* glsl */ `
uniform float uDaylight;
uniform float uMinLight;
uniform float uGamma;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogSphere;
// effSky = max(0, sky - (1 - daylight) * 11); ramp = 0.8^(15 - L) (close to the classic f / (4 - 3f) ramp).
// Block light is warm and gets warmer as it fades (white-yellow next to a torch, orange at the edge of its
// reach). Then the classic brightness curve lifts the mid tones: l = mix(l, 1 - (1 - l)^4, uGamma), with
// uGamma = settings.brightness (0 = moody, 1 = bright; default 0.7), and uMinLight keeps caves from going black.
// As the daylight falls, sky light turns a cool moonlit blue: the lifted sky term is multiplied by a tint that
// keeps about the same brightness but moves red/green into blue (block light stays warm). The lift is monotonic,
// so lift(max(sky, block)) == max(lift(sky), lift(block)) and the tint can sit between the two.
vec3 bcLift(vec3 l) {
  vec3 inv = 1.0 - l;
  return mix(l, 1.0 - inv * inv * inv * inv, uGamma);
}
vec3 bcLight(float sky, float block) {
  float effSky = max(0.0, sky - (1.0 - uDaylight) * 11.0);
  float skyB = pow(0.8, 15.0 - effSky);
  float b = pow(0.8, 15.0 - block);
  vec3 blk = vec3(b, b * ((b * 0.6 + 0.4) * 0.6 + 0.4), b * (b * b * 0.6 + 0.4));
  vec3 blkL = bcLift(blk);
  // full moonlight tint away from torches; it fades out where block light is strong, so a torch's warm pool
  // blends into the blue night instead of turning mauve at its edge
  float moon = (1.0 - uDaylight) * (1.0 - smoothstep(0.1, 0.45, blkL.r));
  vec3 skyC = min(bcLift(vec3(skyB)) * mix(vec3(1.0), vec3(0.82, 0.95, 1.55), moon), vec3(1.0));
  vec3 l = max(skyC, blkL);
  return max(l, vec3(uMinLight));
}
// Fog by view distance from uFogNear to uFogFar. Cylindrical (horizontal) on land so high flight does not wash
// the ground out: a LINEAR ramp from 0.8 * fogFar, so the view stays crisp to about 80% of the radius (the world
// meshes one ring beyond the fog radius, so every gap of the circular mesh radius lies past fogFar). Underwater and
// in lava (uFogSphere = 1) the fog is spherical and eased out (1 - (1 - f)^2): thick close up.
float bcFog(vec3 rel) {
  float d = mix(length(rel.xz), length(rel), uFogSphere);
  float f = clamp((d - uFogNear) / max(0.001, uFogFar - uFogNear), 0.0, 1.0);
  return mix(f, 1.0 - (1.0 - f) * (1.0 - f), uFogSphere);
}
`;

/** Wave displacement shared by chunks (and atlas-mode entities, where it is disabled). */
const WAVE_GLSL = /* glsl */ `
uniform float uTime;
uniform float uWave;
vec3 bcWave(vec3 wp, float wave, float v) {
  if (uWave <= 0.0 || wave < 0.5) return vec3(0.0);
  float ph = wp.x * 0.37 + wp.z * 0.29 + wp.y * 0.11;
  if (wave < 1.5) {          // leaves: sway +-0.03 in x/z
    return uWave * 0.03 * vec3(sin(uTime * 1.7 + ph), 0.0, cos(uTime * 1.3 + ph * 1.3));
  } else if (wave < 2.5) {   // plants: only the top vertices sway
    if (v >= 128.0) return vec3(0.0);
    return uWave * vec3(0.06 * sin(uTime * 2.1 + ph), 0.0, 0.05 * cos(uTime * 1.6 + ph * 1.7));
  }
  // water: bob y +-0.03 (phase from world x/z so shared vertices stay together)
  float pw = wp.x * 0.5 + wp.z * 0.37;
  return vec3(0.0, uWave * 0.03 * sin(uTime * 1.9 + pw), 0.0);
}
`;

// Smooth light and AO are blended BILINEARLY per pixel from the quad's four corners (v1.4, review CORE-R2): every
// vertex carries all four corner values (aCorner, flat) and its own corner of the face (flags bits 7-8), so a face
// has no triangle diagonal, whatever its corners are. aCorner per corner (BL, BR, TR, TL): sky*8 | block*8 << 7 |
// ao << 14, read as float (exact up to 65535). AO is turned into its brightness factor per corner and multiplied by
// the face shade (from the face bits, so chunk geometry needs no aLight attribute), then blended.
export const CHUNK_VERT = /* glsl */ `
in vec4 aTex;    // layer, u, v (1/256 tile), flags
in vec4 aCorner; // the quad's corner lights BL, BR, TR, TL
uniform vec4 uAnimFrames; // frames per ANIM mode (0, water, lava, fire)
uniform vec4 uAnimFps;
${WAVE_GLSL}
${SHADE_GLSL}
out vec2 vUv;
flat out float vLayer;
flat out vec4 vSky4;   // sky level per corner
flat out vec4 vBlk4;   // block level per corner
flat out vec4 vAo4;    // AO brightness factor x face shade per corner
out vec2 vFace;        // position inside the face: BL (0,0), BR (1,0), TR (1,1), TL (0,1)
out vec3 vRel;     // world position relative to the camera (fog)
void main() {
  float flags = aTex.w;
  float anim = mod(floor(flags / 8.0), 4.0);
  float wave = mod(floor(flags / 32.0), 4.0);
  float corner = mod(floor(flags / 128.0), 4.0);
  vFace = vec2(step(0.5, corner) * step(corner, 2.5), step(1.5, corner));
  vec4 ao = floor(aCorner / 16384.0);
  vec4 rest = aCorner - ao * 16384.0;
  vec4 blk = floor(rest / 128.0);
  vSky4 = (rest - blk * 128.0) * 0.125;
  vBlk4 = blk * 0.125;
  // AO 0..3 -> 0.5, 0.7, 0.85, 1.0, times the face shade
  vAo4 = (0.5 + 0.2 * min(ao, 1.0) + 0.15 * clamp(ao - 1.0, 0.0, 1.0) + 0.15 * clamp(ao - 2.0, 0.0, 1.0)) * bcFaceShade(mod(flags, 8.0));
  float layer = aTex.x;
  if (anim > 0.5) {
    int ai = int(anim + 0.5);
    layer += mod(floor(uTime * uAnimFps[ai]), max(1.0, uAnimFrames[ai]));
  }
  vLayer = layer;
  vUv = aTex.yz / 256.0;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.xyz += bcWave(wp.xyz, wave, aTex.z);
  vRel = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const CHUNK_FRAG = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uTex;
${LIGHT_FOG_GLSL}
in vec2 vUv;
flat in float vLayer;
flat in vec4 vSky4;
flat in vec4 vBlk4;
flat in vec4 vAo4;
in vec2 vFace;
in vec3 vRel;
layout(location = 0) out highp vec4 outColor;
// bilinear blend of corner values (x BL, y BR, z TR, w TL) with the weights w of the face position
float bcBilerp(vec4 c, vec4 w) { return dot(c, w); }
void main() {
  vec4 tex = texture(uTex, vec3(vUv, vLayer));
#if defined(CUTOUT)
  // Mipmaps average alpha toward 0.5 at a distance and leaves erode; lower the threshold with the mip level.
  vec2 tc = vUv * 16.0;
  vec2 dx = dFdx(tc), dy = dFdy(tc);
  float lod = 0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1e-8));
  float thr = mix(0.5, 0.18, clamp(lod / 3.0, 0.0, 1.0));
  if (tex.a < thr) discard;
  tex.a = 1.0;
#elif defined(TRANSLUCENT)
  if (tex.a < 0.02) discard;
#else
  tex.a = 1.0;
#endif
  vec2 f = clamp(vFace, 0.0, 1.0), g = 1.0 - f;
  vec4 w = vec4(g.x * g.y, f.x * g.y, f.x * f.y, g.x * f.y);
  vec3 color = tex.rgb * bcBilerp(vAo4, w) * bcLight(bcBilerp(vSky4, w), bcBilerp(vBlk4, w));
  color = mix(color, uFogColor, bcFog(vRel));
  outColor = vec4(color, tex.a);
}
`;

/**
 * Entity material (SPEC §5.5.5). Defines: MAP (2D texture), ATLAS (array texture + chunk vertex format),
 * PARTS n (uParts[n] per-vertex pose matrices, attribute aPart), else plain colour.
 */
export const ENTITY_VERT = /* glsl */ `
#ifdef ATLAS
in vec4 aTex;
in vec4 aLight;
uniform vec4 uAnimFrames;
uniform vec4 uAnimFps;
uniform float uTime;
out vec2 vUv;
flat out float vLayer;
out float vAo;
#endif
#ifdef MAP
out vec2 vUv;
#endif
#ifdef PARTS
in float aPart;
uniform mat4 uParts[PARTS];
#endif
out float vShade;
out vec3 vRel;
void main() {
  vec4 lp = vec4(position, 1.0);
  vec3 n = normal;
#ifdef PARTS
  mat4 pm = uParts[int(aPart + 0.5)];
  lp = pm * lp;
  n = mat3(pm) * n;
#endif
  vec4 wp = modelMatrix * lp;
#ifdef ATLAS
  float flags = aTex.w;
  float anim = mod(floor(flags / 8.0), 4.0);
  float layer = aTex.x;
  if (anim > 0.5) {
    int ai = int(anim + 0.5);
    layer += mod(floor(uTime * uAnimFps[ai]), max(1.0, uAnimFrames[ai]));
  }
  vLayer = layer;
  vUv = aTex.yz / 256.0;
  vAo = aLight.z;
  vShade = aLight.w / 255.0;
#else
  // Directional face shade like blocks (up 1.0, N/S 0.8, E/W 0.6, down 0.5); geometry without normals = 1.
  vec3 wn = mat3(modelMatrix) * n;
  float nl = length(wn);
  if (nl < 0.01) { vShade = 1.0; }
  else {
    wn /= nl;
    vec3 q = wn * wn;
    vShade = q.x * 0.6 + q.z * 0.8 + q.y * (wn.y > 0.0 ? 1.0 : 0.5);
  }
#endif
#ifdef MAP
  vUv = uv;
#endif
  vRel = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const ENTITY_FRAG = /* glsl */ `
precision highp sampler2DArray;
${LIGHT_FOG_GLSL}
uniform float uLightSky;
uniform float uLightBlock;
uniform vec4 uTint;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uAlphaTest;
uniform float uFogOn;
#ifdef ATLAS
uniform sampler2DArray uTex;
in vec2 vUv;
flat in float vLayer;
in float vAo;
#endif
#ifdef MAP
uniform sampler2D uMap;
in vec2 vUv;
#endif
in float vShade;
in vec3 vRel;
layout(location = 0) out highp vec4 outColor;
void main() {
  vec4 tex = vec4(uColor, uOpacity);
#ifdef ATLAS
  tex *= texture(uTex, vec3(vUv, vLayer));
  float ao = vAo < 0.5 ? 0.5 : vAo < 1.5 ? 0.7 : vAo < 2.5 ? 0.85 : 1.0;
#else
  float ao = 1.0;
#endif
#ifdef MAP
  tex *= texture(uMap, vUv);
#endif
  if (tex.a < uAlphaTest) discard;
  vec3 color = tex.rgb * vShade * ao * bcLight(uLightSky, uLightBlock);
  color = mix(color, uTint.rgb, clamp(uTint.a, 0.0, 1.0));
  color = mix(color, uFogColor, bcFog(vRel) * uFogOn);
  outColor = vec4(color, tex.a);
}
`;

/** Full-screen sky gradient (drawn first, no depth). Direction from the inverse view-projection. */
export const SKY_VERT = /* glsl */ `
uniform mat4 uInvViewProj;
out vec3 vDir;
void main() {
  vec2 p = position.xy;           // full-screen triangle in clip space
  vec4 w = uInvViewProj * vec4(p, 1.0, 1.0);
  vDir = w.xyz / w.w - cameraPosition;
  gl_Position = vec4(p, 0.9999, 1.0);
}
`;

export const SKY_FRAG = /* glsl */ `
uniform vec3 uSkyColor;
uniform vec3 uFogColor;
uniform vec4 uSunset;   // rgb + strength (0 = none)
uniform vec3 uSunDir;
uniform float uSkyFlat; // 1 = whole sky is the fog colour (underwater / lava)
in vec3 vDir;
layout(location = 0) out highp vec4 outColor;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  // Zenith = sky colour, horizon = fog colour; the band hugs the horizon like the classic sky plane.
  float t = clamp(h * 2.6, 0.0, 1.0);
  t = 1.0 - (1.0 - t) * (1.0 - t);
  vec3 col = mix(uFogColor, uSkyColor, t);
  // Sunrise / sunset glow toward the sun, strongest at the horizon.
  if (uSunset.a > 0.0) {
    vec2 sd = uSunDir.xz;
    float sl = length(sd);
    vec2 dh = d.xz;
    float dl = length(dh);
    float facing = (sl > 1e-4 && dl > 1e-4) ? max(0.0, dot(dh / dl, sd / sl)) : 0.0;
    float band = exp(-abs(h - 0.04) * 5.0) * smoothstep(-0.08, 0.02, h);
    float g = uSunset.a * pow(facing, 2.5) * band;
    col = mix(col, uSunset.rgb, clamp(g, 0.0, 1.0));
  }
  // Below the horizon the sky fades into the fog colour (t = 0 there), so terrain holes never show a seam.
  col = mix(col, uFogColor, uSkyFlat);
  outColor = vec4(col, 1.0);
}
`;

/**
 * Kid outline: each box edge is a screen-space CAPSULE (a strip with round end caps), so the strips of edges that
 * meet at a corner overlap in a clean round joint at any angle - also for an edge seen end-on - with no spikes
 * (review CORE-R7). Attributes: position = edge start, aEnd = edge end, aSide (-1/+1), aAlong (0/1).
 * uWidth is the width in blocks, at least uMinPx * depth (so it stays a few pixels wide far away); uViewport is
 * the current viewport in framebuffer pixels (x, y, w, h), set per draw by the outline mesh.
 */
export const OUTLINE_RIBBON_VERT = /* glsl */ `
in vec3 aEnd;
in float aSide;
in float aAlong;
uniform float uWidth;
uniform float uMinPx;   // minimum width in "blocks per block of depth" (keeps lines visible far away)
uniform vec4 uViewport;
flat out vec2 vA;       // segment ends, framebuffer pixels
flat out vec2 vB;
flat out vec2 vR;       // capsule radius (px) at A and at B
void main() {
  vec3 a = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 b = (modelMatrix * vec4(aEnd, 1.0)).xyz;
  // pull toward the camera so the outline is never buried in the block faces it outlines
  vec3 ta = cameraPosition - a, tb = cameraPosition - b;
  float da = length(ta), db = length(tb);
  a += ta / max(da, 1e-4) * min(0.06, da * 0.2);
  b += tb / max(db, 1e-4) * min(0.06, db * 0.2);
  vec4 va = viewMatrix * vec4(a, 1.0);
  vec4 vb = viewMatrix * vec4(b, 1.0);
  // clip the segment to just in front of the near plane (view space looks down -z)
  const float ZC = -0.1;
  if (va.z > ZC && vb.z > ZC) { vA = vec2(0.0); vB = vec2(0.0); vR = vec2(0.0); gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  if (va.z > ZC) va = mix(va, vb, (ZC - va.z) / (vb.z - va.z));
  if (vb.z > ZC) vb = mix(vb, va, (ZC - vb.z) / (va.z - vb.z));
  vec4 ca = projectionMatrix * va;
  vec4 cb = projectionMatrix * vb;
  vec2 hv = 0.5 * uViewport.zw;
  vec2 pa = (ca.xy / ca.w) * hv + hv + uViewport.xy;
  vec2 pb = (cb.xy / cb.w) * hv + hv + uViewport.xy;
  float wa = max(uWidth, -va.z * uMinPx) * 0.5 * projectionMatrix[1][1] * hv.y / -va.z;
  float wb = max(uWidth, -vb.z * uMinPx) * 0.5 * projectionMatrix[1][1] * hv.y / -vb.z;
  vec2 d = pb - pa;
  float len = length(d);
  vec2 dir = len > 1e-3 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float r = max(wa, wb) + 1.0;   // the quad covers the capsule; the fragment shader cuts it to shape
  vec2 p = (aAlong > 0.5 ? pb : pa) + dir * (aAlong * 2.0 - 1.0) * r + nrm * aSide * r;
  vA = pa; vB = pb; vR = vec2(wa, wb);
  vec4 c = aAlong > 0.5 ? cb : ca;
  gl_Position = vec4(((p - uViewport.xy - hv) / hv) * c.w, c.z, c.w);
}
`;

export const OUTLINE_RIBBON_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
flat in vec2 vA;
flat in vec2 vB;
flat in vec2 vR;
layout(location = 0) out highp vec4 outColor;
void main() {
  vec2 p = gl_FragCoord.xy;
  vec2 ab = vB - vA;
  float l2 = dot(ab, ab);
  float t = l2 > 1e-6 ? clamp(dot(p - vA, ab) / l2, 0.0, 1.0) : 0.0;
  if (length(p - (vA + ab * t)) > mix(vR.x, vR.y, t)) discard;
  outColor = vec4(uColor, uOpacity);
}
`;
