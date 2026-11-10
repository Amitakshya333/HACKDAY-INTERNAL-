import urllib.request
import json

payload = {
    'model': 'gemma2:2b',
    'prompt': '''You are the MAOS Oasis Swarm Architect.
Analyze this goal: "Build Canva 3D Spatial Studio with drag-and-drop, PBR shaders, and GLTF export".
Decide how many parallel worker agents are needed (between 2 and 4).
Respond in pure JSON matching this exact schema:
{
  "plan_name": "Canva 3D Swarm Pipeline",
  "pane_count": 3,
  "agents": [
    {"name": "Agent-Alpha", "role": "WebGL Engine", "task": "Setup Three.js viewport and raycast ground plane", "color": "#8B5CF6"},
    {"name": "Agent-Beta", "role": "Canva UI Dock", "task": "Build sidebar with 3D primitives and drag-and-drop handlers", "color": "#EC4899"},
    {"name": "Agent-Gamma", "role": "PBR Shaders", "task": "Configure physical materials, glass refraction, and GLTF export", "color": "#06B6D4"}
  ]
}
Return ONLY valid JSON, no markdown formatting.''',
    'stream': False,
    'options': {'temperature': 0.1, 'num_predict': 350}
}

req = urllib.request.Request(
    'http://127.0.0.1:11434/api/generate',
    data=json.dumps(payload).encode('utf-8'),
    headers={'Content-Type': 'application/json'}
)
with urllib.request.urlopen(req, timeout=30) as res:
    data = json.loads(res.read().decode('utf-8'))
    print(data.get('response'))
