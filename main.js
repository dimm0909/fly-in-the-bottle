'use strict';

const { app, BrowserWindow, Menu, ipcMain, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const brainHost = require('./brain-host');
const platform = require('./platform');

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

// The widget is a fixed 0.72 aspect ratio window scaled as a whole: the wheel zooms it, the menu
// offers presets. The base size (scale 1) is 360x500.
const BASE = { width: 360, height: 500 };
const SCALE_MIN = 0.5;
const SCALE_MAX = 3;
const PRESETS = { S: { scale: 0.8, label: 'Маленький' }, M: { scale: 1, label: 'Средний' }, L: { scale: 1.3, label: 'Большой' } };

const LAYERS = {
  desktop: 'На обоях (под всеми окнами)',
  normal: 'Обычное окно',
  top: 'Поверх всех окон',
};

const DEFAULTS = { x: null, y: null, scale: 1, layer: 'desktop', sound: true, brain: true };

const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
const sizeFor = (scale) => ({ width: Math.round(BASE.width * scale), height: Math.round(BASE.height * scale) });

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    // older versions stored a preset name ("size": "S" | "M" | "L")
    if (typeof saved.scale !== 'number') saved.scale = PRESETS[saved.size]?.scale ?? 1;
    delete saved.size;
    return { ...DEFAULTS, ...saved, scale: clamp(saved.scale, SCALE_MIN, SCALE_MAX) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings() {
  if (shotMode) return; // test runs must not touch the user's saved settings
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Could not save settings:', err);
  }
}

// ---------------------------------------------------------------------------
// CLI flags (dev helpers)
//   --shot[=file]   render in a window placed far off-screen, save a PNG with alpha and quit
//   --script=file   JS file evaluated in the renderer before the screenshot; its result is logged
//   --delay=ms      wait before the screenshot (default 1500)
//   --dev           expose window.__w to the page
// ---------------------------------------------------------------------------

function flag(name) {
  // the last occurrence wins, so `npm run shot -- --shot=file.png` overrides the script's bare --shot
  const hit = [...process.argv].reverse().find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
}

const shotFlag = flag('shot');
const shotMode = Boolean(shotFlag);
const shotFile = typeof shotFlag === 'string' ? path.resolve(shotFlag) : path.join(__dirname, 'shots', 'shot.png');
// --dev exposes window.__w (scene internals) to the page. (Not "--debug": Node claims that one.)
// --layer=normal|top|desktop overrides the saved window layer for this run only.
const debugMode = shotMode || Boolean(flag('dev'));

let settings = null;
let win = null;
let dragOrigin = null;

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function defaultPosition({ width, height }) {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - width - 48,
    y: workArea.y + workArea.height - height - 24,
  };
}

// Keep the widget reachable if a monitor was unplugged since the last run.
function clampToDisplays(x, y, { width, height }) {
  const area = screen.getDisplayMatching({ x, y, width, height }).workArea;
  return {
    x: Math.min(Math.max(x, area.x - width / 2), area.x + area.width - width / 2),
    y: Math.min(Math.max(y, area.y - height / 4), area.y + area.height - height / 2),
  };
}

function createWindow() {
  const size = sizeFor(settings.scale);
  const start = shotMode
    ? { x: -5000, y: -5000 } // a hidden window barely animates, so show it, but far off-screen
    : settings.x == null || settings.y == null
      ? defaultPosition(size)
      : clampToDisplays(settings.x, settings.y, size);

  win = new BrowserWindow({
    ...start,
    width: size.width,
    height: size.height,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    // The desktop layer (platform.js) keeps the widget beneath every other window.
    ...platform.windowOptions(settings.layer),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });

  const stopLayer = platform.applyLayer(win, settings.layer);

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'src', 'index.html'), debugMode ? { query: { debug: '1' } } : undefined);
  if (shotMode) win.setIgnoreMouseEvents(true);
  win.once('ready-to-show', () => win.showInactive());
  win.on('closed', () => {
    stopLayer();
    win = null;
  });

  if (shotMode) win.webContents.once('did-finish-load', runShot);
}

function recreateWindow() {
  const old = win;
  createWindow();
  old?.destroy();
}

async function runShot() {
  const wc = win.webContents;
  const script = flag('script');
  const delay = Number(flag('delay')) || 1500;
  try {
    // The page loads its assets asynchronously; wait until it has built the scene.
    for (let i = 0; i < 100 && !(await wc.executeJavaScript('Boolean(window.__w)')); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (typeof script === 'string') {
      const result = await wc.executeJavaScript(fs.readFileSync(path.resolve(script), 'utf8'));
      if (result !== undefined) console.log('script result:', JSON.stringify(result));
      console.log('bounds:', JSON.stringify(win.getBounds()));
    }
    await new Promise((r) => setTimeout(r, delay));
    const image = await wc.capturePage();
    fs.mkdirSync(path.dirname(shotFile), { recursive: true });
    fs.writeFileSync(shotFile, image.toPNG());
    console.log(`shot saved: ${shotFile} (${image.getSize().width}x${image.getSize().height})`);
  } catch (err) {
    console.error('shot failed:', err);
    process.exitCode = 1;
  }
  app.quit();
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function publicSettings() {
  return { sound: settings.sound, scale: settings.scale, brain: brain.status() };
}

// --- the connectome brain (optional: needs npm run brain:setup to have been run) ---
const brain = {
  host: null,
  info: null,
  error: null,
  async start() {
    if (this.host || !brainHost.available()) return;
    try {
      const host = new brainHost.BrainHost();
      this.info = await host.start();
      this.host = host;
      this.error = null;
    } catch (err) {
      this.error = String(err.message || err);
      console.error('brain failed to start:', this.error);
    }
  },
  stop() {
    this.host?.stop();
    this.host = null;
    this.info = null;
  },
  status() {
    return { available: brainHost.available(), enabled: settings.brain, running: Boolean(this.host?.ready), error: this.error };
  },
};

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Звук жужжания',
      type: 'checkbox',
      checked: settings.sound,
      click: (item) => {
        settings.sound = item.checked;
        saveSettings();
        win?.webContents.send('settings:changed', publicSettings());
      },
    },
    {
      label: brain.status().available ? 'Мозг: коннектом MaleCNS' : 'Мозг: не установлен (npm run brain:setup)',
      type: 'checkbox',
      enabled: brain.status().available,
      checked: settings.brain && brain.status().running,
      click: async (item) => {
        settings.brain = item.checked;
        saveSettings();
        if (settings.brain) await brain.start();
        else brain.stop();
        win?.webContents.send('settings:changed', publicSettings());
      },
    },
    { type: 'separator' },
    {
      label: 'Размер',
      submenu: [
        ...Object.values(PRESETS).map((p) => ({
          label: p.label,
          type: 'radio',
          checked: Math.abs(settings.scale - p.scale) < 0.02,
          click: () => applyScale(p.scale),
        })),
        { type: 'separator' },
        { label: `Масштаб ${Math.round(settings.scale * 100)}% (колесо мыши над банкой)`, enabled: false },
        { label: 'Сбросить масштаб (100%)', click: () => applyScale(1) },
      ],
    },
    {
      label: 'Положение',
      submenu: Object.entries(LAYERS).map(([key, label]) => ({
        label,
        type: 'radio',
        checked: settings.layer === key,
        click: () => {
          if (settings.layer === key) return;
          rememberPosition();
          settings.layer = key;
          saveSettings();
          recreateWindow();
        },
      })),
    },
    {
      label: 'Вернуть в правый нижний угол',
      click: () => {
        const size = sizeFor(settings.scale);
        win?.setBounds({ ...defaultPosition(size), ...size });
        rememberPosition();
      },
    },
    { type: 'separator' },
    { label: 'Выход', click: () => app.quit() },
  ]);
}

/**
 * Scale the whole widget. The window grows and shrinks around its bottom centre so the jar stays
 * where it stands on the desk, and never outgrows the screen it is on.
 */
function applyScale(target) {
  if (!win) return;
  const b = win.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  const fit = Math.min(area.width / BASE.width, area.height / BASE.height) * 0.97;
  const scale = clamp(target, SCALE_MIN, Math.max(SCALE_MIN, Math.min(SCALE_MAX, fit)));
  const size = sizeFor(scale);
  let x = Math.round(b.x + (b.width - size.width) / 2);
  let y = b.y + b.height - size.height;
  if (!shotMode) {
    x = clamp(x, area.x, area.x + area.width - size.width);
    y = clamp(y, area.y, area.y + area.height - size.height);
  }
  settings.scale = scale;
  win.setBounds({ x, y, ...size });
  scheduleRemember();
}

let rememberTimer = null;
function scheduleRemember() {
  clearTimeout(rememberTimer);
  rememberTimer = setTimeout(rememberPosition, 400);
}

let pendingZoom = 1;
let zoomTimer = null;
ipcMain.on('widget:zoom', (_event, factor) => {
  if (!Number.isFinite(factor)) return;
  pendingZoom *= clamp(factor, 0.5, 2);
  if (zoomTimer) return;
  // coalesce a burst of wheel events into one resize per ~frame
  zoomTimer = setTimeout(() => {
    zoomTimer = null;
    const f = pendingZoom;
    pendingZoom = 1;
    applyScale(settings.scale * f);
  }, 16);
});

function rememberPosition() {
  if (!win) return;
  const { x, y } = win.getBounds();
  settings.x = x;
  settings.y = y;
  saveSettings();
}

ipcMain.handle('settings:get', () => publicSettings());

ipcMain.handle('brain:info', () => (brain.host?.ready ? { ...brain.info } : null));
ipcMain.handle('brain:noise', async (_event, groups, rate) => {
  await brain.host?.noise(groups, rate);
});
ipcMain.handle('brain:step', async (_event, drives, ms) => {
  if (!brain.host?.ready) return null;
  try {
    return await brain.host.step(drives, ms);
  } catch (err) {
    console.error('brain step failed:', err.message);
    return null;
  }
});

// Read-only access to bundled assets (fly meshes). fetch() on file:// is unreliable in the renderer.
const ASSET_DIR = path.join(__dirname, 'assets');
ipcMain.handle('asset:read', (_event, relativePath) => {
  const file = path.resolve(ASSET_DIR, String(relativePath));
  if (!file.startsWith(ASSET_DIR + path.sep)) throw new Error('asset outside the assets directory');
  return fs.readFileSync(file);
});

ipcMain.on('widget:menu', () => {
  if (win && !shotMode) buildMenu().popup({ window: win });
});

ipcMain.on('widget:drag-start', () => {
  if (win) dragOrigin = win.getBounds();
});

ipcMain.on('widget:drag-move', (_event, dx, dy) => {
  if (!win || !dragOrigin) return;
  // setBounds (rather than setPosition) so a frameless transparent window
  // can't drift in size while it is being dragged on Linux.
  win.setBounds({
    x: Math.round(dragOrigin.x + dx),
    y: Math.round(dragOrigin.y + dy),
    width: dragOrigin.width,
    height: dragOrigin.height,
  });
});

ipcMain.on('widget:drag-end', () => {
  dragOrigin = null;
  rememberPosition();
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

// Linux needs this hint to give the window an alpha channel.
if (platform.isLinux) app.commandLine.appendSwitch('enable-transparent-visuals');
// Windows stops painting windows it thinks are covered; the off-screen test window must keep going.
if (platform.isWin && shotMode) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const gotLock = shotMode || app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => win?.showInactive());

  app.whenReady().then(async () => {
    settings = loadSettings();
    if (shotMode) settings = { ...DEFAULTS };
    const layerFlag = flag('layer');
    if (typeof layerFlag === 'string' && layerFlag in LAYERS) settings.layer = layerFlag;
    if (settings.brain && !flag('no-brain')) await brain.start();
    createWindow();
  });

  app.on('before-quit', () => brain.stop());
  app.on('window-all-closed', () => app.quit());
}
