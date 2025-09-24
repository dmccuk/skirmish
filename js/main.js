(() => {
  // -------- Viewport & World sizes --------
  const VIEW_W=960, VIEW_H=600; // canvas size
  const MAP_W=2400, MAP_H=1600; // large map
  const ctx=document.getElementById('c').getContext('2d');
  ctx.canvas.width = VIEW_W; ctx.canvas.height = VIEW_H;

  // Camera
  const cam = { x: 0, y: 0 };

  // Minimap
  const mini = document.getElementById('minimap');
  const mctx = mini.getContext('2d');
  const MINI_W = mini.width, MINI_H = mini.height;
  const mScaleX = MINI_W / MAP_W, mScaleY = MINI_H / MAP_H;

  // UI elems
  const overlay=document.getElementById('overlay');
  const resultEl=document.getElementById('result');
  const statsEl=document.getElementById('stats');
  const btnSelectAll=document.getElementById('selectAll');
  const btnRestart=document.getElementById('restart');
  const btnBuildRifleman=document.getElementById('buildRifleman');
  const btnBuildGrenadier=document.getElementById('buildGrenadier');
  const terrainBtn=document.getElementById('terrainBtn');
  const terrainFile=document.getElementById('terrainFile');
  const muteBtn=document.getElementById('muteBtn');
  const volumeSlider=document.getElementById('volumeSlider');
  const helpBtn=document.getElementById('helpBtn');
  const helpModal=document.getElementById('helpModal');
  const helpClose=document.getElementById('closeHelp');

  // Selection HUD
  const selCountEl = document.getElementById('selCount');
  const selGridEl  = document.getElementById('selGrid');
  const orderFlash = document.getElementById('orderFlash');
  let orderFlashTimer=null;

  // --- Audio ---
  const bgm = new Audio('assets/skirmish1.mp3'); bgm.loop = true; bgm.volume = parseFloat(volumeSlider.value);
  const deathSoundBase = new Audio('assets/death.mp3'); deathSoundBase.volume = 0.6;
  bgm.play().catch(() => {
    const start = () => { bgm.play().catch(()=>{}); document.removeEventListener('pointerdown', start); };
    document.addEventListener('pointerdown', start, { once: true });
  });
  muteBtn.onclick = () => { bgm.muted = !bgm.muted; muteBtn.textContent = bgm.muted ? "🔇" : "🔊"; };
  volumeSlider.oninput = (e) => { bgm.volume = parseFloat(e.target.value); };

  // --- Custom cursors (SVG data URIs) ---
  const greenTarget = makeCursor('#27e36a');
  const redTarget   = makeCursor('#ff4d5a');
  const defaultCursor = 'crosshair';
  function makeCursor(color){
    const svg = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <circle cx="16" cy="16" r="10" fill="none" stroke="${color}" stroke-width="2"/>
      <line x1="16" y1="1" x2="16" y2="7" stroke="${color}" stroke-width="2"/>
      <line x1="16" y1="25" x2="16" y2="31" stroke="${color}" stroke-width="2"/>
      <line x1="1" y1="16" x2="7" y2="16" stroke="${color}" stroke-width="2"/>
      <line x1="25" y1="16" x2="31" y2="16" stroke="${color}" stroke-width="2"/>
      <circle cx="16" cy="16" r="2" fill="${color}"/>
    </svg>`);
    return `url("data:image/svg+xml,${svg}") 16 16, crosshair`;
  }

  // -------- World / Tilemap --------
  const F={PLAYER:1,ENEMY:2};
  const BUILDING_TYPES = {BARRACKS:'barracks', HQ:'hq', DEPOT:'depot'};
  const VISION_RADIUS=100; // Fog reveal radius
  const SEP_RADIUS = 18, SEP_FORCE = 65;

  // Tile constants
  const TILE = { PLAIN:0, FOREST:1, WATER:2, ROCK:3 };
  const TILE_SIZE = 50;
  const GRID_W = MAP_W / TILE_SIZE;
  const GRID_H = MAP_H / TILE_SIZE;

  // --- DENSITY TUNING (reduce clutter) ---
  const DENSITY = {
    forestBlobs: 7,      // fewer forests (was 18)
    rockBlobs:   4,      // fewer rock fields (was 12)
    riverThickness: 2,   // thinner river (was 3)
    riverWaveAmp:  3,    // gentler wiggle (was 5)
    treesPerCell:  0.28, // global tree base density (was 0.8)
    forestTreeMult:1.2,  // multiplier inside forest (was 2.0)
    grassTreeMult: 0.15  // multiplier on grass (was 0.4)
  };

  let world;

  // Offscreen fog canvas
  const fogCanvas = document.createElement('canvas');
  fogCanvas.width = MAP_W; fogCanvas.height = MAP_H;
  const fogCtx = fogCanvas.getContext('2d');

  // --- Camera panning state ---
  const PAN_SPEED = 520;
  const PAN_SPEED_FAST = 980;
  const EDGE_BAND = 60;
  let keys = new Set();
  let isPanningDrag = false;
  let dragStartScreen = null;
  let dragStartCam = null;

  function panBy(dx, dy) {
    cam.x = Math.max(0, Math.min(cam.x + dx, MAP_W - VIEW_W));
    cam.y = Math.max(0, Math.min(cam.y + dy, MAP_H - VIEW_H));
  }
  function centerCamera(cx,cy){
    cam.x = Math.max(0, Math.min(cx - VIEW_W/2, MAP_W - VIEW_W));
    cam.y = Math.max(0, Math.min(cy - VIEW_H/2, MAP_H - VIEW_H));
  }
  function worldToScreen(x,y){ return { x: x - cam.x, y: y - cam.y }; }
  function screenToWorld(x,y){ return { x: x + cam.x, y: y + cam.y }; }
  function edgeEase(dist){
    const t = Math.max(0, Math.min(1, dist / EDGE_BAND));
    return t * t;
  }

  // Minimap interaction
  mini.addEventListener('pointerdown', (e)=>{
    const r=mini.getBoundingClientRect();
    const mx = (e.clientX - r.left), my = (e.clientY - r.top);
    const wx = Math.max(0, Math.min(mx / mScaleX, MAP_W));
    const wy = Math.max(0, Math.min(my / mScaleY, MAP_H));
    centerCamera(wx, wy);
  });

  // Help modal
  const firstRunKey = 'skirmish_help_seen_v2';
  function showHelp(){ helpModal.style.display='flex'; }
  function hideHelp(){ helpModal.style.display='none'; localStorage.setItem(firstRunKey,'1'); }
  if(!localStorage.getItem(firstRunKey)) showHelp();
  helpBtn.onclick = showHelp;
  helpClose.onclick = hideHelp;
  helpModal.addEventListener('click', (e)=>{ if(e.target===helpModal) hideHelp(); });

  // --- Pattern loaders with fallbacks ---
  function makeFallbackPattern(colorA, colorB){
    const tile = document.createElement('canvas'); tile.width=256; tile.height=256;
    const tctx = tile.getContext('2d');
    tctx.fillStyle = colorA; tctx.fillRect(0,0,256,256);
    tctx.fillStyle = colorB;
    for (let y=0; y<256; y+=16){
      for (let x=(y%32===0?0:8); x<256; x+=16) tctx.fillRect(x, y, 8, 8);
    }
    return tile;
  }

  const patterns = { 0:null, 1:null, 2:null, 3:null };

  function loadPattern(path, fallbackA, fallbackB, done){
    const img = new Image();
    img.onload = ()=> done(ctx.createPattern(img,'repeat'));
    img.onerror = ()=>{
      const can = makeFallbackPattern(fallbackA, fallbackB);
      done(ctx.createPattern(can,'repeat'));
    };
    img.src = path;
  }

  function loadAllPatterns(then){
    let left=4;
    const set = (type,pat)=>{ patterns[type]=pat; if(--left===0) then(); };
    loadPattern('assets/grass_tile.jpg',  '#3b5d2f','#466d38', p=>set(0,p));
    loadPattern('assets/forest_canopy_tile.jpg', '#2c4a2e','#355c35', p=>set(1,p));
    loadPattern('assets/water_tile.jpg',  '#1d4d7a','#2b6aa5', p=>set(2,p));
    loadPattern('assets/rock_tile.jpg',   '#555555','#6e6e6e', p=>set(3,p));
  }

  // --- Tilemap helpers ---
  let tilemap; // Uint8Array length GRID_W*GRID_H
  function idx(cx,cy){ return cy*GRID_W + cx; }
  function inBounds(cx,cy){ return cx>=0 && cy>=0 && cx<GRID_W && cy<GRID_H; }
  function terrainAt(x,y){
    const cx = Math.floor(x / TILE_SIZE), cy = Math.floor(y / TILE_SIZE);
    if(!inBounds(cx,cy)) return 3;
    return tilemap[idx(cx,cy)];
  }

  // River thinner & with smaller wave
  function carveRiverAndBridges(){
    const midY = Math.floor(GRID_H*0.5);
    const thickness = DENSITY.riverThickness;
    const waveAmp   = DENSITY.riverWaveAmp;

    for(let cx=0; cx<GRID_W; cx++){
      const offset = Math.round(Math.sin(cx/6)*waveAmp);
      const cyCenter = midY + offset;
      for(let dy=-thickness; dy<=thickness; dy++){
        const cy = cyCenter + dy;
        if(inBounds(cx,cy)) tilemap[idx(cx,cy)] = 2; // WATER
      }
    }
    const bridges = [10, 24, 38, 46];
    for(const bx of bridges){
      for(let by=0; by<GRID_H; by++){
        if(inBounds(bx,by))   tilemap[idx(bx,by)]   = 0;
        if(inBounds(bx+1,by)) tilemap[idx(bx+1,by)] = 0;
      }
    }
  }

  // Carve open lanes for movement (one horizontal, one vertical)
  function carveLanes(){
    // Horizontal lane
    const y1 = Math.floor(GRID_H*0.62);
    for(let cx=0; cx<GRID_W; cx++){
      for(let k=-2;k<=2;k++){
        const cy = y1 + k;
        if(inBounds(cx,cy) && tilemap[idx(cx,cy)]!==2) tilemap[idx(cx,cy)] = 0;
      }
    }
    // Vertical lane
    const x1 = Math.floor(GRID_W*0.45);
    for(let cy=0; cy<GRID_H; cy++){
      for(let k=-2;k<=2;k++){
        const cx = x1 + k;
        if(inBounds(cx,cy) && tilemap[idx(cx,cy)]!==2) tilemap[idx(cx,cy)] = 0;
      }
    }
  }

  function addBlobs(type, count, radiusCellsMin, radiusCellsMax){
    for(let i=0;i<count;i++){
      const cx0 = Math.floor(Math.random()*GRID_W);
      const cy0 = Math.floor(Math.random()*GRID_H);
      const r = Math.floor(radiusCellsMin + Math.random()*(radiusCellsMax-radiusCellsMin));
      for(let cy=cy0-r; cy<=cy0+r; cy++){
        for(let cx=cx0-r; cx<=cx0+r; cx++){
          if(!inBounds(cx,cy)) continue;
          const dx=cx-cx0, dy=cy-cy0;
          if(dx*dx+dy*dy <= r*r){
            if(tilemap[idx(cx,cy)]!==2) tilemap[idx(cx,cy)] = type;
          }
        }
      }
    }
  }

  // Decorative trees — much lighter
  function populateTrees(){
    world.trees.length = 0;
    const base = DENSITY.treesPerCell;
    for(let cy=0; cy<GRID_H; cy++){
      for(let cx=0; cx<GRID_W; cx++){
        const t = tilemap[idx(cx,cy)];
        let k = 0;
        if(t===1) k = DENSITY.forestTreeMult;   // denser in forest
        else if(t===0) k = DENSITY.grassTreeMult;

        const count = Math.floor(base * k);
        for(let i=0;i<count;i++){
          const x = cx*TILE_SIZE + Math.random()*TILE_SIZE;
          const y = cy*TILE_SIZE + Math.random()*TILE_SIZE;
          const r = (t===1? 8+Math.random()*9 : 5+Math.random()*5);
          world.trees.push({x,y,r});
        }
      }
    }
  }

  // --- World reset ---
  function reset(){
    // init fog (black)
    fogCtx.globalCompositeOperation = 'source-over';
    fogCtx.fillStyle = 'rgba(0,0,0,1)';
    fogCtx.fillRect(0,0,MAP_W,MAP_H);

    world={
      tAccum:0, time:0, score:0,
      units:[], bullets:[], trees:[], buildings:[],
      selection:new Set(), selBox:null,
      ended:false, stats:{lost:0,kills:0,timeStart:performance.now()},
      resources:{credits:500},
      enemyAI:{credits:300,incomeTimer:0,buildCooldown:2,unassigned:[],squads:[],groupTimer:5,
               focus:null,searchRoute:[],searchCursor:0,base:null,baseAlertTime:0},
      clickFx:[]
    };

    // Build tilemap with lower density
    tilemap = new Uint8Array(GRID_W*GRID_H).fill(0); // PLAIN
    carveRiverAndBridges();
    addBlobs(1, DENSITY.forestBlobs, 3, 5); // FOREST fewer
    addBlobs(3, DENSITY.rockBlobs,   2, 3); // ROCK fewer
    carveLanes();                            // open corridors
    populateTrees();

    // Player barracks
    world.buildings.push({
      type:BUILDING_TYPES.BARRACKS, f:F.PLAYER, x:120, y:MAP_H-130, w:70, h:46,
      hp:260, max:260, queue:[], current:null, timeLeft:0
    });

    // Enemy base layout
    const enemyHQ = {
      type:BUILDING_TYPES.HQ, f:F.ENEMY, x:1936, y:220, w:128, h:88,
      hp:420, max:420, queue:[], current:null, timeLeft:0
    };
    const enemyDepot = {
      type:BUILDING_TYPES.DEPOT, f:F.ENEMY, x:2138, y:334, w:96, h:70,
      hp:320, max:320, queue:[], current:null, timeLeft:0
    };
    const enemyBarracks = {
      type:BUILDING_TYPES.BARRACKS, f:F.ENEMY, x:2068, y:296, w:74, h:46,
      hp:260, max:260, queue:[], current:null, timeLeft:0
    };

    world.buildings.push(enemyHQ, enemyDepot, enemyBarracks);

    world.enemyAI.base = {
      center:{x:enemyHQ.x+enemyHQ.w/2, y:enemyHQ.y+enemyHQ.h/2},
      rally:{x:enemyHQ.x+enemyHQ.w/2+60, y:enemyHQ.y+enemyHQ.h+90},
      patrolPoints:[], alertRadius:360
    };
    world.enemyAI.base.patrolPoints = makePatrolRing(world.enemyAI.base.center, 150, 6);

    const playerBarracks = getBarracks(F.PLAYER);
    if(playerBarracks){
      const playerCenter = {x:playerBarracks.x+playerBarracks.w/2, y:playerBarracks.y+playerBarracks.h/2};
      world.enemyAI.searchRoute = buildEnemySearchRoute(world.enemyAI.base.center, playerCenter);
      world.enemyAI.searchCursor = Math.floor(Math.random()*world.enemyAI.searchRoute.length);
    }

    // Player squad
    for(let i=0;i<6;i++){ const u=spawn(220+(i%3)*22,MAP_H-120+Math.floor(i/3)*26,F.PLAYER,'rifleman'); u.selected=true; world.selection.add(u); }
    for(let i=0;i<2;i++){ const u=spawn(300+(i*22),MAP_H-120,F.PLAYER,'grenadier'); u.selected=true; world.selection.add(u); }
    updateSelectionHUD();

    // Enemies
    const enemyAI = world.enemyAI;
    const baseSpawn = world.enemyAI.base.center;
    for(let i=0;i<6;i++){
      enemyAI.unassigned.push(spawn(
        baseSpawn.x-100+(i%3)*36,
        baseSpawn.y+90+Math.floor(i/3)*28,
        F.ENEMY,'rifleman'));
    }
    for(let i=0;i<3;i++){
      enemyAI.unassigned.push(spawn(
        baseSpawn.x+80+(i*28),
        baseSpawn.y+36,
        F.ENEMY,'grenadier'));
    }
    for(let i=0;i<4;i++){
      enemyAI.unassigned.push(spawn(
        baseSpawn.x-140+(i*36),
        baseSpawn.y-60,
        F.ENEMY,'rifleman'));
    }

    // Start camera near base
    centerCamera(260, MAP_H-120);

    // Initial reveal
    for(const u of world.units){ if(u.f===F.PLAYER) revealAround(u.x,u.y); }
  }

  function spawn(x,y,f,unitType='rifleman'){
    const base = {
      rifleman:  {hp:48,max:48,range:115,dmg:9,  s:1.7},
      grenadier: {hp:60,max:60,range:220,dmg:25, s:1.4}
    }[unitType];
    const u={
      id:Math.random().toString(36).slice(2),
      type:'unit', f, x, y, r:8,
      hp:base.hp, max:base.max, range:base.range, dmg:base.dmg, s:base.s,
      cd:0, unitType,
      target:null, vx:0, vy:0, facing:0, walk:0,
      selected:false, wander:Math.random()*6.28
    };
    world.units.push(u); return u;
  }

  // --- Input (pointer) + cursor logic ---
  let pointer={x:cam.x+VIEW_W/2,y:cam.y+VIEW_H/2,down:false,dragStart:null,dragging:false, overEnemy:false,inside:false};
  const DRAG_THRESH=8;
  const canvas=ctx.canvas;

  canvas.addEventListener('pointerenter', () => { pointer.inside=true; });
  canvas.addEventListener('pointerleave', () => {
    pointer.inside=false;
    pointer.overEnemy=false;
    pointer.x=cam.x+VIEW_W/2;
    pointer.y=cam.y+VIEW_H/2;
  });

  // Keyboard pan
  window.addEventListener('keydown', (e) => {
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ','Space','PageUp','PageDown','Home','End'].includes(e.key)) {
      e.preventDefault();
    }
    keys.add(e.key);
    updateCursorForPanMode();
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.key); updateCursorForPanMode(); });

  function updateCursorForPanMode(){
    const spaceHeld = keys.has(' ') || keys.has('Space');
    if (!isPanningDrag && spaceHeld) canvas.style.cursor = 'grab';
  }

  // Begin drag-to-pan if Space is held or middle mouse pressed
  canvas.addEventListener('pointerdown', (e) => {
    const isMiddle = (e.button === 1);
    const spaceHeld = keys.has(' ') || keys.has('Space');
    if (isMiddle || spaceHeld) {
      isPanningDrag = true;
      dragStartScreen = { x: e.clientX, y: e.clientY };
      dragStartCam = { x: cam.x, y: cam.y };
      canvas.style.cursor = 'grabbing';
      world.selBox = null;
      return;
    }
    // selection start
    canvas.setPointerCapture(e.pointerId);
    const p=screenToWorld(...Object.values(pos(e)));
    pointer.inside=true;
    pointer.x=p.x; pointer.y=p.y; pointer.down=true; pointer.dragStart={x:p.x,y:p.y}; pointer.dragging=false;
    world.selBox={x:p.x,y:p.y,w:0,h:0};
  }, { capture: true });

  canvas.addEventListener('pointermove', (e) => {
    if (isPanningDrag && dragStartScreen) {
      const dx = e.clientX - dragStartScreen.x;
      const dy = e.clientY - dragStartScreen.y;
      panBy(-dx, -dy);
      return;
    }
    const s=pos(e); const p=screenToWorld(s.x,s.y);
    pointer.x=p.x; pointer.y=p.y; pointer.inside=true;
    const hasSelection = world.selection.size>0;
    const spaceHeld = keys.has(' ') || keys.has('Space');
    pointer.overEnemy = !!unitAt(p.x,p.y,F.ENEMY);
    if (!spaceHeld) {
      if (hasSelection && pointer.overEnemy) canvas.style.cursor = redTarget;
      else if (hasSelection) canvas.style.cursor = greenTarget;
      else canvas.style.cursor = defaultCursor;
    }

    if(pointer.down && pointer.dragStart){
      const dx=p.x-pointer.dragStart.x, dy=p.y-pointer.dragStart.y;
      if(!pointer.dragging && (Math.abs(dx)>DRAG_THRESH||Math.abs(dy)>DRAG_THRESH)) pointer.dragging=true;
      if(pointer.dragging){
        world.selBox={x:Math.min(pointer.dragStart.x,p.x), y:Math.min(pointer.dragStart.y,p.y),
                      w:Math.abs(dx), h:Math.abs(dy)};
      }
    }
  }, { capture: true });

  canvas.addEventListener('pointerup', (e) => {
    if (isPanningDrag) {
      isPanningDrag = false;
      dragStartScreen = null;
      dragStartCam = null;
      canvas.style.cursor = 'grab';
      return;
    }
    if (e.button !== 0) return; // only left click

    const p=screenToWorld(...Object.values(pos(e))); pointer.down=false;
    const hasSel = world.selection.size>0;
    if(pointer.dragging && world.selBox){
      world.selection.forEach(u=>u.selected=false); world.selection.clear();
      world.units.forEach(u=>{ if(u.f===F.PLAYER && circleInRect(u.x,u.y,u.r,world.selBox)){ u.selected=true; world.selection.add(u);} });
      updateSelectionHUD();
    } else {
      const enemy = unitAt(p.x,p.y,F.ENEMY);
      const friendly = unitAt(p.x,p.y,F.PLAYER);
      if(enemy && hasSel){
        world.selection.forEach(u=>u.target=enemy);
        flashOrder('Attack');
        addClickFx(p.x,p.y,'#ff4d5a');
      }
      else if(friendly){
        world.selection.forEach(u=>u.selected=false); world.selection.clear();
        friendly.selected=true; world.selection.add(friendly);
        updateSelectionHUD();
      }
      else if(hasSel){
        assignFormationMove([...world.selection], p.x, p.y);
        flashOrder('Move');
        addClickFx(p.x,p.y,'#27e36a');
      }
    }
    world.selBox=null; pointer.dragStart=null; pointer.dragging=false;
  }, { capture: true });

  // Mouse wheel vertical pan
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = Math.sign(e.deltaY) * 80;
    panBy(0, delta);
  }, { passive: false });

  canvas.addEventListener('contextmenu', e=>e.preventDefault(), {passive:false});

  function addClickFx(x,y,color){
    world.clickFx.push({x,y,color,age:0,life:0.5});
    while (world.clickFx.length > 12) world.clickFx.shift(); // cap effects
  }
  function pos(e){ const r=canvas.getBoundingClientRect(); return {x:(e.clientX-r.left), y:(e.clientY-r.top)}; }

  // --- Buttons / Build Queue ---
  btnSelectAll.onclick=()=>{
    world.selection.forEach(u=>u.selected=false); world.selection.clear();
    world.units.forEach(u=>{ if(u.f===F.PLAYER){ u.selected=true; world.selection.add(u);} });
    updateSelectionHUD();
  };
  btnRestart.onclick=()=>location.reload();
  btnBuildRifleman.onclick=()=>queueBuild('rifleman',50,3);
  btnBuildGrenadier.onclick=()=>queueBuild('grenadier',100,4);

  function queueBuild(kind,cost,time){
    const b = getBarracks(F.PLAYER);
    if(!b || b.hp<=0) return;
    if(world.resources.credits < cost) return;
    world.resources.credits -= cost;
    b.queue.push({kind, time});
    if(!b.current){ startNextInQueue(b); }
  }
  function startNextInQueue(b){
    if(b.queue.length===0){ b.current=null; b.timeLeft=0; return; }
    b.current = b.queue.shift(); b.timeLeft = b.current.time;
  }
  function getBarracks(faction){
    return world.buildings.find(b => b.f===faction && b.type===BUILDING_TYPES.BARRACKS);
  }

  // --- Helpers ---
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function unitAt(x,y,filt){ for(const u of world.units){ if(filt && u.f!==filt) continue; if(Math.hypot(x-u.x,y-u.y)<=u.r+3) return u; } return null; }
  function circleInRect(cx,cy,r,rect){ const rx=clamp(cx,rect.x,rect.x+rect.w), ry=clamp(cy,rect.y,rect.y+rect.h);
    return (cx-r<=rect.x+rect.w && cx+r>=rect.x && cy-r<=rect.y+rect.h && cy+r>=rect.y && ((cx-rx)**2+(cy-ry)**2)<=r*r); }

  // LOS blockers for rifles (trees + forest/rock tiles)
  function blockedByTerrain(ax,ay,bx,by){
    const steps = Math.ceil(Math.hypot(bx-ax, by-ay) / 12);
    for(let i=1;i<steps;i++){
      const t = i/steps;
      const x = ax + (bx-ax)*t;
      const y = ay + (by-ay)*t;
      const tt = terrainAt(x,y);
      if(tt===1 || tt===3) return true;
    }
    return false;
  }
  function blockedByTrees(ax,ay,bx,by){
    for(const t of world.trees){
      const dx=bx-ax, dy=by-ay, L2=dx*dx+dy*dy||1, u=clamp(((t.x-ax)*dx+(t.y-ay)*dy)/L2,0,1);
      const px=ax+u*dx, py=ay+u*dy, d2=(px-t.x)**2+(py-t.y)**2;
      if(d2 <= (t.r+3)*(t.r+3)) return true;
    } return false;
  }
  function rifleBlocked(ax,ay,bx,by){ return blockedByTerrain(ax,ay,bx,by) || blockedByTrees(ax,ay,bx,by); }

  // --- Fog of War: solid reveal (no banding) ---
  function revealAround(x, y){
    fogCtx.save();
    fogCtx.globalCompositeOperation = 'destination-out';
    fogCtx.beginPath();
    fogCtx.arc(x, y, VISION_RADIUS, 0, Math.PI * 2);
    fogCtx.fillStyle = '#fff';
    fogCtx.fill();
    fogCtx.restore();
  }

  // --- Reactive fire ---
  function reactToAttack(victim, attacker){
    if(!attacker || victim.hp<=0) return;
    victim.target = attacker;
    for(const ally of world.units){
      if(ally===victim) continue;
      if(ally.f!==victim.f || ally.hp<=0) continue;
      const d = Math.hypot(ally.x - victim.x, ally.y - victim.y);
      if(d <= 150 && !rifleBlocked(ally.x,ally.y,attacker.x,attacker.y)){
        if(!ally.target || ally.target.dummy) ally.target = attacker;
      }
    }
  }

  function processBarracks(b, dt){
    if(!b || b.hp<=0) return;
    if(!b.current && b.queue.length>0){ startNextInQueue(b); }
    if(!b.current) return;
    b.timeLeft -= dt;
    if(b.timeLeft>0) return;
    const spawnX = b.x + b.w/2 + (Math.random()-0.5)*20;
    const spawnY = (b.f===F.PLAYER) ? b.y - 10 : b.y + b.h + 12;
    const nu = spawn(spawnX, spawnY, b.f, b.current.kind);
    if(b.f===F.PLAYER){
      nu.selected=true; world.selection.add(nu); updateSelectionHUD();
    } else if(world.enemyAI){
      world.enemyAI.unassigned.push(nu);
    }
    b.current=null;
    b.timeLeft=0;
    startNextInQueue(b);
  }

  function playerCentroid(){
    let sx=0, sy=0, count=0;
    for(const u of world.units){
      if(u.f===F.PLAYER && u.hp>0){ sx+=u.x; sy+=u.y; count++; }
    }
    if(count===0) return {x:MAP_W*0.35,y:MAP_H*0.75};
    return {x:sx/count, y:sy/count};
  }

  function makePatrolRing(center, radius, count){
    const pts=[];
    for(let i=0;i<count;i++){
      const ang = (Math.PI*2*i)/count;
      const px = clamp(center.x + Math.cos(ang)*radius, 60, MAP_W-60);
      const py = clamp(center.y + Math.sin(ang)*radius, 60, MAP_H-60);
      pts.push({x:px, y:py});
    }
    return pts;
  }

  function buildEnemySearchRoute(from, to){
    const pts=[];
    const steps=6;
    for(let i=1;i<=steps;i++){
      const t=i/(steps+1);
      const curve=Math.sin(Math.PI*t);
      const offsetX=(Math.random()-0.5)*260*curve;
      const offsetY=(Math.random()-0.5)*320*curve;
      const x=clamp(from.x + (to.x-from.x)*t + offsetX, 60, MAP_W-60);
      const y=clamp(from.y + (to.y-from.y)*t + offsetY, 100, MAP_H-80);
      pts.push({x,y});
    }
    pts.push({x:clamp(to.x,80,MAP_W-80), y:clamp(to.y-80,120,MAP_H-100)});
    return pts;
  }

  function squadCenter(members){
    let sx=0, sy=0;
    for(const m of members){ sx+=m.x; sy+=m.y; }
    return {x:sx/members.length, y:sy/members.length};
  }

  function findClosestPlayerTarget(center){
    let best=null, bestDist=Infinity;
    for(const u of world.units){
      if(u.f!==F.PLAYER || u.hp<=0) continue;
      const d = Math.hypot(u.x-center.x, u.y-center.y);
      if(d < bestDist){ bestDist=d; best=u; }
    }
    return best ? {unit:best, distance:bestDist} : null;
  }

  function updateEnemyAI(dt){
    const ai = world.enemyAI;
    if(!ai) return;

    ai.incomeTimer += dt;
    const INCOME_INTERVAL = 3.5;
    if(ai.incomeTimer >= INCOME_INTERVAL){
      ai.credits += 8;
      ai.incomeTimer -= INCOME_INTERVAL;
    }

    const barracks = getBarracks(F.ENEMY);
    if(barracks && barracks.hp>0){
      if(ai.buildCooldown>0) ai.buildCooldown -= dt;
      if(ai.buildCooldown<=0 && barracks.queue.length < 4){
        const roll = Math.random();
        const preferGrenadier = ai.credits >= 100 && roll > 0.6;
        const choice = preferGrenadier ? 'grenadier' : 'rifleman';
        const cost = choice==='rifleman'?50:100;
        if(ai.credits >= cost){
          ai.credits -= cost;
          const baseTime = choice==='rifleman'?3:4;
          const buildTime = baseTime * 1.4;
          barracks.queue.push({kind:choice, time:buildTime});
          if(!barracks.current) startNextInQueue(barracks);
          ai.buildCooldown = 2.4 + Math.random()*3.4;
        } else {
          ai.buildCooldown = 1.2;
        }
      }
    }

    if(ai.base && (!ai.searchRoute || ai.searchRoute.length===0)){
      const playerB = getBarracks(F.PLAYER);
      const target = playerB ? {x:playerB.x+playerB.w/2, y:playerB.y+playerB.h/2} : playerCentroid();
      ai.searchRoute = buildEnemySearchRoute(ai.base.center, target);
      ai.searchCursor = 0;
    }

    const DETECT_UNIT = 420;
    const DETECT_STRUCTURE = 520;
    let newFocus = null;
    for(const enemy of world.units){
      if(enemy.f!==F.ENEMY || enemy.hp<=0) continue;
      const info = findClosestPlayerTarget({x:enemy.x, y:enemy.y});
      if(info && info.distance <= DETECT_UNIT){
        newFocus = {x:info.unit.x, y:info.unit.y, time:world.time};
        break;
      }
    }
    if(!newFocus){
      const playerB = getBarracks(F.PLAYER);
      if(playerB){
        const center = {x:playerB.x+playerB.w/2, y:playerB.y+playerB.h/2};
        for(const enemy of world.units){
          if(enemy.f!==F.ENEMY || enemy.hp<=0) continue;
          if(Math.hypot(enemy.x-center.x, enemy.y-center.y) <= DETECT_STRUCTURE){
            newFocus = {x:center.x, y:center.y, time:world.time};
            break;
          }
        }
      }
    }
    if(newFocus) ai.focus = newFocus;
    else if(ai.focus && world.time - ai.focus.time > 18) ai.focus = null;

    if(ai.base){
      const baseCenter = ai.base.center;
      const threatened = world.units.some(u => u.f===F.PLAYER && u.hp>0 && Math.hypot(u.x-baseCenter.x, u.y-baseCenter.y) <= ai.base.alertRadius);
      if(threatened) ai.baseAlertTime = world.time;
      if(ai.baseAlertTime && world.time - ai.baseAlertTime > 12) ai.baseAlertTime = 0;
    }

    ai.unassigned = ai.unassigned.filter(u => u.hp>0);
    for(const u of ai.unassigned){ u.squad = null; }
    ai.groupTimer += dt;

    for(let i=ai.squads.length-1;i>=0;i--){
      const squad = ai.squads[i];
      squad.members = squad.members.filter(u => u.hp>0);
      if(squad.members.length===0){ ai.squads.splice(i,1); continue; }
      for(const m of squad.members){ m.squad = squad; }
      if(squad.members.length<2){
        for(const m of squad.members){ m.target=null; m.squad=null; ai.unassigned.push(m); }
        ai.squads.splice(i,1);
      }
    }

    const defendersCount = ai.squads.filter(s => s.role==='defend').length;
    if(ai.unassigned.length >= 2 && ai.groupTimer >= 3){
      const maxSize = Math.min(5, ai.unassigned.length);
      const size = Math.floor(Math.random() * (maxSize - 1)) + 2;
      const members = ai.unassigned.splice(0, size);
      const role = (defendersCount===0) ? 'defend' : 'hunt';
      const patrolLen = ai.base && ai.base.patrolPoints.length ? ai.base.patrolPoints.length : 1;
      const routeLen = (ai.searchRoute && ai.searchRoute.length) ? ai.searchRoute.length : 1;
      const startIndex = routeLen ? (ai.searchCursor % routeLen) : 0;
      const squad = {members, role, waypoint:null, targetUnit:null, orderLabel:'', searchIndex:startIndex, patrolIndex:Math.floor(Math.random()*patrolLen)};
      ai.searchCursor = (ai.searchCursor + 1) % routeLen;
      for(const m of members){ m.squad = squad; m.target=null; }
      if(role==='defend' && ai.base){
        const dest = ai.base.patrolPoints[squad.patrolIndex % patrolLen] || ai.base.center;
        orderSquadTo(squad, dest, 'patrol');
      } else {
        if(ai.focus){
          orderSquadTo(squad, ai.focus, 'investigate');
        } else if(ai.searchRoute && ai.searchRoute.length){
          const dest = ai.searchRoute[squad.searchIndex % ai.searchRoute.length];
          orderSquadTo(squad, dest, 'search');
          squad.searchIndex = (squad.searchIndex + 1) % ai.searchRoute.length;
        }
      }
      ai.squads.push(squad);
      ai.groupTimer = 0;
    }

    const hasFreshFocus = ai.focus && world.time - ai.focus.time < 18;
    for(const squad of ai.squads){
      if(!squad.members || squad.members.length===0) continue;
      const center = squadCenter(squad.members);
      let targetInfo = findClosestPlayerTarget(center);
      const targetRange = squad.role==='defend' ? 520 : 420;
      if(targetInfo && targetInfo.distance <= targetRange){
        squad.targetUnit = targetInfo.unit;
      } else if(squad.targetUnit && squad.targetUnit.hp>0){
        targetInfo = {unit:squad.targetUnit};
      } else {
        squad.targetUnit = null;
      }

      if(squad.targetUnit){
        for(const m of squad.members){ if(m.target !== squad.targetUnit) m.target = squad.targetUnit; }
        continue;
      }

      if(squad.members.some(m => !m.target) && squad.waypoint){
        assignFormationMove(squad.members, squad.waypoint.x, squad.waypoint.y);
      }

      if(squad.role==='defend' && ai.base){
        const underAlert = ai.baseAlertTime && world.time - ai.baseAlertTime < 8;
        if(underAlert){
          if(!squad.waypoint || squad.orderLabel!=='respond'){
            orderSquadTo(squad, ai.base.center, 'respond');
          }
        } else {
          const patrolLen = ai.base.patrolPoints.length || 1;
          if(!squad.waypoint || squad.orderLabel!=='patrol'){
            const dest = ai.base.patrolPoints[squad.patrolIndex % patrolLen] || ai.base.center;
            orderSquadTo(squad, dest, 'patrol');
            squad.patrolIndex = (squad.patrolIndex + 1) % patrolLen;
          } else {
            const dist = Math.hypot(center.x - squad.waypoint.x, center.y - squad.waypoint.y);
            if(dist < 70){
              const dest = ai.base.patrolPoints[squad.patrolIndex % patrolLen] || ai.base.center;
              orderSquadTo(squad, dest, 'patrol');
              squad.patrolIndex = (squad.patrolIndex + 1) % patrolLen;
            }
          }
        }
        continue;
      }

      if(hasFreshFocus){
        if(!squad.waypoint || squad.orderLabel!=='investigate'){
          orderSquadTo(squad, ai.focus, 'investigate');
        }
      } else if(ai.searchRoute && ai.searchRoute.length){
        const dist = Math.hypot(center.x - (squad.waypoint?.x||center.x), center.y - (squad.waypoint?.y||center.y));
        if(!squad.waypoint || squad.orderLabel!=='search' || dist < 80){
          const dest = ai.searchRoute[squad.searchIndex % ai.searchRoute.length];
          orderSquadTo(squad, dest, 'search');
          squad.searchIndex = (squad.searchIndex + 1) % ai.searchRoute.length;
        }
      }
    }
  }

  // --- Formation assignment ---
  function assignFormationMove(units, tx, ty){
    if(units.length===0) return;
    let cx=0, cy=0; for(const u of units){ cx+=u.x; cy+=u.y; } cx/=units.length; cy/=units.length;
    const face = Math.atan2(ty - cy, tx - cx);
    const n = units.length, spacing = 24;
    const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
    const offsets=[]; let i=0;
    for(let r=0;r<rows;r++){
      for(let c=0;c<cols;c++){
        if(i++>=n) break;
        const ox = (c - (cols-1)/2)*spacing, oy = (r - (rows-1)/2)*spacing;
        const rx =  ox*Math.cos(face) - oy*Math.sin(face);
        const ry =  ox*Math.sin(face) + oy*Math.cos(face);
        offsets.push({x:rx,y:ry});
      }
    }
    i=0; for(const u of units){ const off = offsets[i++] || {x:0,y:0}; u.target = { x: tx + off.x, y: ty + off.y, dummy:true, formation:true }; }
  }

  function orderSquadTo(squad, dest, label){
    if(!squad || !dest) return;
    assignFormationMove(squad.members, dest.x, dest.y);
    squad.waypoint = {x:dest.x, y:dest.y};
    squad.targetUnit = null;
    squad.orderLabel = label || '';
    squad.orderIssued = world.time;
  }

  // --- Separation steering ---
  function separation(u){
    let fx=0, fy=0, count=0;
    for(const v of world.units){
      if(v===u || v.f!==u.f || v.hp<=0) continue;
      const dx=u.x - v.x, dy=u.y - v.y;
      const d=Math.hypot(dx,dy);
      if(d>0 && d<SEP_RADIUS){
        const m=(SEP_RADIUS - d)/SEP_RADIUS;
        fx += (dx/d) * m; fy += (dy/d) * m; count++;
      }
    }
    if(count>0){ fx/=count; fy/=count; }
    return {fx,fy};
  }

  // --- Game Step ---
  function step(dt){
    world.time += dt; world.tAccum += dt;

    // Keyboard pan
    (function panCameraByKeys(){
      let sx = 0, sy = 0;
      const speed = (keys.has('Shift')) ? PAN_SPEED_FAST : PAN_SPEED;
      if (keys.has('ArrowLeft') || keys.has('a') || keys.has('A')) sx -= speed * dt;
      if (keys.has('ArrowRight')|| keys.has('d') || keys.has('D')) sx += speed * dt;
      if (keys.has('ArrowUp')   || keys.has('w') || keys.has('W')) sy -= speed * dt;
      if (keys.has('ArrowDown') || keys.has('s') || keys.has('S')) sy += speed * dt;
      if (sx || sy) panBy(sx, sy);
    })();

    // Edge scroll
    (function edgeScroll(){
      if (isPanningDrag || !pointer.inside) return;
      const screenX = pointer.x - cam.x;
      const screenY = pointer.y - cam.y;
      let vx = 0, vy = 0;
      if (screenX <= EDGE_BAND) {
        const dist = EDGE_BAND - screenX;
        vx = -edgeEase(dist);
      } else if (screenX >= VIEW_W - EDGE_BAND) {
        const dist = screenX - (VIEW_W - EDGE_BAND);
        vx = edgeEase(dist);
      }
      if (screenY <= EDGE_BAND) {
        const dist = EDGE_BAND - screenY;
        vy = -edgeEase(dist);
      } else if (screenY >= VIEW_H - EDGE_BAND) {
        const dist = screenY - (VIEW_H - EDGE_BAND);
        vy = edgeEase(dist);
      }
      if (vx || vy) {
        const speed = PAN_SPEED * 0.8;
        panBy(vx * speed * dt, vy * speed * dt);
      }
    })();

    if(world.tAccum>=2){ world.resources.credits+=10; world.tAccum=0; }

    updateEnemyAI(dt);

    // Cooldowns + walk anim + reveal
    for(const u of world.units){
      if(u.cd>0) u.cd-=dt;
      if(u.f===F.PLAYER && u.hp>0) revealAround(u.x,u.y);
      const speed = Math.hypot(u.vx,u.vy);
      if(speed>0.01){ u.facing = Math.atan2(u.vy,u.vx); u.walk += dt * (4 + speed*4); }
      else { u.walk += dt*2; }
    }

    // Enemy seek
    for(const u of world.units){
      if(u.f!==F.ENEMY || u.hp<=0) continue;
      if(u.squad){
        const squadTarget = u.squad.targetUnit;
        if(squadTarget && squadTarget.hp>0 && u.target !== squadTarget){
          u.target = squadTarget;
        }
        continue;
      }
      if(!u.target || (u.target.hp!==undefined && u.target.hp<=0)){
        let best=null,bd2=Infinity;
        for(const p of world.units){ if(p.f!==F.PLAYER||p.hp<=0) continue;
          const d2=(p.x-u.x)**2+(p.y-u.y)**2;
          if(d2<bd2 && Math.sqrt(d2)<190 && !rifleBlocked(u.x,u.y,p.x,p.y)){ bd2=d2; best=p; } }
        if(best){
          u.target=best;
        } else {
          u.wander += (Math.random()-0.5)*0.2;
          u.x += Math.cos(u.wander)*0.6*60*dt;
          u.y += Math.sin(u.wander)*0.6*60*dt;
        }
      }
    }

    // Move & fire
    for(const u of world.units){
      if(u.hp<=0) continue;
      let t=u.target; if(t && t.hp!==undefined && t.hp<=0) t=u.target=null;

      if(t){
        const tx=t.x, ty=t.y, dist=Math.hypot(tx-u.x,ty-u.y);
        const inRange=dist<=u.range;
        const canShoot = inRange && (u.unitType==='grenadier' ? true : !rifleBlocked(u.x,u.y,tx,ty));
        if(t.dummy){
          moveToward(u,tx,ty,dt,true);
          if(dist<6) u.target=null;
        } else if(canShoot){
          if(u.cd<=0){ fire(u,t); u.cd=0.5+Math.random()*0.2; }
        } else {
          moveToward(u,tx,ty,dt,true);
        }
      } else {
        const sep = separation(u);
        u.vx = (u.vx + (sep.fx*SEP_FORCE/60))*0.9;
        u.vy = (u.vy + (sep.fy*SEP_FORCE/60))*0.9;
        u.x+=u.vx*60*dt; u.y+=u.vy*60*dt;
      }

      // Terrain collision / slow
      const ttype = terrainAt(u.x,u.y);
      if(ttype===2 || ttype===3){
        u.x -= u.vx*60*dt; u.y -= u.vy*60*dt; u.vx = u.vy = 0;
      }
      for(const tr of world.trees){
        const dx=u.x-tr.x, dy=u.y-tr.y, d=Math.hypot(dx,dy);
        if(d<tr.r+u.r){ const push=(tr.r+u.r-d)+0.1, nx=dx/(d||1), ny=dy/(d||1); u.x+=nx*push; u.y+=ny*push; }
      }
      u.x=clamp(u.x,8,MAP_W-8); u.y=clamp(u.y,8,MAP_H-8);
    }

    // Projectiles
    for(let i=world.bullets.length-1;i>=0;i--){
      const b=world.bullets[i];
      if(b.ballistic){
        b.t += dt;
        const k = Math.min(1, b.t / b.tMax);
        const x = b.ox + (b.tx - b.ox) * k;
        const y = b.oy + (b.ty - b.oy) * k;
        const dist = Math.hypot(b.tx - b.ox, b.ty - b.oy);
        const h = Math.min(90, 18 + dist*0.18);
        const yArc = y - (4 * h * k * (1 - k));
        b.x = x; b.y = yArc;
        if(k >= 1){ explode(b.x,b.y,b.blastRadius,b.dmg,b.f,b.from); world.bullets.splice(i,1); continue; }
      } else {
        const ang=Math.atan2(b.ty-b.y,b.tx-b.x);
        const nx=Math.cos(ang)*b.spd*60*dt, ny=Math.sin(ang)*b.spd*60*dt;
        if(rifleBlocked(b.ox,b.oy,b.x+nx,b.y+ny)){ world.bullets.splice(i,1); continue; }
        b.x+=nx; b.y+=ny; b.life-=dt;
        const t=b.target;
        if(t && t.hp>0 && Math.hypot(b.x-t.x,b.y-t.y)<t.r+3){ t.hp -= b.dmg; reactToAttack(t, b.from); world.bullets.splice(i,1); continue; }
        if(b.life<=0){ world.bullets.splice(i,1); }
      }
    }

    // Explosions fade
    if(world.explosions){ for(let i=world.explosions.length-1;i>=0;i--){ const e=world.explosions[i]; e.life-=dt; if(e.life<=0) world.explosions.splice(i,1); } }

    // Barracks production
    processBarracks(getBarracks(F.PLAYER), dt);
    processBarracks(getBarracks(F.ENEMY), dt);

    // Click FX progress
    for(let i=world.clickFx.length-1;i>=0;i--){
      const f=world.clickFx[i]; f.age+=dt; if(f.age>=f.life) world.clickFx.splice(i,1);
    }

    // Deaths + SFX
    for(let i=world.units.length-1;i>=0;i--){
      const u=world.units[i]; if(u.hp>0) continue;
      const s = deathSoundBase.cloneNode(); s.play().catch(()=>{});
      if(u.selected){ world.selection.delete(u); }
      if(u.f===F.PLAYER) world.stats.lost++; else world.stats.kills++;
      world.units.splice(i,1);
    }
    updateSelectionHUD();

    // Win/lose
    const pAlive=world.units.some(u=>u.f===F.PLAYER), eAlive=world.units.some(u=>u.f===F.ENEMY);
    if(!pAlive||!eAlive) endGame(pAlive && !eAlive);
  }

  function moveToward(u,tx,ty,dt,applySep=false){
    const ang=Math.atan2(ty-u.y,tx-u.x), sp=u.s;
    let vx=Math.cos(ang)*sp, vy=Math.sin(ang)*sp;
    if(applySep){
      const sep = separation(u);
      vx += (sep.fx*SEP_FORCE)/100; vy += (sep.fy*SEP_FORCE)/100;
      const spd=Math.hypot(vx,vy), max=sp*1.25; if(spd>max){ vx*=max/spd; vy*=max/spd; }
    }

    // movement speed modifier by terrain at NEXT position
    const nx = u.x + vx*60*dt, ny = u.y + vy*60*dt;
    const ttype = terrainAt(nx,ny);
    if(ttype===2 || ttype===3){
      const side=Math.random()<.5?Math.PI/2:-Math.PI/2;
      vx=Math.cos(ang+side)*sp*.85; vy=Math.sin(ang+side)*sp*.85;
    } else if(ttype===1){
      vx *= 0.75; vy *= 0.75;
    }

    // sidestep trees (soft)
    let blockedMove=false;
    for(const tr of world.trees){ const dx=(u.x+vx*60*dt)-tr.x, dy=(u.y+vy*60*dt)-tr.y; if(Math.hypot(dx,dy)<tr.r+u.r){ blockedMove=true; break; } }
    if(blockedMove){ const side=Math.random()<.5?Math.PI/2:-Math.PI/2; vx=Math.cos(ang+side)*sp*.85; vy=Math.sin(ang+side)*sp*.85; }
    u.vx=vx; u.vy=vy; u.x+=vx*60*dt; u.y+=vy*60*dt;
  }

  function fire(from,target){
    if(from.unitType==='grenadier'){
      const dist = Math.hypot(target.x - from.x, target.y - from.y);
      const flight = clamp(0.55 + dist / 600, 0.55, 1.2);
      world.bullets.push({
        x:from.x, y:from.y, ox:from.x, oy:from.y,
        tx:target.x, ty:target.y, target,
        dmg:from.dmg, f:from.f, from,
        ballistic:true, t:0, tMax:flight,
        explosive:true, blastRadius:35
      });
    } else {
      world.bullets.push({x:from.x,y:from.y,ox:from.x,oy:from.y,tx:target.x,ty:target.y,target,
                          spd:5.5,dmg:from.dmg,life:.6,f:from.f,from,explosive:false});
    }
  }

  function explode(x,y,radius,dmg,faction,attacker){
    world.explosions = world.explosions || [];
    world.explosions.push({x,y,radius,life:0.3,maxLife:0.3});
    for(const u of world.units){
      if(u.f===faction || u.hp<=0) continue;
      const dist=Math.hypot(u.x-x,u.y-y);
      if(dist<=radius){
        const dd=Math.max(1, dmg*(1-dist/radius)); 
        u.hp-=dd;
        if(attacker) reactToAttack(u, attacker);
      }
    }
  }

  // --- Drawing helpers ---
  function drawTileLayer(){
    const startCX = Math.max(0, Math.floor(cam.x / TILE_SIZE));
    const endCX   = Math.min(GRID_W - 1, Math.floor((cam.x + VIEW_W) / TILE_SIZE));
    const startCY = Math.max(0, Math.floor(cam.y / TILE_SIZE));
    const endCY   = Math.min(GRID_H - 1, Math.floor((cam.y + VIEW_H) / TILE_SIZE));

    ctx.save();
    ctx.translate(-cam.x, -cam.y);
    for(let cy=startCY; cy<=endCY; cy++){
      for(let cx=startCX; cx<=endCX; cx++){
        const t = tilemap[idx(cx,cy)];
        ctx.fillStyle = patterns[t] || patterns[0];
        ctx.fillRect(cx * TILE_SIZE, cy * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
    ctx.restore();
  }

  function drawTrees(){
    for(const t of world.trees){
      const s=worldToScreen(t.x,t.y);
      if(s.x<-t.r-4||s.y<-t.r-4||s.x>VIEW_W+t.r+4||s.y>VIEW_H+t.r+4) continue;
      const tt = terrainAt(t.x,t.y);
      if(tt===2 || tt===3) continue;
      ctx.fillStyle='rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(s.x+2,s.y+2,t.r,0,Math.PI*2); ctx.fill();
      const grad=ctx.createRadialGradient(s.x-2,s.y-2,2,s.x,s.y,t.r);
      grad.addColorStop(0,'#3f7a3f'); grad.addColorStop(1,'#235a29');
      ctx.fillStyle=grad; ctx.beginPath(); ctx.arc(s.x,s.y,t.r,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#5a3a21'; ctx.beginPath(); ctx.arc(s.x,s.y+t.r*0.6,3,0,Math.PI*2); ctx.fill();
    }
  }

  function drawBuilding(b){
    const s=worldToScreen(b.x,b.y);
    const x=s.x, y=s.y, w=b.w, h=b.h;
    if(x<-w||y<-h||x>VIEW_W||y>VIEW_H) return;

    ctx.save();

    ctx.fillStyle='rgba(0,0,0,.35)';
    ctx.fillRect(x+3,y+3,w,h);

    if(b.type===BUILDING_TYPES.HQ){
      ctx.fillStyle='#b33f3f';
      roundRect(x,y,w,h,10,true,false);
      ctx.fillStyle='#5b1f1f';
      roundRect(x+8,y+8,w-16,h-26,8,true,false);
      ctx.fillStyle='#2b1111';
      roundRect(x+18,y+18,w-36,h-52,6,true,false);
      ctx.fillStyle='#ffd27f';
      ctx.fillRect(x+w/2-18,y+14,36,7);
      ctx.fillRect(x+w/2-12,y+26,24,6);
      ctx.fillStyle='rgba(245,226,188,0.8)';
      ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(x+18,y+18,10,Math.PI*0.2,Math.PI*1.4); ctx.stroke();
      ctx.fillRect(x+17,y+10,2,8);
      ctx.fillStyle='#ff6666';
      ctx.fillRect(x+w-16,y-12,3,12);
      ctx.beginPath(); ctx.moveTo(x+w-13,y-11); ctx.lineTo(x+w-1,y-6); ctx.lineTo(x+w-13,y-1); ctx.closePath(); ctx.fill();
    } else if(b.type===BUILDING_TYPES.DEPOT){
      ctx.fillStyle='#a96736';
      roundRect(x,y,w,h,8,true,false);
      ctx.fillStyle='#5a3018';
      roundRect(x+6,y+10,w-12,h-24,6,true,false);
      ctx.fillStyle='#d9b066';
      const stripes=4;
      for(let i=0;i<=stripes;i++){
        const sx = x+8 + (w-16)*(i/stripes);
        ctx.fillRect(sx,y+12,2,h-28);
      }
      ctx.fillStyle='#3a1c0d';
      ctx.fillRect(x+4,y+h-16,w-8,12);
      ctx.fillStyle='#ffb347';
      ctx.fillRect(x+8,y+h-22,w-16,6);
    } else {
      const isPlayer = b.f===F.PLAYER;
      ctx.fillStyle = isPlayer ? '#4a8bd3' : '#d34a4a';
      roundRect(x,y,w,h,6,true,false);
      ctx.fillStyle = isPlayer ? '#2d4a6b' : '#6b2d2d';
      roundRect(x+4,y+4,w-8,14,4,true,false);
      ctx.fillStyle = 'rgba(255,255,255,.15)';
      ctx.fillRect(x+8,y+6,12,3); ctx.fillRect(x+w-20,y+6,12,3);
      ctx.fillStyle = '#0e121d';
      ctx.fillRect(x+w/2-6,y+h-16,12,16);
      ctx.fillStyle = isPlayer ? '#3bd1ff' : '#ff6666';
      ctx.fillRect(x+6,y-8,2,8);
      ctx.beginPath();
      ctx.moveTo(x+8,y-8);
      ctx.lineTo(x+22,y-3);
      ctx.lineTo(x+8,y+2);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle='#0e121d';
    ctx.fillRect(x,y-10,w,4);
    ctx.fillStyle='#36d399';
    ctx.fillRect(x,y-10,w*(b.hp/b.max),4);

    if(b.type===BUILDING_TYPES.BARRACKS && b.current){
      const total = b.current.time;
      const prog = Math.max(0,1 - b.timeLeft/total);
      ctx.fillStyle='#36d399';
      ctx.fillRect(x,y-16,w*prog,4);
    }
    if(b.type===BUILDING_TYPES.BARRACKS && b.queue.length>0){
      ctx.fillStyle='#ffffff'; ctx.font='12px system-ui';
      ctx.fillText(`Queue: ${b.queue.length}`, x, y-20);
    }

    ctx.restore();
  }

  function roundRect(x,y,w,h,r,fill,stroke){
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
    if(fill) ctx.fill(); if(stroke) ctx.stroke();
  }

  function drawBuildings(){ for(const b of world.buildings){ drawBuilding(b); } }

  // Animated soldier
  function drawSoldier(u){
    const s=worldToScreen(u.x,u.y);
    if(s.x<-30||s.y<-30||s.x>VIEW_W+30||s.y>VIEW_H+30) return;

    const dir = u.facing;
    ctx.save(); ctx.translate(s.x,s.y); ctx.rotate(dir);

    ctx.fillStyle='rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(2,3,u.r*0.9,u.r*0.6,0,0,Math.PI*2); ctx.fill();

    const swing = Math.sin(u.walk)*3.2, backSwing = -Math.sin(u.walk)*3.2;
    ctx.strokeStyle = '#1c2535'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(-2,4); ctx.lineTo(-2,4+swing); ctx.stroke();
    ctx.beginPath(); ctx.moveTo( 2,4); ctx.lineTo( 2,4+backSwing); ctx.stroke();

    const bodyColor = (u.f===F.PLAYER)?'#4a6b8a':'#8a4a4a';
    ctx.fillStyle=bodyColor; ctx.fillRect(-3,-2,6,8);

    ctx.fillStyle='#f4c2a1'; ctx.fillRect(-2.2,-6,4.4,3);
    ctx.fillStyle=(u.f===F.PLAYER)?'#2d4a6b':'#6b2d2d'; ctx.fillRect(-3,-7,6,2);

    ctx.fillStyle='#303030';
    if(u.unitType==='grenadier'){ ctx.fillRect(4,-1,6,2); ctx.fillRect(10,-2,2,4); }
    else { ctx.fillRect(3,-1,7,1.5); ctx.fillRect(10,-2,1.5,3); }

    if(u.selected){ ctx.strokeStyle='#d7f5ff'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(0,0,u.r+3,0,Math.PI*2); ctx.stroke(); }
    ctx.restore();

    ctx.fillStyle='#0e121d'; ctx.fillRect(s.x-10,s.y-16,20,4);
    ctx.fillStyle='#36d399'; ctx.fillRect(s.x-10,s.y-16,20*(u.hp/u.max),4);
  }

  function drawBulletsExplosions(){
    for(const b of world.bullets){
      const s=worldToScreen(b.x,b.y);
      if(b.ballistic){
        ctx.fillStyle='#f0e06b'; ctx.beginPath(); ctx.arc(s.x,s.y,3,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='rgba(240,224,107,.25)'; ctx.beginPath(); ctx.arc(s.x,s.y+3,2,0,Math.PI*2); ctx.fill();
      } else {
        ctx.fillStyle='#f8f1b8'; ctx.fillRect(s.x-2,s.y-2,4,4);
      }
    }
    if(world.explosions){
      for(const e of world.explosions){
        const s=worldToScreen(e.x,e.y);
        const a=e.life/e.maxLife, sz=e.radius*(1-a);
        const g=ctx.createRadialGradient(s.x,s.y,0,s.x,s.y,sz);
        g.addColorStop(0,`rgba(255,120,0,${a*.8})`);
        g.addColorStop(.6,`rgba(255,200,0,${a*.35})`);
        g.addColorStop(1,`rgba(255,120,0,0)`);
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(s.x,s.y,sz,0,Math.PI*2); ctx.fill();
      }
    }
  }

  function drawClickFx(){
    for(const f of world.clickFx){
      const k=f.age/f.life, r=8+40*k, a=1-k;
      const s=worldToScreen(f.x,f.y);
      ctx.strokeStyle=f.color; ctx.lineWidth=2*a;
      ctx.beginPath(); ctx.arc(s.x,s.y,r,0,Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s.x-6,s.y); ctx.lineTo(s.x-2,s.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s.x+2,s.y); ctx.lineTo(s.x+6,s.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s.x,s.y-6); ctx.lineTo(s.x,s.y-2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s.x,s.y+2); ctx.lineTo(s.x,s.y+6); ctx.stroke();
    }
  }

  // Selection HUD
  function updateSelectionHUD(){
    const arr = [...world.selection].filter(u=>u.hp>0);
    selCountEl.textContent = arr.length.toString();
    selGridEl.innerHTML = '';
    for(const u of arr){
      const tile = document.createElement('div');
      tile.className = 'tile ' + (u.unitType==='grenadier' ? 'gren' : 'rifle');
      tile.title = `${u.unitType} • HP ${Math.max(0,Math.ceil(u.hp))}/${u.max}`;
      tile.textContent = u.unitType==='grenadier' ? 'G' : 'R';
      const hpWrap = document.createElement('div'); hpWrap.className = 'hpbar';
      const hpFill = document.createElement('span'); hpFill.style.width = `${Math.max(0, (u.hp/u.max)*100)}%`;
      hpWrap.appendChild(hpFill); tile.appendChild(hpWrap); selGridEl.appendChild(tile);
    }
  }
  function flashOrder(text){
    orderFlash.textContent = `Order: ${text}`;
    orderFlash.classList.add('show');
    if(orderFlashTimer) clearTimeout(orderFlashTimer);
    orderFlashTimer = setTimeout(()=>orderFlash.classList.remove('show'), 700);
  }

  // Fog overlay on current viewport
  function drawFog(){ ctx.drawImage(fogCanvas, cam.x, cam.y, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H); }

  // Minimap draw
  function drawMinimap(){
    mctx.fillStyle = '#203046'; mctx.fillRect(0,0,MINI_W,MINI_H);

    for(let cy=0; cy<GRID_H; cy++){
      for(let cx=0; cx<GRID_W; cx++){
        const t = tilemap[idx(cx,cy)];
        let col = '#3a5f2f';
        if(t===1) col='#2c4a2e';
        else if(t===2) col='#1d4d7a';
        else if(t===3) col='#555555';
        mctx.fillStyle = col;
        mctx.fillRect(Math.floor(cx*TILE_SIZE*mScaleX), Math.floor(cy*TILE_SIZE*mScaleY),
                      Math.ceil(TILE_SIZE*mScaleX), Math.ceil(TILE_SIZE*mScaleY));
      }
    }

    try{
      const temp = document.createElement('canvas'); temp.width=MINI_W; temp.height=MINI_H;
      const tctx=temp.getContext('2d');
      tctx.drawImage(fogCanvas, 0,0,MAP_W,MAP_H, 0,0,MINI_W,MINI_H);
      mctx.globalAlpha = 0.75;
      mctx.drawImage(temp,0,0);
      mctx.globalAlpha = 1;
    }catch(_e){}

    mctx.strokeStyle = '#8ab4ff'; mctx.lineWidth = 1;
    mctx.strokeRect(cam.x*mScaleX, cam.y*mScaleY, VIEW_W*mScaleX, VIEW_H*mScaleY);

    for(const u of world.units){
      mctx.fillStyle = (u.f===F.PLAYER)?'#3bd1ff':'#ff6666';
      mctx.fillRect((u.x*mScaleX)|0, (u.y*mScaleY)|0, 2, 2);
    }
  }

  // Render
  function draw(){
    drawTileLayer();
    drawTrees();
    drawBuildings();

    for(const u of world.units){
      if(u.f===F.PLAYER) { drawSoldier(u); }
      else {
        let visible=false;
        for(const p of world.units){
          if(p.f!==F.PLAYER || p.hp<=0) continue;
          if(Math.hypot(u.x-p.x,u.y-p.y) <= VISION_RADIUS){ visible=true; break; }
        }
        if(visible) drawSoldier(u);
      }
    }

    drawBulletsExplosions();
    drawClickFx();

    if(world.selBox){ 
      const s=world.selBox; const a=worldToScreen(s.x,s.y);
      ctx.setLineDash([6,4]); ctx.strokeStyle='#8ab4ff'; ctx.strokeRect(a.x, a.y, s.w, s.h); ctx.setLineDash([]); 
    }

    drawFog();

    ctx.fillStyle='#ffffff'; ctx.font='bold 14px system-ui';
    const p=world.units.filter(u=>u.f===F.PLAYER).length, e=world.units.filter(u=>u.f===F.ENEMY).length;
    ctx.fillText(`Credits: ${world.resources.credits}  |  Troops: ${p}  |  Hostiles: ${e}`,10,20);
    const b = getBarracks(F.PLAYER);
    if(b){
      if(b.current){
        const prog = Math.max(0,1 - b.timeLeft/b.current.time);
        ctx.fillText(`Barracks: ${b.current.kind} ${Math.round(prog*100)}% • Queue ${b.queue.length}`, 10, 40);
      } else {
        ctx.fillText(`Barracks: idle • Queue ${b.queue.length}`, 10, 40);
      }
    }

    drawMinimap();
  }

  // Loop & end
  let last=performance.now();
  function loop(now){
    if(world.ended) return;
    const dt=Math.min(0.033,(now-last)/1000); last=now;
    step(dt); draw(); requestAnimationFrame(loop);
  }
  function endGame(win){
    world.ended=true; overlay.style.display='flex';
    resultEl.textContent = win ? 'Victory — area secured!' : 'Defeat — squad wiped.';
    const sec=((performance.now()-world.stats.timeStart)/1000).toFixed(1);
    statsEl.textContent=`Time: ${sec}s • Lost: ${world.stats.lost} • Kills: ${world.stats.kills}`;
  }

  // Drag/drop + button terrain override
  terrainBtn.onclick = () => terrainFile.click();
  terrainFile.onchange = (e)=>{
    const file = e.target.files?.[0]; if(!file) return;
    const img = new Image(); img.onload = ()=>{
      const tc=document.createElement('canvas'); tc.width=MAP_W; tc.height=MAP_H;
      const tctx=tc.getContext('2d');
      const pat = tctx.createPattern(img,'repeat');
      if(pat){ tctx.fillStyle=pat; tctx.fillRect(0,0,MAP_W,MAP_H); }
      else { tctx.drawImage(img, 0,0,MAP_W,MAP_H); }
      patterns[0] = ctx.createPattern(tc, 'no-repeat');
    };
    img.src = URL.createObjectURL(file);
  };
  ;['dragenter','dragover'].forEach(ev=>ctx.canvas.addEventListener(ev, e=>{ e.preventDefault(); }));
  ctx.canvas.addEventListener('drop', e=>{
    e.preventDefault();
    const file = e.dataTransfer.files?.[0]; if(!file || !file.type.startsWith('image/')) return;
    const img = new Image(); img.onload = ()=>{
      const tc=document.createElement('canvas'); tc.width=MAP_W; tc.height=MAP_H;
      const tctx=tc.getContext('2d');
      const pat = tctx.createPattern(img,'repeat');
      if(pat){ tctx.fillStyle=pat; tctx.fillRect(0,0,MAP_W,MAP_H); }
      else { tctx.drawImage(img, 0,0,MAP_W,MAP_H); }
      patterns[0] = ctx.createPattern(tc, 'no-repeat');
    };
    img.src = URL.createObjectURL(file);
  });

  loadAllPatterns(()=>{ reset(); requestAnimationFrame(loop); });
})();
