const { contextBridge, ipcRenderer } = require('electron');
if (process.isMainFrame) {
  const methods = ['state', 'settings', 'models', 'test', 'choose-project', 'open-recent', 'analyze', 'cancel', 'chat', 'export'];
  contextBridge.exposeInMainWorld('desktop', {
    call: (name, ...args) => {
      if (!methods.includes(name)) throw new Error('Unknown action');
      return ipcRenderer.invoke(name, ...args);
    },
    on: (name, callback) => {
      if (!['progress', 'completed', 'task-error', 'idle'].includes(name)) throw new Error('Unknown event');
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on(name, listener);
      return () => ipcRenderer.removeListener(name, listener);
    },
  });
}
