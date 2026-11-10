import React from 'react';
import {
  Sliders,
  Palette,
  Eye,
  Trash2,
  Copy,
  Layers,
  Sparkles,
  Maximize2,
  Move,
  RotateCw,
  Lock,
  Unlock,
} from 'lucide-react';
import { MaterialProperties, SceneObjectData } from '../types';

interface InspectorProps {
  selectedObject: SceneObjectData | null;
  onUpdateMaterial: (id: string, props: Partial<MaterialProperties>) => void;
  onUpdateTransform: (
    id: string,
    transform: { position?: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] }
  ) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleLock: (id: string) => void;
}

const QUICK_COLORS = [
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#ffffff', // White
  '#ffd700', // Gold
  '#18181b', // Obsidian
];

export const Inspector: React.FC<InspectorProps> = ({
  selectedObject,
  onUpdateMaterial,
  onUpdateTransform,
  onDuplicate,
  onDelete,
  onToggleLock,
}) => {
  if (!selectedObject) {
    return (
      <aside className="w-80 h-[calc(100vh-3.5rem)] bg-[#121524]/95 border-l border-white/10 p-6 flex flex-col items-center justify-center text-center z-20 select-none backdrop-blur-md">
        <div className="w-14 h-14 rounded-2xl bg-[#1c2136] flex items-center justify-center text-slate-500 mb-4 border border-white/5">
          <Sliders className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-slate-300 mb-1">No Object Selected</h3>
        <p className="text-xs text-slate-400 max-w-[200px]">
          Click any 3D element in the viewport or add a new one from the sidebar dock to adjust its parameters.
        </p>
      </aside>
    );
  }

  const { id, name, type, position, rotation, scale, material, locked } = selectedObject;

  return (
    <aside className="w-80 h-[calc(100vh-3.5rem)] bg-[#121524]/95 border-l border-white/10 flex flex-col z-20 select-none backdrop-blur-md">
      {/* Header */}
      <div className="p-4 border-b border-white/5 bg-[#171b2e]/60 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="w-2.5 h-2.5 rounded-full bg-violet-500" />
          <div>
            <h3 className="text-xs font-bold text-slate-100 truncate max-w-[150px]">{name}</h3>
            <span className="text-[10px] text-violet-400 font-mono capitalize">{type}</span>
          </div>
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={() => onToggleLock(id)}
            title={locked ? 'Unlock Object' : 'Lock Object'}
            className={`p-1.5 rounded-md text-xs transition-all ${
              locked ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:text-white'
            }`}
          >
            {locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => onDuplicate(id)}
            title="Duplicate (Ctrl+D)"
            className="p-1.5 rounded-md text-xs text-slate-400 hover:text-white hover:bg-white/5"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDelete(id)}
            title="Delete (Del)"
            className="p-1.5 rounded-md text-xs text-red-400 hover:bg-red-500/20 hover:text-red-300"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Color & Material Section */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-1.5">
              <Palette className="w-3.5 h-3.5 text-violet-400" />
              <span>Base Color</span>
            </span>
            <div className="flex items-center space-x-2">
              <span className="text-[11px] font-mono text-slate-400 uppercase">{material.color}</span>
              <input
                type="color"
                value={material.color}
                onChange={(e) => onUpdateMaterial(id, { color: e.target.value })}
                className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
              />
            </div>
          </div>

          {/* Quick Swatches */}
          <div className="flex items-center space-x-1.5">
            {QUICK_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => onUpdateMaterial(id, { color })}
                style={{ backgroundColor: color }}
                className={`w-6 h-6 rounded-full border border-white/20 transition-transform hover:scale-110 active:scale-95 ${
                  material.color.toLowerCase() === color.toLowerCase() ? 'ring-2 ring-violet-400' : ''
                }`}
              />
            ))}
          </div>
        </section>

        {/* PBR Parameters */}
        <section className="space-y-3 pt-3 border-t border-white/5">
          <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-1.5">
            <Sparkles className="w-3.5 h-3.5 text-pink-400" />
            <span>PBR Surface Finish</span>
          </span>

          {/* Roughness */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>Roughness</span>
              <span className="font-mono text-slate-200">{(material.roughness * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={material.roughness}
              onChange={(e) => onUpdateMaterial(id, { roughness: parseFloat(e.target.value) })}
              className="w-full accent-violet-500 h-1.5 bg-[#252b45] rounded-lg cursor-pointer"
            />
          </div>

          {/* Metalness */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>Metalness</span>
              <span className="font-mono text-slate-200">{(material.metalness * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={material.metalness}
              onChange={(e) => onUpdateMaterial(id, { metalness: parseFloat(e.target.value) })}
              className="w-full accent-violet-500 h-1.5 bg-[#252b45] rounded-lg cursor-pointer"
            />
          </div>

          {/* Glass Transmission */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>Glass Transmission</span>
              <span className="font-mono text-slate-200">{(material.transmission * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={material.transmission}
              onChange={(e) => onUpdateMaterial(id, { transmission: parseFloat(e.target.value) })}
              className="w-full accent-cyan-400 h-1.5 bg-[#252b45] rounded-lg cursor-pointer"
            />
          </div>

          {/* Emissive Glow */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>Emissive Glow</span>
              <span className="font-mono text-slate-200">{(material.emissiveIntensity * 100).toFixed(0)}%</span>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="color"
                value={material.emissive}
                onChange={(e) => onUpdateMaterial(id, { emissive: e.target.value })}
                className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
              />
              <input
                type="range"
                min="0"
                max="3"
                step="0.05"
                value={material.emissiveIntensity}
                onChange={(e) => onUpdateMaterial(id, { emissiveIntensity: parseFloat(e.target.value) })}
                className="flex-1 accent-pink-500 h-1.5 bg-[#252b45] rounded-lg cursor-pointer"
              />
            </div>
          </div>

          {/* Wireframe Toggle */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-slate-400">Wireframe Mesh</span>
            <button
              onClick={() => onUpdateMaterial(id, { wireframe: !material.wireframe })}
              className={`w-10 h-5 rounded-full p-0.5 transition-colors ${
                material.wireframe ? 'bg-violet-600' : 'bg-[#252b45]'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white transition-transform ${
                  material.wireframe ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </section>

        {/* Transform Coordinates Section */}
        <section className="space-y-3 pt-3 border-t border-white/5">
          <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-1.5">
            <Move className="w-3.5 h-3.5 text-violet-400" />
            <span>Transform Coordinates</span>
          </span>

          {/* Position */}
          <div className="space-y-1.5">
            <span className="text-[10px] text-slate-400 font-semibold">Position (X, Y, Z)</span>
            <div className="grid grid-cols-3 gap-1.5">
              {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                <div key={axis} className="flex items-center bg-[#1c2136] px-2 py-1 rounded border border-white/5">
                  <span className="text-[10px] text-slate-500 font-bold mr-1">{axis}</span>
                  <input
                    type="number"
                    step="0.1"
                    value={position[i].toFixed(1)}
                    onChange={(e) => {
                      const newPos = [...position] as [number, number, number];
                      newPos[i] = parseFloat(e.target.value) || 0;
                      onUpdateTransform(id, { position: newPos });
                    }}
                    className="w-full bg-transparent text-xs text-slate-200 outline-none text-right font-mono"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Rotation */}
          <div className="space-y-1.5">
            <span className="text-[10px] text-slate-400 font-semibold">Rotation (Deg)</span>
            <div className="grid grid-cols-3 gap-1.5">
              {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                <div key={axis} className="flex items-center bg-[#1c2136] px-2 py-1 rounded border border-white/5">
                  <span className="text-[10px] text-slate-500 font-bold mr-1">{axis}</span>
                  <input
                    type="number"
                    step="5"
                    value={rotation[i].toFixed(0)}
                    onChange={(e) => {
                      const newRot = [...rotation] as [number, number, number];
                      newRot[i] = parseFloat(e.target.value) || 0;
                      onUpdateTransform(id, { rotation: newRot });
                    }}
                    className="w-full bg-transparent text-xs text-slate-200 outline-none text-right font-mono"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Scale */}
          <div className="space-y-1.5">
            <span className="text-[10px] text-slate-400 font-semibold">Scale</span>
            <div className="grid grid-cols-3 gap-1.5">
              {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                <div key={axis} className="flex items-center bg-[#1c2136] px-2 py-1 rounded border border-white/5">
                  <span className="text-[10px] text-slate-500 font-bold mr-1">{axis}</span>
                  <input
                    type="number"
                    step="0.1"
                    value={scale[i].toFixed(1)}
                    onChange={(e) => {
                      const newScale = [...scale] as [number, number, number];
                      newScale[i] = Math.max(0.1, parseFloat(e.target.value) || 1);
                      onUpdateTransform(id, { scale: newScale });
                    }}
                    className="w-full bg-transparent text-xs text-slate-200 outline-none text-right font-mono"
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Quick Reset Footer */}
      <div className="p-3 border-t border-white/5 bg-[#171b2e]/60 flex items-center justify-between">
        <button
          onClick={() =>
            onUpdateTransform(id, {
              position: [0, 0.8, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
            })
          }
          className="w-full py-1.5 text-xs text-slate-300 hover:text-white bg-[#222842] hover:bg-[#2b3354] rounded-lg transition-colors font-medium"
        >
          Reset to Origin
        </button>
      </div>
    </aside>
  );
};
