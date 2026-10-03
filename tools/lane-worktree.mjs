// OWNER: LEAD. Gives one lane its own git worktree + branch so parallel lanes never break each other's build
// (SPEC §0.1-§0.2). node_modules is shared through a Windows directory junction (no admin rights needed).
//
//   node tools/lane-worktree.mjs <lane> [--dir <path>] [--base <ref>] [--dry-run]
//
//   <lane>   one of: corea coreb corec cored coree mobs inv audio menus kid mech fx
//   --dir    worktree folder (default: ../bc-<lane>, a sibling of this checkout - keeps paths short for Chrome)
//   --base   commit/branch to start from (default: HEAD). The foundation MUST be committed first (integrator).
//   --dry-run  print what would happen, change nothing
//
// Result: branch lane/<lane> checked out in <dir>, <dir>/node_modules -> <root>/node_modules (junction),
// and docs/handoff/<lane>.md ready for the lane's handoff note. Never commits, pushes, deletes or stashes.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LANES = ['corea', 'coreb', 'corec', 'cored', 'coree', 'mobs', 'inv', 'audio', 'menus', 'kid', 'mech', 'fx'];

function git(args, opts = {}) {
  const out = execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  return typeof out === 'string' ? out.trim() : '';
}

function main(argv) {
  const lane = argv[0];
  if (!lane || !LANES.includes(lane)) throw new Error(`usage: node tools/lane-worktree.mjs <${LANES.join('|')}> [--dir path] [--base ref] [--dry-run]`);
  let dir = resolve(ROOT, '..', `bc-${lane}`), base = 'HEAD', dry = false;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--dir') dir = resolve(ROOT, argv[++i]);
    else if (argv[i] === '--base') base = argv[++i];
    else if (argv[i] === '--dry-run') dry = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  // Safety: the foundation must be committed, otherwise the worktree would be an empty checkout.
  const tracked = git(['ls-files', '--', 'src/main.js', 'docs/SPEC.md', 'build.mjs']).split('\n').filter(Boolean);
  if (tracked.length < 3) throw new Error('the foundation is not committed yet (src/main.js, docs/SPEC.md, build.mjs untracked). The integrator commits it first; this tool never commits.');
  const branch = `lane/${lane}`;
  const branchExists = (() => { try { git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]); return true; } catch { return false; } })();
  if (existsSync(dir)) throw new Error(`${dir} already exists - reuse it or pass --dir`);
  const addArgs = branchExists ? ['worktree', 'add', dir, branch] : ['worktree', 'add', '--no-track', '-b', branch, dir, base];
  const nm = join(ROOT, 'node_modules');
  const handoff = join(dir, 'docs', 'handoff', `${lane}.md`);
  console.log(`[lane-worktree] git ${addArgs.join(' ')}`);
  console.log(`[lane-worktree] junction ${join(dir, 'node_modules')} -> ${nm}`);
  console.log(`[lane-worktree] handoff note ${handoff}`);
  if (dry) return;
  git(addArgs, { stdio: 'inherit' });
  symlinkSync(nm, join(dir, 'node_modules'), 'junction');
  mkdirSync(dirname(handoff), { recursive: true });
  if (!existsSync(handoff)) {
    writeFileSync(handoff, `# Handoff - ${lane}\n\nBranch \`${branch}\` · worktree \`${dir}\`\n\n` +
      '<!-- newest first: date · what changed · commands run + results (copy the PASS/FAIL lines) · remaining · blockers · spec conflicts -->\n');
  }
  console.log(`[lane-worktree] ready. In ${dir}: node build.mjs --dev --out .tmp/build && node tools/smoke.mjs --tag ${lane}`);
}

try { main(process.argv.slice(2)); } catch (err) { console.error(`[lane-worktree] ${err.message}`); process.exit(1); }
