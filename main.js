const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow(){

const win = new BrowserWindow({
width:1600,
height:900,
webPreferences:{
nodeIntegration:true,
contextIsolation:false
}
});

win.loadFile('index.html');
}

app.whenReady().then(createWindow);
