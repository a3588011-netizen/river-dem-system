const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
let mainWindow;
function createWindow(){
  mainWindow=new BrowserWindow({
    width:1500,height:950,minWidth:1100,minHeight:750,
    title:'하천 DEM 분석 시스템',
    webPreferences:{nodeIntegration:false,contextIsolation:true}
  });
  mainWindow.loadFile(path.join(__dirname,'index.html'));
  const template=[
    {label:'File',submenu:[
      {label:'DEM 열기',accelerator:'Ctrl+O',click(){mainWindow.webContents.executeJavaScript('openDemFile()')}},
      {type:'separator'},{label:'종료',click(){app.quit()}}
    ]},
    {label:'Edit',submenu:[
      {label:'설정 초기화',click(){mainWindow.webContents.executeJavaScript('localStorage.clear();location.reload();')}}
    ]},
    {label:'View',submenu:[
      {label:'지도 설정',click(){mainWindow.webContents.executeJavaScript('toggleRight()')}},
      {label:'전체화면',accelerator:'F11',click(){mainWindow.setFullScreen(!mainWindow.isFullScreen())}},
      {label:'새로고침',accelerator:'F5',click(){mainWindow.reload()}}
    ]},
    {label:'Setting',submenu:[
      {label:'Heat Map ON/OFF',click(){mainWindow.webContents.executeJavaScript("document.getElementById('heatSw').click()")}},
      {label:'DEM Overlay ON/OFF',click(){mainWindow.webContents.executeJavaScript("document.getElementById('demSw').click()")}},
      {label:'DEM 열기',click(){mainWindow.webContents.executeJavaScript('openDemFile()')}}
    ]},
    {label:'Help',submenu:[
      {label:'버전 정보',click(){mainWindow.webContents.executeJavaScript('alert("River DEM Desktop v3")')}}
    ]}
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
app.whenReady().then(createWindow);
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
