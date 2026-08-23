const { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');

let mainWindow;
let forceClose = false;
let closeDialogOpen = false;
let unresponsiveDialogOpen = false;

const GITHUB_API_VERSION='2026-03-10';
const GITHUB_MAX_BLOB_BYTES=100*1024*1024;
const GITHUB_CONFIG_FILE='riverdem-github.json';

let githubTokenMemory='';
let githubSessionCounter=0;
const githubPublishSessions=new Map();

function githubDefaultConfig(){
  return {
    owner:'a3588011-netizen',
    repo:'river-dem-system',
    branch:'main',
    pagesBaseUrl:'https://a3588011-netizen.github.io/river-dem-system/',
    rememberToken:true,
    encryptedToken:''
  };
}

function githubNormalizePagesBaseUrl(value){
  let url=String(value||'').trim();

  if(!url)return '';

  if(!/^https?:\/\//i.test(url)){
    url='https://'+url.replace(/^\/+/,'');
  }

  return url.replace(/\/+$/,'')+'/';
}

function githubNormalizeConfig(value={}){
  const defaults=githubDefaultConfig();

  return {
    owner:String(value.owner??defaults.owner).trim(),
    repo:String(value.repo??defaults.repo).trim(),
    branch:String(value.branch??defaults.branch).trim(),
    pagesBaseUrl:githubNormalizePagesBaseUrl(
      value.pagesBaseUrl??defaults.pagesBaseUrl
    ),
    rememberToken:value.rememberToken!==false,
    encryptedToken:String(value.encryptedToken||'')
  };
}

function githubValidateConfig(config){
  if(!/^[A-Za-z0-9_.-]+$/.test(config.owner)){
    throw new Error('GitHub 사용자/소유자 형식이 올바르지 않습니다.');
  }

  if(!/^[A-Za-z0-9_.-]+$/.test(config.repo)){
    throw new Error('GitHub 저장소 이름 형식이 올바르지 않습니다.');
  }

  if(
    !config.branch||
    config.branch.includes('..')||
    config.branch.startsWith('/')||
    config.branch.endsWith('/')
  ){
    throw new Error('GitHub 브랜치 이름을 확인해주세요.');
  }

  if(!/^https?:\/\//i.test(config.pagesBaseUrl)){
    throw new Error('GitHub Pages 주소를 확인해주세요.');
  }
}

function githubConfigPath(){
  return path.join(
    app.getPath('userData'),
    GITHUB_CONFIG_FILE
  );
}

async function githubReadConfigFile(){
  try{
    const raw=await fs.readFile(
      githubConfigPath(),
      'utf8'
    );

    return githubNormalizeConfig(
      JSON.parse(raw)
    );
  }catch(err){
    if(err && err.code!=='ENOENT'){
      console.error('GitHub config read failed',err);
    }

    return githubDefaultConfig();
  }
}

async function githubWriteConfigFile(config){
  const normalized=githubNormalizeConfig(config);

  await fs.writeFile(
    githubConfigPath(),
    JSON.stringify(normalized,null,2),
    'utf8'
  );

  return normalized;
}

function githubDecryptStoredToken(config){
  if(!config?.encryptedToken)return '';

  if(!safeStorage.isEncryptionAvailable()){
    return '';
  }

  try{
    return safeStorage.decryptString(
      Buffer.from(
        config.encryptedToken,
        'base64'
      )
    );
  }catch(err){
    console.error('GitHub token decrypt failed',err);
    return '';
  }
}

async function githubGetToken(config=null){
  if(githubTokenMemory){
    return githubTokenMemory;
  }

  const cfg=config||await githubReadConfigFile();
  const decrypted=githubDecryptStoredToken(cfg);

  if(decrypted){
    githubTokenMemory=decrypted;
  }

  return githubTokenMemory;
}

async function githubPublicConfig(config=null){
  const cfg=config||await githubReadConfigFile();
  const token=await githubGetToken(cfg);

  return {
    owner:cfg.owner,
    repo:cfg.repo,
    branch:cfg.branch,
    pagesBaseUrl:cfg.pagesBaseUrl,
    rememberToken:cfg.rememberToken,
    hasToken:!!token,
    secureStorage:safeStorage.isEncryptionAvailable()
  };
}

async function githubSaveConfig(payload={}){
  const current=await githubReadConfigFile();

  const next=githubNormalizeConfig({
    ...current,
    owner:payload.owner,
    repo:payload.repo,
    branch:payload.branch,
    pagesBaseUrl:payload.pagesBaseUrl,
    rememberToken:payload.rememberToken
  });

  githubValidateConfig(next);

  const suppliedToken=String(payload.token||'').trim();

  if(suppliedToken){
    githubTokenMemory=suppliedToken;
  }else if(!githubTokenMemory){
    githubTokenMemory=githubDecryptStoredToken(current);
  }

  if(next.rememberToken){
    if(
      githubTokenMemory &&
      safeStorage.isEncryptionAvailable()
    ){
      next.encryptedToken=
        safeStorage.encryptString(
          githubTokenMemory
        ).toString('base64');
    }else if(!safeStorage.isEncryptionAvailable()){
      next.encryptedToken='';
    }
  }else{
    next.encryptedToken='';
  }

  const saved=await githubWriteConfigFile(next);
  return githubPublicConfig(saved);
}

function githubEncodePathSegment(value){
  return encodeURIComponent(String(value||''));
}

function githubApiBase(config){
  return (
    'https://api.github.com/repos/'+
    githubEncodePathSegment(config.owner)+'/'+
    githubEncodePathSegment(config.repo)
  );
}

async function githubFetchWithTimeout(url,options={},timeoutMs=60000){
  const controller=new AbortController();
  const timer=setTimeout(
    ()=>controller.abort(),
    Math.max(1000,Number(timeoutMs)||60000)
  );

  try{
    return await fetch(
      url,
      {
        ...options,
        signal:controller.signal
      }
    );
  }finally{
    clearTimeout(timer);
  }
}

async function githubApiRequest(config,token,endpoint,options={}){
  if(!token){
    throw new Error('GitHub 토큰이 없습니다.');
  }

  const url=
    endpoint.startsWith('http')
      ?endpoint
      :githubApiBase(config)+endpoint;

  const headers={
    'Accept':'application/vnd.github+json',
    'Authorization':'Bearer '+token,
    'X-GitHub-Api-Version':GITHUB_API_VERSION,
    'User-Agent':'RiverDEM-Electron',
    ...(options.headers||{})
  };

  const response=
    await githubFetchWithTimeout(
      url,
      {
        method:options.method||'GET',
        headers,
        body:options.body===undefined
          ?undefined
          :JSON.stringify(options.body)
      },
      options.timeoutMs||60000
    );

  let data=null;
  const raw=await response.text();

  if(raw){
    try{
      data=JSON.parse(raw);
    }catch(e){
      data=raw;
    }
  }

  if(options.allow404 && response.status===404){
    return {status:404,data:null};
  }

  if(!response.ok){
    const message=
      data&&typeof data==='object'&&data.message
        ?data.message
        :raw||response.statusText;

    const error=new Error(
      `GitHub API ${response.status}: ${message}`
    );

    error.status=response.status;
    error.data=data;
    throw error;
  }

  return {
    status:response.status,
    data
  };
}

async function githubTestApi(config,token){
  githubValidateConfig(config);

  const repo=
    await githubApiRequest(
      config,
      token,
      ''
    );

  const ref=
    await githubApiRequest(
      config,
      token,
      '/git/ref/heads/'+
      githubEncodePathSegment(config.branch)
    );

  return {
    fullName:repo.data?.full_name||
      `${config.owner}/${config.repo}`,
    branch:config.branch,
    commitSha:ref.data?.object?.sha||''
  };
}

async function githubGetBranchState(config,token){
  const ref=
    await githubApiRequest(
      config,
      token,
      '/git/ref/heads/'+
      githubEncodePathSegment(config.branch)
    );

  const commitSha=ref.data?.object?.sha;
  if(!commitSha){
    throw new Error('GitHub 브랜치의 현재 커밋을 찾지 못했습니다.');
  }

  const commit=
    await githubApiRequest(
      config,
      token,
      '/git/commits/'+
      githubEncodePathSegment(commitSha)
    );

  const treeSha=commit.data?.tree?.sha;
  if(!treeSha){
    throw new Error('GitHub 브랜치의 현재 트리를 찾지 못했습니다.');
  }

  return {commitSha,treeSha};
}

async function githubResultPathExists(config,token,resultId){
  const pathValue='results/'+resultId;

  const result=
    await githubApiRequest(
      config,
      token,
      '/contents/'+
      pathValue
        .split('/')
        .map(githubEncodePathSegment)
        .join('/')+
      '?ref='+encodeURIComponent(config.branch),
      {allow404:true}
    );

  return result.status!==404;
}

async function githubListExistingResultFiles(config,token,treeSha,resultId){
  const prefix=`results/${resultId}/`;

  const result=
    await githubApiRequest(
      config,
      token,
      '/git/trees/'+
      githubEncodePathSegment(treeSha)+
      '?recursive=1'
    );

  const tree=
    Array.isArray(result.data?.tree)
      ?result.data.tree
      :[];

  return tree
    .filter(item=>
      item &&
      item.type==='blob' &&
      typeof item.path==='string' &&
      item.path.startsWith(prefix)
    )
    .map(item=>item.path);
}

function githubDataToBuffer(data){
  if(typeof data==='string'){
    return Buffer.from(data,'utf8');
  }

  if(Buffer.isBuffer(data)){
    return data;
  }

  if(data instanceof Uint8Array){
    return Buffer.from(
      data.buffer,
      data.byteOffset,
      data.byteLength
    );
  }

  if(data instanceof ArrayBuffer){
    return Buffer.from(data);
  }

  if(
    data &&
    data.type==='Buffer' &&
    Array.isArray(data.data)
  ){
    return Buffer.from(data.data);
  }

  throw new Error('업로드 파일 데이터를 읽지 못했습니다.');
}

function githubValidateResultId(resultId){
  const id=String(resultId||'').trim();

  if(!/^[A-Za-z0-9_-]{1,48}$/.test(id)){
    throw new Error(
      '결과 ID는 영문, 숫자, -, _ 조합 1~48자로 입력해주세요.'
    );
  }

  return id;
}

function githubValidateUploadPath(pathValue,resultId){
  const pathText=
    String(pathValue||'')
      .replace(/\\/g,'/')
      .replace(/^\/+/,'');

  const prefix=`results/${resultId}/`;

  if(
    !pathText.startsWith(prefix)||
    pathText.includes('../')||
    pathText.includes('/..')||
    pathText.includes('//')
  ){
    throw new Error(
      'GitHub 업로드 경로가 허용된 results/<결과ID>/ 범위를 벗어났습니다.'
    );
  }

  return pathText;
}

async function githubCreateBlob(config,token,buffer){
  if(buffer.byteLength>GITHUB_MAX_BLOB_BYTES){
    throw new Error(
      `GitHub 단일 파일 100MB 제한을 초과했습니다: ${(buffer.byteLength/1024/1024).toFixed(1)}MB`
    );
  }

  const result=
    await githubApiRequest(
      config,
      token,
      '/git/blobs',
      {
        method:'POST',
        timeoutMs:180000,
        body:{
          content:buffer.toString('base64'),
          encoding:'base64'
        }
      }
    );

  const sha=result.data?.sha;
  if(!sha){
    throw new Error('GitHub blob SHA를 받지 못했습니다.');
  }

  return sha;
}

async function githubFinalizeEntries(
  config,
  token,
  branchState,
  entries,
  commitMessage,
  existingPaths=[]
){
  if(!Array.isArray(entries)||!entries.length){
    throw new Error('GitHub에 반영할 파일이 없습니다.');
  }

  const newPaths=new Set(
    entries.map(entry=>entry.path)
  );

  const deletions=
    (Array.isArray(existingPaths)?existingPaths:[])
      .filter(pathValue=>!newPaths.has(pathValue))
      .map(pathValue=>({
        path:pathValue,
        mode:'100644',
        type:'blob',
        sha:null
      }));

  const treeResult=
    await githubApiRequest(
      config,
      token,
      '/git/trees',
      {
        method:'POST',
        body:{
          base_tree:branchState.treeSha,
          tree:[
            ...entries.map(entry=>({
              path:entry.path,
              mode:'100644',
              type:'blob',
              sha:entry.sha
            })),
            ...deletions
          ]
        }
      }
    );

  const newTreeSha=treeResult.data?.sha;
  if(!newTreeSha){
    throw new Error('GitHub 새 tree SHA를 받지 못했습니다.');
  }

  const commitResult=
    await githubApiRequest(
      config,
      token,
      '/git/commits',
      {
        method:'POST',
        body:{
          message:String(
            commitMessage||
            'RiverDEM result publish'
          ),
          tree:newTreeSha,
          parents:[branchState.commitSha]
        }
      }
    );

  const newCommitSha=commitResult.data?.sha;
  if(!newCommitSha){
    throw new Error('GitHub 새 commit SHA를 받지 못했습니다.');
  }

  await githubApiRequest(
    config,
    token,
    '/git/refs/heads/'+
    githubEncodePathSegment(config.branch),
    {
      method:'PATCH',
      body:{
        sha:newCommitSha,
        force:false
      }
    }
  );

  return {
    commitSha:newCommitSha,
    treeSha:newTreeSha,
    deletedCount:deletions.length
  };
}

function registerGithubIpc(){
  ipcMain.handle(
    'github:get-config',
    async ()=>{
      return githubPublicConfig();
    }
  );

  ipcMain.handle(
    'github:save-config',
    async (event,payload)=>{
      return githubSaveConfig(payload||{});
    }
  );

  ipcMain.handle(
    'github:test-connection',
    async ()=>{
      const config=await githubReadConfigFile();
      githubValidateConfig(config);

      const token=await githubGetToken(config);
      if(!token){
        throw new Error('GitHub 토큰을 먼저 입력해주세요.');
      }

      return githubTestApi(config,token);
    }
  );

  ipcMain.handle(
    'github:publish-begin',
    async (event,options={})=>{
      const config=await githubReadConfigFile();
      githubValidateConfig(config);

      const token=await githubGetToken(config);
      if(!token){
        throw new Error('GitHub 토큰을 먼저 입력해주세요.');
      }

      const resultId=
        githubValidateResultId(
          options.resultId
        );

      const branchState=
        await githubGetBranchState(
          config,
          token
        );

      const exists=
        await githubResultPathExists(
          config,
          token,
          resultId
        );

      const existingPaths=
        exists
          ?await githubListExistingResultFiles(
            config,
            token,
            branchState.treeSha,
            resultId
          )
          :[];

      const sessionId=
        'gh-'+
        Date.now().toString(36)+'-'+
        (++githubSessionCounter).toString(36);

      githubPublishSessions.set(
        sessionId,
        {
          config,
          token,
          resultId,
          branchState,
          entries:[],
          existingPaths,
          commitMessage:String(
            options.commitMessage||
            `RiverDEM result: ${resultId}`
          ),
          createdAt:Date.now()
        }
      );

      return {
        sessionId,
        exists,
        existingFileCount:existingPaths.length,
        pageUrl:
          config.pagesBaseUrl+
          'results/'+
          resultId+
          '/'
      };
    }
  );

  ipcMain.handle(
    'github:publish-blob',
    async (event,payload={})=>{
      const session=
        githubPublishSessions.get(
          String(payload.sessionId||'')
        );

      if(!session){
        throw new Error('GitHub 게시 세션이 만료되었습니다. 다시 게시해주세요.');
      }

      const uploadPath=
        githubValidateUploadPath(
          payload.path,
          session.resultId
        );

      const buffer=
        githubDataToBuffer(
          payload.data
        );

      const sha=
        await githubCreateBlob(
          session.config,
          session.token,
          buffer
        );

      const existingIndex=
        session.entries.findIndex(
          item=>item.path===uploadPath
        );

      const entry={
        path:uploadPath,
        sha,
        size:buffer.byteLength
      };

      if(existingIndex>=0){
        session.entries[existingIndex]=entry;
      }else{
        session.entries.push(entry);
      }

      return {
        path:uploadPath,
        sha,
        size:buffer.byteLength
      };
    }
  );

  ipcMain.handle(
    'github:publish-finalize',
    async (event,payload={})=>{
      const sessionId=String(payload.sessionId||'');
      const session=githubPublishSessions.get(sessionId);

      if(!session){
        throw new Error('GitHub 게시 세션이 만료되었습니다. 다시 게시해주세요.');
      }

      try{
        const result=
          await githubFinalizeEntries(
            session.config,
            session.token,
            session.branchState,
            session.entries,
            session.commitMessage,
            session.existingPaths
          );

        return {
          ...result,
          pageUrl:
            session.config.pagesBaseUrl+
            'results/'+
            session.resultId+
            '/',
          fileCount:session.entries.length
        };
      }finally{
        githubPublishSessions.delete(sessionId);
      }
    }
  );

  ipcMain.handle(
    'github:publish-cancel',
    async (event,payload={})=>{
      githubPublishSessions.delete(
        String(payload.sessionId||'')
      );

      return {canceled:true};
    }
  );

  ipcMain.handle(
    'github:wait-pages',
    async (event,payload={})=>{
      const url=String(payload.url||'').trim();

      if(!/^https?:\/\//i.test(url)){
        throw new Error('GitHub Pages 주소가 올바르지 않습니다.');
      }

      const timeoutMs=Math.min(
        120000,
        Math.max(
          5000,
          Number(payload.timeoutMs)||70000
        )
      );

      const started=Date.now();
      let lastStatus=0;

      while(Date.now()-started<timeoutMs){
        try{
          const response=
            await githubFetchWithTimeout(
              url+
              (url.includes('?')?'&':'?')+
              'riverdem_check='+
              Date.now(),
              {
                method:'GET',
                headers:{
                  'Cache-Control':'no-cache',
                  'User-Agent':'RiverDEM-Electron'
                }
              },
              12000
            );

          lastStatus=response.status;

          if(response.ok){
            return {
              ready:true,
              status:response.status
            };
          }
        }catch(err){}

        await new Promise(
          resolve=>setTimeout(resolve,4000)
        );
      }

      return {
        ready:false,
        status:lastStatus
      };
    }
  );

  ipcMain.handle(
    'github:open-external',
    async (event,payload={})=>{
      const url=String(payload.url||'').trim();

      if(!/^https?:\/\//i.test(url)){
        throw new Error('열 수 없는 주소입니다.');
      }

      await shell.openExternal(url);
      return true;
    }
  );
}


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
      preload:path.join(__dirname,'preload.js'),
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
      {label:'GitHub Pages 게시 설정',click(){runRenderer('openGithubSettingsModal()')}},
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

    {label:'3D Print',submenu:[
      {label:'3D 지형 모형 만들기',click(){runRenderer('openPrint3dModal()')}},
      {label:'지도에서 출력 영역 선택',click(){runRenderer('startPrint3dAreaSelection()')}},
      {type:'separator'},
      {label:'지형 STL만 생성',click(){runRenderer('exportPrint3dStl()')}},
      {label:'최종 3D + QR 결과패키지 ZIP 생성',click(){runRenderer('exportPrint3dQrSet()')}},
      {label:'GitHub Pages에 바로 게시',click(){runRenderer('publishPrint3dToGithub()')}},
      {label:'GitHub 게시 설정',click(){runRenderer('openGithubSettingsModal()')}},
      {label:'출력 영역 지우기',click(){runRenderer('clearPrint3dSelection()')}}
    ]},

    {label:'Help',submenu:[
      {label:'버전 정보',click(){runRenderer('alert("River DEM Desktop v4")')}}
    ]}
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(()=>{
  registerGithubIpc();
  createWindow();
});

app.on('window-all-closed',()=>{
  if(process.platform!=='darwin') app.quit();
});
