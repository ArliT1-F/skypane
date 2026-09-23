import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Low-poly vegetation / rock geometry shared by every terrain chunk (instanced).

function colorize(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function clean(geo) {
  // Merge requires identical attribute sets
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  return g;
}

export function makePropMaterials() {
  // Trunks are baked as a dark colour; foliage is white so instanceColor tints it.
  const trunkCol = 0x7a5a45; // multiplied by instance colour, ends up brownish-green: acceptable
  const conifer = (() => {
    const trunk = colorize(clean(new THREE.CylinderGeometry(0.22, 0.32, 3, 5).translate(0, 1.5, 0)), 0x4a3a30);
    const c1 = colorize(clean(new THREE.ConeGeometry(2.6, 5, 7).translate(0, 4.5, 0)), 0xffffff);
    const c2 = colorize(clean(new THREE.ConeGeometry(2.0, 4.2, 7).translate(0, 7.0, 0)), 0xf2f2f2);
    const c3 = colorize(clean(new THREE.ConeGeometry(1.3, 3.4, 7).translate(0, 9.3, 0)), 0xe6e6e6);
    return mergeGeometries([trunk, c1, c2, c3]);
  })();
  const broad = (() => {
    const trunk = colorize(clean(new THREE.CylinderGeometry(0.25, 0.4, 3.4, 5).translate(0, 1.7, 0)), 0x4a3a30);
    const b1 = colorize(clean(new THREE.IcosahedronGeometry(2.6, 0).translate(0, 5.0, 0)), 0xffffff);
    const b2 = colorize(clean(new THREE.IcosahedronGeometry(1.9, 0).translate(1.3, 4.2, 0.6)), 0xeeeeee);
    const b3 = colorize(clean(new THREE.IcosahedronGeometry(1.7, 0).translate(-1.1, 4.4, -0.8)), 0xf6f6f6);
    return mergeGeometries([trunk, b1, b2, b3]);
  })();
  const rock = (() => {
    const g = new THREE.IcosahedronGeometry(1, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 0.75 + 0.5 * Math.abs(Math.sin(i * 12.9898 + p.getX(i) * 7.3));
      p.setXYZ(i, p.getX(i) * k, Math.max(p.getY(i) * k * 0.8, -0.2), p.getZ(i) * k);
    }
    g.computeVertexNormals();
    return colorize(clean(g), 0xffffff);
  })();
  void trunkCol;

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
  return {
    conifer: { geo: conifer, mat },
    broad: { geo: broad, mat },
    rock: { geo: rock, mat: rockMat },
  };
}
