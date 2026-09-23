import * as THREE from 'three';
import { Simplex } from '../core/noise.js';
import { WATER_LEVEL } from './terrain.js';

function makeWaterNormals() {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  const img = g.createImageData(S, S);
  const n = new Simplex(7);
  const hgt = new Float32Array(S * S);
  // tileable noise via torus mapping
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const a = (x / S) * Math.PI * 2;
      const b = (y / S) * Math.PI * 2;
      const r = 1.2;
      const nx = Math.cos(a) * r;
      const ny = Math.sin(a) * r;
      const nz = Math.cos(b) * r;
      const nw = Math.sin(b) * r;
      // 4D-ish from two 2D lookups
      hgt[y * S + x] =
        n.noise2(nx * 2 + nz * 1.3, ny * 2 + nw * 1.3) * 0.6 +
        n.noise2(nx * 5 - nw * 3.1, ny * 5 + nz * 3.1) * 0.3 +
        n.noise2(nx * 11 + nz * 7, ny * 11 - nw * 7) * 0.1;
    }
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const l = hgt[y * S + ((x - 1 + S) % S)];
      const r = hgt[y * S + ((x + 1) % S)];
      const d = hgt[((y - 1 + S) % S) * S + x];
      const u = hgt[((y + 1) % S) * S + x];
      const v = new THREE.Vector3((l - r) * 2.2, (d - u) * 2.2, 1).normalize();
      const o = (y * S + x) * 4;
      img.data[o] = (v.x * 0.5 + 0.5) * 255;
      img.data[o + 1] = (v.y * 0.5 + 0.5) * 255;
      img.data[o + 2] = (v.z * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function createWater(biome) {
  const SIZE = 8000;
  const TILE = 36;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, 1, 1).rotateX(-Math.PI / 2);
  const normals = makeWaterNormals();
  const normals2 = normals.clone();
  normals.repeat.set(SIZE / TILE, SIZE / TILE);
  const frozen = !!biome.frozen;
  const mat = new THREE.MeshPhongMaterial({
    color: biome.waterColor,
    specular: frozen ? 0x9fb4c0 : 0xd8e8ff,
    shininess: frozen ? 40 : 90,
    normalMap: normals,
    normalScale: new THREE.Vector2(frozen ? 0.15 : 0.55, frozen ? 0.15 : 0.55),
    transparent: true,
    opacity: frozen ? 0.95 : 0.86,
    depthWrite: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER_LEVEL;
  mesh.receiveShadow = false;
  mesh.renderOrder = 1;
  let t = 0;
  return {
    mesh,
    update(camera, dt = 1 / 60) {
      t += dt;
      // follow the camera but keep the texture locked to world space
      const snap = TILE;
      const x = Math.round(camera.position.x / snap) * snap;
      const z = Math.round(camera.position.z / snap) * snap;
      mesh.position.x = x;
      mesh.position.z = z;
      const drift = frozen ? 0 : t * 0.012;
      normals.offset.set((x / TILE) % 1 + drift, (-z / TILE) % 1 + drift * 0.6);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      normals.dispose();
      normals2.dispose();
    },
  };
}
