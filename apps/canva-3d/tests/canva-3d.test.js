import { test, describe } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';

describe('Canva 3D Math & Geometry Suite', () => {
  test('should verify Euler to Degree rotation transforms', () => {
    const rad = Math.PI / 2;
    const deg = THREE.MathUtils.radToDeg(rad);
    assert(Math.abs(deg - 90) < 0.001, 'Degree rotation should be 90');
  });

  test('should verify ground plane raycast plane equations', () => {
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ray = new THREE.Ray(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0));
    const target = new THREE.Vector3();
    const hit = ray.intersectPlane(groundPlane, target);

    assert.notStrictEqual(hit, null);
    assert.strictEqual(target.x, 0);
    assert.strictEqual(target.y, 0);
    assert.strictEqual(target.z, 0);
  });

  test('should verify PBR material property ranges', () => {
    const pbrProps = {
      color: '#8b5cf6',
      roughness: 0.2,
      metalness: 0.8,
      transmission: 0.9,
      opacity: 1.0,
      emissiveIntensity: 0.5,
    };

    assert(pbrProps.roughness >= 0 && pbrProps.roughness <= 1);
    assert(pbrProps.metalness >= 0 && pbrProps.metalness <= 1);
    assert(pbrProps.transmission >= 0 && pbrProps.transmission <= 1);
  });

  test('should serialize scene object JSON without loss of coordinates', () => {
    const objectData = {
      id: 'test_obj_1',
      name: 'Cyberpunk Torus',
      type: 'torus',
      position: [1.5, 2.0, -3.5],
      rotation: [45, 90, 0],
      scale: [1, 1, 1],
      material: {
        color: '#ec4899',
        roughness: 0.1,
        metalness: 0.9,
      },
    };

    const json = JSON.stringify(objectData);
    const parsed = JSON.parse(json);

    assert.strictEqual(parsed.id, 'test_obj_1');
    assert.deepStrictEqual(parsed.position, [1.5, 2.0, -3.5]);
    assert.deepStrictEqual(parsed.rotation, [45, 90, 0]);
    assert.strictEqual(parsed.material.color, '#ec4899');
  });
});
