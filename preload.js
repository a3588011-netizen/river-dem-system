const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('riverdemGithub',{
  getConfig(){
    return ipcRenderer.invoke('github:get-config');
  },

  saveConfig(config){
    return ipcRenderer.invoke('github:save-config',config);
  },

  testConnection(){
    return ipcRenderer.invoke('github:test-connection');
  },

  beginPublish(options){
    return ipcRenderer.invoke('github:publish-begin',options);
  },

  uploadBlob(sessionId,path,data){
    return ipcRenderer.invoke(
      'github:publish-blob',
      {sessionId,path,data}
    );
  },

  finalizePublish(sessionId){
    return ipcRenderer.invoke(
      'github:publish-finalize',
      {sessionId}
    );
  },

  cancelPublish(sessionId){
    return ipcRenderer.invoke(
      'github:publish-cancel',
      {sessionId}
    );
  },

  waitForPages(url,timeoutMs){
    return ipcRenderer.invoke(
      'github:wait-pages',
      {url,timeoutMs}
    );
  },

  openExternal(url){
    return ipcRenderer.invoke(
      'github:open-external',
      {url}
    );
  }
});
