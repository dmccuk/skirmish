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
  const unitReadyNotice = document.getElementById('unitReadyNotice');
  let unitReadyTimer=null;

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
  const BUILDING_TYPES = {BARRACKS:'barracks'};
  const VISION_RADIUS=100; // Fog reveal radius
  const SEP_RADIUS = 18, SEP_FORCE = 65;
  const SPAWN_GLOW_TIME = 1.6;

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

  // --- Pattern generation helpers ---
  function mulberry32(a){
    return function(){
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function tileableValueNoise(width,height,cellSize,seed){
    const cellsX = Math.max(1, Math.ceil(width / cellSize));
    const cellsY = Math.max(1, Math.ceil(height / cellSize));
    const gW = cellsX + 1;
    const gH = cellsY + 1;
    const grid = new Float32Array(gW * gH);
    const rand = mulberry32(seed);
    for(let y=0;y<cellsY;y++){
      for(let x=0;x<cellsX;x++){
        grid[y*gW + x] = rand();
      }
    }
    for(let y=0;y<cellsY;y++){
      grid[y*gW + cellsX] = grid[y*gW];
    }
    for(let x=0;x<cellsX;x++){
      grid[cellsY*gW + x] = grid[x];
    }
    grid[cellsY*gW + cellsX] = grid[0];
    const smooth = t => t*t*(3-2*t);
    const data = new Float32Array(width*height);
    let i=0;
    for(let y=0;y<height;y++){
      const gy = y / cellSize;
      const y0 = Math.floor(gy);
      const ty = smooth(gy - y0);
      for(let x=0;x<width;x++,i++){
        const gx = x / cellSize;
        const x0 = Math.floor(gx);
        const tx = smooth(gx - x0);
        const a = grid[y0*gW + x0];
        const b = grid[y0*gW + (x0+1)];
        const c = grid[(y0+1)*gW + x0];
        const d = grid[(y0+1)*gW + (x0+1)];
        const top = a + (b - a) * tx;
        const bottom = c + (d - c) * tx;
        data[i] = top + (bottom - top) * ty;
      }
    }
    return data;
  }

  function createFractalNoise(width,height,opts={}){
    const { cellSize=160, octaves=3, persistence=0.5, seed=1 } = opts;
    const data = new Float32Array(width*height);
    let amplitude = 1;
    let total = 0;
    let scale = cellSize;
    for(let o=0;o<octaves;o++){
      const noise = tileableValueNoise(width,height,scale, seed + o*97);
      for(let i=0;i<data.length;i++) data[i] += noise[i] * amplitude;
      total += amplitude;
      amplitude *= persistence;
      scale = Math.max(4, Math.floor(scale / 2));
    }
    const inv = 1 / total;
    for(let i=0;i<data.length;i++) data[i] *= inv;
    return data;
  }

  function clamp(v,min,max){ return v<min?min:(v>max?max:v); }

  function drawWrapped(ctx,size,drawFn){
    for(const ox of [-size,0,size]){
      for(const oy of [-size,0,size]){
        drawFn(ox, oy);
      }
    }
  }

  function makeGrassPattern(){
    const size = 512;
    const can = document.createElement('canvas');
    can.width = can.height = size;
    const gctx = can.getContext('2d');

    const base = gctx.createLinearGradient(0, 0, size, size);
    base.addColorStop(0, '#27421d');
    base.addColorStop(0.5, '#3d6a2b');
    base.addColorStop(1, '#23371a');
    gctx.fillStyle = base;
    gctx.fillRect(0,0,size,size);

    const noise = createFractalNoise(size,size,{cellSize:140,octaves:4,persistence:0.55,seed:1331});
    const img = gctx.getImageData(0,0,size,size);
    const data = img.data;
    for(let i=0;i<noise.length;i++){
      const n = noise[i];
      const shade = (n-0.5)*120;
      const idx = i*4;
      data[idx] = clamp(data[idx] + shade*0.6,0,255);
      data[idx+1] = clamp(data[idx+1] + shade*1.1,0,255);
      data[idx+2] = clamp(data[idx+2] + shade*0.4,0,255);
    }
    gctx.putImageData(img,0,0);

    gctx.globalAlpha = 0.35;
    for(let i=0;i<160;i++){
      const x = Math.random()*size;
      const y = Math.random()*size;
      const r = 60 + Math.random()*200;
      const light = `rgba(110, ${150+Math.floor(Math.random()*30)}, 80, 0.35)`;
      drawWrapped(gctx,size,(ox,oy)=>{
        const grad = gctx.createRadialGradient(x+ox, y+oy, r*0.2, x+ox, y+oy, r);
        grad.addColorStop(0, light);
        grad.addColorStop(1, 'rgba(40,70,40,0)');
        gctx.fillStyle = grad;
        gctx.fillRect(x+ox-r, y+oy-r, r*2, r*2);
      });
    }
    gctx.globalAlpha = 1;

    gctx.lineCap = 'round';
    for(let i=0;i<1300;i++){
      const x = Math.random()*size;
      const y = Math.random()*size;
      const len = 10 + Math.random()*22;
      const sway = (Math.random()-0.5)*0.6;
      const tone = 120 + Math.random()*40;
      gctx.strokeStyle = `rgba(${60 + Math.floor(Math.random()*20)}, ${tone|0}, ${60 + Math.floor(Math.random()*25)}, 0.45)`;
      gctx.lineWidth = 0.8 + Math.random()*0.7;
      drawWrapped(gctx,size,(ox,oy)=>{
        gctx.beginPath();
        gctx.moveTo(x+ox, y+oy);
        gctx.quadraticCurveTo(x+ox + len*0.3, y+oy - len*0.6, x+ox + Math.sin(sway)*len, y+oy - len);
        gctx.stroke();
      });
    }

    return ctx.createPattern(can,'repeat');
  }

  function makeForestPattern(){
    const size = 512;
    const can = document.createElement('canvas');
    can.width = can.height = size;
    const gctx = can.getContext('2d');

    const base = gctx.createLinearGradient(0, size*0.2, size, size);
    base.addColorStop(0, '#1c2d1a');
    base.addColorStop(0.5, '#244127');
    base.addColorStop(1, '#162015');
    gctx.fillStyle = base;
    gctx.fillRect(0,0,size,size);

    const noise = createFractalNoise(size,size,{cellSize:120,octaves:5,persistence:0.6,seed:2457});
    const img = gctx.getImageData(0,0,size,size);
    const data = img.data;
    for(let i=0;i<noise.length;i++){
      const n = noise[i];
      const shade = (n-0.5)*150;
      const idx = i*4;
      data[idx] = clamp(data[idx] + shade*0.5,0,255);
      data[idx+1] = clamp(data[idx+1] + shade*1.3,0,255);
      data[idx+2] = clamp(data[idx+2] + shade*0.4,0,255);
    }
    gctx.putImageData(img,0,0);

    gctx.globalCompositeOperation = 'lighter';
    for(let i=0;i<140;i++){
      const x = Math.random()*size;
      const y = Math.random()*size;
      const r = 80 + Math.random()*180;
      drawWrapped(gctx,size,(ox,oy)=>{
        const grad = gctx.createRadialGradient(x+ox, y+oy, r*0.2, x+ox, y+oy, r);
        grad.addColorStop(0, 'rgba(70,120,60,0.5)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        gctx.fillStyle = grad;
        gctx.fillRect(x+ox-r, y+oy-r, r*2, r*2);
      });
    }
    gctx.globalCompositeOperation = 'source-over';

    gctx.globalAlpha = 0.45;
    for(let i=0;i<120;i++){
      const x = Math.random()*size;
      const y = Math.random()*size;
      const r = 50 + Math.random()*120;
      drawWrapped(gctx,size,(ox,oy)=>{
        const grad = gctx.createRadialGradient(x+ox, y+oy, r*0.3, x+ox, y+oy, r);
        grad.addColorStop(0, 'rgba(30,50,25,0.35)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        gctx.fillStyle = grad;
        gctx.fillRect(x+ox-r, y+oy-r, r*2, r*2);
      });
    }
    gctx.globalAlpha = 1;

    return ctx.createPattern(can,'repeat');
  }

  function makeWaterPattern(){
    const size = 512;
    const can = document.createElement('canvas');
    can.width = can.height = size;
    const gctx = can.getContext('2d');

    const base = gctx.createLinearGradient(0, 0, 0, size);
    base.addColorStop(0, '#0f2b48');
    base.addColorStop(0.5, '#1f4f7a');
    base.addColorStop(1, '#0d2440');
    gctx.fillStyle = base;
    gctx.fillRect(0,0,size,size);

    const noise = createFractalNoise(size,size,{cellSize:180,octaves:4,persistence:0.65,seed:887});
    const img = gctx.getImageData(0,0,size,size);
    const data = img.data;
    for(let i=0;i<noise.length;i++){
      const n = noise[i];
      const shade = (n-0.5)*110;
      const idx = i*4;
      data[idx] = clamp(data[idx] + shade*0.3,0,255);
      data[idx+1] = clamp(data[idx+1] + shade*0.7,0,255);
      data[idx+2] = clamp(data[idx+2] + shade*1.3,0,255);
    }
    gctx.putImageData(img,0,0);

    gctx.globalAlpha = 0.35;
    gctx.lineWidth = 1.6;
    gctx.strokeStyle = 'rgba(180,220,255,0.4)';
    for(let y=0;y<size;y+=18){
      drawWrapped(gctx,size,(ox,oy)=>{
        gctx.beginPath();
        for(let x=-size;x<=size*2;x+=8){
          const wave = Math.sin((x + y*4) * 0.01) * 6 + Math.cos((x*0.02) + y*0.05) * 3;
          const px = x + ox;
          const py = y + oy + wave;
          if(x===-size) gctx.moveTo(px, py);
          else gctx.lineTo(px, py);
        }
        gctx.stroke();
      });
    }
    gctx.globalAlpha = 1;

    for(let i=0;i<80;i++){
      const x = Math.random()*size;
      const y = Math.random()*size;
      const r = 20 + Math.random()*70;
      drawWrapped(gctx,size,(ox,oy)=>{
        const grad = gctx.createRadialGradient(x+ox, y+oy, 0, x+ox, y+oy, r);
        grad.addColorStop(0, 'rgba(200,240,255,0.35)');
        grad.addColorStop(1, 'rgba(200,240,255,0)');
        gctx.fillStyle = grad;
        gctx.fillRect(x+ox-r, y+oy-r, r*2, r*2);
      });
    }

    return ctx.createPattern(can,'repeat');
  }

  function makeRockPattern(){
    const size = 512;
    const can = document.createElement('canvas');
    can.width = can.height = size;
    const gctx = can.getContext('2d');

    const base = gctx.createLinearGradient(0, 0, size, size);
    base.addColorStop(0, '#4a4948');
    base.addColorStop(0.5, '#5d5c5b');
    base.addColorStop(1, '#3a3a39');
    gctx.fillStyle = base;
    gctx.fillRect(0,0,size,size);

    const noise = createFractalNoise(size,size,{cellSize:150,octaves:5,persistence:0.58,seed:431});
    const img = gctx.getImageData(0,0,size,size);
    const data = img.data;
    for(let i=0;i<noise.length;i++){
      const n = noise[i];
      const shade = (n-0.5)*160;
      const idx = i*4;
      data[idx] = clamp(data[idx] + shade*1.1,0,255);
      data[idx+1] = clamp(data[idx+1] + shade*1.05,0,255);
      data[idx+2] = clamp(data[idx+2] + shade*0.9,0,255);
    }
    gctx.putImageData(img,0,0);

    gctx.globalAlpha = 0.55;
    for(let i=0;i<90;i++){
      const x = Math.random()*size;
      const y = Math.random()*size;
      const r = 40 + Math.random()*120;
      drawWrapped(gctx,size,(ox,oy)=>{
        const grad = gctx.createRadialGradient(x+ox, y+oy, r*0.1, x+ox, y+oy, r);
        grad.addColorStop(0, 'rgba(220,220,220,0.18)');
        grad.addColorStop(1, 'rgba(220,220,220,0)');
        gctx.fillStyle = grad;
        gctx.fillRect(x+ox-r, y+oy-r, r*2, r*2);
      });
    }
    gctx.globalAlpha = 1;

    gctx.lineCap = 'round';
    for(let i=0;i<110;i++){
      const x = Math.random()*size;
      const y = Math.random()*size;
      const len = 30 + Math.random()*130;
      const ang = Math.random()*Math.PI*2;
      const lw = 0.8 + Math.random()*1.6;
      const col = Math.random()<0.5 ? 'rgba(20,20,20,0.35)' : 'rgba(220,220,220,0.22)';
      gctx.strokeStyle = col;
      gctx.lineWidth = lw;
      drawWrapped(gctx,size,(ox,oy)=>{
        gctx.beginPath();
        gctx.moveTo(x+ox, y+oy);
        gctx.lineTo(x+ox + Math.cos(ang)*len, y+oy + Math.sin(ang)*len);
        gctx.stroke();
      });
    }

    return ctx.createPattern(can,'repeat');
  }

  const patterns = { 0:null, 1:null, 2:null, 3:null };

  function loadAllPatterns(then){
    patterns[0] = makeGrassPattern();
    patterns[1] = makeForestPattern();
    patterns[2] = makeWaterPattern();
    patterns[3] = makeRockPattern();
    then();
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
          const tone = 0.7 + Math.random()*0.5;
          const shadow = 0.45 + Math.random()*0.35;
          const lean = (Math.random()-0.5)*0.6;
          const canopy = 0.85 + Math.random()*0.25;
          world.trees.push({x,y,r,tone,shadow,lean,canopy});
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
      enemyAI:{credits:300,incomeTimer:0,buildCooldown:2,unassigned:[],squads:[],groupTimer:5},
      clickFx:[]
    };

    if(unitReadyTimer){ clearTimeout(unitReadyTimer); unitReadyTimer=null; }
    if(unitReadyNotice){
      unitReadyNotice.classList.remove('show');
      unitReadyNotice.textContent='';
    }

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

    // Enemy barracks
    world.buildings.push({
      type:BUILDING_TYPES.BARRACKS, f:F.ENEMY, x:2020, y:280, w:70, h:46,
      hp:260, max:260, queue:[], current:null, timeLeft:0
    });

    // Player squad
    for(let i=0;i<6;i++){ const u=spawn(220+(i%3)*22,MAP_H-120+Math.floor(i/3)*26,F.PLAYER,'rifleman'); u.selected=true; world.selection.add(u); }
    for(let i=0;i<2;i++){ const u=spawn(300+(i*22),MAP_H-120,F.PLAYER,'grenadier'); u.selected=true; world.selection.add(u); }
    updateSelectionHUD();

    // Enemies
    const enemyAI = world.enemyAI;
    for(let i=0;i<8;i++) enemyAI.unassigned.push(spawn(1800+(i%4)*26,320+Math.floor(i/4)*26,F.ENEMY,'rifleman'));
    for(let i=0;i<3;i++) enemyAI.unassigned.push(spawn(1950+(i*26),420,F.ENEMY,'grenadier'));
    for(let i=0;i<6;i++) enemyAI.unassigned.push(spawn(2100+(i%3)*26,900+Math.floor(i/3)*26,F.ENEMY,'rifleman'));

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
      selected:false, wander:Math.random()*6.28,
      spawnGlow:0
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

  function addClickFx(x,y,color,life=0.5){
    world.clickFx.push({x,y,color,age:0,life});
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
      nu.spawnGlow = SPAWN_GLOW_TIME;
      addClickFx(spawnX, spawnY, '#4dd0ff', 1.1);
      showUnitReady(b.current.kind);
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

  function chooseEnemySearchPoint(origin){
    const centroid = playerCentroid();
    let baseX = centroid.x;
    let baseY = Math.max(centroid.y, MAP_H*0.55);
    const offsetX = (Math.random()-0.5)*480;
    const offsetY = (Math.random()-0.4)*360;
    let destX = clamp(baseX + offsetX, 80, MAP_W-80);
    let destY = clamp(baseY + offsetY, MAP_H*0.35, MAP_H-80);
    if(origin && Math.random()<0.3){
      destX = clamp(origin.x + (Math.random()-0.5)*520, 80, MAP_W-80);
      destY = clamp(origin.y + (Math.random()-0.5)*520, MAP_H*0.3, MAP_H-80);
    }
    return {x:destX, y:destY};
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
      if(ai.buildCooldown<=0 && barracks.queue.length < 3){
        const choice = (Math.random() < 0.7) ? 'rifleman' : 'grenadier';
        const cost = choice==='rifleman'?50:100;
        if(ai.credits >= cost){
          ai.credits -= cost;
          const baseTime = choice==='rifleman'?3:4;
          const buildTime = baseTime * 1.4;
          barracks.queue.push({kind:choice, time:buildTime});
          if(!barracks.current) startNextInQueue(barracks);
          ai.buildCooldown = 3 + Math.random()*3;
        } else {
          ai.buildCooldown = 1.5;
        }
      }
    }

    ai.unassigned = ai.unassigned.filter(u => u.hp>0);
    ai.groupTimer += dt;

    if(ai.unassigned.length >= 2 && ai.groupTimer >= 4){
      const maxSize = Math.min(5, ai.unassigned.length);
      const size = Math.floor(Math.random() * (maxSize - 1)) + 2;
      const members = ai.unassigned.splice(0, size);
      ai.squads.push({members, waypoint:null, targetUnit:null, reassign:0});
      ai.groupTimer = 0;
    }

    for(let i=ai.squads.length-1;i>=0;i--){
      const squad = ai.squads[i];
      squad.members = squad.members.filter(u => u.hp>0);
      if(squad.members.length===0){ ai.squads.splice(i,1); continue; }

      const center = squadCenter(squad.members);
      const targetInfo = findClosestPlayerTarget(center);
      if(targetInfo && targetInfo.distance <= 420){
        squad.targetUnit = targetInfo.unit;
        squad.waypoint = null;
        squad.reassign = 0;
        for(const m of squad.members){
          if(m.target !== targetInfo.unit) m.target = targetInfo.unit;
        }
        continue;
      }

      squad.targetUnit = null;
      squad.reassign += dt;

      if(squad.waypoint){
        const dist = Math.hypot(center.x - squad.waypoint.x, center.y - squad.waypoint.y);
        if(dist < 60 || squad.reassign > 12){
          squad.waypoint = null;
        }
      }

      if(!squad.waypoint){
        const dest = chooseEnemySearchPoint(center);
        assignFormationMove(squad.members, dest.x, dest.y);
        squad.waypoint = dest;
        squad.reassign = 0;
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
      if(u.spawnGlow>0){ u.spawnGlow = Math.max(0, u.spawnGlow - dt); }
    }

    // Enemy seek
    for(const u of world.units){
      if(u.f!==F.ENEMY || u.hp<=0) continue;
      if(!u.target || (u.target.hp!==undefined && u.target.hp<=0)){
        let best=null,bd2=Infinity;
        for(const p of world.units){ if(p.f!==F.PLAYER||p.hp<=0) continue;
          const d2=(p.x-u.x)**2+(p.y-u.y)**2;
          if(d2<bd2 && Math.sqrt(d2)<190 && !rifleBlocked(u.x,u.y,p.x,p.y)){ bd2=d2; best=p; } }
        if(best) u.target=best; else { u.wander += (Math.random()-0.5)*0.2; u.x += Math.cos(u.wander)*0.6*60*dt; u.y += Math.sin(u.wander)*0.6*60*dt; }
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
      const tone = t.tone != null ? t.tone : 1;
      const shadow = t.shadow != null ? t.shadow : 0.5;
      const lean = t.lean != null ? t.lean : 0;
      const canopyScale = t.canopy != null ? t.canopy : 0.95;

      const shadowAlpha = clamp(0.32 + shadow*0.25, 0.25, 0.6);
      ctx.fillStyle=`rgba(0,0,0,${shadowAlpha})`;
      ctx.beginPath();
      ctx.ellipse(s.x + t.r*0.25, s.y + t.r*0.55, t.r*1.15, t.r*0.55, 0, 0, Math.PI*2);
      ctx.fill();

      const light = `rgb(${Math.round(70 + 40*tone)}, ${Math.round(130 + 45*tone)}, ${Math.round(70 + 25*tone)})`;
      const mid   = `rgb(${Math.round(45 + 35*tone)}, ${Math.round(105 + 40*tone)}, ${Math.round(55 + 25*tone)})`;
      const dark  = `rgb(${Math.round(22 + 25*tone)}, ${Math.round(65 + 35*tone)}, ${Math.round(35 + 20*tone)})`;

      const canopy = ctx.createRadialGradient(
        s.x - t.r*(0.35 + lean*0.4),
        s.y - t.r*(0.92 + lean*0.15),
        t.r*0.28,
        s.x,
        s.y,
        t.r*1.08
      );
      canopy.addColorStop(0, light);
      canopy.addColorStop(0.45, mid);
      canopy.addColorStop(1, dark);
      ctx.fillStyle = canopy;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y - t.r*0.08, t.r*1.05, t.r*canopyScale, 0, 0, Math.PI*2);
      ctx.fill();

      const highlight = ctx.createRadialGradient(
        s.x - t.r*(0.55 + lean*0.3),
        s.y - t.r*1.25,
        0,
        s.x - t.r*(0.55 + lean*0.3),
        s.y - t.r*1.25,
        t.r*1.3
      );
      highlight.addColorStop(0, 'rgba(255,255,255,0.2)');
      highlight.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = highlight;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y - t.r*0.15, t.r*1.02, t.r*canopyScale*0.92, 0, 0, Math.PI*2);
      ctx.fill();

      ctx.strokeStyle = `rgba(18,45,18,${0.25 + shadow*0.25})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y - t.r*0.08, t.r*1.04, t.r*canopyScale*0.95, 0, 0, Math.PI*2);
      ctx.stroke();

      const trunkHeight = t.r*(0.85 + shadow*0.2);
      const trunkGrad = ctx.createLinearGradient(
        s.x - 2.4,
        s.y + t.r*0.18,
        s.x + 2.4,
        s.y + t.r*0.18 + trunkHeight
      );
      trunkGrad.addColorStop(0, '#2b1a0f');
      trunkGrad.addColorStop(0.45, '#654223');
      trunkGrad.addColorStop(1, '#1f140b');
      ctx.fillStyle = trunkGrad;
      ctx.beginPath();
      ctx.moveTo(s.x - 2.2, s.y + t.r*0.18);
      ctx.lineTo(s.x + 2.2, s.y + t.r*0.18);
      ctx.lineTo(s.x + 1.5, s.y + t.r*0.18 + trunkHeight);
      ctx.lineTo(s.x - 1.5, s.y + t.r*0.18 + trunkHeight);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.moveTo(s.x - 1, s.y + t.r*0.26);
      ctx.lineTo(s.x - 0.2, s.y + t.r*0.26);
      ctx.lineTo(s.x - 0.8, s.y + t.r*0.26 + trunkHeight*0.6);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawBarracks(b){
    const isPlayer = b.f===F.PLAYER;
    const s=worldToScreen(b.x,b.y);
    const x=s.x, y=s.y, w=b.w, h=b.h;
    if(x<-w||y<-h||x>VIEW_W||y>VIEW_H) return;

    ctx.fillStyle='rgba(0,0,0,.35)'; ctx.fillRect(x+3,y+3,w,h);
    ctx.fillStyle = isPlayer ? '#4a8bd3' : '#d34a4a';
    roundRect(x,y,w,h,6,true,false);
    ctx.fillStyle = isPlayer ? '#2d4a6b' : '#6b2d2d';
    roundRect(x+4,y+4,w-8,14,4,true,false);
    ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(x+8,y+6,12,3); ctx.fillRect(x+w-20,y+6,12,3);
    ctx.fillStyle = '#0e121d'; ctx.fillRect(x+w/2-6,y+h-16,12,16);
    ctx.fillStyle = isPlayer ? '#3bd1ff' : '#ff6666';
    ctx.fillRect(x+6,y-8,2,8); ctx.beginPath(); ctx.moveTo(x+8,y-8); ctx.lineTo(x+22,y-3); ctx.lineTo(x+8,y+2); ctx.closePath(); ctx.fill();

    ctx.fillStyle='#0e121d'; ctx.fillRect(x,y-10,w,4);
    ctx.fillStyle='#36d399'; ctx.fillRect(x,y-10,w*(b.hp/b.max),4);

    if(b.current){
      const total = b.current.time; const prog = Math.max(0,1 - b.timeLeft/total);
      ctx.fillStyle='#36d399'; ctx.fillRect(x,y-16,w*prog,4);
    }
    if(b.queue.length>0){
      ctx.fillStyle='#ffffff'; ctx.font='12px system-ui';
      ctx.fillText(`Queue: ${b.queue.length}`, x, y-20);
    }
  }

  function roundRect(x,y,w,h,r,fill,stroke){
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
    if(fill) ctx.fill(); if(stroke) ctx.stroke();
  }

  function drawBuildings(){ for(const b of world.buildings){ drawBarracks(b); } }

  // Animated soldier
  function drawSoldier(u){
    const s=worldToScreen(u.x,u.y);
    if(s.x<-30||s.y<-30||s.x>VIEW_W+30||s.y>VIEW_H+30) return;

    if(u.spawnGlow>0){
      const ratio = clamp(u.spawnGlow / SPAWN_GLOW_TIME, 0, 1);
      ctx.save();
      ctx.translate(s.x,s.y);
      const ringRadius = u.r + 10 + (1 - ratio) * 6;
      ctx.globalAlpha = 0.35 + 0.45 * ratio;
      ctx.fillStyle = `rgba(77,208,255,${0.12 + 0.18*ratio})`;
      ctx.beginPath(); ctx.arc(0,0, ringRadius + 4, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = '#4dd0ff';
      ctx.lineWidth = 2 + (1 - ratio) * 2;
      ctx.beginPath(); ctx.arc(0,0, ringRadius, 0, Math.PI*2); ctx.stroke();
      ctx.restore();
    }

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
  function showUnitReady(kind){
    if(!unitReadyNotice) return;
    const pretty = kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : 'Unit';
    unitReadyNotice.textContent = `Unit ready: ${pretty}`;
    unitReadyNotice.classList.add('show');
    if(unitReadyTimer) clearTimeout(unitReadyTimer);
    unitReadyTimer = setTimeout(()=>{
      unitReadyNotice.classList.remove('show');
      unitReadyTimer=null;
    }, 1800);
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
