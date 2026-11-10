import React, { useState } from 'react';
import { Download, Camera, Code2, X, Check, Sparkles, Box } from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExportGLTF: (filename: string) => void;
  onCaptureScreenshot: () => string;
  sceneObjectsCount: number;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  onExportGLTF,
  onCaptureScreenshot,
  sceneObjectsCount,
}) => {
  const [copied, setCopied] = useState(false);
  const [filename, setFilename] = useState('my-canva-3d-scene');

  if (!isOpen) return null;

  const handleDownloadPNG = () => {
    const dataUrl = onCaptureScreenshot();
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${filename}.png`;
    link.click();
  };

  const handleDownloadGLB = () => {
    onExportGLTF(`${filename}.glb`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-[#161a2e] border border-violet-500/30 rounded-2xl shadow-2xl p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center space-x-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-violet-600 to-pink-500 flex items-center justify-center text-white shadow-lg shadow-violet-500/25">
            <Download className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-100">Export 3D Artwork</h3>
            <p className="text-xs text-slate-400">{sceneObjectsCount} mesh elements active in scene</p>
          </div>
        </div>

        {/* File name input */}
        <div className="mb-5 space-y-1">
          <label className="text-[11px] font-semibold text-slate-300">File Name</label>
          <input
            type="text"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            className="w-full bg-[#1e233d] border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-violet-500"
          />
        </div>

        {/* Export Options Cards */}
        <div className="space-y-3 mb-6">
          {/* GLTF / GLB */}
          <div
            onClick={handleDownloadGLB}
            className="group p-3.5 rounded-xl bg-[#1d223b] border border-white/5 hover:border-violet-500/60 hover:bg-[#232947] cursor-pointer transition-all flex items-center justify-between shadow-sm hover:shadow-lg hover:shadow-violet-600/10"
          >
            <div className="flex items-center space-x-3">
              <div className="w-9 h-9 rounded-lg bg-violet-600/20 text-violet-400 flex items-center justify-center border border-violet-500/30">
                <Box className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-100 group-hover:text-violet-300">
                  Export Binary .GLB (3D Model)
                </h4>
                <p className="text-[10px] text-slate-400">Blender, Unity, Unreal, Vision Pro, WebGL</p>
              </div>
            </div>
            <Download className="w-4 h-4 text-slate-400 group-hover:text-violet-400" />
          </div>

          {/* High Res PNG */}
          <div
            onClick={handleDownloadPNG}
            className="group p-3.5 rounded-xl bg-[#1d223b] border border-white/5 hover:border-pink-500/60 hover:bg-[#232947] cursor-pointer transition-all flex items-center justify-between shadow-sm hover:shadow-lg hover:shadow-pink-600/10"
          >
            <div className="flex items-center space-x-3">
              <div className="w-9 h-9 rounded-lg bg-pink-600/20 text-pink-400 flex items-center justify-center border border-pink-500/30">
                <Camera className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-100 group-hover:text-pink-300">
                  High-Res Studio Snapshot (PNG)
                </h4>
                <p className="text-[10px] text-slate-400">Crisp 4K canvas snapshot with lights & shadows</p>
              </div>
            </div>
            <Download className="w-4 h-4 text-slate-400 group-hover:text-pink-400" />
          </div>
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-white/5 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
