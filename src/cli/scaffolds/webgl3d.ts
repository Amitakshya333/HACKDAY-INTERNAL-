/**
 * Offline fallback scaffold for 3D goals ("3d triangle", "three.js cube", "webgl ..."):
 * a rotating 3D triangle in raw WebGL. No CDN, so it renders without network access.
 */

export const WEBGL_GOAL_PATTERN = /\b(3d|three(\.js)?|webgl|triangle|cube|pyramid|polyhedron)\b/i;

const SCENE_JS = `// MAOS Oasis 3D scene: raw WebGL, no external libraries
function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}

// Column-major model-view: rotate about Y then X, then push the scene back along -Z.
function modelView(angleY, angleX, distance) {
  const cy = Math.cos(angleY), sy = Math.sin(angleY), cx = Math.cos(angleX), sx = Math.sin(angleX);
  return [cy, sx * sy, -cx * sy, 0, 0, cx, sx, 0, sy, -sx * cy, cx * cy, 0, 0, 0, -distance, 1];
}

// x, y, z, r, g, b per vertex
const TRIANGLE = new Float32Array([
  0.0, 0.9, 0.0, 0.40, 0.91, 0.98,
  -0.9, -0.7, 0.0, 0.96, 0.45, 0.71,
  0.9, -0.7, 0.0, 0.65, 0.55, 0.98,
]);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { perspective, modelView, TRIANGLE };
}

if (typeof document !== 'undefined') {
  const canvas = document.getElementById('scene');
  const status = document.getElementById('status');
  const gl = canvas.getContext('webgl');
  if (!gl) {
    status.textContent = 'WebGL is not available in this browser.';
  } else {
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER,
      'attribute vec3 aPos; attribute vec3 aColor; uniform mat4 uProj; uniform mat4 uView; varying vec3 vColor;' +
      'void main() { vColor = aColor; gl_Position = uProj * uView * vec4(aPos, 1.0); }'));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER,
      'precision mediump float; varying vec3 vColor; void main() { gl_FragColor = vec4(vColor, 1.0); }'));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, TRIANGLE, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    const aColor = gl.getAttribLocation(prog, 'aColor');
    gl.enableVertexAttribArray(aPos);
    gl.enableVertexAttribArray(aColor);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, 24, 12);
    const uProj = gl.getUniformLocation(prog, 'uProj');
    const uView = gl.getUniformLocation(prog, 'uView');
    gl.enable(gl.DEPTH_TEST);

    let spinning = true, angle = 0, last = performance.now();
    document.getElementById('toggle').addEventListener('click', (e) => {
      spinning = !spinning;
      e.target.textContent = spinning ? 'Pause' : 'Spin';
    });

    const frame = (now) => {
      if (spinning) angle += (now - last) / 1000;
      last = now;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.clearColor(0.03, 0.04, 0.08, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(uProj, false, perspective(Math.PI / 4, w / h, 0.1, 100));
      gl.uniformMatrix4fv(uView, false, modelView(angle, 0.35, 3));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      requestAnimationFrame(frame);
    };
    status.textContent = 'Rotating 3D triangle (WebGL)';
    requestAnimationFrame(frame);
  }
}
`;

const escapeHtml = (s: string) => s.replace(/[<>&"]/g, '');

export function webgl3dScaffold(goal: string): Array<{ path: string; content: string; desc: string }> {
  const title = escapeHtml(goal).slice(0, 80) || '3D Scene';
  return [
    {
      path: 'index.html',
      desc: '3D scene page with WebGL canvas',
      content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1>${title}</h1>
  <canvas id="scene" aria-label="3D scene"></canvas>
  <p id="status" role="status"></p>
  <button id="toggle">Pause</button>
  <script src="scene.js"></script>
</body>
</html>
`,
    },
    {
      path: 'style.css',
      desc: '3D scene styling',
      content: `* { box-sizing: border-box; margin: 0; padding: 0; }
body { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  background: #070a14; color: #f1f5f9; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
h1 { color: #67e8f9; font-size: 22px; }
canvas { width: min(90vw, 640px); height: min(60vh, 480px); border: 1px solid #334155; border-radius: 8px; }
#status { color: #94a3b8; }
button { background: #1e293b; color: #67e8f9; border: 1px solid #334155; border-radius: 6px; padding: 8px 16px; cursor: pointer; }
button:hover, button:focus-visible { border-color: #67e8f9; outline: none; }
`,
    },
    { path: 'scene.js', desc: 'Raw WebGL rotating 3D triangle (no CDN)', content: SCENE_JS },
  ];
}
