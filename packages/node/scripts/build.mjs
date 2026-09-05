#!/usr/bin/env node
// Dual-mode build:
//   TARGET unset / "main" / "noarch" -> tsc (the publishable JS shim).
//   TARGET = <rust-triple>           -> cargo cross-compile + stage at
//                                       build/<triple>/bin/twilightfactory{,.exe}.
//
// Invoked by the putitoutthere reusable workflow at release time. Per-triple
// rows run on native runners (x86_64-linux on ubuntu-latest, aarch64-linux on
// ubuntu-24.04-arm, darwin on macos-latest, windows on windows-latest) per
// the engine's defaultRunsOn, so cross-linker setup is not required —
// `rustup target add` is enough to make the triple known to cargo.

import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const nodePkg = resolve(here, '..');
const rustCrate = resolve(nodePkg, '..', 'rust');

const target = process.env.TARGET ?? '';

if (target === '' || target === 'main' || target === 'noarch') {
  // Use the locally-installed tsc, regardless of which package manager
  // (`npm` at release-time, `pnpm` at PR-time) populated node_modules.
  run('npx', ['--no-install', 'tsc', '-b', '--clean', 'tsconfig.json'], { cwd: nodePkg });
  run('npx', ['--no-install', 'tsc', '-p', 'tsconfig.json'], { cwd: nodePkg });
  process.exit(0);
}

const ext = target.includes('windows') ? '.exe' : '';
const bin = `twilightfactory${ext}`;

run('rustup', ['target', 'add', target], { cwd: rustCrate });
run('cargo', ['build', '--release', '--target', target, '--bin', 'twilightfactory'], { cwd: rustCrate });

const src = join(rustCrate, 'target', target, 'release', bin);
const dstDir = join(nodePkg, 'build', target, 'bin');
const dst = join(dstDir, bin);
mkdirSync(dstDir, { recursive: true });
copyFileSync(src, dst);
// copyFileSync drops the exec bit (dst gets 0666 & ~umask = 0644); restore it
// so the published npm tarball + GitHub Actions artifact roundtrip both keep
// the binary executable. Windows ignores mode bits.
chmodSync(dst, 0o755);
console.log(`staged: ${src} -> ${dst}`);

function run(cmd, args, opts) {
  // shell: true so Windows resolves `.cmd` shims (npx.cmd, rustup.exe, etc.)
  // without each call hard-coding extensions. Args are static — no injection.
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: true, ...opts });
  if (res.status !== 0) {
    console.error(`failed: ${cmd} ${args.join(' ')} (exit ${res.status})`);
    process.exit(res.status ?? 1);
  }
}
