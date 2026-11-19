/**
 * Define Block Data Structure and Types
 * Part of goal: "Create a mini Minecraft-inspired game."
 * Agent: ignite-worker-1
 */

export class DefineBlockDataStructureAndTypes {
  constructor(options = {}) {
    this.name = 'Define Block Data Structure and Types';
    this.goal = 'Create a mini Minecraft-inspired game.';
    this.options = options;
    this.status = 'initialized';
    this.state = new Map();
  }

  initialize() {
    this.status = 'active';
    return { success: true, timestamp: Date.now() };
  }

  execute(action, payload = {}) {
    const key = String(action || 'default');
    this.state.set(key, { payload, time: Date.now() });
    return {
      action: key,
      status: 'executed',
      data: payload,
      stateSize: this.state.size
    };
  }

  getState(key) {
    return this.state.get(key) || null;
  }
}

export function createInstance(opts) {
  return new DefineBlockDataStructureAndTypes(opts);
}

// ── Interactive Mini Minecraft 3D Voxel Engine ──
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    const displayArea = document.getElementById('display-area');
    const controlsArea = document.getElementById('controls-area');
    if (!displayArea) return;

    displayArea.innerHTML = '';
    displayArea.style.position = 'relative';
    displayArea.style.overflow = 'hidden';
    displayArea.style.minHeight = '480px';
    displayArea.style.backgroundColor = '#0b0f19';
    displayArea.style.borderRadius = '8px';

    const canvas = document.createElement('canvas');
    canvas.width = displayArea.clientWidth || 900;
    canvas.height = 480;
    canvas.style.display = 'block';
    canvas.style.cursor = 'crosshair';
    displayArea.appendChild(canvas);

    const ctx = canvas.getContext('2d');

    // Block Definitions
    const BLOCK_TYPES = {
      grass:   { id: 'grass', name: 'Grass', top: '#4ade80', side1: '#15803d', side2: '#166534' },
      dirt:    { id: 'dirt', name: 'Dirt', top: '#854d0e', side1: '#713f12', side2: '#582d08' },
      stone:   { id: 'stone', name: 'Stone', top: '#94a3b8', side1: '#64748b', side2: '#475569' },
      wood:    { id: 'wood', name: 'Wood', top: '#b45309', side1: '#92400e', side2: '#78350f' },
      leaves:  { id: 'leaves', name: 'Leaves', top: '#22c55e', side1: '#16a34a', side2: '#15803d' },
      water:   { id: 'water', name: 'Water', top: 'rgba(56,189,248,0.8)', side1: 'rgba(14,165,233,0.8)', side2: 'rgba(2,132,199,0.8)' },
      diamond: { id: 'diamond', name: 'Diamond', top: '#38bdf8', side1: '#0284c7', side2: '#0369a1' },
      gold:    { id: 'gold', name: 'Gold', top: '#fbbf24', side1: '#d97706', side2: '#b45309' },
    };

    let selectedType = 'grass';
    const WORLD_SIZE = 14;
    const blocks = new Map();

    const blockKey = (x, y, z) => `${x},${y},${z}`;

    // Procedural terrain generation
    for (let x = -WORLD_SIZE / 2; x < WORLD_SIZE / 2; x++) {
      for (let z = -WORLD_SIZE / 2; z < WORLD_SIZE / 2; z++) {
        const dist = Math.sqrt(x * x + z * z);
        const height = Math.floor(2 + Math.sin(x * 0.4) * 1.5 + Math.cos(z * 0.4) * 1.5);
        for (let y = 0; y <= height; y++) {
          let type = 'stone';
          if (y === height) type = dist < 2 && height <= 1 ? 'water' : 'grass';
          else if (y >= height - 1) type = 'dirt';
          blocks.set(blockKey(x, y, z), { x, y, z, type });
        }
      }
    }

    // Add trees
    const plantTree = (tx, ty, tz) => {
      for (let h = 1; h <= 3; h++) blocks.set(blockKey(tx, ty + h, tz), { x: tx, y: ty + h, z: tz, type: 'wood' });
      for (let lx = -1; lx <= 1; lx++) {
        for (let lz = -1; lz <= 1; lz++) {
          for (let ly = 3; ly <= 4; ly++) {
            if (lx === 0 && lz === 0 && ly === 3) continue;
            blocks.set(blockKey(tx + lx, ty + ly, tz + lz), { x: tx + lx, y: ty + ly, z: tz + lz, type: 'leaves' });
          }
        }
      }
      blocks.set(blockKey(tx, ty + 5, tz), { x: tx, y: ty + 5, z: tz, type: 'leaves' });
    };

    plantTree(2, 3, 2);
    plantTree(-3, 2, -3);

    // Camera State
    let angle = Math.PI / 4;
    let pitch = 0.55;
    let zoom = 24;
    let isDragging = false;
    let lastMouseX = 0;
    let lastMouseY = 0;

    const project = (x, y, z) => {
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const rx = x * cosA - z * sinA;
      const rz = x * sinA + z * cosA;

      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);
      const ry = y * cosP - rz * sinP;
      const depth = y * sinP + rz * cosP;

      const screenX = canvas.width / 2 + rx * zoom;
      const screenY = canvas.height / 2 - ry * zoom;
      return { x: screenX, y: screenY, depth };
    };

    const drawCube = (x, y, z, type) => {
      const def = BLOCK_TYPES[type] || BLOCK_TYPES.stone;
      const s = 0.5;
      const p = [
        project(x - s, y - s, z - s), project(x + s, y - s, z - s),
        project(x + s, y + s, z - s), project(x - s, y + s, z - s),
        project(x - s, y - s, z + s), project(x + s, y - s, z + s),
        project(x + s, y + s, z + s), project(x - s, y + s, z + s)
      ];

      // Draw Top Face
      ctx.fillStyle = def.top;
      ctx.beginPath();
      ctx.moveTo(p[3].x, p[3].y);
      ctx.lineTo(p[2].x, p[2].y);
      ctx.lineTo(p[6].x, p[6].y);
      ctx.lineTo(p[7].x, p[7].y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.stroke();

      // Right Side
      ctx.fillStyle = def.side1;
      ctx.beginPath();
      ctx.moveTo(p[2].x, p[2].y);
      ctx.lineTo(p[1].x, p[1].y);
      ctx.lineTo(p[5].x, p[5].y);
      ctx.lineTo(p[6].x, p[6].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Left Side
      ctx.fillStyle = def.side2;
      ctx.beginPath();
      ctx.moveTo(p[7].x, p[7].y);
      ctx.lineTo(p[6].x, p[6].y);
      ctx.lineTo(p[5].x, p[5].y);
      ctx.lineTo(p[4].x, p[4].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Sky Gradient
      const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      grad.addColorStop(0, '#0f172a');
      grad.addColorStop(1, '#1e293b');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Sort blocks back to front (painter's algorithm)
      const list = Array.from(blocks.values()).map(b => ({
        ...b,
        depth: (b.x * Math.sin(angle) + b.z * Math.cos(angle)) * Math.cos(pitch) + b.y * Math.sin(pitch)
      }));
      list.sort((a, b) => a.depth - b.depth);

      for (const b of list) drawCube(b.x, b.y, b.z, b.type);

      // HUD Overlay
      ctx.fillStyle = '#38bdf8';
      ctx.font = '13px JetBrains Mono, monospace';
      ctx.fillText(`Blocks: ${blocks.size} | Orbit: Drag Mouse | Zoom: Scroll`, 16, 28);
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`Selected: ${BLOCK_TYPES[selectedType].name.toUpperCase()} (Click to Place, Right-Click to Mine)`, 16, 48);
    };

    // User Interactions
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0 && !e.shiftKey) {
        isDragging = true;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
      } else if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
        // Mine / Remove top block near center
        const keys = Array.from(blocks.keys());
        if (keys.length > 0) {
          const lastKey = keys[keys.length - 1];
          blocks.delete(lastKey);
          render();
        }
      }
    });

    window.addEventListener('mouseup', () => { isDragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - lastMouseX;
      const dy = e.clientY - lastMouseY;
      angle += dx * 0.01;
      pitch = Math.max(0.2, Math.min(1.2, pitch + dy * 0.01));
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      render();
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoom = Math.max(12, Math.min(48, zoom - e.deltaY * 0.03));
      render();
    }, { passive: false });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // Place block at random top coordinate
      const rx = Math.floor(Math.random() * 6) - 3;
      const rz = Math.floor(Math.random() * 6) - 3;
      let topY = 0;
      for (const b of blocks.values()) {
        if (b.x === rx && b.z === rz && b.y >= topY) topY = b.y + 1;
      }
      blocks.set(blockKey(rx, topY, rz), { x: rx, y: topY, z: rz, type: selectedType });
      render();
    });

    // Hotbar Controls
    if (controlsArea) {
      controlsArea.innerHTML = '';
      controlsArea.style.display = 'flex';
      controlsArea.style.gap = '8px';
      controlsArea.style.flexWrap = 'wrap';
      controlsArea.style.marginTop = '12px';

      for (const [key, bDef] of Object.entries(BLOCK_TYPES)) {
        const btn = document.createElement('button');
        btn.textContent = bDef.name;
        btn.style.padding = '8px 14px';
        btn.style.borderRadius = '6px';
        btn.style.border = key === selectedType ? '2px solid #38bdf8' : '1px solid #334155';
        btn.style.backgroundColor = key === selectedType ? '#1e293b' : '#0f172a';
        btn.style.color = bDef.top;
        btn.style.fontWeight = 'bold';
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', () => {
          selectedType = key;
          Array.from(controlsArea.children).forEach(c => c.style.border = '1px solid #334155');
          btn.style.border = '2px solid #38bdf8';
          render();
        });
        controlsArea.appendChild(btn);
      }
    }

    render();
  });
}
