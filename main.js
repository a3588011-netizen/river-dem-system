const { app, BrowserWindow } = require('electron');
const path = require('path');

let splash;
let mainWindow;

function createWindow() {
  splash = new BrowserWindow({
    width: 420,
    height: 240,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    center: true,
    backgroundColor: '#111827'
  });

  splash.loadURL(`data:text/html;charset=utf-8,
    <html>
      <body style="margin:0;background:#111827;color:#4ade80;font-family:Segoe UI, sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;">
        <div style="text-align:center;">
          <div style="font-size:28px;font-weight:900;color:white;">River DEM</div>
          <div style="margin-top:16px;font-size:15px;">실행 중...</div>
          <div style="margin-top:8px;font-size:13px;color:#9ca3af;">지도 / DEM 엔진 로드 중</div>
        </div>
      </body>
    </html>
  `);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 900,
    minHeight: 650,
    title: 'River DEM',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      if (splash) splash.close();
      mainWindow.show();
    }, 800);
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
