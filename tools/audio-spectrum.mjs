// OWNER LANE: FEATURE-AUDIO. Brightness scan of the rendered catalogue (.tmp/audio-wav/*.wav, written by the
// audio-catalog smoke scenario): spectral centroid and share of energy above 5 kHz per sound. A thin hiss on laptop
// speakers shows up as a high '>5k' share. Usage: node tools/audio-spectrum.mjs [count]
import { readdirSync, readFileSync } from 'node:fs';
const dir = new URL('../.tmp/audio-wav/', import.meta.url);
function fft(re, im) { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len; for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) { const c = Math.cos(a * k), s = Math.sin(a * k); const xr = re[i + k + len / 2] * c - im[i + k + len / 2] * s, xi = re[i + k + len / 2] * s + im[i + k + len / 2] * c; re[i + k + len / 2] = re[i + k] - xr; im[i + k + len / 2] = im[i + k] - xi; re[i + k] += xr; im[i + k] += xi; } } }
const rows = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.wav') || f.startsWith('music')) continue;
  const b = readFileSync(new URL(f, dir)); const ch = b.readUInt16LE(22), sr = b.readUInt32LE(24); const n = (b.length - 44) / 2 / ch;
  const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = b.readInt16LE(44 + i * ch * 2) / 32768;
  const N = 2048; let E = 0, C = 0, hf = 0, crest = 0;
  for (let o = 0; o + N <= n; o += N / 2) { const re = new Float64Array(N), im = new Float64Array(N); for (let i = 0; i < N; i++) re[i] = x[o + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); fft(re, im);
    for (let k = 1; k < N / 2; k++) { const p = re[k] * re[k] + im[k] * im[k]; const fr = k * sr / N; E += p; C += p * fr; if (fr > 5000) hf += p; } }
  rows.push({ name: f.replace('.wav', ''), centroid: Math.round(C / E), hf5k: Math.round(hf / E * 1000) / 10 });
}
rows.sort((a, b) => b.hf5k - a.hf5k);
console.log('highest >5kHz energy share (%):'); for (const r of rows.slice(0, Number(process.argv[2]) || 25)) console.log(r.name.padEnd(26), 'centroid', String(r.centroid).padStart(5), 'Hz  >5k', r.hf5k + '%');
