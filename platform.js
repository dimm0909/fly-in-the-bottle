'use strict';

// Per-platform window behaviour: what "layer" the widget lives in.
//
//   desktop  under every other window, on all workspaces, out of the task switcher
//   normal   an ordinary frameless window
//   top      above everything
//
// Linux/X11 has a window type for this (_NET_WM_WINDOW_TYPE_DESKTOP), verified on GNOME. Windows has
// no such thing; the closest is a non-activating tool window (never takes focus, so a click cannot
// raise it; no Alt-Tab entry) pushed to the bottom of the z-order with SetWindowPos(HWND_BOTTOM).
// The Windows path could not be tested where this was written; if it misbehaves, use the "normal"
// layer (--layer=normal). macOS has no desktop layer here and falls back to "normal".

const isWin = process.platform === 'win32';
const isLinux = process.platform === 'linux';

/** BrowserWindow constructor options for a layer. */
function windowOptions(layer) {
  if (layer !== 'desktop') return {};
  if (isLinux) return { type: 'desktop' };
  if (isWin) return { type: 'toolbar', focusable: false };
  return {};
}

// --- Windows: keep the window at the bottom of the z-order --------------------------------------

const SWP_NOSIZE = 0x1;
const SWP_NOMOVE = 0x2;
const SWP_NOACTIVATE = 0x10;
const SWP_NOOWNERZORDER = 0x200;
const HWND_BOTTOM = 1;

let native; // undefined: not tried yet, false: unavailable

function loadNative() {
  if (native !== undefined) return native;
  try {
    // koffi is an optional dependency (npm installs it everywhere but only Windows needs it)
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    native = {
      setWindowPos: user32.func('bool __stdcall SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int X, int Y, int cx, int cy, uint32_t uFlags)'),
    };
  } catch (err) {
    console.warn('desktop layer: cannot reach user32 (%s); the widget stays a normal tool window', err.message);
    native = false;
  }
  return native;
}

function windowHandle(win) {
  const buf = win.getNativeWindowHandle();
  return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
}

function sendToBottom(win) {
  const n = loadNative();
  if (!n || win.isDestroyed()) return false;
  try {
    return n.setWindowPos(windowHandle(win), HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
  } catch (err) {
    console.warn('desktop layer: SetWindowPos failed:', err.message);
    return false;
  }
}

/**
 * Apply what constructor options cannot. Returns a function that stops any background work.
 * On Windows the z-order is re-asserted every couple of seconds: other programs can reshuffle it.
 */
function applyLayer(win, layer) {
  if (layer === 'top') win.setAlwaysOnTop(true, 'screen-saver');
  if (layer !== 'normal' && !isWin) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  if (layer === 'desktop' && isWin) {
    const pin = () => sendToBottom(win);
    win.once('ready-to-show', () => setTimeout(pin, 200));
    const timer = setInterval(pin, 2000);
    return () => clearInterval(timer);
  }
  return () => {};
}

module.exports = { isWin, isLinux, windowOptions, applyLayer };
