/**
 * MAOS Quad-Pane Sovereign Swarm Launcher
 *
 * Spawns 4 physical, tiled Herdr panes (2x2 grid) in Tab 5:
 *   - Top-Left:     Agent-Alpha (3D WebGL Engine & Raycasting)
 *   - Top-Right:    Agent-Beta (Canva Dock & Primitives Catalog)
 *   - Bottom-Left:  Agent-Gamma (PBR Shaders, Glass & Studio Lighting)
 *   - Bottom-Right: Agent-Delta (GLTF Exporter & Production Build)
 *
 * Each worker pane streams live unassisted Gemma inference,
 * runs isolated AST compilation, and displays real-time telemetry.
 */

import chalk from 'chalk';
import { execSync } from 'child_process';
import * as path from 'path';

const MODEL = process.env.MAOS_GEMMA_MODEL || 'gemma2:2b';
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

interface SwarmPaneConfig {
  agent: string;
  name: string;
  role: string;
  task: string;
  color: string;
}

const SWARM_CONFIGS: SwarmPaneConfig[] = [
  {
    agent: 'gemma-alpha',
    name: 'Agent-Alpha',
    role: 'WebGL 3D Engine & Raycast Drag-and-Drop',
    task: 'Setup Three.js perspective camera, OrbitControls, ground shadow plane, and screen-to-world raycasting drop listener',
    color: '#8B5CF6', // Violet
  },
  {
    agent: 'gemma-beta',
    name: 'Agent-Beta',
    role: 'Canva 3D UI Dock & Primitives Catalog',
    task: 'Create Canva sidebar dock with 11 draggable 3D primitives, floating quick-action toolbar, and drop event handlers',
    color: '#EC4899', // Pink
  },
  {
    agent: 'gemma-gamma',
    name: 'Agent-Gamma',
    role: 'PBR Shaders, Glass Transmission & Lights',
    task: 'Configure MeshPhysicalMaterial with roughness, metalness, glass refraction (IOR 1.52), emissive glow, and 5 studio lighting presets',
    color: '#06B6D4', // Cyan
  },
  {
    agent: 'gemma-delta',
    name: 'Agent-Delta',
    role: 'GLTF/GLB Exporter & Production Build',
    task: 'Implement Three.js GLTFExporter binary download, high-res 4K PNG snapshot capture, and Vite bundling verification',
    color: '#10B981', // Emerald
  },
];

function execHerdr(cmd: string): string {
  try {
    return execSync(`herdr ${cmd}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err: any) {
    return err.stdout?.toString() || '';
  }
}

async function main() {
  console.clear();
  console.log(chalk.bold.hex('#8B5CF6')('╔════════════════════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.hex('#8B5CF6')('║') + chalk.bold.hex('#EC4899')('       MAOS IGNITE ✦ QUAD-PANE PHYSICAL MULTIPLEXED GEMMA SWARM             ') + chalk.bold.hex('#8B5CF6')('║'));
  console.log(chalk.bold.hex('#8B5CF6')('╠════════════════════════════════════════════════════════════════════════════╣'));
  console.log(chalk.bold.hex('#8B5CF6')('║') + ` Multiplexer: ` + chalk.bold.green('Herdr Sovereign Tiled Multiplexer (Tab 5 Focus)') + `            ${chalk.bold.hex('#8B5CF6')('║')}`);
  console.log(chalk.bold.hex('#8B5CF6')('║') + ` Model:       ` + chalk.bold.cyan(`Local Gemma (${MODEL}) via RTX 4060 CUDA Loopback`) + `              ${chalk.bold.hex('#8B5CF6')('║')}`);
  console.log(chalk.bold.hex('#8B5CF6')('║') + ` Layout:      ` + chalk.bold.yellow('2x2 Quad Grid (4 Physical Dedicated Panes)') + `                   ${chalk.bold.hex('#8B5CF6')('║')}`);
  console.log(chalk.bold.hex('#8B5CF6')('╚════════════════════════════════════════════════════════════════════════════╝'));
  console.log('');

  // 1. Inspect Herdr panes in Tab 5
  console.log(chalk.bold.hex('#A78BFA')('🔍 [1/3] Detecting Physical Herdr Panes in Tab 5 (wA:tD)...'));

  let panesJson: any;
  try {
    panesJson = JSON.parse(execHerdr('pane list'));
  } catch {
    console.error('Failed to list Herdr panes.');
    return;
  }

  const allPanes = panesJson.result?.panes || [];
  let tab5Panes = allPanes.filter((p: any) => p.tab_id === 'wA:tD');

  console.log(`   Found ${tab5Panes.length} pane(s) in Tab 5.`);

  // If fewer than 4 panes, create splits to make a 2x2 grid
  while (tab5Panes.length < 4) {
    const parentPane = tab5Panes[0].pane_id;
    const dir = tab5Panes.length % 2 === 1 ? 'right' : 'down';
    console.log(chalk.cyan(`   Tiling terminal: splitting ${parentPane} (${dir})...`));
    execHerdr(`pane split ${parentPane} --direction ${dir} --no-focus`);
    const refreshed = JSON.parse(execHerdr('pane list'));
    tab5Panes = (refreshed.result?.panes || []).filter((p: any) => p.tab_id === 'wA:tD');
  }

  const targetPaneIds = tab5Panes.slice(0, 4).map((p: any) => p.pane_id);
  console.log(chalk.bold.green(`✔ 4 Physical Panes Ready: ${targetPaneIds.join(', ')}\n`));

  // 2. Configure & Name Each Physical Pane
  console.log(chalk.bold.hex('#A78BFA')('🏷  [2/3] Configuring Swarm Personas & Herdr Metadata...'));

  for (let i = 0; i < 4; i++) {
    const paneId = targetPaneIds[i];
    const cfg = SWARM_CONFIGS[i];
    const label = `${cfg.name} | ${cfg.role.split('&')[0].trim()}`;

    execHerdr(`pane rename ${paneId} "${label}"`);
    execHerdr(`pane report-agent ${paneId} --source maos --agent "${cfg.agent}" --state working`);
    console.log(`   ${chalk.hex(cfg.color)('●')} Pane ${chalk.bold.white(paneId)} labeled: ${chalk.bold.hex(cfg.color)(label)}`);
  }

  console.log(chalk.bold.green(`✔ All 4 Herdr panes assigned dedicated swarm personas.\n`));

  // 3. Launch Concurrent Gemma Worker Agents in Physical Panes
  console.log(chalk.bold.hex('#A78BFA')('⚡ [3/3] Launching Concurrent Worker Processes Across 4 Tiled Panes...'));

  for (let i = 0; i < 4; i++) {
    const paneId = targetPaneIds[i];
    const cfg = SWARM_CONFIGS[i];
    const workerCmd = `npx tsx src/cli/worker-agent.ts --agent ${cfg.agent} --name ${cfg.name} --role "${cfg.role}" --task "${cfg.task}" --color "${cfg.color}" --model ${MODEL}`;

    console.log(`   🚀 Dispatching ${cfg.name} to ${paneId}...`);
    execHerdr(`pane run ${paneId} "${workerCmd}"`);
  }

  console.log('\n' + chalk.bold.hex('#10B981')('═════════════════════════════════════════════════════════════════════════════'));
  console.log(chalk.bold.white('  🎉 4-PANE PHYSICAL GEMMA SWARM IS LIVE & STREAMING IN TAB 5!'));
  console.log(chalk.gray('  Switch to Tab 5 in Herdr to watch all 4 panes reason, stream, and compile concurrently.'));
  console.log(chalk.bold.hex('#10B981')('═════════════════════════════════════════════════════════════════════════════\n'));
}

main().catch(console.error);
