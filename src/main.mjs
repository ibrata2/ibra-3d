import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, safeStorage, Menu } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import { ENGINES, convert, engineById } from './engines.mjs';
import { explainError } from './errors.mjs';
import { fixGlb, glbStats } from './glb.mjs';
import * as lib from './library.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMG_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

// بروتوكول خاص لعرض ملفات GLB والصور المحلية داخل model-viewer
protocol.registerSchemesAsPrivileged([
  { scheme: 'ibra3d', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

let win;
const userData = () => app.getPath('userData');
const outputsDir = () => path.join(userData(), 'outputs');
const settingsFile = () => path.join(userData(), 'settings.json');

// ---------- الإعدادات (التوكن مشفّر ومحفوظ محلياً فقط) ----------
function loadSettings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { /* أول تشغيل */ }
  let token = '';
  if (s.tokenEnc) {
    try { token = safeStorage.decryptString(Buffer.from(s.tokenEnc, 'base64')); } catch { token = ''; }
  } else if (s.token) token = s.token;
  return {
    token,
    libraryDir: s.libraryDir || '',
    engine: s.engine || 'hunyuan21',
    rembg: s.rembg ?? true,
    texture: s.texture ?? false,
    faces: s.faces ?? 30000,
    seed: s.seed ?? '',
    autoFallback: s.autoFallback ?? false
  };
}

function saveSettings(next) {
  const cur = loadSettings();
  const merged = { ...cur, ...next };
  const out = { ...merged };
  delete out.token;
  if (merged.token) {
    if (safeStorage.isEncryptionAvailable()) out.tokenEnc = safeStorage.encryptString(merged.token).toString('base64');
    else out.token = merged.token;
  }
  fs.mkdirSync(userData(), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(out, null, 2), 'utf8');
  return merged;
}

function toLocalUrl(abs) {
  return 'ibra3d://local/' + encodeURIComponent(abs) + '?v=' + Date.now();
}

function allowedPath(abs) {
  const norm = path.resolve(abs).toLowerCase();
  const roots = [outputsDir()];
  const s = loadSettings();
  if (s.libraryDir) roots.push(s.libraryDir);
  // الصور الأصلية اللي اختارها المستخدم مسموحة للعرض فقط
  if (IMG_EXT.includes(path.extname(norm))) return true;
  return roots.some(r => norm.startsWith(path.resolve(r).toLowerCase() + path.sep) || norm === path.resolve(r).toLowerCase());
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#07070a',
    title: 'IBRA 3D',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  fs.mkdirSync(outputsDir(), { recursive: true });
  protocol.handle('ibra3d', (req) => {
    const u = new URL(req.url);
    const abs = decodeURIComponent(u.pathname.replace(/^\//, ''));
    if (!allowedPath(abs) || !fs.existsSync(abs)) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(abs).toString());
  });
  createWindow();
  if (process.env.IBRA_SELFTEST) {
    import('./selftest.mjs').then(m => m.runSelfTest(win, process.env.IBRA_SELFTEST, {
      image: process.env.IBRA_TEST_IMAGE, glb: process.env.IBRA_TEST_GLB
    })).catch(e => console.error('selftest', e)).finally(() => app.quit());
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ---------- IPC ----------
ipcMain.handle('settings:get', () => {
  const s = loadSettings();
  return { ...s, hasToken: !!s.token, token: s.token ? s.token.slice(0, 5) + '•••••' + s.token.slice(-3) : '' };
});

ipcMain.handle('settings:save', (_e, s) => {
  const patch = { ...s };
  if ('token' in patch) {
    const t = String(patch.token || '').trim();
    if (t.includes('•')) delete patch.token; // ما تغيّر
    else patch.token = t;
  }
  saveSettings(patch);
  return true;
});

ipcMain.handle('engines:list', () => ENGINES);

// يتأكد إن التوكن صالح ويرجع اسم الحساب
ipcMain.handle('token:check', async () => {
  const { token } = loadSettings();
  if (!token) return { ok: false, message: 'ماكو توكن محفوظ' };
  try {
    const r = await net.fetch('https://huggingface.co/api/whoami-v2', { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 401) return { ok: false, message: 'التوكن مرفوض — تأكد إنك نسخته كامل' };
    if (!r.ok) return { ok: false, message: `Hugging Face رجّع ${r.status}` };
    const j = await r.json();
    return { ok: true, name: j.name || j.fullname || '' };
  } catch (e) {
    return { ok: false, message: 'ما كدرت أوصل لـ Hugging Face للتحقق' };
  }
});

ipcMain.handle('dialog:images', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'اختر صور',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'صور', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
  });
  return r.canceled ? [] : r.filePaths.map(p => ({ path: p, name: path.basename(p), url: toLocalUrl(p) }));
});

const cancelled = new Set();
ipcMain.handle('convert:cancel', (_e, id) => { cancelled.add(id); return true; });

ipcMain.handle('convert:run', async (_e, job) => {
  const { id, imagePath, engineId, opts } = job;
  const send = (p) => { if (!win?.isDestroyed()) win.webContents.send('convert:progress', { id, ...p }); };
  try {
    const ext = path.extname(imagePath).toLowerCase();
    if (!IMG_EXT.includes(ext)) throw new Error('صيغة الصورة غير مدعومة (PNG / JPG / WEBP بس)');
    const image = fs.readFileSync(imagePath);
    const s = loadSettings();
    const res = await convert({
      engineId,
      image,
      mime: MIME[ext],
      opts,
      token: s.token,
      onProgress: (p) => { if (!cancelled.has(id)) send(p); }
    });
    if (cancelled.has(id)) { cancelled.delete(id); return { ok: false, cancelled: true }; }
    const base = path.parse(imagePath).name.replace(/[^\w\u0600-\u06FF\- ]+/g, '_').slice(0, 60) || 'model';
    const out = path.join(outputsDir(), `${base}_${engineId}_${Date.now()}.glb`);
    // نضيف normals و material إذا ناقصة حتى المجسم ما يطلع أسود بالألعاب
    let glb = res.glb;
    try { glb = fixGlb(res.glb).glb; } catch (e) { console.warn('[fixGlb]', e.message); }
    fs.writeFileSync(out, glb);
    let stats = null;
    try { stats = glbStats(glb); } catch { /* اختياري */ }
    return {
      ok: true,
      path: out,
      url: toLocalUrl(out),
      seed: res.seed,
      engine: engineById(res.engine).name,
      sizeKb: Math.round(glb.length / 1024),
      triangles: stats ? Math.round(stats.triangles) : null
    };
  } catch (err) {
    if (cancelled.has(id)) { cancelled.delete(id); return { ok: false, cancelled: true }; }
    const info = explainError(err);
    console.error('[convert]', engineId, info.raw);
    return { ok: false, error: info };
  }
});

ipcMain.handle('file:saveAs', async (_e, src, name) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'حفظ المجسم',
    defaultPath: (name || path.basename(src)).replace(/\.glb$/i, '') + '.glb',
    filters: [{ name: 'GLB', extensions: ['glb'] }]
  });
  if (r.canceled || !r.filePath) return null;
  fs.copyFileSync(src, r.filePath);
  return r.filePath;
});

ipcMain.handle('file:show', (_e, p) => { if (p && fs.existsSync(p)) shell.showItemInFolder(p); return true; });

ipcMain.handle('open:external', (_e, url) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
  return true;
});

// ---------- المكتبة ----------
function requireLib() {
  const d = loadSettings().libraryDir;
  if (!d || !fs.existsSync(d)) {
    const e = new Error('اختار مجلد المكتبة أولاً');
    e.code = 'NOLIB';
    throw e;
  }
  return d;
}

const wrap = (fn) => async (...args) => {
  try { return { ok: true, data: await fn(...args) }; }
  catch (e) { return { ok: false, code: e.code || '', message: e.message }; }
};

ipcMain.handle('lib:pick', wrap(async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'اختر مجلد مكتبة IBRA-3D-LIBRARY (اللي بيه models و catalog.json)',
    properties: ['openDirectory', 'createDirectory']
  });
  if (r.canceled || !r.filePaths[0]) return null;
  let dir = r.filePaths[0];
  // إذا اختار مجلد أبو المكتبة وبداخله IBRA-3D-LIBRARY نستخدمه
  const inner = path.join(dir, 'IBRA-3D-LIBRARY');
  if (!fs.existsSync(path.join(dir, 'catalog.json')) && fs.existsSync(path.join(inner, 'catalog.json'))) dir = inner;
  lib.ensureLibrary(dir);
  lib.readCatalog(dir); // يتأكد إنه JSON صالح
  saveSettings({ libraryDir: dir });
  return dir;
}));

ipcMain.handle('lib:types', () => lib.TYPES);

ipcMain.handle('lib:list', wrap(async () => {
  const d = requireLib();
  return { dir: d, models: lib.listModels(d).map(m => ({ ...m, url: m.exists ? toLocalUrl(m.abs) : null })) };
}));

ipcMain.handle('lib:suggest', wrap(async (_e, prefix) => lib.suggestCode(requireLib(), prefix)));
ipcMain.handle('lib:exists', wrap(async (_e, code) => lib.codeExists(requireLib(), code)));

ipcMain.handle('lib:add', wrap(async (_e, data) => {
  const d = requireLib();
  if (!data.srcPath || !fs.existsSync(data.srcPath)) throw new Error('ملف المجسم ما موجود');
  return lib.addModel(d, data);
}));

ipcMain.handle('lib:remove', wrap(async (_e, code) => {
  const d = requireLib();
  const file = lib.removeModel(d, code);
  if (fs.existsSync(file)) {
    try { await shell.trashItem(file); } catch { fs.unlinkSync(file); }
  }
  return true;
}));

ipcMain.handle('lib:export', wrap(async () => {
  const d = requireLib();
  const r = await dialog.showSaveDialog(win, {
    title: 'تصدير المكتبة',
    defaultPath: 'IBRA-3D-LIBRARY.zip',
    filters: [{ name: 'ZIP', extensions: ['zip'] }]
  });
  if (r.canceled || !r.filePath) return null;
  const zip = new AdmZip();
  zip.addLocalFile(path.join(d, 'catalog.json'), 'IBRA-3D-LIBRARY');
  zip.addLocalFolder(path.join(d, 'models'), 'IBRA-3D-LIBRARY/models');
  zip.writeZip(r.filePath);
  return r.filePath;
}));

ipcMain.handle('lib:open', wrap(async () => { shell.openPath(requireLib()); return true; }));
