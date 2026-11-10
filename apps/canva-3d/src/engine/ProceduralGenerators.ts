import * as THREE from 'three';

export const createProceduralStar = (points: number, outerR: number, innerR: number, depth: number): THREE.BufferGeometry => {
  const geometry = new THREE.BufferGeometry();
  const vertices = [];
  const indices = [];

  for (let i = 0; i < points; i++) {
    const angle = (i / points) * (Math.PI * 2);
    const r = outerR + (innerR * Math.cos(angle * depth));
    const x = r * Math.cos(angle);
    const y = r * Math.sin(angle);
    vertices.push(x, y, 0);
  }

  for (let i = 0; i < points - 2; i++) {
    indices.push(i, (i + 1) % points, 0);
    indices.push(i, points - 1, (i + 1) % points);
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(new THREE.Uint16BufferAttribute(indices, 1));

  return geometry;
};

export const createProceduralHelix = (radius: number, tube: number, turns: number, height: number): THREE.BufferGeometry => {
  const geometry = new THREE.BufferGeometry();
  const vertices = [];
  const indices = [];

  const step = (Math.PI * 2) / turns;

  for (let i = 0; i <= turns; i++) {
    const angle = i * step;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle);
    const z = height * (i / turns);
    vertices.push(x, y, z);
  }

  for (let i = 0; i < turns; i++) {
    indices.push(i, (i + 1), (i + 1) + turns);
    indices.push(i, (i + 1) + turns, i + turns);
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(new THREE.Uint16BufferAttribute(indices, 1));

  return geometry;
};

export const createCrystalPolyhedron = (radius: number): THREE.BufferGeometry => {
  const geometry = new THREE.IcosahedronGeometry(radius, 3);
  // Alternatively, use:
  // const geometry = new THREE.DodecahedronGeometry(radius, 3);
  return geometry;
};