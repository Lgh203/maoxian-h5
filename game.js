/* H5 translation of the existing YarnGameView rules. No Android SDK is loaded. */
const CAPACITY = 4;
const TIMING = Object.freeze({layer:200,settle:60,full:1500,fly:380,dress:1000,modelHold:650});
const YARN_COLORS = Object.freeze([[48,50,56],[255,224,31],[255,126,28],[245,67,67],[127,224,35],[173,69,242],[255,83,169],[164,97,72],[245,247,250],[47,139,242],[119,124,135]]);
const SEAMS = [25,51,77,101,127,153,177,203,229,253,279,305];
const clamp = (v,a,b) => Math.min(b,Math.max(a,v));
const lerp = (a,b,t) => a+(b-a)*t;
const rgb = (color,alpha=1) => `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;

function buildPalette(data) {
  const map = Array.from({length:11},(_,i)=>i);
  if (data.number === 1) return map;
  const used = Array(11).fill(false), preferred = [1,3,4,5,8,9,10,2,6,7,0];
  for(const rod of data.rods) for(const color of rod.colors) if(color>=0&&color<11) used[color]=true;
  let at=0;
  for(let raw=0;raw<11;raw++) if(used[raw]) map[raw]=preferred[Math.min(at++,10)];
  return map;
}

function revealTop(rod) {
  if(!rod.colors.length) return;
  const top=rod.colors.length-1, color=rod.colors[top];
  let first=true;
  for(let i=top;i>=0;i--) {
    if(!rod.mystery[i]) break;
    if(!first && rod.colors[i]!==color) break;
    rod.mystery[i]=false;
    first=false;
  }
}

function topGroupCount(rod) {
  if(!rod.colors.length) return 0;
  const color=rod.colors.at(-1);
  let count=0;
  for(let i=rod.colors.length-1;i>=0;i--) {
    if(rod.mystery[i]||rod.colors[i]!==color) break;
    count++;
  }
  return count;
}

function nextOrderColor(state,card) {
  for(let color=0;color<11;color++) if(state.remainingOrders[color]>0) {
    if(!state.modelOrderColor.some((v,i)=>i!==card&&v===color)) return color;
  }
  for(let color=0;color<11;color++) if(state.remainingOrders[color]>0) {
    const assigned=state.modelOrderColor.filter((v,i)=>i!==card&&v===color).length;
    if(state.remainingOrders[color]>assigned) return color;
  }
  return -1;
}

function createLevelState(data,guideFinished=false) {
  const palette=buildPalette(data), remainingOrders=Array(11).fill(0);
  let pieces=0;
  const rods=data.rods.map(source=>{
    const colors=source.colors.map(c=>c>=0&&c<11?palette[c]:c);
    const mystery=colors.map((_,i)=>(source.questionLayers||[]).includes(i));
    const rule=source.unlockRule?source.unlockRule.slice():null;
    if(rule&&rule[0]>0&&rule[0]<11) rule[0]=palette[rule[0]];
    const rod={originalX:source.x,originalY:source.y,colors,mystery,lockColor:rule&&rule.length>=2?rule[0]:0,lockCount:rule&&rule.length>=2?Math.max(0,rule[1]):0,consumed:false,screenX:0,screenY:0};
    revealTop(rod);
    for(const color of colors) if(color>=0&&color<11) {remainingOrders[color]++;pieces++;}
    return rod;
  });
  const state={level:data.number,difficulty:data.difficulty,rods,remainingOrders:remainingOrders.map(n=>Math.floor(n/4)),totalGroups:Math.floor(pieces/4),completedGroups:0,moves:0,selected:-1,won:false,paused:false,bonusAdded:false,guideFinished,modelOrderColor:[-1,-1,-1],modelDressed:[false,false,false],modelDressStart:[0,0,0],modelHoldUntil:[0,0,0],moveActive:false,movingFrom:-1,movingTo:-1,movingColor:-1,movingAmount:0,movingTargetSize:0,movingLanded:0,movingStart:0,effectActive:false,effectRod:-1,effectColor:-1,effectTarget:0,effectStart:0,checkPlayed:false,flyPlayed:false,winAt:0};
  for(let i=0;i<3;i++) state.modelOrderColor[i]=nextOrderColor(state,i);
  return state;
}

/** Return a legal move descriptor without changing the rods, or null. */
function planMove(rods,from,to) {
  if(from<0||to<0||from===to||from>=rods.length||to>=rods.length) return null;
  const a=rods[from],b=rods[to];
  if(a.consumed||b.consumed||a.lockCount>0||b.lockCount>0||!a.colors.length||b.colors.length>=4) return null;
  const color=a.colors.at(-1);
  if(b.colors.length&&b.colors.at(-1)!==color) return null;
  const amount=Math.min(topGroupCount(a),4-b.colors.length);
  return amount>0?{from,to,color,amount,targetSize:b.colors.length}:null;
}

/** Consume one matching order from each applicable lock; return unlocked indices. */
function progressLocks(state,color) {
  const unlocked=[];
  state.rods.forEach((rod,i)=>{
    // Legacy data also uses -1 for generic locks. The Java build only handled 0,
    // permanently locking these rods; both non-positive sentinels mean any order.
    if(rod.lockCount>0&&(rod.lockColor<=0||rod.lockColor===color)) {
      rod.lockCount--;
      if(rod.lockCount<=0) {rod.lockCount=0;revealTop(rod);unlocked.push(i);}
    }
  });
  return unlocked;
}

if(typeof document!=='undefined') initializeBrowser();

function initializeBrowser() {
  const WIDTH=360,HEIGHT=640;
  const canvas=document.querySelector('#game-canvas'), mainContext=canvas.getContext('2d',{alpha:false});
  let ctx=mainContext;
  // Match the native view's static board cache: only selected and moving/effect
  // rods need per-frame painting. High-density late levels avoid hundreds of blits.
  const boardCache=document.createElement('canvas');
  let boardCacheDirty=true;
  const $=id=>document.getElementById(id);
  const screens=['loading-screen','start-screen','consent-screen','legal-screen','exit-screen'];
  const STORAGE='maoxian_h5_v1.';
  const read=(key,fallback)=>{try{return localStorage.getItem(STORAGE+key)??fallback;}catch{return fallback;}};
  const save=(key,value)=>{try{localStorage.setItem(STORAGE+key,String(value));}catch{/* Private browsing may prohibit persistence. */}};
  let ready=false,scene='loading',legalReturn='start',levels=[],state=null,phase=0;
  let musicOn=read('music','true')!=='false',consentAccepted=read('consent','false')==='true';
  let layoutScale=.48,layoutBaseWidth=46,toast='',toastUntil=0;
  let gameTime=0,lastFrame=performance.now(),frameId=0;
  const images=new Map(),tintedGlows=new Map();
  const bgm=$('bgm');bgm.volume=.45;
  let audioContext=null,audioEnabled=false;
  const soundBuffers=new Map();
  const sounds=['yarn_move','level_complete','yarn_full','check_mark','spool_fly','dress_knit','model_enter','yarn_wrap_1','yarn_wrap_2','yarn_wrap_3'];
  const FONT='"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",system-ui,sans-serif';
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;

  const showScreen=(name)=>{
    scene=name;
    screens.forEach(id=>$(id).hidden=id!==`${name}-screen`);
    if(name==='game'||name==='paused'||name==='won') screens.forEach(id=>$(id).hidden=true);
  };
  const status=text=>{$('accessible-status').textContent=text;};
  const notify=text=>{toast=text;toastUntil=gameTime+2200;status(text);};
  const setMusicLabel=()=>{$('music-button').textContent=`音乐：${musicOn?'开启':'关闭'}`;};
  setMusicLabel();

  async function unlockAudio() {
    audioEnabled=true;
    const AudioCtx=window.AudioContext||window.webkitAudioContext;
    if(AudioCtx) {
      audioContext??=new AudioCtx();
      if(audioContext.state==='suspended') await audioContext.resume().catch(()=>{});
      if(!soundBuffers.size) for(const name of sounds) {
        fetch(`./assets/audio/${name}.mp3`).then(r=>{if(!r.ok)throw Error(`Audio ${r.status}`);return r.arrayBuffer();})
          .then(b=>audioContext.decodeAudioData(b)).then(b=>soundBuffers.set(name,b)).catch(()=>{});
      }
    }
    syncMusic();
  }
  function syncMusic() {
    if(audioEnabled&&musicOn&&['game','won'].includes(scene)&&!document.hidden) bgm.play().catch(()=>{});
    else bgm.pause();
  }
  function sound(name,volume=.72) {
    if(!audioEnabled||!musicOn||!audioContext||audioContext.state!=='running') return;
    const buffer=soundBuffers.get(name);if(!buffer)return;
    const source=audioContext.createBufferSource(),gain=audioContext.createGain();
    source.buffer=buffer;gain.gain.value=volume;source.connect(gain).connect(audioContext.destination);source.start();
  }
  function toggleMusic() {musicOn=!musicOn;save('music',musicOn);setMusicLabel();unlockAudio();}

  const legalText={
    privacy:`<p>更新日期：2026年10月11日<br>运营主体：南京兴宇信息科技有限公司</p><h3>一、适用范围</h3><p>本政策适用于《毛线小织匠》H5网页试玩版本。网页无需注册，当前不接入Android账号、广告、支付或联运SDK，不提供充值、提现或付费服务。</p><h3>二、本地游戏数据</h3><p>关卡进度、是否完成教程、音乐设置及隐私同意记录存于当前网站的浏览器localStorage中，仅用于恢复同一浏览器、同一网站的试玩状态。游戏不会主动将这些存档上传。每次重新打开会从保存的当前关重新开始，不保存进行中的搬移动作。</p><p>清理浏览器或网站数据、隐私浏览模式、更换设备、浏览器或网站域名，可能导致本地记录不可用。您可在浏览器网站设置中清除本地记录。</p><h3>三、网络加载与托管</h3><p>网页代码、图片、音乐与关卡文件需要通过网络从静态托管服务加载。正式试玩由GitHub Pages提供静态托管。托管服务可能记录访问IP、请求时间、User-Agent及必要的技术日志，其处理方式以托管服务自身的政策为准。不能将本网页理解为完全离线或完全没有服务器日志。</p><h3>四、权限与第三方SDK</h3><p>本网页不主动调用摄像头、麦克风、定位、通讯录或传感器，不要求手机号或实名认证。音乐在您的点击操作后播放，可以随时关闭。当前版本没有广告SDK，未来若增加相关功能，将另行更新政策并依法取得所需同意。</p><h3>五、未成年人及权利</h3><p>适龄提示8+。未成年人应在监护人指导下试玩，合理控制时间。不同意可退出网页；撤回同意可清除本站浏览器数据。关于网页服务或隐私事项，可通过游戏发布方提供的客服渠道联系运营主体。</p>`,
    agreement:`<p>更新日期：2026年10月11日<br>运营主体：南京兴宇信息科技有限公司</p><h3>一、网页试玩服务</h3><p>《毛线小织匠》H5是浏览器本地游客试玩。无需账户，不提供充值、提现、现金奖励或Android账号登录。网页加载需网络，浏览器兼容性和托管服务状态可能影响使用。</p><h3>二、使用方式</h3><p>点击毛线柱，再点击空柱或同色柱，将顶层连续同色毛线搬移。每柱容量四组，完成同色柱后为模特织衣并推进订单。请在支持Canvas与JavaScript的现代浏览器中试玩。</p><h3>三、本地进度</h3><p>进度与设置只保存在同一网站的当前浏览器中。当前关刷新会重新开始。清除网站数据、隐私浏览、更换浏览器或网址可能导致进度丢失，网页不提供云同步或找回承诺。</p><h3>四、健康游戏与内容</h3><p>建议8周岁以上体验，未成年人应由监护人指导，合理安排时间。不得利用网页从事违法活动或破坏服务。游戏画面与音频等内容的使用应遵守相关权利和授权范围。</p><h3>五、服务边界</h3><p>本页为试玩说明，不代表已通过应用商店审核、完成商业广告接入或实体手机全机型验证。后续若新增广告、账号、支付等功能，将另行说明并更新相应协议。</p>`
  };
  function openLegal(kind) {
    legalReturn=scene;showScreen('legal');syncMusic();
    $('legal-title').textContent=kind==='agreement'?'用户协议':'隐私政策';
    $('legal-content').innerHTML=legalText[kind]||legalText.privacy;
    $('legal-content').scrollTop=0;$('legal-close').focus({preventScroll:true});
  }
  document.querySelectorAll('[data-legal]').forEach(el=>el.addEventListener('click',event=>{event.preventDefault();openLegal(el.dataset.legal);}));
  $('legal-close').addEventListener('click',()=>{showScreen(legalReturn);syncMusic();});
  $('agree-button').addEventListener('click',()=>{consentAccepted=true;save('consent',true);showScreen('start');});
  $('decline-button').addEventListener('click',()=>{showScreen('exit');syncMusic();});
  $('return-button').addEventListener('click',()=>showScreen(consentAccepted?'start':'consent'));
  $('music-button').addEventListener('click',toggleMusic);
  $('start-button').addEventListener('click',()=>{
    if(!ready)return;
    if(!consentAccepted){showScreen('consent');return;}
    newLevel(clamp(Number(read('level','1'))||1,1,800),true);showScreen('game');unlockAudio();
  });
  $('retry-button').addEventListener('click',()=>location.reload());

  async function loadResources() {
    const names=['recovered_post','recovered_base','recovered_shadow','ui_clear','ui_add','ui_pause','ui_speech','tutorial_guide','completion_glow'];
    for(let i=1;i<=3;i++) names.push(`recovered_model_aligned_${i}`,`recovered_model_dress_${i}`);
    for(let c=0;c<11;c++)for(let v=1;v<=2;v++) names.push(`recovered_yarn_${c}_back_${v}`,`recovered_yarn_${c}_front_${v}`);
    let loaded=0;
    const count=names.length+1;
    const tick=()=>{$('load-progress').style.width=`${++loaded/count*100}%`;$('load-message').textContent=`正在准备毛线与关卡… ${Math.round(loaded/count*100)}%`;};
    try {
      const levelRequest=fetch('./levels.json').then(r=>{if(!r.ok)throw Error(`关卡加载失败 (${r.status})`);return r.json();}).then(data=>{
        if(!Array.isArray(data.levels)||data.levels.length!==800)throw Error('关卡数据不完整');
        levels=data.levels;tick();
      });
      await Promise.all([levelRequest,...names.map(name=>new Promise((resolve,reject)=>{
        const img=new Image();img.onload=()=>{images.set(name,img);tick();resolve();};img.onerror=()=>reject(Error(`素材加载失败：${name}`));img.src=`./assets/images/${name}.png`;
      }))]);
      ready=true;
      $('progress-label').textContent=`第 ${clamp(Number(read('level','1'))||1,1,800)} / 800 关 · 缤纷订单`;
      showScreen(consentAccepted?'start':'consent');
      status('加载完成，请同意说明后开始网页试玩。');
    } catch(error) {
      console.error(error);$('load-message').textContent=error.message;$('retry-button').hidden=false;
    }
  }
  function newLevel(level,entranceSound=false) {
    const data=levels.find(l=>l.number===level)||levels[0];
    state=createLevelState(data,read('guide','false')==='true');
    save('level',state.level);toast='';toastUntil=0;updateLayout();
    if(entranceSound) sound('model_enter');
    status(`第${state.level}关，${state.totalGroups}组毛线订单。`);
  }
  function modelX(card) {return WIDTH*[183,375,567][card]/750;}
  function updateLayout() {
    if(!state||!state.rods.length)return;
    const xs=state.rods.map(r=>r.originalX),ys=state.rods.map(r=>r.originalY);
    const minY=Math.min(...ys),maxY=Math.max(...ys),maxX=Math.max(...xs.map(Math.abs));
    const mapW=maxX*2+96,mapH=maxY-minY+223,mapScale=Math.min(1,685/mapW,626/mapH);
    const centerShift=mapH/2-Math.abs(minY);
    layoutScale=WIDTH/750*mapScale;layoutBaseWidth=WIDTH*96/750*mapScale;
    for(const rod of state.rods){rod.screenX=WIDTH*(375+mapScale*rod.originalX)/750;rod.screenY=HEIGHT*(907-mapScale*(rod.originalY-centerShift))/1334;}
    boardCacheDirty=true;
  }
  function rodBounds(rod) {
    const half=Math.max(14,layoutBaseWidth*.62),top=Math.max(42,175*layoutScale);
    return {x:rod.screenX-half,y:rod.screenY-top,width:half*2,height:top+22};
  }
  function hitRod(x,y) {
    let best=-1,score=Infinity;
    state.rods.forEach((rod,i)=>{
      if(rod.consumed)return;
      const b=rodBounds(rod);
      if(x<b.x||x>b.x+b.width||y<b.y||y>b.y+b.height)return;
      const v=Math.abs(x-rod.screenX)+Math.abs(y-(rod.screenY-Math.max(42,175*layoutScale)*.35))*.18;
      if(v<score){best=i;score=v;}
    });return best;
  }
  function beginMove(from,to) {
    const move=planMove(state.rods,from,to);if(!move||state.moveActive)return false;
    Object.assign(state,{moveActive:true,movingFrom:from,movingTo:to,movingColor:move.color,movingAmount:move.amount,movingTargetSize:move.targetSize,movingLanded:0,movingStart:gameTime,selected:-1});
    const a=state.rods[from];a.colors.splice(-move.amount);a.mystery.splice(-move.amount);revealTop(a);
    boardCacheDirty=true;
    state.guideFinished=true;save('guide',true);sound(`yarn_wrap_${clamp(move.amount,1,3)}`);return true;
  }
  function updateMove() {
    if(!state.moveActive)return;
    const elapsed=gameTime-state.movingStart,target=state.rods[state.movingTo];
    while(state.movingLanded<state.movingAmount&&elapsed>=(state.movingLanded+1)*TIMING.layer) {
      target.colors.push(state.movingColor);target.mystery.push(false);state.movingLanded++;
      boardCacheDirty=true;
    }
    if(elapsed<state.movingAmount*TIMING.layer+TIMING.settle)return;
    revealTop(target);state.moves++;const rod=state.movingTo,color=state.movingColor;
    Object.assign(state,{moveActive:false,movingFrom:-1,movingTo:-1,movingColor:-1,movingAmount:0,movingTargetSize:0,movingLanded:0,movingStart:0});
    sound('yarn_move',.60);
    if(target.colors.length===4&&target.colors.every(c=>c===color)) startCompletion(rod,color);
  }
  function selectTarget(color) {
    let card=state.modelOrderColor.findIndex(c=>c===color);
    if(card>=0)return card;
    card=state.modelHoldUntil.findIndex(t=>t===0);
    if(card<0)card=state.completedGroups%3;
    state.modelOrderColor[card]=color;state.modelDressed[card]=false;return card;
  }
  function startCompletion(rod,color) {
    Object.assign(state,{effectActive:true,effectRod:rod,effectColor:color,effectTarget:selectTarget(color),effectStart:gameTime,checkPlayed:false,flyPlayed:false,selected:-1});
    boardCacheDirty=true;
    sound('yarn_full',.83);
  }
  function updateEffect() {
    if(!state.effectActive)return;
    const elapsed=gameTime-state.effectStart;
    if(elapsed>=900&&!state.checkPlayed){state.checkPlayed=true;sound('check_mark',.70);}
    if(elapsed>=TIMING.full&&!state.flyPlayed){state.flyPlayed=true;sound('spool_fly',.72);}
    if(elapsed<TIMING.full+TIMING.fly)return;
    state.rods[state.effectRod].consumed=true;state.completedGroups++;
    const color=state.effectColor,target=state.effectTarget;
    if(state.remainingOrders[color]>0)state.remainingOrders[color]--;
    if(progressLocks(state,color).length)notify('新毛线柱已解锁！');
    state.modelDressed[target]=true;state.modelDressStart[target]=gameTime;state.modelHoldUntil[target]=gameTime+TIMING.dress+TIMING.modelHold;
    sound('dress_knit',.80);
    state.effectActive=false;state.effectRod=-1;state.effectColor=-1;
    boardCacheDirty=true;
    if(state.completedGroups>=state.totalGroups)state.winAt=gameTime+TIMING.dress+350;
    status(`已完成${state.completedGroups}/${state.totalGroups}组毛线，${state.moves}步。`);
  }
  function refreshModels() {
    for(let i=0;i<3;i++)if(state.modelHoldUntil[i]>0&&gameTime>=state.modelHoldUntil[i]&&state.winAt===0&&!state.won){
      state.modelHoldUntil[i]=0;state.modelDressStart[i]=0;const color=nextOrderColor(state,i);
      if(color>=0){state.modelOrderColor[i]=color;state.modelDressed[i]=false;sound('model_enter',.65);}else state.modelOrderColor[i]=-1;
    }
  }
  function addEmptyRod() {
    if(state.bonusAdded){notify('本关已经增加过空柱');return;}
    state.rods.push({originalX:0,originalY:Math.min(...state.rods.map(r=>r.originalY))-170,colors:[],mystery:[],lockColor:0,lockCount:0,consumed:false,screenX:0,screenY:0});
    state.bonusAdded=true;updateLayout();sound('check_mark');notify('已免费增加一个空柱');
  }
  function clickAt(x,y) {
    if(!state||!['game','paused','won'].includes(scene)||y<0||y>640)return;
    unlockAudio();
    if(state.paused) {
      if(x>=67&&x<=WIDTH-67&&y>HEIGHT/2-5&&y<HEIGHT/2+43){state.paused=false;showScreen('game');sound('check_mark');syncMusic();}
      else if(y>=HEIGHT/2+52&&y<=HEIGHT/2+81){toggleMusic();}
      else if(y>=HEIGHT/2+87&&y<=HEIGHT/2+112){state.paused=false;newLevel(state.level);showScreen('game');syncMusic();notify('已重新开始本关');}
      return;
    }
    if(state.won) {
      if(y>HEIGHT/2+12&&y<HEIGHT/2+92){newLevel(state.level>=800?1:state.level+1,true);showScreen('game');syncMusic();}
      return;
    }
    if(state.moveActive||state.effectActive||state.winAt>0)return;
    if(x>=WIDTH/2-40&&x<=WIDTH/2+40&&y>=594&&y<=631){openLegal('privacy');return;}
    if(y>=582&&y<=616&&x>=WIDTH-35&&x<=WIDTH-2){state.paused=true;showScreen('paused');syncMusic();return;}
    if(y>585){
      if(x<WIDTH*.43){newLevel(state.level);notify('已重新开始本关');}
      else if(x>WIDTH*.57&&x<WIDTH*.91)addEmptyRod();
      return;
    }
    const hit=hitRod(x,y);if(hit<0)return;
    const rod=state.rods[hit];
    if(rod.lockCount>0){notify('先完成对应颜色订单即可解锁');return;}
    if(state.selected<0){if(rod.colors.length)state.selected=hit;}
    else if(state.selected===hit)state.selected=-1;
    else if(beginMove(state.selected,hit))state.selected=-1;
    else if(rod.colors.length)state.selected=hit;
    boardCacheDirty=true;
  }
  canvas.addEventListener('pointerup',event=>{
    if(event.pointerType==='mouse'&&event.button!==0)return;
    const r=canvas.getBoundingClientRect();clickAt((event.clientX-r.left)*WIDTH/r.width,(event.clientY-r.top)*HEIGHT/r.height);
  });
  canvas.addEventListener('contextmenu',event=>event.preventDefault());
  document.addEventListener('visibilitychange',()=>{lastFrame=performance.now();syncMusic();});

  function resize() {
    const rect=canvas.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1);
    canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);
    boardCacheDirty=true;
  }
  addEventListener('resize',resize);resize();
  const art=(name,x,y,w,h)=>{const img=images.get(name);if(img)ctx.drawImage(img,x,y,w,h);};
  const txt=(text,x,y,size,color='white',align='center',bold=true)=>{ctx.fillStyle=color;ctx.font=`${bold?'700':'400'} ${size}px ${FONT}`;ctx.textAlign=align;ctx.textBaseline='alphabetic';ctx.fillText(text,x,y);};
  function roundPath(x,y,w,h,r) {
    r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
  }
  const box=(x,y,w,h,r,fill,stroke=null,line=1)=>{roundPath(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=line;ctx.stroke();}};
  const circle=(x,y,r,fill)=>{ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill();};
  const line=(x1,y1,x2,y2,color,width)=>{ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.stroke();};
  function gradient(y1,y2,top,bottom){const g=ctx.createLinearGradient(0,y1,0,y2);g.addColorStop(0,top);g.addColorStop(1,bottom);return g;}
  function drawAmbient() {
    for(let i=0;i<14;i++)circle((i*61+phase*4*(1+i%3))%(WIDTH+24)-12,245+(i*43%320)+Math.sin(phase+i)*5,1.2+i%2,`rgba(255,255,255,${(22+i%3*10)/255})`);
  }
  function drawModel(x,y,variant) {
    const base=images.get(`recovered_model_aligned_${variant+1}`),dress=images.get(`recovered_model_dress_${variant+1}`);
    const age=state.modelDressStart[variant]>0?gameTime-state.modelDressStart[variant]:TIMING.dress;
    const pulse=age<TIMING.dress?1+.035*Math.sin(age*.025):1,bob=Math.sin(phase+variant)*2;
    const ref=dress||base;if(!ref)return;
    const h=160*pulse,w=Math.min(68*pulse,h*ref.width/ref.height),left=x-w/2,top=y-h/2+bob;
    if(!state.modelDressed[variant]){ctx.drawImage(base,left,top,w,h);return;}
    const progress=clamp(age/TIMING.dress,0,1);
    if(progress>=1){ctx.drawImage(dress,left,top,w,h);return;}
    const boundary=top+h-h*progress;
    ctx.save();ctx.beginPath();ctx.rect(left,top,w,boundary-top);ctx.clip();ctx.drawImage(base,left,top,w,h);ctx.restore();
    ctx.save();ctx.beginPath();ctx.rect(left,boundary,w,top+h-boundary);ctx.clip();ctx.drawImage(dress,left,top,w,h);ctx.restore();
    const lineY=y+78-progress*156,c=YARN_COLORS[Math.max(0,state.modelOrderColor[variant])];
    ctx.beginPath();ctx.moveTo(x-29,lineY);ctx.bezierCurveTo(x-11,lineY-5,x+11,lineY+5,x+29,lineY);ctx.strokeStyle=rgb(c,.82);ctx.lineWidth=2.5;ctx.stroke();
    for(let i=0;i<7;i++){const a=i*Math.PI*2/7+phase,r=13+5*(i%2);circle(x+Math.cos(a)*r,lineY+Math.sin(a)*r*.35,1.4,'rgba(255,255,255,.59)');}
  }
  function drawTop() {
    txt('毛线小织匠',12,26,19,'white','left');txt(`第 ${state.level} / 800 关`,WIDTH-12,25,13,'white','right');
    box(WIDTH/2-35,5,70,29,14,'#ffdb41');txt('适龄提示 8+',WIDTH/2,24,10.5,'#445769');
    const fills=['#ffe2e8','#fff8d6','#e2fbdf'],rims=['#ee4c5b','#edcb23','#59c945'];
    for(let i=0;i<3;i++){
      const x=modelX(i);box(x-34,47,68,172,19,'rgba(0,60,115,.176)');box(x-34,44,68,172,19,fills[i],rims[i],3);drawModel(x,130,i);
      const order=state.modelOrderColor[i];
      if(order>=0){circle(x,205,7.2,'rgba(255,255,255,.63)');circle(x,205,5.5,rgb(YARN_COLORS[order]));}
      else if(state.modelDressed[i])txt('✓',x,210,14,'#49be59');
    }
    if(!(state.level===1&&!state.guideFinished&&state.moves===0)){
      const label=state.level===1?'新手订单':state.level<=25?'轻松订单':state.level<=200?'进阶订单':state.level<=500?'专家订单':'大师订单';
      txt(`${label}  ·  完成同色毛线，为模特织出新衣`,WIDTH/2,234,10.5,'rgba(255,255,255,.90)');
    }
  }
  function drawLayer(x,y,s,row,color,front,lifted=false) {
    row=clamp(row,0,11);color=clamp(color,0,10);
    const variant=row%2===0?2:1,lift=lifted?-30*s+Math.sin(phase*2)*3*s:0,seam=y-SEAMS[row]*s+lift;
    art(`recovered_yarn_${color}_${front?'front':'back'}_${variant}`,x-82*s,front?seam:seam-54*s,164*s,front?57*s:54*s);
  }
  function drawLock(x,y,s,rod) {
    y-=190*s;
    ctx.beginPath();ctx.ellipse(x,y-5*s,18*s,20*s,0,190*Math.PI/180,350*Math.PI/180);ctx.strokeStyle='rgba(255,255,255,.88)';ctx.lineWidth=Math.max(1.5,7*s);ctx.stroke();
    box(x-25*s,y,50*s,39*s,7*s,'rgba(42,74,111,.90)');
    circle(x-10*s,y+19*s,6*s,rod.lockColor>0?rgb(YARN_COLORS[rod.lockColor]):'white');
    txt(`×${rod.lockCount}`,x+7*s,y+24*s,Math.max(6,27*s));
  }
  function drawCore(rod,x,y,width,selected=false) {
    const s=width/192;
    if(selected){circle(x,y-34*s,Math.max(22,64*s),'rgba(255,255,255,.14)');circle(x,y-34*s,Math.max(18,56*s),'rgba(255,255,255,.33)');}
    art('recovered_shadow',x-141*s,y-78.5*s,282*s,157*s);art('recovered_base',x-96*s,y-62*s,192*s,124*s);
    const group=selected?topGroupCount(rod):0;
    for(let row=0;row<rod.colors.length;row++)for(let part=0;part<3;part++)drawLayer(x,y,s,row*3+part,rod.mystery[row]?10:rod.colors[row],false,selected&&row>=rod.colors.length-group);
    art('recovered_post',x-26*s,y-329*s,52*s,336*s);
    for(let row=0;row<rod.colors.length;row++)for(let part=0;part<3;part++)drawLayer(x,y,s,row*3+part,rod.mystery[row]?10:rod.colors[row],true,selected&&row>=rod.colors.length-group);
    for(let row=0;row<rod.colors.length;row++)if(rod.mystery[row])txt('?',x,y-SEAMS[Math.min(11,row*3+1)]*s+12*s,Math.max(7,31*s));
    if(rod.lockCount>0)drawLock(x,y,s,rod);
  }
  function glowImage(color) {
    if(tintedGlows.has(color))return tintedGlows.get(color);
    const original=images.get('completion_glow');if(!original)return null;
    const off=document.createElement('canvas');off.width=original.width;off.height=original.height;const c=off.getContext('2d');
    c.drawImage(original,0,0);c.globalCompositeOperation='source-in';c.fillStyle=rgb(YARN_COLORS[color]);c.fillRect(0,0,off.width,off.height);tintedGlows.set(color,off);return off;
  }
  function drawCompletionGlow(x,y,width,elapsed,color) {
    const s=width/192,top=y-190*s,pulse=.8+.22*Math.sin(elapsed*.022),r=31*pulse,g=glowImage(color);
    if(g){ctx.save();ctx.globalAlpha=180*pulse/255;ctx.drawImage(g,x-r,top-r,r*2,r*2);ctx.restore();}
    for(let i=0;i<14;i++){const a=i*.9+elapsed*.006,d=18+i%4*6+Math.sin(a)*5;circle(x+Math.cos(a)*d,top+Math.sin(a)*d*.55,1.2+i%2,rgb(YARN_COLORS[color],(90+i%3*35)/255));}
    if(elapsed>880){circle(x,top+2,11,'rgba(0,40,80,.31)');circle(x,top,10,'#3ccd60');line(x-5,top,x-1,top+4,'white',2.4);line(x-1,top+4,x+6,top-4,'white',2.4);}
  }
  function drawRod(rod,index) {
    if(!state.effectActive||state.effectRod!==index){drawCore(rod,rod.screenX,rod.screenY,layoutBaseWidth,state.selected===index);return;}
    const elapsed=gameTime-state.effectStart;
    if(elapsed<TIMING.full){
      const q=Math.min(1,elapsed/1000),jump=-Math.sin(q*Math.PI)*15,angle=Math.sin(elapsed*.035)*2.2*(1-q*.55)*Math.PI/180;
      ctx.save();ctx.translate(rod.screenX,rod.screenY+jump);ctx.rotate(angle);drawCore(rod,0,0,layoutBaseWidth);ctx.restore();drawCompletionGlow(rod.screenX,rod.screenY+jump,layoutBaseWidth,elapsed,state.effectColor);
    }else{
      const u=clamp((elapsed-TIMING.full)/TIMING.fly,0,1),tx=modelX(state.effectTarget),ty=160,cx=(rod.screenX+tx)/2,cy=Math.min(rod.screenY,ty)-105;
      const x=(1-u)**2*rod.screenX+2*(1-u)*u*cx+u*u*tx,y=(1-u)**2*rod.screenY+2*(1-u)*u*cy+u*u*ty;
      ctx.beginPath();ctx.moveTo(rod.screenX,rod.screenY);ctx.quadraticCurveTo(cx,cy,x,y);ctx.strokeStyle=rgb(YARN_COLORS[state.effectColor],150*(1-u)/255);ctx.lineWidth=2;ctx.stroke();
      drawCore(rod,x,y,layoutBaseWidth*(1-.3*u));
    }
  }
  function cubic(sx,sy,c1x,c1y,c2x,c2y,tx,ty,u) {
    const v=1-u;return {x:v*v*v*sx+3*v*v*u*c1x+3*v*u*u*c2x+u*u*u*tx,y:v*v*v*sy+3*v*v*u*c1y+3*v*u*u*c2y+u*u*u*ty};
  }
  function drawBraidedPath(sx,sy,c1x,c1y,c2x,c2y,tx,ty,u,color,s) {
    const ax=lerp(sx,c1x,u),ay=lerp(sy,c1y,u),bx=lerp(c1x,c2x,u),by=lerp(c1y,c2y,u),cx=lerp(c2x,tx,u),cy=lerp(c2y,ty,u);
    const dx=lerp(ax,bx,u),dy=lerp(ay,by,u),ex=lerp(bx,cx,u),ey=lerp(by,cy,u),px=lerp(dx,ex,u),py=lerp(dy,ey,u);
    const c=YARN_COLORS[color];
    for(const [paint,width] of [[rgb(c.map(v=>Math.max(0,v-70)),155/255),Math.max(2.6,8.2*s)],[rgb(c,245/255),Math.max(1.9,5.7*s)],['rgba(255,255,255,.49)',Math.max(.7,1.4*s)]]){
      ctx.beginPath();ctx.moveTo(sx,sy);ctx.bezierCurveTo(ax,ay,dx,dy,px,py);ctx.strokeStyle=paint;ctx.lineWidth=width;ctx.lineCap='round';ctx.stroke();
    }
    let previous={x:sx,y:sy},distance=0,next=10;
    for(let step=1;step<=40;step++){
      const p=cubic(sx,sy,c1x,c1y,c2x,c2y,tx,ty,u*step/40),dx=p.x-previous.x,dy=p.y-previous.y,segment=Math.hypot(dx,dy);distance+=segment;
      if(distance>=next&&segment>0){const nx=-dy/segment*2.1,ny=dx/segment*2.1;line(p.x-nx,p.y-ny,p.x+nx,p.y+ny,'rgba(255,255,255,.41)',Math.max(.6,1.2*s));next+=10;}
      previous=p;
    }
  }
  function drawMoveFlight() {
    if(!state.moveActive)return;
    const source=state.rods[state.movingFrom],target=state.rods[state.movingTo],s=layoutBaseWidth/192,elapsed=gameTime-state.movingStart;
    for(let layer=state.movingLanded;layer<state.movingAmount;layer++){
      const local=clamp((elapsed-layer*TIMING.layer)/TIMING.layer,0,1),u=local*local*(3-2*local);
      const sourceRing=Math.min(11,(source.colors.length+layer)*3),targetRing=Math.min(11,(state.movingTargetSize+layer)*3);
      const sx=source.screenX,sy=source.screenY-(SEAMS[sourceRing]-SEAMS[0])*s,tx=target.screenX,ty=target.screenY-(SEAMS[targetRing]-SEAMS[0])*s;
      const arc=clamp(Math.abs(tx-sx)*.28+25,45,105),cy=Math.min(sy,ty)-arc,p=cubic(sx,sy,sx,cy,tx,cy,tx,ty,u);
      if(local>0)drawBraidedPath(sx,sy,sx,cy,tx,cy,tx,ty,u,state.movingColor,s);
      const centerY=p.y-SEAMS[2]*s*.5,bounce=1+.10*Math.sin(local*Math.PI);
      ctx.save();ctx.translate(p.x,centerY);ctx.rotate(Math.sin(local*Math.PI*2)*6*Math.PI/180);ctx.scale(bounce,2-bounce);ctx.translate(-p.x,-centerY);
      for(let part=0;part<3;part++)drawLayer(p.x,p.y,s,part,state.movingColor,false);
      for(let part=0;part<3;part++)drawLayer(p.x,p.y,s,part,state.movingColor,true);ctx.restore();
    }
  }
  function drawHand(x,y) {
    const bob=Math.sin(phase*2)*3;circle(x+6,y+10+bob,17,'rgba(0,90,140,.2)');circle(x+4,y+7+bob,15,'white');line(x,y+5+bob,x+7,y-32+bob,'white',8);line(x+1,y-4+bob,x-7,y-14+bob,'white',7);circle(x+7,y-32+bob,4,'white');
  }
  function drawBoard() {
    if(boardCacheDirty||boardCache.width!==canvas.width||boardCache.height!==canvas.height) {
      boardCache.width=canvas.width;boardCache.height=canvas.height;
      const cached=boardCache.getContext('2d');ctx=cached;
      ctx.setTransform(canvas.width/WIDTH,0,0,canvas.height/HEIGHT,0,0);
      box(5,246,WIDTH-10,340,22,gradient(246,586,'rgba(255,255,255,.071)','rgba(255,255,255,.012)'));
      for(let i=0;i<state.rods.length;i++)if(!state.rods[i].consumed&&i!==state.selected&&(!state.effectActive||i!==state.effectRod))drawRod(state.rods[i],i);
      ctx=mainContext;boardCacheDirty=false;
    }
    ctx.drawImage(boardCache,0,0,WIDTH,HEIGHT);
    if(state.selected>=0&&!state.rods[state.selected].consumed)drawRod(state.rods[state.selected],state.selected);
    if(state.effectActive)drawRod(state.rods[state.effectRod],state.effectRod);
    drawMoveFlight();
    if(state.level===1&&!state.guideFinished&&state.moves===0&&!state.effectActive&&!state.moveActive){
      art('tutorial_guide',WIDTH*95.778/750,HEIGHT*517.493/1334,WIDTH*(304.798-95.778)/750,HEIGHT*(866.508-517.493)/1334);
      art('ui_speech',WIDTH*280.788/750,HEIGHT*468/1334,WIDTH*(669.788-280.788)/750,HEIGHT*(586-468)/1334);
      txt('点击右侧红色毛线，再放到同色柱！',WIDTH*475/750,HEIGHT*540/1334,10.6,'#12609b');
      let target=state.rods.find(r=>r.colors.length===1&&r.colors.at(-1)===3);if(!target)target=state.rods.filter(r=>r.colors.at(-1)===3).at(-1);
      if(target)drawHand(target.screenX-8,target.screenY-35*layoutScale);
    }
  }
  function drawBottom() {
    art('ui_clear',WIDTH*75/360-42,596,84,39);art('ui_add',WIDTH*284/360-42,596,84,39);art('ui_pause',WIDTH-34,584,30,30);
    box(WIDTH/2-40,594,80,37,15,'rgba(255,255,255,.80)','#318fcd',1.4);txt('隐私政策',WIDTH/2,617,10.5,'#227eb9');
    if(state.bonusAdded)box(WIDTH*284/360-42,596,84,39,9,'rgba(40,144,215,.37)');
  }
  function drawPause() {
    ctx.fillStyle='rgba(4,33,68,.57)';ctx.fillRect(0,0,WIDTH,HEIGHT);
    box(34,HEIGHT/2-98,WIDTH-68,219,22,'#f7fcff');txt('游戏已暂停',WIDTH/2,HEIGHT/2-50,22,'#1e82bb');
    box(67,HEIGHT/2-5,WIDTH-134,48,16,'#1fb2ee');txt('继续游戏',WIDTH/2,HEIGHT/2+26,15);
    txt(`音乐与音效：${musicOn?'开启':'关闭'}　点击切换`,WIDTH/2,HEIGHT/2+71,12,'#427e9f');
    txt('重新开始本关',WIDTH/2,HEIGHT/2+105,12,'#5e7f97');
  }
  function drawWin() {
    ctx.fillStyle='rgba(0,35,85,.49)';ctx.fillRect(0,0,WIDTH,HEIGHT);
    box(28,HEIGHT/2-117,WIDTH-56,244,24,'rgba(0,35,85,.27)');box(28,HEIGHT/2-122,WIDTH-56,244,24,'#f7fcff');
    txt('✦ ✦ ✦',WIDTH/2,HEIGHT/2-72,23,'#ffd82d');txt('恭喜完成',WIDTH/2,HEIGHT/2-38,25,'#1c85bf');txt(`第 ${state.level} 关 · 使用 ${state.moves} 步`,WIDTH/2,HEIGHT/2-5,13,'#607d95');
    box(61,HEIGHT/2+23,WIDTH-122,54,18,'#1fb2ee');txt(state.level>=800?'重新挑战第一关':'下一关',WIDTH/2,HEIGHT/2+58,16);
  }
  function drawToast() {
    if(gameTime>toastUntil||!toast)return;
    const w=Math.min(WIDTH-42,Math.max(136,toast.length*13+30));box(WIDTH/2-w/2,548,w,34,16,'rgba(11,74,121,.88)');txt(toast,WIDTH/2,570,11);
  }
  function draw() {
    ctx.setTransform(canvas.width/WIDTH,0,0,canvas.height/HEIGHT,0,0);
    ctx.fillStyle=gradient(0,640,'#2b9deb','#6fc5f7');ctx.fillRect(0,0,WIDTH,HEIGHT);
    if(!state)return;
    drawAmbient();drawTop();drawBoard();drawBottom();if(state.paused)drawPause();if(state.won)drawWin();drawToast();
  }
  function frame(now) {
    const delta=Math.max(0,Math.min(100,now-lastFrame));lastFrame=now;
    const active=state&&!state.paused&&!document.hidden&&['game','won'].includes(scene);
    if(active){gameTime+=delta;if(!reducedMotion)phase+=delta*.0027;updateMove();updateEffect();refreshModels();
      if(state.winAt>0&&!state.won&&gameTime>=state.winAt){state.won=true;state.winAt=0;showScreen('won');sound('level_complete',.85);status(`第${state.level}关完成。点击下一关继续。`);}}
    draw();frameId=requestAnimationFrame(frame);
  }
  const freezeTree=value=>{
    if(value&&typeof value==='object') {Object.values(value).forEach(freezeTree);Object.freeze(value);}
    return value;
  };
  const snapshot=()=>{
    const s=state;
    return freezeTree({ready,scene,level:s?.level||clamp(Number(read('level','1'))||1,1,800),moves:s?.moves||0,won:s?.won||false,paused:s?.paused||false,guideFinished:s?.guideFinished||false,bonusAdded:s?.bonusAdded||false,totalGroups:s?.totalGroups||0,completedGroups:s?.completedGroups||0,remainingOrders:s?.remainingOrders.slice()||[],orders:s?.modelOrderColor.slice()||[],modelOrderColor:s?.modelOrderColor.slice()||[],modelDressed:s?.modelDressed.slice()||[],modelDressStart:s?.modelDressStart.slice()||[],modelHoldUntil:s?.modelHoldUntil.slice()||[],moveActive:s?.moveActive||false,effectActive:s?.effectActive||false,winAt:s?.winAt||0,selected:s?.selected??-1,musicOn,consentAccepted,levelCount:levels.length,width:WIDTH,height:HEIGHT,layoutBaseWidth,layoutScale,gameTime,rods:s?.rods.map(r=>({...r,colors:r.colors.slice(),mystery:r.mystery.slice(),bounds:rodBounds(r)}))||[],buttons:[{label:'暂停',x:WIDTH-19,y:599},{label:'重新开始',x:75,y:615},{label:'增加空柱',x:284,y:615},{label:'隐私政策',x:180,y:613},{label:'继续游戏',x:180,y:340},{label:'下一关',x:180,y:370},{label:'音乐',x:180,y:386}],audio:{bgmPaused:bgm.paused,bgmCurrentTime:bgm.currentTime,bgmMuted:bgm.muted,audioEnabled,audioContextState:audioContext?.state||'uninitialized',soundBuffers:soundBuffers.size}});
  };
  Object.defineProperty(window,'WoolH5',{value:Object.freeze({snapshot}),writable:false,configurable:false});
  frameId=requestAnimationFrame(frame);loadResources();
}
