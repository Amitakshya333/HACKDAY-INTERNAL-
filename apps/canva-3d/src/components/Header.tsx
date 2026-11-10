import React from 'react';
import {
  Box,
  Move,
  RotateCw,
  Maximize2,
  Play,
  Pause,
  Download,
  Sparkles,
  Camera,
  Grid,
  Sun,
  Layers,
  Cpu,
} from 'lucide-react';
import { StudioTheme, TransformMode } from '../types';

interface HeaderProps {
  transformMode: TransformMode;
  onSetTransformMode: (mode: TransformMode) => void;
  studioTheme: StudioTheme;
  onSetStudioTheme: (theme: StudioTheme) => void;
  isAnimating: boolean;
  onToggleAnimate: () => void;
  isGridVisible: boolean;
  onToggleGrid: () => void;
  onSetCameraView: (view: 'iso' | 'front' | 'top') => void;
  onOpenExport: () => void;
  onToggleLayers: () => void;
  isLayersOpen: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  transformMode,
  onSetTransformMode,
  studioTheme,
  onSetStudioTheme,
  isAnimating,
  onToggleAnimate,
  isGridVisible,
  onToggleGrid,
  onSetCameraView,
  onOpenExport,
  onToggleLayers,
  isLayersOpen,
}) => {
  return (
    <header className="h-14 border-b border-white/10 bg-[#121524]/90 backdrop-blur-md px-4 flex items-center justify-between z-30 select-none">
      {/* Brand */}
      <div className="flex items-center space-x-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-violet-600 via-fuchsia-500 to-pink-500 flex items-center justify-center shadow-lg shadow-violet-500/25">
          <Box className="w-5 h-5 text-white animate-pulse" />
        </div>
        <div>
          <div className="flex items-center space-x-2">
            <span className="font-extrabold text-base tracking-tight bg-gradient-to-r from-white via-violet-200 to-pink-300 bg-clip-text text-transparent">
              Canva 3D
            </span>
            <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">
              Studio
            </span>
          </div>
          <p className="text-[10px] text-slate-400 flex items-center space-x-1">
            <Cpu className="w-3 h-3 text-cyan-400 inline" />
            <span>Autonomous Gemma Swarm Engine</span>
          </p>
        </div>
      </div>

      {/* Center Tool Pills */}
      <div className="flex items-center space-x-2">
        {/* Transform Mode Switcher */}
        <div className="flex items-center bg-[#1c2136] p-1 rounded-lg border border-white/5 shadow-inner">
          <button
            onClick={() => onSetTransformMode('translate')}
            title="Translate Gizmo (W)"
            className={`p-1.5 rounded-md text-xs flex items-center space-x-1 transition-all ${
              transformMode === 'translate'
                ? 'bg-violet-600 text-white shadow-md shadow-violet-600/30'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Move className="w-3.5 h-3.5" />
            <span className="hidden sm:inline font-medium">Move</span>
          </button>
          <button
            onClick={() => onSetTransformMode('rotate')}
            title="Rotate Gizmo (E)"
            className={`p-1.5 rounded-md text-xs flex items-center space-x-1 transition-all ${
              transformMode === 'rotate'
                ? 'bg-violet-600 text-white shadow-md shadow-violet-600/30'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline font-medium">Rotate</span>
          </button>
          <button
            onClick={() => onSetTransformMode('scale')}
            title="Scale Gizmo (R)"
            className={`p-1.5 rounded-md text-xs flex items-center space-x-1 transition-all ${
              transformMode === 'scale'
                ? 'bg-violet-600 text-white shadow-md shadow-violet-600/30'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline font-medium">Scale</span>
          </button>
        </div>

        {/* Camera Views */}
        <div className="hidden md:flex items-center bg-[#1c2136] p-1 rounded-lg border border-white/5">
          <span className="text-[11px] text-slate-400 px-2 flex items-center space-x-1">
            <Camera className="w-3 h-3 text-violet-400" />
            <span>Cam:</span>
          </span>
          <button
            onClick={() => onSetCameraView('iso')}
            className="px-2 py-1 text-xs text-slate-300 hover:text-white hover:bg-white/5 rounded"
          >
            Iso
          </button>
          <button
            onClick={() => onSetCameraView('front')}
            className="px-2 py-1 text-xs text-slate-300 hover:text-white hover:bg-white/5 rounded"
          >
            Front
          </button>
          <button
            onClick={() => onSetCameraView('top')}
            className="px-2 py-1 text-xs text-slate-300 hover:text-white hover:bg-white/5 rounded"
          >
            Top
          </button>
        </div>

        {/* Toggles */}
        <div className="flex items-center space-x-1 bg-[#1c2136] p-1 rounded-lg border border-white/5">
          <button
            onClick={onToggleAnimate}
            title={isAnimating ? 'Pause Floating Animation' : 'Float & Animate Scene'}
            className={`p-1.5 rounded-md transition-all ${
              isAnimating
                ? 'bg-pink-500/20 text-pink-400 border border-pink-500/40'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {isAnimating ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onToggleGrid}
            title="Toggle Ground Grid"
            className={`p-1.5 rounded-md transition-all ${
              isGridVisible ? 'text-violet-400' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onToggleLayers}
            title="Scene Layers"
            className={`p-1.5 rounded-md transition-all ${
              isLayersOpen ? 'bg-violet-600/30 text-violet-300' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Right Controls: Studio Theme & Export */}
      <div className="flex items-center space-x-3">
        {/* Theme Selector */}
        <div className="hidden lg:flex items-center space-x-1.5 bg-[#1c2136] px-2 py-1 rounded-lg border border-white/5 text-xs text-slate-300">
          <Sun className="w-3.5 h-3.5 text-amber-400" />
          <select
            value={studioTheme}
            onChange={(e) => onSetStudioTheme(e.target.value as StudioTheme)}
            className="bg-transparent text-slate-200 outline-none cursor-pointer text-xs"
          >
            <option value="cyberpunk" className="bg-[#121524]">Cyberpunk Neon</option>
            <option value="studio" className="bg-[#121524]">Studio Minimal</option>
            <option value="sunset" className="bg-[#121524]">Sunset Glow</option>
            <option value="void" className="bg-[#121524]">Deep Void</option>
            <option value="pastel" className="bg-[#121524]">Pastel Dream</option>
          </select>
        </div>

        {/* Export Button */}
        <button
          onClick={onOpenExport}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 text-white shadow-lg shadow-violet-600/30 transition-all active:scale-95"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export 3D</span>
        </button>
      </div>
    </header>
  );
};
