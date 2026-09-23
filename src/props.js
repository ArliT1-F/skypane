import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const PROP_KEYS = [
  'conifer',
  'broad',
  'dreamTree',
  'bush',
  'flower',
  'rock',
  'crystal',
  'pillar',
  'floatingDiamond',
  'floatingRing',
  'roadSign',
  'lantern',
];

export const floatingTimeUniform = { value: 0 };

function colorize(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function clean(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  if (g.attributes.normal) g.computeVertexNormals();
  return g;
}

export function makePropMaterials() {
  // 1. Conifer pine tree
  const conifer = (() => {
    const trunk = colorize(clean(new THREE.CylinderGeometry(0.22, 0.32, 3, 5).translate(0, 1.5, 0)), 0x4a3a30);
    const c1 = colorize(clean(new THREE.ConeGeometry(2.6, 5, 7).translate(0, 4.5, 0)), 0xffffff);
    const c2 = colorize(clean(new THREE.ConeGeometry(2.0, 4.2, 7).translate(0, 7.0, 0)), 0xf2f2f2);
    const c3 = colorize(clean(new THREE.ConeGeometry(1.3, 3.4, 7).translate(0, 9.3, 0)), 0xe6e6e6);
    return mergeGeometries([trunk, c1, c2, c3]);
  })();

  // 2. Broadleaf oak tree
  const broad = (() => {
    const trunk = colorize(clean(new THREE.CylinderGeometry(0.25, 0.4, 3.4, 5).translate(0, 1.7, 0)), 0x4a3a30);
    const b1 = colorize(clean(new THREE.IcosahedronGeometry(2.6, 0).translate(0, 5.0, 0)), 0xffffff);
    const b2 = colorize(clean(new THREE.IcosahedronGeometry(1.9, 0).translate(1.3, 4.2, 0.6)), 0xeeeeee);
    const b3 = colorize(clean(new THREE.IcosahedronGeometry(1.7, 0).translate(-1.1, 4.4, -0.8)), 0xf6f6f6);
    return mergeGeometries([trunk, b1, b2, b3]);
  })();

  // 3. Dream tree (cherry blossom / ethereal pastel willow)
  const dreamTree = (() => {
    const trunk = colorize(clean(new THREE.CylinderGeometry(0.24, 0.38, 4.0, 6).translate(0, 2.0, 0)), 0x3d3532);
    const b1 = colorize(clean(new THREE.IcosahedronGeometry(2.5, 1).translate(0, 5.2, 0)), 0xffffff);
    const b2 = colorize(clean(new THREE.IcosahedronGeometry(1.8, 1).translate(1.2, 4.5, 0.5)), 0xffeef5);
    const b3 = colorize(clean(new THREE.IcosahedronGeometry(1.7, 1).translate(-1.2, 4.7, -0.5)), 0xfbf0f8);
    const b4 = colorize(clean(new THREE.IcosahedronGeometry(1.3, 1).translate(0, 6.7, 0.2)), 0xfff5fa);
    return mergeGeometries([trunk, b1, b2, b3, b4]);
  })();

  // 4. Flowering bush / shrub
  const bush = (() => {
    const foliage = colorize(clean(new THREE.IcosahedronGeometry(1.4, 1).translate(0, 1.1, 0)), 0xffffff);
    const f1 = colorize(clean(new THREE.DodecahedronGeometry(0.35).translate(0.5, 1.8, 0.4)), 0xffe6f0);
    const f2 = colorize(clean(new THREE.DodecahedronGeometry(0.3).translate(-0.4, 1.7, -0.3)), 0xfff0ea);
    return mergeGeometries([foliage, f1, f2]);
  })();

  // 5. Wildflower clump
  const flower = (() => {
    const stem1 = colorize(clean(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 4).translate(0, 0.35, 0)), 0x3b6635);
    const bloom1 = colorize(clean(new THREE.DodecahedronGeometry(0.32).translate(0, 0.75, 0)), 0xffffff);
    const stem2 = colorize(clean(new THREE.CylinderGeometry(0.04, 0.04, 0.55, 4).translate(0.25, 0.28, 0.2)), 0x3b6635);
    const bloom2 = colorize(clean(new THREE.DodecahedronGeometry(0.26).translate(0.25, 0.6, 0.2)), 0xffffff);
    const stem3 = colorize(clean(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 4).translate(-0.2, 0.25, -0.15)), 0x3b6635);
    const bloom3 = colorize(clean(new THREE.DodecahedronGeometry(0.24).translate(-0.2, 0.55, -0.15)), 0xffffff);
    return mergeGeometries([stem1, bloom1, stem2, bloom2, stem3, bloom3]);
  })();

  // 6. Faceted rock / boulder
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

  // 7. Dreamcore ground crystals
  const crystal = (() => {
    const c1 = colorize(clean(new THREE.CylinderGeometry(0.08, 0.42, 3.0, 6).translate(0, 1.5, 0)), 0xffffff);
    const c2 = colorize(clean(new THREE.CylinderGeometry(0.07, 0.34, 2.2, 6).rotateZ(0.28).translate(0.48, 1.0, 0)), 0xf0f5ff);
    const c3 = colorize(clean(new THREE.CylinderGeometry(0.06, 0.28, 1.9, 6).rotateX(-0.26).translate(-0.4, 0.85, 0.3)), 0xfaf0ff);
    return mergeGeometries([c1, c2, c3]);
  })();

  // 8. Dreamcore classical marble column
  const pillar = (() => {
    const base = colorize(clean(new THREE.BoxGeometry(1.3, 0.4, 1.3).translate(0, 0.2, 0)), 0xdcdde2);
    const shaft = colorize(clean(new THREE.CylinderGeometry(0.46, 0.52, 5.8, 12).translate(0, 3.3, 0)), 0xf5f6fa);
    const cap = colorize(clean(new THREE.BoxGeometry(1.2, 0.35, 1.2).translate(0, 6.4, 0)), 0xdcdde2);
    return mergeGeometries([base, shaft, cap]);
  })();

  // 9. Floating dream octahedron (diamond)
  const floatingDiamond = (() => {
    const outer = colorize(clean(new THREE.OctahedronGeometry(2.0, 0)), 0xffffff);
    const inner = colorize(clean(new THREE.OctahedronGeometry(1.1, 0)), 0xf0f5ff);
    return mergeGeometries([outer, inner]);
  })();

  // 10. Floating dream ring (torus)
  const floatingRing = (() => {
    const ring = colorize(clean(new THREE.TorusGeometry(3.6, 0.4, 8, 18)), 0xffffff);
    return ring;
  })();

  // 11. Roadside curve chevron sign
  const roadSign = (() => {
    const post = colorize(clean(new THREE.CylinderGeometry(0.06, 0.08, 1.9, 5).translate(0, 0.95, 0)), 0x56493f);
    const board = colorize(clean(new THREE.BoxGeometry(0.75, 0.48, 0.08).translate(0, 1.7, 0)), 0xffffff);
    return mergeGeometries([post, board]);
  })();

  // 12. Roadside vintage lantern post
  const lantern = (() => {
    const post = colorize(clean(new THREE.CylinderGeometry(0.07, 0.1, 3.1, 6).translate(0, 1.55, 0)), 0x24282e);
    const arm = colorize(clean(new THREE.BoxGeometry(0.48, 0.07, 0.07).translate(0.2, 3.1, 0)), 0x24282e);
    const lamp = colorize(clean(new THREE.CylinderGeometry(0.18, 0.12, 0.38, 6).translate(0.4, 2.9, 0)), 0xffffff);
    return mergeGeometries([post, arm, lamp]);
  })();

  // Materials
  const foliageMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0, flatShading: true });
  const pillarMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.05 });
  const signMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });

  // Glowing / luminous dreamcore materials
  const crystalMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.2,
    metalness: 0.25,
    emissive: 0x112233,
    emissiveIntensity: 0.45,
  });

  const lanternMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.5,
    emissive: 0x442a12,
    emissiveIntensity: 0.75,
  });

  // Floating objects material with vertex shader bobbing
  const floatingMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.22,
    metalness: 0.35,
    emissive: 0x221533,
    emissiveIntensity: 0.65,
  });
  floatingMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = floatingTimeUniform;
    shader.vertexShader = `uniform float uTime;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float bob = sin(uTime * 1.35 + position.x * 0.15 + position.z * 0.15) * 0.75;
      float sway = cos(uTime * 0.95 + position.y * 0.2) * 0.3;
      transformed.y += bob;
      transformed.x += sway;
      `
    );
  };

  return {
    conifer: { geo: conifer, mat: foliageMat },
    broad: { geo: broad, mat: foliageMat },
    dreamTree: { geo: dreamTree, mat: foliageMat },
    bush: { geo: bush, mat: foliageMat },
    flower: { geo: flower, mat: foliageMat },
    rock: { geo: rock, mat: rockMat },
    crystal: { geo: crystal, mat: crystalMat },
    pillar: { geo: pillar, mat: pillarMat },
    floatingDiamond: { geo: floatingDiamond, mat: floatingMat, castShadow: false },
    floatingRing: { geo: floatingRing, mat: floatingMat, castShadow: false },
    roadSign: { geo: roadSign, mat: signMat },
    lantern: { geo: lantern, mat: lanternMat },
  };
}
