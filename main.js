const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');

let mainWindow;
let forceClose = false;
let closeDialogOpen = false;

async function saveProjectBeforeClose(){
  if(!mainWindow || mainWindow.isDestroyed()) return false;

  try{
    const raw = await mainWindow.webContents.executeJavaScript(
      'window.getProjectSavePayloadForElectron ? window.getProjectSavePayloadForElectron() : null',
      true
    );

    if(!raw){
      await dialog.showMessageBox(mainWindow,{
        type:'error',
        title:'RiverDEM',
        message:'프로젝트 저장 데이터를 만들 수 없습니다.',
        detail:'창을 닫지 않았습니다.'
      });
      return false;
    }

    const payload = JSON.parse(raw);
    const defaultName = payload.fileName || 'RiverDEM.riverdem';

    const result = await dialog.showSaveDialog(mainWindow,{
      title:'RiverDEM 프로젝트 저장',
      defaultPath:path.join(app.getPath('documents'),defaultName),
      filters:[
        { name:'RiverDEM 프로젝트', extensions:['riverdem'] },
        { name:'JSON', extensions:['json'] }
      ]
    });

    if(result.canceled || !result.filePath){
      return false;
    }

    let filePath = result.filePath;
    if(!/\.(riverdem|json)$/i.test(filePath)){
      filePath += '.riverdem';
    }

    await fs.writeFile(
      filePath,
      JSON.stringify(payload.project,null,2),
      'utf8'
    );

    await mainWindow.webContents.executeJavaScript(
      `window.notifyProjectSavedByElectron && window.notifyProjectSavedByElectron(${JSON.stringify(filePath)})`,
      true
    );

    return true;
  }catch(err){
    await dialog.showMessageBox(mainWindow,{
      type:'error',
      title:'RiverDEM 프로젝트 저장 실패',
      message:'프로젝트를 저장하지 못했습니다.',
      detail:String(err && err.message ? err.message : err)
    });
    return false;
  }
}

async function confirmClose(){
  if(!mainWindow || mainWindow.isDestroyed() || closeDialogOpen) return;

  closeDialogOpen = true;

  try{
    const result = await dialog.showMessageBox(mainWindow,{
      type:'question',
      title:'RiverDEM',
      message:'종료하기 전에 현재 프로젝트를 저장하시겠습니까?',
      detail:'저장을 선택하면 .riverdem 프로젝트 파일을 저장한 뒤 RiverDEM을 종료합니다.',
      buttons:['저장','저장 안 함','취소'],
      defaultId:0,
      cancelId:2,
      noLink:true
    });

    if(result.response===2){
      return;
    }

    if(result.response===0){
      const saved = await saveProjectBeforeClose();
      if(!saved) return;
    }

    forceClose = true;
    mainWindow.close();
  }finally{
    closeDialogOpen = false;
  }
}

function createWindow(){
  mainWindow=new BrowserWindow({
    width:1500,
    height:950,
    minWidth:1100,
    minHeight:750,
    title:'RiverDEM',
    webPreferences:{
      nodeIntegration:false,
      contextIsolation:true
    }
  });

  mainWindow.loadFile(path.join(__dirname,'index.html'));

  mainWindow.on('close',(event)=>{
    if(forceClose) return;

    event.preventDefault();
    confirmClose();
  });

  const template=[
    {label:'File',submenu:[
      {label:'DEM 열기',accelerator:'Ctrl+O',click(){mainWindow.webContents.executeJavaScript('openDemFile()')}},
      {type:'separator'},
      {label:'종료',click(){mainWindow.close()}}
    ]},
    {label:'Edit',submenu:[
      {label:'VWorld API Key 설정',click(){mainWindow.webContents.executeJavaScript('setVWorldKey()')}},
      {type:'separator'},
      {label:'설정 초기화',click(){mainWindow.webContents.executeJavaScript('localStorage.clear();location.reload();')}}
    ]},
    {label:'View',submenu:[
      {label:'하천 선택 패널',click(){mainWindow.webContents.executeJavaScript('toggleLeft()')}},
      {label:'지도 설정 패널',click(){mainWindow.webContents.executeJavaScript('toggleRight()')}},
      {label:'전체화면',accelerator:'F11',click(){mainWindow.setFullScreen(!mainWindow.isFullScreen())}},
      {label:'새로고침',accelerator:'F5',click(){mainWindow.reload()}}
    ]},
    {label:'Setting',submenu:[
      {label:'Heat Map ON/OFF',click(){mainWindow.webContents.executeJavaScript("document.getElementById('heatSw').click()")}},
      {label:'DEM Overlay ON/OFF',click(){mainWindow.webContents.executeJavaScript("document.getElementById('demSw').click()")}},
      {label:'VWorld 기본지도',click(){mainWindow.webContents.executeJavaScript("baseMapSelect.value='vworld-base';setBaseMap()")}},
      {label:'VWorld 위성지도',click(){mainWindow.webContents.executeJavaScript("baseMapSelect.value='vworld-satellite';setBaseMap()")}},
      {label:'OpenStreetMap',click(){mainWindow.webContents.executeJavaScript("baseMapSelect.value='osm';setBaseMap()")}}
    ]},
    {label:'Help',submenu:[
      {label:'버전 정보',click(){mainWindow.webContents.executeJavaScript('alert("River DEM Desktop v4")')}}
    ]}
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(createWindow);

app.on('window-all-closed',()=>{
  if(process.platform!=='darwin') app.quit();
});
