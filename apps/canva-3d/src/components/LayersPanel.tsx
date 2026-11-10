import React from 'react';
import { Eye, EyeOff, Lock, Unlock, Trash2, Copy, Layers, X, Box } from 'lucide-react';
import { SceneObjectData } from '../types';

interface LayersPanelProps {
  isOpen: boolean;
  onClose: () => void;
  objects: SceneObjectData[];
  selectedObjectId: string | null;
  onSelectObject: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onToggleLock: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

export const LayersPanel: React.FC<LayersPanelProps> = ({
  isOpen,
  onClose,
  objects,
  selectedObjectId,
  onSelectObject,
  onToggleVisibility,
  onToggleLock,
  onDuplicate,
  onDelete,
}) => {
  if (!isOpen) return null;

  return (
    <div className="absolute top-16 right-84 w-72 max-h-[500px] bg-[#15192c]/95 border border-white/10 rounded-2xl shadow-2xl backdrop-blur-xl z-20 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
      <div className="p-3 border-b border-white/5 flex items-center justify-between bg-[#1a1f36]/70">
        <div className="flex items-center space-x-2">
          <Layers className="w-4 h-4 text-violet-400" />
          <h3 className="text-xs font-bold text-slate-200">Scene Hierarchy ({objects.length})</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/10"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {objects.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-500">
            No objects in the scene. Drag elements to start!
          </div>
        ) : (
          objects.map((obj) => {
            const isSelected = selectedObjectId === obj.id;
            return (
              <div
                key={obj.id}
                onClick={() => onSelectObject(obj.id)}
                className={`flex items-center justify-between p-2 rounded-xl text-xs cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-violet-600/30 border border-violet-500/50 text-white'
                    : 'hover:bg-white/5 text-slate-300'
                }`}
              >
                <div className="flex items-center space-x-2 truncate">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: obj.material.color }}
                  />
                  <span className="font-medium truncate">{obj.name}</span>
                </div>

                <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => onToggleVisibility(obj.id)}
                    className="p-1 text-slate-400 hover:text-white rounded"
                    title={obj.visible ? 'Hide' : 'Show'}
                  >
                    {obj.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-slate-600" />}
                  </button>
                  <button
                    onClick={() => onToggleLock(obj.id)}
                    className="p-1 text-slate-400 hover:text-white rounded"
                    title={obj.locked ? 'Unlock' : 'Lock'}
                  >
                    {obj.locked ? <Lock className="w-3.5 h-3.5 text-amber-400" /> : <Unlock className="w-3.5 h-3.5 text-slate-500" />}
                  </button>
                  <button
                    onClick={() => onDuplicate(obj.id)}
                    className="p-1 text-slate-400 hover:text-white rounded"
                    title="Duplicate"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDelete(obj.id)}
                    className="p-1 text-red-400 hover:text-red-300 rounded"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
