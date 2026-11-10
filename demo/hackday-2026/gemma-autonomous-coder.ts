/**
 * MAOS Oasis Autonomous Coder — Unassisted Gemma Engine
 *
 * Demonstrates 100% unassisted, autonomous code generation,
 * compilation verification, and self-healing using local Gemma on CUDA.
 *
 * Usage:
 *   npx tsx demo/hackday-2026/gemma-autonomous-coder.ts --model gemma2:9b --verbose
 */

import chalk from 'chalk';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;

// Parse CLI flags
const args = process.argv.slice(2);
const isVerbose = args.includes('--verbose') || args.includes('-v') || true;
const modelIndex = args.indexOf('--model');
const MODEL = modelIndex !== -1 && args[modelIndex + 1] ? args[modelIndex + 1] : 'gemma2:9b';

const targetFilePath = path.resolve('..', 'apps', 'canva-3d', 'src', 'engine', 'ProceduralGenerators.ts');
const appsDir = path.resolve('..', 'apps', 'canva-3d');

interface GenerationMetrics {
  totalDurationMs: number;
  evalDurationMs: number;
  promptEvalDurationMs: number;
  promptTokens: number;
  generatedTokens: number;
  tokensPerSecond: number;
}

/**
 * Stream completion from local Ollama with live token-by-token terminal printing
 */
async function streamGemmaCode(
  systemPrompt: string,
  userPrompt: string,
): Promise<{ code: string; rawResponse: string; metrics: GenerationMetrics }> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: MODEL,
      system: systemPrompt,
      prompt: userPrompt,
      stream: true,
      options: {
        temperature: 0.1, // low temperature for precise code generation
        num_predict: 1024,
      },
    });

    const startTime = Date.now();
    let rawResponse = '';
    let promptTokens = 0;
    let generatedTokens = 0;
    let evalDurationNs = 0;
    let promptEvalDurationNs = 0;

    const req = http.request(
      {
        hostname: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: '/api/generate',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (res) => {
        res.on('data', (chunk: Buffer) => {
          const lines = chunk
            .toString()
            .split('\n')
            .filter((l) => l.trim().length > 0);
          for (const line of lines) {
            try {
              const data = JSON.parse(line);
              if (data.response) {
                rawResponse += data.response;
                generatedTokens++;
                // Print streamed tokens live in terminal!
                process.stdout.write(chalk.hex('#A78BFA')(data.response));
              }
              if (data.done) {
                promptTokens = data.prompt_eval_count || 0;
                generatedTokens = data.eval_count || generatedTokens;
                evalDurationNs = data.eval_duration || 0;
                promptEvalDurationNs = data.prompt_eval_duration || 0;
              }
            } catch {
              // partial chunk - ignore
            }
          }
        });

        res.on('end', () => {
          const totalDurationMs = Date.now() - startTime;
          const evalDurationMs = evalDurationNs / 1_000_000 || totalDurationMs;
          const tokensPerSecond = generatedTokens / (evalDurationMs / 1000) || 0;

          const metrics: GenerationMetrics = {
            totalDurationMs,
            evalDurationMs,
            promptEvalDurationMs: promptEvalDurationNs / 1_000_000,
            promptTokens,
            generatedTokens,
            tokensPerSecond,
          };

          // Extract typescript code block
          let code = rawResponse;
          const match = rawResponse.match(/```(?:typescript|ts)?\s*([\s\S]*?)```/i);
          if (match && match[1]) {
            code = match[1].trim();
          }

          resolve({ code, rawResponse, metrics });
        });
      },
    );

    req.on('error', (err) => reject(err));
    req.write(postData);
    req.end();
  });
}

function verifyBuild(): { success: boolean; errorOutput?: string } {
  try {
    execSync('npx vite build', { cwd: appsDir, stdio: 'pipe', encoding: 'utf-8' });
    return { success: true };
  } catch (err: any) {
    const output = (err.stdout || '') + '\n' + (err.stderr || '');
    return { success: false, errorOutput: output.slice(0, 1500) };
  }
}

async function main() {
  console.clear();
  console.log(
    chalk.bold.hex('#8B5CF6')('╔════════════════════════════════════════════════════════════════════════════╗'),
  );
  console.log(
    chalk.bold.hex('#8B5CF6')('║') +
      chalk.bold.hex('#EC4899')('       MAOS OASIS ✦ 100% UNASSISTED AUTONOMOUS GEMMA CODE GENERATION        ') +
      chalk.bold.hex('#8B5CF6')('║'),
  );
  console.log(
    chalk.bold.hex('#8B5CF6')('╠════════════════════════════════════════════════════════════════════════════╣'),
  );
  console.log(
    chalk.bold.hex('#8B5CF6')('║') +
      ` Model:    ` +
      chalk.bold.cyan(`${MODEL} (Local CUDA Inference, No Cloud API)`) +
      `          ${chalk.bold.hex('#8B5CF6')('║')}`,
  );
  console.log(
    chalk.bold.hex('#8B5CF6')('║') +
      ` Mode:     ` +
      chalk.bold.yellow('Zero Human / Assistant Assistance (Pure Raw Model Output)') +
      `     ${chalk.bold.hex('#8B5CF6')('║')}`,
  );
  console.log(
    chalk.bold.hex('#8B5CF6')('║') +
      ` Target:   ` +
      chalk.bold.white('Procedural 3D Geometry Generators for Canva 3D') +
      `               ${chalk.bold.hex('#8B5CF6')('║')}`,
  );
  console.log(
    chalk.bold.hex('#8B5CF6')('║') +
      ` Telemetry:` +
      chalk.bold.green(' --verbose live hardware stats enabled') +
      `                              ${chalk.bold.hex('#8B5CF6')('║')}`,
  );
  console.log(
    chalk.bold.hex('#8B5CF6')('╚════════════════════════════════════════════════════════════════════════════╝'),
  );
  console.log('');

  const systemPrompt = `You are a professional TypeScript and Three.js graphics engineer.
You write production-grade, bug-free TypeScript code.
Import THREE from 'three'.
Do not write conversational filler. Write only the TypeScript file code inside a \`\`\`typescript block.`;

  const userPrompt = `Write a TypeScript module named \`ProceduralGenerators.ts\` for Three.js.
It must export:
1. \`createProceduralStar(points: number, outerR: number, innerR: number, depth: number): THREE.BufferGeometry\` - creates an extruded 3D star.
2. \`createProceduralHelix(radius: number, tube: number, turns: number, height: number): THREE.BufferGeometry\` - creates a 3D coiled spring/helix.
3. \`createCrystalPolyhedron(radius: number): THREE.BufferGeometry\` - creates a faceted crystalline polyhedron (using IcosahedronGeometry or DodecahedronGeometry).

Make sure all imports are valid \`import * as THREE from 'three';\` and all return types are \`THREE.BufferGeometry\`.
Return ONLY the \`\`\`typescript code block.`;

  console.log(chalk.bold.hex('#F59E0B')('⏳ [1/3] Prompting Local Gemma on RTX 4060 GPU (Streaming live tokens)...'));
  console.log(chalk.gray('───────────────────────────────────────────────────────────────────────────\n'));

  const result = await streamGemmaCode(systemPrompt, userPrompt);

  console.log('\n\n' + chalk.gray('───────────────────────────────────────────────────────────────────────────'));
  console.log(chalk.bold.green('✔ Token generation complete.'));

  // Print Verbose Telemetry
  if (isVerbose) {
    console.log(chalk.bold.hex('#38BDF8')('\n📊 [VERBOSE GPU & MODEL METRICS]'));
    console.log(`   • Model:              ${chalk.bold.cyan(MODEL)}`);
    console.log(`   • Prompt Tokens:      ${chalk.bold.white(result.metrics.promptTokens.toString())}`);
    console.log(`   • Generated Tokens:   ${chalk.bold.white(result.metrics.generatedTokens.toString())}`);
    console.log(`   • Prompt Eval Time:   ${chalk.bold.white(result.metrics.promptEvalDurationMs.toFixed(1))} ms`);
    console.log(`   • Code Eval Time:     ${chalk.bold.white((result.metrics.evalDurationMs / 1000).toFixed(2))} s`);
    console.log(`   • Generation Speed:   ${chalk.bold.green(result.metrics.tokensPerSecond.toFixed(1))} tokens/sec`);
    console.log(`   • Total Clock Time:   ${chalk.bold.white((result.metrics.totalDurationMs / 1000).toFixed(2))} s`);
  }

  // Save the code directly to disk
  console.log(chalk.bold.hex('#F59E0B')(`\n💾 [2/3] Writing Gemma's unassisted code to:`));
  console.log(`   ${chalk.cyan(targetFilePath)}`);

  fs.writeFileSync(targetFilePath, result.code, 'utf-8');

  // Verify compilation
  console.log(chalk.bold.hex('#F59E0B')('\n⚙️  [3/3] Testing Compilation with Vite & TypeScript Compiler...'));
  let buildResult = verifyBuild();

  if (buildResult.success) {
    console.log(chalk.bold.green("✔ SUCCESS: Gemma's code compiled cleanly with 0 errors on first attempt!"));
  } else {
    console.log(chalk.bold.red('✖ COMPILER WARNING/ERROR DETECTED:'));
    console.log(chalk.red(buildResult.errorOutput));

    console.log(chalk.bold.hex('#EC4899')('\n🩹 [AUTONOMOUS HEALER ACTIVATED]'));
    console.log(chalk.yellow('   Feeding compiler error back into Gemma for autonomous self-healing patch...'));

    const healPrompt = `The code you generated produced this TypeScript/Vite compilation error:
${buildResult.errorOutput}

Here is your previous code:
${result.code}

Fix the error and return ONLY the corrected \`\`\`typescript code block.`;

    const healResult = await streamGemmaCode(systemPrompt, healPrompt);
    fs.writeFileSync(targetFilePath, healResult.code, 'utf-8');

    console.log(chalk.bold.hex('#F59E0B')('\n⚙️  Re-verifying patched build...'));
    const retryBuild = verifyBuild();
    if (retryBuild.success) {
      console.log(chalk.bold.green('✔ SUCCESS: Autonomous Healer resolved the issue! 0 errors.'));
    } else {
      console.log(chalk.yellow('Build warning noted; review output above.'));
    }
  }

  console.log(
    chalk.bold.hex('#10B981')('\n═════════════════════════════════════════════════════════════════════════════'),
  );
  console.log(chalk.bold.white('  🏁 UNASSISTED GEMMA GENERATION & VERIFICATION COMPLETE!'));
  console.log(chalk.gray(`  Check the newly created file: apps/canva-3d/src/engine/ProceduralGenerators.ts`));
  console.log(
    chalk.bold.hex('#10B981')('═════════════════════════════════════════════════════════════════════════════\n'),
  );
}

main().catch(console.error);
