#!/usr/bin/env node
'use strict';

// Cross-platform helper behind the npm scripts (Linux, Windows, macOS):
//
//   node tools/dev.js start [args]     run the widget (adds --no-sandbox on Linux, clears ELECTRON_RUN_AS_NODE)
//   node tools/dev.js setup-brain      download MaleCNS, build the graph, groups and the simulator
//   node tools/dev.js compile-brain    build only the simulator (data/brain/brain[.exe])
//   node tools/dev.js py <args>        run the project's Python (.venv) with the given arguments
//   node tools/dev.js docs             build the Sphinx documentation

const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const https = require('https');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';
const EXE = isWin ? '.exe' : '';
const VENV = path.join(ROOT, '.venv');
const VENV_PY = path.join(VENV, isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');
const DATA = path.join(ROOT, 'data');

const log = (...a) => console.log('[dev]', ...a);
const die = (msg) => {
  console.error(`[dev] ${msg}`);
  process.exit(1);
};

function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: false, ...options });
  if (r.error) die(`cannot run ${cmd}: ${r.error.message}`);
  if (r.status !== 0) die(`${cmd} ${args.slice(0, 3).join(' ')} ... failed (exit ${r.status})`);
}

function has(cmd, args = ['--version']) {
  const r = spawnSync(cmd, args, { stdio: 'ignore' });
  return !r.error && r.status === 0;
}

// ---------------------------------------------------------------------------------------------

function start(args) {
  const electron = require('electron'); // in plain Node this is the path of the binary
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // set by some terminals (VS Code) and turns Electron into plain Node
  // On Ubuntu 24.04 unprivileged user namespaces are restricted and the sandbox helper is not setuid;
  // without this flag the window stays empty. Windows and macOS keep the sandbox.
  const flags = process.platform === 'linux' ? ['--no-sandbox'] : [];
  const child = spawn(electron, ['.', ...flags, ...args], { cwd: ROOT, env, stdio: 'inherit' });
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
}

// ---------------------------------------------------------------------------------------------

function findPython() {
  const candidates = isWin ? [['py', '-3'], ['python'], ['python3']] : [['python3'], ['python']];
  for (const c of candidates) if (has(c[0], [...c.slice(1), '--version'])) return c;
  die('Python 3 was not found. Install it (https://www.python.org/) and run this again.');
}

function ensureVenv() {
  if (fs.existsSync(VENV_PY)) return;
  const py = findPython();
  log('creating .venv');
  run(py[0], [...py.slice(1), '-m', 'venv', '--system-site-packages', VENV]);
}

function needVenv() {
  if (!fs.existsSync(VENV_PY)) die('.venv is missing. Run: npm run brain:setup (or create it: python -m venv .venv)');
}

function download(url, file) {
  return new Promise((resolve, reject) => {
    const get = (u, redirects = 0) =>
      https
        .get(u, (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 5) {
            res.resume();
            return get(new URL(res.headers.location, u).toString(), redirects + 1);
          }
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          const total = Number(res.headers['content-length']) || 0;
          const part = `${file}.part`;
          const out = fs.createWriteStream(part);
          let got = 0;
          let shown = -1;
          res.on('data', (chunk) => {
            got += chunk.length;
            const pct = total ? Math.floor((got / total) * 20) * 5 : -1;
            if (pct !== shown && total) {
              shown = pct;
              process.stdout.write(`\r  ${path.basename(file)}: ${pct}% of ${(total / 1e6).toFixed(0)} MB   `);
            }
          });
          res.pipe(out);
          out.on('finish', () => {
            out.close(() => {
              fs.renameSync(part, file);
              process.stdout.write('\n');
              resolve();
            });
          });
          res.on('error', reject);
          out.on('error', reject);
        })
        .on('error', reject);
    get(url);
  });
}

async function setupBrain() {
  const base = 'https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome';
  const files = [
    'body-annotations-male-cns-v1.0-minconf-0.5.feather',
    'body-neurotransmitters-male-cns-v1.0.feather',
    'connectome-weights-male-cns-v1.0-minconf-0.5.feather',
  ];
  fs.mkdirSync(path.join(DATA, 'malecns'), { recursive: true });
  fs.mkdirSync(path.join(DATA, 'brain'), { recursive: true });
  for (const f of files) {
    const file = path.join(DATA, 'malecns', f);
    if (fs.existsSync(file) && fs.statSync(file).size > 0) {
      log(`have ${f}`);
      continue;
    }
    log(`downloading ${f}`);
    await download(`${base}/${f}`, file).catch((e) => die(`download failed: ${e.message}`));
  }
  ensureVenv();
  log('installing pyarrow and pandas');
  run(VENV_PY, ['-m', 'pip', 'install', '-q', 'pyarrow', 'pandas']);
  run(VENV_PY, [path.join('tools', 'build_brain_graph.py')]);
  run(VENV_PY, [path.join('tools', 'build_groups.py')]);
  compileBrain();
  log('brain ready');
}

// ---------------------------------------------------------------------------------------------

function compileBrain() {
  const out = path.join(DATA, 'brain', `brain${EXE}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const sources = ['main.cpp', 'cpu.cpp'].map((f) => path.join(ROOT, 'brain', f));
  const gnu = (cxx) => ['-O3', '-ffast-math', '-std=c++17', '-Wall', '-Wextra', ...(isWin ? ['-static'] : ['-march=native']), ...sources, '-o', out];

  const want = process.env.CXX ? [process.env.CXX] : ['g++', 'c++', 'clang++'];
  for (const cxx of want) {
    if (!has(cxx)) continue;
    log(`compiling with ${cxx}`);
    return run(cxx, gnu(cxx));
  }
  if (isWin && has('cl', [])) {
    log('compiling with MSVC');
    // static runtime so the executable does not need the Visual C++ redistributable
    return run('cl', ['/nologo', '/O2', '/fp:fast', '/std:c++17', '/EHsc', '/MT', ...sources, `/Fe:${out}`, `/Fo:${path.join(DATA, 'brain')}${path.sep}`]);
  }
  // No C++ compiler: zig (from PyPI) is a small self-contained one and cross-compiles as well.
  ensureVenv();
  log('no C++ compiler found; installing zig from PyPI (about 80 MB) to build the simulator');
  run(VENV_PY, ['-m', 'pip', 'install', '-q', 'ziglang']);
  run(VENV_PY, ['-m', 'ziglang', 'c++', '-O2', '-ffast-math', '-std=c++17', ...sources, '-o', out]);
}

// ---------------------------------------------------------------------------------------------

function docs() {
  needVenv();
  if (spawnSync(VENV_PY, ['-c', 'import sphinx, myst_parser, furo'], { stdio: 'ignore' }).status !== 0) {
    log('installing the documentation dependencies');
    run(VENV_PY, ['-m', 'pip', 'install', '-q', '-r', path.join('docs', 'requirements.txt')]);
  }
  // always a full rebuild: the side menu must not disagree with the page tree
  for (const dir of [path.join(ROOT, 'docs', '_build'), path.join(ROOT, 'docs', 'api', 'generated')]) fs.rmSync(dir, { recursive: true, force: true });
  run(VENV_PY, ['-m', 'sphinx', '-b', 'html', '-E', 'docs', path.join('docs', '_build', 'html')]);
  log(`docs: ${path.join('docs', '_build', 'html', 'index.html')}`);
}

// ---------------------------------------------------------------------------------------------

const [command, ...rest] = process.argv.slice(2);
const commands = {
  start: () => start(rest),
  'setup-brain': setupBrain,
  'compile-brain': () => compileBrain(),
  py: () => {
    needVenv();
    run(VENV_PY, rest);
  },
  docs,
};
if (!commands[command]) die(`usage: node tools/dev.js <${Object.keys(commands).join('|')}> [args]`);
Promise.resolve(commands[command]()).catch((e) => die(e.message));
