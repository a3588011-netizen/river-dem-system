const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');

let mainWindow;
let forceClose = false;
let closeDialogOpen = false;
let unresponsiveDialogOpen = false;

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

  mainWindow.loadFile(path.join(__dirname,'index.html')).catch(async err=>{
    await dialog.showMessageBox(mainWindow,{
      type:'error',
      title:'RiverDEM 시작 오류',
      message:'RiverDEM 화면을 불러오지 못했습니다.',
      detail:String(err && err.message ? err.message : err)
    });
  });

  mainWindow.webContents.on('render-process-gone',async (event,details)=>{
    if(!mainWindow || mainWindow.isDestroyed()) return;

    await dialog.showMessageBox(mainWindow,{
      type:'error',
      title:'RiverDEM',
      message:'화면 처리 프로세스가 종료되었습니다.',
      detail:`원인: ${details.reason || 'unknown'}`
    });
  });

  mainWindow.on('unresponsive',async ()=>{
    if(
      !mainWindow ||
      mainWindow.isDestroyed() ||
      unresponsiveDialogOpen
    ) return;

    unresponsiveDialogOpen = true;

    try{
      await dialog.showMessageBox(mainWindow,{
        type:'warning',
        title:'RiverDEM',
        message:'RiverDEM이 일시적으로 응답하지 않습니다.',
        detail:'대용량 DEM 처리 중이라면 잠시 기다린 뒤 상태를 확인해주세요.'
      });
    }finally{
      unresponsiveDialogOpen = false;
    }
  });

  mainWindow.on('responsive',()=>{
    unresponsiveDialogOpen = false;
  });

  mainWindow.on('close',(event)=>{
    if(forceClose) return;

    event.preventDefault();
    confirmClose();
  });

  const runRenderer=(code)=>{
    if(!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.executeJavaScript(code,true).catch(err=>{
      console.error('RiverDEM menu command failed:',err);
    });
  };

  const template=[
    {label:'File',submenu:[
      {label:'DEM 열기',accelerator:'Ctrl+O',click(){runRenderer('openDemFile()')}},
      {type:'separator'},
      {label:'프로젝트 저장',accelerator:'Ctrl+S',click(){runRenderer('saveRiverDemProject()')}},
      {label:'프로젝트 불러오기',accelerator:'Ctrl+Shift+O',click(){runRenderer('openRiverDemProject()')}},
      {label:'분석 결과 Excel 내보내기',accelerator:'Ctrl+E',click(){runRenderer('exportRiverDemAnalysisExcel()')}},
      {type:'separator'},
      {label:'종료',click(){mainWindow.close()}}
    ]},

    {label:'Edit',submenu:[
      {label:'측정 / 체크포인트 / 단면 전체 지우기',click(){runRenderer('clearAllMeasurements()')}},
      {type:'separator'},
      {label:'설정 초기화',click(){runRenderer('localStorage.clear();location.reload()')}}
    ]},

    {label:'View',submenu:[
      {label:'하천 선택 패널 열기/닫기',click(){runRenderer('toggleLeft()')}},
      {label:'작업 도구 패널 열기/닫기',click(){runRenderer('toggleRight()')}},
      {type:'separator'},
      {label:'DEM Overlay ON/OFF',click(){runRenderer("menuToggleOverlay('dem')")}},
      {label:'Heat Map ON/OFF',click(){runRenderer("menuToggleOverlay('heat')")}},
      {type:'separator'},
      {label:'측정 결과 표시/숨김',click(){runRenderer("menuToggleResultLayer('measurement')")}},
      {label:'체크포인트 표시/숨김',click(){runRenderer("menuToggleResultLayer('checkpoint')")}},
      {label:'X/Y 단면 표시/숨김',click(){runRenderer("menuToggleResultLayer('section')")}},
      {type:'separator'},
      {label:'전체화면',accelerator:'F11',click(){mainWindow.setFullScreen(!mainWindow.isFullScreen())}},
      {label:'새로고침',accelerator:'F5',click(){mainWindow.reload()}}
    ]},

    {label:'Setting',submenu:[
      {label:'VWorld API Key 설정',click(){runRenderer('setVWorldKey()')}},
      {type:'separator'},
      {label:'배경지도',submenu:[
        {label:'VWorld 기본지도',click(){runRenderer("menuSetBaseMap('vworld-base')")}},
        {label:'VWorld 위성지도',click(){runRenderer("menuSetBaseMap('vworld-satellite')")}},
        {label:'OpenStreetMap',click(){runRenderer("menuSetBaseMap('osm')")}},
        {label:'흰색 배경',click(){runRenderer("menuSetBaseMap('blank')")}}
      ]},
      {label:'좌표계',submenu:[
        {label:'EPSG:4326 · WGS84 위경도',click(){runRenderer("menuSetCoordinate('EPSG:4326')")}},
        {label:'EPSG:3857 · Web Mercator',click(){runRenderer("menuSetCoordinate('EPSG:3857')")}},
        {label:'EPSG:5179 · Korea 2000',click(){runRenderer("menuSetCoordinate('EPSG:5179')")}}
      ]},
      {label:'Heat Map 모드',submenu:[
        {label:'하천 저고도 강조 (-5 ~ 30 m)',click(){runRenderer("menuSetHeatMode('river')")}},
        {label:'일반 지형',click(){runRenderer("menuSetHeatMode('terrain')")}},
        {label:'DEM 전체범위 자동',click(){runRenderer("menuSetHeatMode('auto')")}}
      ]},
      {label:'DEM 샘플 방식',submenu:[
        {label:'단일 셀 원값',click(){runRenderer("menuSetSampleMode('cell')")}},
        {label:'3×3 평균 (기본)',click(){runRenderer("menuSetSampleMode('avg3')")}},
        {label:'5×5 평균',click(){runRenderer("menuSetSampleMode('avg5')")}},
        {label:'쌍선형 보간',click(){runRenderer("menuSetSampleMode('bilinear')")}}
      ]},
      {type:'separator'},
      {label:'현재 DEM 셀 경계 ON/OFF',click(){runRenderer('menuTogglePixelBoundary()')}}
    ]},

    {label:'Help',submenu:[
      {label:'버전 정보',click(){runRenderer('alert("River DEM Desktop v4")')}}
    ]}
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(createWindow);

app.on('window-all-closed',()=>{
  if(process.platform!=='darwin') app.quit();
});
