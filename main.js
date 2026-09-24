'use strict';

const { app, BrowserWindow, Menu, ipcMain, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const brainHost = require('./brain-host');

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

// Window sizes keep a fixed 0.72 aspect ratio so the scene scales uniformly.
const SIZES = {
  S: { width: 288, height: 400, label: 'Маленький' },
  M: { width: 360, height: 500, label: 'Средний' },
  L: { width: 468, height: 650, label: 'Большой' },
};

const LAYERS = {
  desktop: 'На обоях (под всеми окнами)',
  normal: 'Обычное окно',
  top: 'Поверх всех окон',
};

const DEFAULTS = { x: null, y: null, size: 'M', layer: 'desktop', sound: true, brain: true };

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
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
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
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
  const size = SIZES[settings.size] ?? SIZES.M;
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
    // A "desktop" window type makes the WM keep the widget beneath every other
    // window, on all workspaces, and out of the Alt-Tab list.
    ...(process.platform === 'linux' && settings.layer === 'desktop' ? { type: 'desktop' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });

  if (settings.layer === 'top') win.setAlwaysOnTop(true, 'screen-saver');
  if (settings.layer !== 'normal') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'src', 'index.html'), debugMode ? { query: { debug: '1' } } : undefined);
  if (shotMode) win.setIgnoreMouseEvents(true);
  win.once('ready-to-show', () => win.showInactive());
  win.on('closed', () => {
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
  return { sound: settings.sound, size: settings.size, brain: brain.status() };
}

// --- the connectome brain (optional: needs tools/setup_brain.sh to have been run) ---
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
      label: brain.status().available ? 'Мозг: коннектом MaleCNS' : 'Мозг: не установлен (tools/setup_brain.sh)',
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
      submenu: Object.entries(SIZES).map(([key, s]) => ({
        label: s.label,
        type: 'radio',
        checked: settings.size === key,
        click: () => {
          settings.size = key;
          saveSettings();
          if (win) {
            const b = win.getBounds();
            // Grow/shrink around the bottom-centre so the jar stays put on the desk.
            win.setBounds({
              x: Math.round(b.x + (b.width - s.width) / 2),
              y: b.y + b.height - s.height,
              width: s.width,
              height: s.height,
            });
          }
        },
      })),
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
        const size = SIZES[settings.size];
        const p = defaultPosition(size);
        win?.setBounds({ ...p, width: size.width, height: size.height });
        rememberPosition();
      },
    },
    { type: 'separator' },
    { label: 'Выход', click: () => app.quit() },
  ]);
}

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
app.commandLine.appendSwitch('enable-transparent-visuals');

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
