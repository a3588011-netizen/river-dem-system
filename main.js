const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: '하천 DEM 분석 시스템',
    backgroundColor: '#f3f4f6',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile('index.html');

  // 메뉴
  const template = [

    {
      label: 'File',
      submenu: [
        {
          label: 'DEM 열기',
          click() {
            mainWindow.webContents.executeJavaScript(`
              document.getElementById('demFile').click()
            `);
          }
        },

        { type: 'separator' },

        {
          label: '종료',
          click() {
            app.quit();
          }
        }
      ]
    },

    {
      label: 'Edit',
      submenu: [
        {
          label: '현재 DEM 제거',
          click() {
            mainWindow.webContents.executeJavaScript(`
              if(window.ras){
                ras = null;
                alert('DEM 제거 완료');
              }
            `);
          }
        },

        {
          label: '설정 초기화',
          click() {
            mainWindow.webContents.executeJavaScript(`
              localStorage.clear();
              location.reload();
            `);
          }
        }
      ]
    },

    {
      label: 'View',
      submenu: [
        {
          label: '전체화면',
          click() {
            mainWindow.setFullScreen(
              !mainWindow.isFullScreen()
            );
          }
        },

        {
          label: '새로고침',
          click() {
            mainWindow.reload();
          }
        }
      ]
    },

    {
      label: 'Setting',
      submenu: [
        {
          label: 'Heatmap ON/OFF',
          click() {
            mainWindow.webContents.executeJavaScript(`
              if(typeof heat !== 'undefined' && heat){
                if(map.hasLayer(heat)){
                  map.removeLayer(heat);
                } else {
                  heat.addTo(map);
                }
              }
            `);
          }
        },

        {
          label: 'UI 초기화',
          click() {
            mainWindow.webContents.executeJavaScript(`
              location.reload();
            `);
          }
        }
      ]
    },

    {
      label: 'Help',
      submenu: [
        {
          label: '버전 정보',
          click() {
            mainWindow.webContents.executeJavaScript(`
              alert('River DEM v1.0');
            `);
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
