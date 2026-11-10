import React, { useEffect, useRef, useState } from 'react';
import { ThreeSceneManager } from './engine/ThreeScene';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { Viewport } from './components/Viewport';
import { Inspector } from './components/Inspector';
import { FloatingToolbar } from './components/FloatingToolbar';
import { LayersPanel } from './components/LayersPanel';
import { ExportModal } from './components/ExportModal';
import { MaterialPreset, MaterialProperties, SceneObjectData, ShapeType, StudioTheme, TransformMode } from './types';

export const App: React.FC = () => {
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const sceneManagerRef = useRef<ThreeSceneManager | null>(null);

  const [objects, setObjects] = useState<SceneObjectData[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [selectedObject, setSelectedObject] = useState<SceneObjectData | null>(null);

  const [transformMode, setTransformMode] = useState<TransformMode>('translate');
  const [studioTheme, setStudioTheme] = useState<StudioTheme>('cyberpunk');
  const [isAnimating, setIsAnimating] = useState(false);
  const [isGridVisible, setIsGridVisible] = useState(true);
  const [isLayersOpen, setIsLayersOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);

  // Initialize Scene
  useEffect(() => {
    if (!canvasContainerRef.current) return;

    const manager = new ThreeSceneManager(canvasContainerRef.current);
    sceneManagerRef.current = manager;

    manager.onSelectObject = (id, data) => {
      setSelectedObjectId(id);
      setSelectedObject(data || null);
    };

    manager.onTransformChange = (id, data) => {
      setSelectedObject((prev) => (prev && prev.id === id ? { ...prev, ...data } : prev));
    };

    manager.onObjectsChanged = (allObjects) => {
      setObjects(allObjects);
      if (selectedObjectId) {
        const current = allObjects.find((o) => o.id === selectedObjectId);
        setSelectedObject(current || null);
      }
    };

    // Pre-populate with a gorgeous initial scene
    loadInitialShowcase(manager);

    // Keyboard Shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

      if (e.key === 'w' || e.key === 'W') {
        manager.setTransformMode('translate');
        setTransformMode('translate');
      } else if (e.key === 'e' || e.key === 'E') {
        manager.setTransformMode('rotate');
        setTransformMode('rotate');
      } else if (e.key === 'r' || e.key === 'R') {
        manager.setTransformMode('scale');
        setTransformMode('scale');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (manager['selectedObjectId']) {
          manager.removeObject(manager['selectedObjectId']);
        }
      } else if (e.key === 'Escape') {
        manager.selectObject(null);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        if (manager['selectedObjectId']) {
          manager.duplicateObject(manager['selectedObjectId']);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      manager.dispose();
    };
  }, []);

  const loadInitialShowcase = (manager: ThreeSceneManager) => {
    // 1. Centerpiece: Cyberpunk glowing torus knot
    manager.addObject(
      'torusKnot',
      [0, 1.8, 0],
      {
        color: '#ec4899',
        roughness: 0.1,
        metalness: 0.85,
        transmission: 0.0,
        opacity: 1.0,
        transparent: false,
        wireframe: false,
        emissive: '#f43f5e',
        emissiveIntensity: 0.6,
      },
      'Centerpiece Knot'
    );

    // 2. Pedestal cylinder
    manager.addObject(
      'cylinder',
      [0, 0.4, 0],
      {
        color: '#1e293b',
        roughness: 0.3,
        metalness: 0.9,
        transmission: 0.0,
        opacity: 1.0,
        transparent: false,
        wireframe: false,
        emissive: '#0f172a',
        emissiveIntensity: 0.1,
      },
      'Mirror Pedestal'
    );

    // 3. Floating Gold Sphere
    manager.addObject(
      'sphere',
      [-2.4, 2.0, -1],
      {
        color: '#ffd700',
        roughness: 0.15,
        metalness: 0.95,
        transmission: 0.0,
        opacity: 1.0,
        transparent: false,
        wireframe: false,
        emissive: '#78350f',
        emissiveIntensity: 0.1,
      },
      'Gold Satellite'
    );

    // 4. Floating Glass Diamond
    manager.addObject(
      'diamond',
      [2.2, 1.6, 1.2],
      {
        color: '#38bdf8',
        roughness: 0.05,
        metalness: 0.1,
        transmission: 0.9,
        opacity: 1.0,
        transparent: true,
        wireframe: false,
        emissive: '#0284c7',
        emissiveIntensity: 0.2,
      },
      'Crystal Prism'
    );

    manager.selectObject(null);
  };

  const handleAddShape = (type: ShapeType, position?: [number, number, number]) => {
    sceneManagerRef.current?.addObject(type, position);
  };

  const handleSetTransformMode = (mode: TransformMode) => {
    setTransformMode(mode);
    sceneManagerRef.current?.setTransformMode(mode);
  };

  const handleSetStudioTheme = (theme: StudioTheme) => {
    setStudioTheme(theme);
    sceneManagerRef.current?.setStudioTheme(theme);
  };

  const handleToggleAnimate = () => {
    if (!sceneManagerRef.current) return;
    const nextState = !isAnimating;
    sceneManagerRef.current.isAnimatingScene = nextState;
    setIsAnimating(nextState);
  };

  const handleToggleGrid = () => {
    if (!sceneManagerRef.current) return;
    const nextState = !isGridVisible;
    sceneManagerRef.current.toggleGrid(nextState);
    setIsGridVisible(nextState);
  };

  const handleSetCameraView = (view: 'iso' | 'front' | 'top') => {
    sceneManagerRef.current?.setCameraView(view);
  };

  const handleApplyPreset = (preset: MaterialPreset) => {
    if (selectedObjectId) {
      sceneManagerRef.current?.updateObjectMaterial(selectedObjectId, preset.properties);
    }
  };

  const handleLoadTemplate = (template: string) => {
    if (!sceneManagerRef.current) return;
    const manager = sceneManagerRef.current;

    // Clear existing
    objects.forEach((obj) => manager.removeObject(obj.id));

    if (template === 'cyberpunk') {
      loadInitialShowcase(manager);
      handleSetStudioTheme('cyberpunk');
    } else if (template === 'minimal') {
      manager.addObject('cylinder', [0, 0.4, 0], { color: '#ffffff', roughness: 0.2, metalness: 0.1 }, 'White Pedestal');
      manager.addObject('cube', [0, 1.8, 0], { color: '#ffd700', roughness: 0.1, metalness: 0.95 }, 'Gold Exhibit Cube');
      manager.addObject('ring', [0, 2.6, 0], { color: '#a855f7', roughness: 0.2, metalness: 0.5 }, 'Floating Halo');
      handleSetStudioTheme('studio');
    } else if (template === 'abstract') {
      manager.addObject('diamond', [-1.5, 1.5, 0], { color: '#10b981', roughness: 0.2, metalness: 0.6 }, 'Emerald Cluster');
      manager.addObject('torus', [1.5, 2.0, 0], { color: '#ec4899', roughness: 0.1, metalness: 0.8 }, 'Neon Ring');
      manager.addObject('sphere', [0, 3.0, -1], { color: '#38bdf8', transmission: 0.9, roughness: 0.05 }, 'Glass Orb');
      handleSetStudioTheme('sunset');
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0b0d14] overflow-hidden">
      {/* Top Navigation */}
      <Header
        transformMode={transformMode}
        onSetTransformMode={handleSetTransformMode}
        studioTheme={studioTheme}
        onSetStudioTheme={handleSetStudioTheme}
        isAnimating={isAnimating}
        onToggleAnimate={handleToggleAnimate}
        isGridVisible={isGridVisible}
        onToggleGrid={handleToggleGrid}
        onSetCameraView={handleSetCameraView}
        onOpenExport={() => setIsExportOpen(true)}
        onToggleLayers={() => setIsLayersOpen(!isLayersOpen)}
        isLayersOpen={isLayersOpen}
      />

      {/* Main Workspace */}
      <div className="flex flex-1 relative overflow-hidden">
        {/* Left Sidebar: Canva 3D Dock */}
        <Sidebar
          onAddShape={handleAddShape}
          onApplyPreset={handleApplyPreset}
          onLoadTemplate={handleLoadTemplate}
        />

        {/* Center: 3D Viewport */}
        <Viewport
          canvasContainerRef={canvasContainerRef}
          onDropShape={handleAddShape}
          getGroundPoint={(x, y) => {
            if (sceneManagerRef.current) {
              const pt = sceneManagerRef.current.getGroundIntersection(x, y);
              return { x: pt.x, y: pt.y, z: pt.z };
            }
            return { x: 0, y: 0.5, z: 0 };
          }}
        />

        {/* Floating Context Toolbar */}
        <FloatingToolbar
          selectedObject={selectedObject}
          transformMode={transformMode}
          onSetTransformMode={handleSetTransformMode}
          onDuplicate={(id) => sceneManagerRef.current?.duplicateObject(id)}
          onDelete={(id) => sceneManagerRef.current?.removeObject(id)}
          onUpdateMaterial={(id, props) => sceneManagerRef.current?.updateObjectMaterial(id, props)}
          onCenterObject={(id) =>
            sceneManagerRef.current?.updateObjectTransform(id, { position: [0, 1.0, 0] })
          }
        />

        {/* Scene Hierarchy Modal */}
        <LayersPanel
          isOpen={isLayersOpen}
          onClose={() => setIsLayersOpen(false)}
          objects={objects}
          selectedObjectId={selectedObjectId}
          onSelectObject={(id) => sceneManagerRef.current?.selectObject(id)}
          onToggleVisibility={(id) => sceneManagerRef.current?.toggleVisibility(id)}
          onToggleLock={(id) => sceneManagerRef.current?.toggleLock(id)}
          onDuplicate={(id) => sceneManagerRef.current?.duplicateObject(id)}
          onDelete={(id) => sceneManagerRef.current?.removeObject(id)}
        />

        {/* Right Sidebar: Material & Transform Inspector */}
        <Inspector
          selectedObject={selectedObject}
          onUpdateMaterial={(id, props) => sceneManagerRef.current?.updateObjectMaterial(id, props)}
          onUpdateTransform={(id, transform) => sceneManagerRef.current?.updateObjectTransform(id, transform)}
          onDuplicate={(id) => sceneManagerRef.current?.duplicateObject(id)}
          onDelete={(id) => sceneManagerRef.current?.removeObject(id)}
          onToggleLock={(id) => sceneManagerRef.current?.toggleLock(id)}
        />
      </div>

      {/* Export Modal */}
      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        onExportGLTF={(name) => sceneManagerRef.current?.exportGLTF(name)}
        onCaptureScreenshot={() => sceneManagerRef.current?.captureScreenshot() || ''}
        sceneObjectsCount={objects.length}
      />
    </div>
  );
};
