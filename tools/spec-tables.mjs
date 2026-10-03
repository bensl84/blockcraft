// OWNER: LEAD. Regenerates the data appendices of docs/SPEC.md from src/data/*.js (between the BEGIN/END markers).
//   node tools/spec-tables.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCKS } from '../src/data/blocks.js';
import { ITEM_LIST } from '../src/data/items.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = join(ROOT, 'docs', 'SPEC.md');

function blockTable() {
  const rows = ['| id | name | shape / pass | hard. | tool (lvl) | light | drops | flags |', '|---:|---|---|---:|---|---:|---|---|'];
  for (const b of BLOCKS) {
    if (!b) continue;
    let drops;
    if (b.dropFn) drops = 'special (dropFn)';
    else if (b.drops === null) drops = '—';
    else if (b.drops === undefined) drops = b.item === null ? '—' : (b.item && b.item !== b.name ? b.item : 'self');
    else if (typeof b.drops === 'string') drops = b.drops;
    else drops = b.drops.map((d) => `${d.item}${d.min !== undefined || d.max !== undefined ? ` ${d.min ?? 1}${d.max !== undefined && d.max !== (d.min ?? 1) ? '-' + d.max : ''}` : ''}${d.chance !== undefined ? ` ${(d.chance * 100).toFixed(1).replace(/\.0$/, '')}%` : ''}`).join(', ');
    const flags = [b.opaque ? 'opaque' : '', b.solid ? '' : 'no-collide', b.gravity ? 'falls' : '', b.flammable ? 'flammable' : '', b.replaceable ? 'replaceable' : '',
      b.facing ? 'facing' : '', b.axis ? 'axis' : '', b.anim ? 'anim' : '', b.climbable ? 'climb' : '', b.slip !== 0.6 ? `slip ${b.slip}` : '',
      b.filter && !b.opaque ? `filter ${b.filter}` : '', b.support ? `support:${b.support}` : '', b.fallMult !== 1 ? `fall x${b.fallMult}` : '',
      b.contactDamage ? `contact ${b.contactDamage}` : ''].filter(Boolean).join(' ');
    const tool = b.tool ? `${b.tool}${b.requiresTool ? ` (${b.level})` : ''}` : '—';
    rows.push(`| ${b.id} | ${b.name} | ${b.shape} / ${b.pass} | ${b.hardness < 0 ? '∞' : b.hardness} | ${tool} | ${b.emit || ''} | ${drops} | ${flags} |`);
  }
  return rows.join('\n');
}

function itemList() {
  const byTab = {};
  for (const it of ITEM_LIST) (byTab[it.tab] ||= []).push(it.key + (it.priority !== 'P0' ? ` (${it.priority})` : ''));
  return Object.entries(byTab).map(([t, l]) => `- **${t}** (${l.length}): ${l.join(', ')}`).join('\n');
}

function replaceBetween(text, name, body) {
  const begin = `<!-- BEGIN:${name} -->`, end = `<!-- END:${name} -->`;
  const i = text.indexOf(begin), j = text.indexOf(end);
  if (i < 0 || j < 0) throw new Error(`markers for ${name} not found in SPEC.md`);
  const eol = text.includes('\r\n') ? '\r\n' : '\n'; // keep the file's line endings
  return text.slice(0, i + begin.length) + eol + body.split('\n').join(eol) + eol + text.slice(j);
}

let spec = readFileSync(SPEC, 'utf8');
spec = replaceBetween(spec, 'BLOCK_TABLE', blockTable());
spec = replaceBetween(spec, 'ITEM_LIST', itemList());
writeFileSync(SPEC, spec);
console.log(`[spec-tables] updated ${SPEC}`);
