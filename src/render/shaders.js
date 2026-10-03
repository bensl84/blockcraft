// OWNER LANE: CORE-D. GLSL ES 3.00 sources for the chunk, entity, sky and outline materials (SPEC §5.5.3).
// three.js (ShaderMaterial, glslVersion GLSL3) prepends: precision, modelMatrix/viewMatrix/projectionMatrix/
// modelViewMatrix/cameraPosition uniforms and the attributes `position`, `normal`, `uv`.
// Pure strings: importable from Node unit tests.

/** Shared lighting + fog helpers (chunk and entity materials use the SAME curve). */
const LIGHT_FOG_GLSL = /* glsl */ `
uniform float uDaylight;
uniform float uMinLight;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogSphere;
// effSky = max(0, sky - (1 - daylight) * 11); bright = 0.8^(15 - L); block light warm-tinted; floor uMinLight.
vec3 bcLight(float sky, float block) {
  float effSky = max(0.0, sky - (1.0 - uDaylight) * 11.0);
  float skyB = pow(0.8, 15.0 - effSky);
  float blkB = pow(0.8, 15.0 - block);
  vec3 l = max(vec3(skyB), blkB * vec3(1.0, 0.92, 0.78));
  return max(l, vec3(uMinLight));
}
// Fog by view distance from uFogNear to uFogFar. Cylindrical (horizontal) on land so high flight does not wash
// the ground out; spherical underwater (uFogSphere = 1). The linear ramp is eased out (1 - (1 - f)^2) so the
// diagonal gaps of the circular mesh radius - which start before fogFar - are already ~80% fogged (pop-in hidden).
float bcFog(vec3 rel) {
  float d = mix(length(rel.xz), length(rel), uFogSphere);
  float f = clamp((d - uFogNear) / max(0.001, uFogFar - uFogNear), 0.0, 1.0);
  return 1.0 - (1.0 - f) * (1.0 - f);
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

export const CHUNK_VERT = /* glsl */ `
in vec4 aTex;    // layer, u, v (1/256 tile), flags
in vec4 aLight;  // sky*16, block*16, ao 0..3, shade*255
uniform vec4 uAnimFrames; // frames per ANIM mode (0, water, lava, fire)
uniform vec4 uAnimFps;
${WAVE_GLSL}
out vec2 vUv;
flat out float vLayer;
out vec3 vLight;   // sky, block, ao
out float vShade;
out vec3 vRel;     // world position relative to the camera (fog)
void main() {
  float flags = aTex.w;
  float anim = mod(floor(flags / 8.0), 4.0);
  float wave = mod(floor(flags / 32.0), 4.0);
  float layer = aTex.x;
  if (anim > 0.5) {
    int ai = int(anim + 0.5);
    layer += mod(floor(uTime * uAnimFps[ai]), max(1.0, uAnimFrames[ai]));
  }
  vLayer = layer;
  vUv = aTex.yz / 256.0;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.xyz += bcWave(wp.xyz, wave, aTex.z);
  vLight = vec3(aLight.x / 16.0, aLight.y / 16.0, aLight.z);
  vShade = aLight.w / 255.0;
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
in vec3 vLight;
in float vShade;
in vec3 vRel;
layout(location = 0) out highp vec4 outColor;
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
  float ao = vLight.z < 0.5 ? 0.5 : vLight.z < 1.5 ? 0.7 : vLight.z < 2.5 ? 0.85 : 1.0;
  vec3 color = tex.rgb * vShade * ao * bcLight(vLight.x, vLight.y);
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
 * Kid outline: box edges as camera-facing ribbons. Attributes: position = edge start, aEnd = edge end,
 * aSide (-1/+1), aAlong (0/1). uWidth in blocks (scaled up with distance for small screens).
 */
export const OUTLINE_RIBBON_VERT = /* glsl */ `
in vec3 aEnd;
in float aSide;
in float aAlong;
uniform float uWidth;
uniform float uMinPx;   // minimum width in "blocks per block of distance" (keeps lines visible far away)
void main() {
  vec3 a = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 b = (modelMatrix * vec4(aEnd, 1.0)).xyz;
  vec3 dir = b - a;
  float len = length(dir);
  dir = len > 0.0 ? dir / len : vec3(1.0, 0.0, 0.0);
  // extend the ribbon past its corners by half a width so corners join without notches
  vec3 p = mix(a, b, aAlong);
  vec3 toCam = cameraPosition - p;
  float dist = length(toCam);
  float w = max(uWidth, dist * uMinPx);
  p += dir * (aAlong * 2.0 - 1.0) * w * 0.5;
  vec3 side = cross(dir, toCam);
  float sl = length(side);
  side = sl > 1e-5 ? side / sl : vec3(0.0, 1.0, 0.0);
  p += side * aSide * w * 0.5;
  // pull toward the camera so the ribbon is never buried in the block faces it outlines
  p += (toCam / max(dist, 1e-4)) * min(0.06, dist * 0.2);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const OUTLINE_RIBBON_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
layout(location = 0) out highp vec4 outColor;
void main() { outColor = vec4(uColor, uOpacity); }
`;
