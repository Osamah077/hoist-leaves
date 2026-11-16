'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const DATA_DIR = () => app.getPath('userData');
const DATA_FILE = () => path.join(DATA_DIR(), 'hoist-leaves-data.json');
const BACKUP_DIR = () => path.join(DATA_DIR(), 'backups');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 900, minHeight: 600,
    title: 'رصيد الإجازات — هويست إنفينيتي',
    backgroundColor: '#FBFBF7',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

/* ===== تخزين البيانات ===== */
function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE(), 'utf8')); }
  catch (e) { return { employees: [], leaves: [], changes: [] }; }
}
function writeData(d) {
  fs.mkdirSync(DATA_DIR(), { recursive: true });
  const tmp = DATA_FILE() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d, null, 1), 'utf8');
  fs.renameSync(tmp, DATA_FILE());
}
function dailyBackup() {
  try {
    if (!fs.existsSync(DATA_FILE())) return;
    fs.mkdirSync(BACKUP_DIR(), { recursive: true });
    const name = 'backup-' + new Date().toISOString().slice(0, 10) + '.json';
    const p = path.join(BACKUP_DIR(), name);
    if (!fs.existsSync(p)) fs.copyFileSync(DATA_FILE(), p);
    const all = fs.readdirSync(BACKUP_DIR()).filter(f => f.startsWith('backup-')).sort();
    while (all.length > 30) fs.unlinkSync(path.join(BACKUP_DIR(), all.shift()));
  } catch (e) {}
}

ipcMain.handle('data:load', () => { dailyBackup(); return readData(); });
ipcMain.handle('data:save', (_e, d) => { writeData(d); return true; });
ipcMain.handle('data:openFolder', () => { shell.openPath(DATA_DIR()); return true; });

/* ===== أدوات التحويل ===== */
const AR_DIGITS = { '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9',
                    '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9' };
function digits(s) { return String(s == null ? '' : s).replace(/[٠-٩۰-۹]/g, c => AR_DIGITS[c]); }
function pad(n) { return String(n).padStart(2, '0'); }
function toISO(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && isFinite(v)) {
    const ms = Math.round((v - 25569) * 86400000);   // رقم تسلسلي من Excel
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  if (v instanceof Date && !isNaN(v)) return v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
  const s = digits(v).trim().replace(/[.\\]/g, '/');
  let m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (m) return m[3] + '-' + pad(m[2]) + '-' + pad(m[1]);
  if (/^\d{5}(\.\d+)?$/.test(s)) return toISO(Number(s));
  return '';
}

/* ===== الاستيراد ===== */
ipcMain.handle('import:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'استيراد البيانات',
    filters: [{ name: 'Excel / CSV / نسخة احتياطية', extensions: ['xlsx', 'xls', 'csv', 'json'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths.length) return null;
  const file = r.filePaths[0];
  const ext = path.extname(file).toLowerCase();
  if (ext === '.json') {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { kind: 'backup', file: path.basename(file), data: d };
  }
  let wb;
  if (ext === '.csv') {
    let txt = fs.readFileSync(file, 'utf8');
    if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
    wb = XLSX.read(txt, { type: 'string', raw: true });
  } else {
    wb = XLSX.read(fs.readFileSync(file), { type: 'buffer' });
  }
  const sheets = wb.SheetNames.map(name => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: true })
  }));
  return { kind: 'sheet', file: path.basename(file), sheets };
});

ipcMain.handle('util:toISO', (_e, v) => toISO(v));
ipcMain.handle('util:toISOMany', (_e, arr) => arr.map(toISO));

/* ===== التصدير ===== */
ipcMain.handle('export:xlsx', async (_e, payload) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'تصدير إلى Excel',
    defaultPath: payload.fileName || 'رصيد-الإجازات.xlsx',
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  });
  if (r.canceled || !r.filePath) return null;
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  payload.sheets.forEach(s => {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    ws['!cols'] = (s.widths || []).map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  });
  XLSX.writeFile(wb, r.filePath);
  return r.filePath;
});

ipcMain.handle('export:json', async (_e, data) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'حفظ نسخة احتياطية',
    defaultPath: 'نسخة-احتياطية-الإجازات-' + new Date().toISOString().slice(0, 10) + '.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, JSON.stringify(data, null, 1), 'utf8');
  return r.filePath;
});

ipcMain.handle('shell:show', (_e, p) => { shell.showItemInFolder(p); return true; });
