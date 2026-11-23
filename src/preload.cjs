const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('ibra', {
  // الإعدادات
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  engines: () => ipcRenderer.invoke('engines:list'),
  checkToken: () => ipcRenderer.invoke('token:check'),

  // التحويل
  pathForFile: (file) => webUtils.getPathForFile(file),
  pickImages: () => ipcRenderer.invoke('dialog:images'),
  convert: (job) => ipcRenderer.invoke('convert:run', job),
  cancel: (id) => ipcRenderer.invoke('convert:cancel', id),
  onProgress: (cb) => ipcRenderer.on('convert:progress', (_e, p) => cb(p)),

  // الملفات
  saveAs: (src, name) => ipcRenderer.invoke('file:saveAs', src, name),
  showInFolder: (p) => ipcRenderer.invoke('file:show', p),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),

  // المكتبة
  pickLibrary: () => ipcRenderer.invoke('lib:pick'),
  libTypes: () => ipcRenderer.invoke('lib:types'),
  libList: () => ipcRenderer.invoke('lib:list'),
  libSuggest: (prefix) => ipcRenderer.invoke('lib:suggest', prefix),
  libExists: (code) => ipcRenderer.invoke('lib:exists', code),
  libAdd: (data) => ipcRenderer.invoke('lib:add', data),
  libRemove: (code) => ipcRenderer.invoke('lib:remove', code),
  libExport: () => ipcRenderer.invoke('lib:export'),
  libOpen: () => ipcRenderer.invoke('lib:open')
});
