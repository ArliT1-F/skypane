import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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

/** Per-instance phase hashed from the instance translation, so props never bob in sync. */
const INSTANCE_PHASE = /* glsl */ `
  #ifdef USE_INSTANCING
    float iph = instanceMatrix[3][0] * 0.21 + instanceMatrix[3][2] * 0.173;
  #else
    float iph = 0.0;
  #endif
`;

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
  const floatingRing = colorize(clean(new THREE.TorusGeometry(3.6, 0.4, 8, 18)), 0xffffff);

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

  // 13. Saguaro cactus with two arms and a tiny bloom
  const cactus = (() => {
    const trunk = colorize(clean(new THREE.CylinderGeometry(0.2, 0.27, 2.6, 7).translate(0, 1.3, 0)), 0xffffff);
    const top = colorize(clean(new THREE.SphereGeometry(0.2, 7, 5).translate(0, 2.6, 0)), 0xf6f6f6);
    const armH1 = colorize(clean(new THREE.CylinderGeometry(0.1, 0.12, 0.42, 6).rotateZ(Math.PI / 2).translate(-0.32, 1.3, 0)), 0xf8f8f8);
    const armV1 = colorize(clean(new THREE.CylinderGeometry(0.09, 0.11, 0.8, 6).translate(-0.5, 1.72, 0)), 0xffffff);
    const armH2 = colorize(clean(new THREE.CylinderGeometry(0.09, 0.11, 0.36, 6).rotateZ(Math.PI / 2).translate(0.29, 1.7, 0)), 0xf8f8f8);
    const armV2 = colorize(clean(new THREE.CylinderGeometry(0.08, 0.1, 0.62, 6).translate(0.45, 2.02, 0)), 0xffffff);
    const bloom = colorize(clean(new THREE.SphereGeometry(0.08, 6, 4).translate(0, 2.72, 0)), 0xff9db8);
    return mergeGeometries([trunk, top, armH1, armV1, armH2, armV2, bloom]);
  })();

  // 14. Bleached dead tree (desert)
  const deadTree = (() => {
    const trunk = colorize(clean(new THREE.CylinderGeometry(0.13, 0.28, 2.8, 5).translate(0, 1.4, 0)), 0xffffff);
    const b1 = colorize(clean(new THREE.CylinderGeometry(0.06, 0.11, 1.5, 4).rotateZ(0.7).translate(0.52, 2.85, 0)), 0xf4f4f4);
    const b2 = colorize(clean(new THREE.CylinderGeometry(0.05, 0.09, 1.2, 4).rotateZ(-0.6).rotateY(1.2).translate(-0.45, 3.05, 0.12)), 0xf0f0f0);
    const b3 = colorize(clean(new THREE.CylinderGeometry(0.04, 0.06, 0.9, 4).rotateX(-0.5).translate(0.1, 3.35, -0.28)), 0xececec);
    return mergeGeometries([trunk, b1, b2, b3]);
  })();

  // 15. Tumbleweed (tangled dry ball)
  const tumbleweed = (() => {
    const g = new THREE.IcosahedronGeometry(0.6, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 0.72 + 0.45 * Math.abs(Math.sin(i * 3.71 + p.getX(i) * 9.1 + p.getZ(i) * 5.3));
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    return colorize(clean(g), 0xffffff);
  })();

  // 16. Palm tree for desert oases
  const palm = (() => {
    const parts = [];
    const t1 = new THREE.CylinderGeometry(0.13, 0.21, 2.2, 6).translate(0, 1.1, 0);
    parts.push(colorize(clean(t1), 0xd9c1a0));
    const t2 = new THREE.CylinderGeometry(0.1, 0.14, 1.9, 6).rotateZ(0.14).translate(0.22, 2.85, 0);
    parts.push(colorize(clean(t2), 0xd2b896));
    const crown = new THREE.SphereGeometry(0.18, 6, 5).translate(0.34, 3.8, 0);
    parts.push(colorize(clean(crown), 0xcbb28e));
    const frond = new THREE.ConeGeometry(0.22, 2.0, 4);
    frond.scale(1, 1, 0.32);
    frond.rotateX(Math.PI * 0.62);
    for (let k = 0; k < 6; k++) {
      const g = frond.clone();
      g.rotateY((k / 6) * Math.PI * 2);
      g.translate(0.34, 3.9, 0);
      parts.push(colorize(clean(g), k % 2 ? 0xffffff : 0xe8f2e0));
    }
    const coco1 = new THREE.SphereGeometry(0.11, 6, 5).translate(0.2, 3.62, 0.14);
    const coco2 = new THREE.SphereGeometry(0.1, 6, 5).translate(0.46, 3.58, -0.1);
    parts.push(colorize(clean(coco1), 0x8a6a48), colorize(clean(coco2), 0x83653f));
    return mergeGeometries(parts);
  })();

  // 17. Reeds / cattails
  const reed = (() => {
    const parts = [];
    const spots = [[0, 0, 0, 0.05, true], [0.16, 0, 0.1, -0.09, true], [-0.13, 0, -0.08, 0.12, false], [0.02, 0, -0.16, -0.04, false], [-0.08, 0, 0.12, 0.16, true]];
    for (const [sx, , sz, tilt, withTip] of spots) {
      const st = new THREE.CylinderGeometry(0.022, 0.038, 1.35, 4).rotateZ(tilt).translate(sx, 0.66, sz);
      parts.push(colorize(clean(st), 0xffffff));
      if (withTip) {
        const tp = new THREE.CylinderGeometry(0.05, 0.05, 0.34, 5).rotateZ(tilt).translate(sx + Math.sin(-tilt) * 0.68, 1.5, sz);
        parts.push(colorize(clean(tp), 0x5b4226));
      }
    }
    return mergeGeometries(parts);
  })();

  // 18. Lily pad (flat disc on the water)
  const lilyPad = colorize(clean(new THREE.CircleGeometry(0.5, 9).rotateX(-Math.PI / 2).translate(0, 0.02, 0)), 0xffffff);

  // 19. Snow-laden pine
  const snowPine = (() => {
    const trunk = colorize(clean(new THREE.CylinderGeometry(0.22, 0.32, 3, 5).translate(0, 1.5, 0)), 0x4a4038);
    const c1 = colorize(clean(new THREE.ConeGeometry(2.6, 5, 7).translate(0, 4.5, 0)), 0xfdfeff);
    const c2 = colorize(clean(new THREE.ConeGeometry(2.0, 4.2, 7).translate(0, 7.0, 0)), 0xf3f8fd);
    const c3 = colorize(clean(new THREE.ConeGeometry(1.3, 3.4, 7).translate(0, 9.3, 0)), 0xe9f1fa);
    return mergeGeometries([trunk, c1, c2, c3]);
  })();

  // 20. Snowman with coal face, carrot nose and a scarf
  const snowman = (() => {
    const bottom = colorize(clean(new THREE.SphereGeometry(0.58, 9, 7).translate(0, 0.52, 0)), 0xffffff);
    const mid = colorize(clean(new THREE.SphereGeometry(0.4, 8, 6).translate(0, 1.28, 0)), 0xfdfdfd);
    const head = colorize(clean(new THREE.SphereGeometry(0.28, 8, 6).translate(0, 1.85, 0)), 0xffffff);
    const nose = colorize(clean(new THREE.ConeGeometry(0.05, 0.26, 5).rotateX(Math.PI / 2).translate(0, 1.88, 0.34)), 0xd9772f);
    const eyeL = colorize(clean(new THREE.SphereGeometry(0.035, 5, 4).translate(-0.09, 1.94, 0.25)), 0x222226);
    const eyeR = colorize(clean(new THREE.SphereGeometry(0.035, 5, 4).translate(0.09, 1.94, 0.25)), 0x222226);
    const btn1 = colorize(clean(new THREE.SphereGeometry(0.045, 5, 4).translate(0, 1.38, 0.38)), 0x222226);
    const btn2 = colorize(clean(new THREE.SphereGeometry(0.045, 5, 4).translate(0, 1.2, 0.39)), 0x222226);
    const armL = colorize(clean(new THREE.CylinderGeometry(0.028, 0.045, 0.9, 4).rotateZ(1.15).translate(-0.52, 1.4, 0)), 0x5d452e);
    const armR = colorize(clean(new THREE.CylinderGeometry(0.028, 0.045, 0.9, 4).rotateZ(-1.15).translate(0.52, 1.4, 0)), 0x5d452e);
    const scarf = colorize(clean(new THREE.TorusGeometry(0.24, 0.06, 5, 10).rotateX(Math.PI / 2).translate(0, 1.62, 0)), 0xc4574e);
    return mergeGeometries([bottom, mid, head, nose, eyeL, eyeR, btn1, btn2, armL, armR, scarf]);
  })();

  // 21. Autumn broadleaf (canopy tinted per-instance orange/red)
  const autumnTree = (() => {
    const trunk = colorize(clean(new THREE.CylinderGeometry(0.26, 0.42, 3.4, 5).translate(0, 1.7, 0)), 0x4d3b30);
    const b1 = colorize(clean(new THREE.IcosahedronGeometry(2.6, 0).translate(0, 5.0, 0)), 0xffffff);
    const b2 = colorize(clean(new THREE.IcosahedronGeometry(1.9, 0).translate(1.3, 4.2, 0.6)), 0xf6f6f6);
    const b3 = colorize(clean(new THREE.IcosahedronGeometry(1.7, 0).translate(-1.1, 4.4, -0.8)), 0xfbfbfb);
    return mergeGeometries([trunk, b1, b2, b3]);
  })();

  // 22. Sunflower with a big friendly head
  const sunflower = (() => {
    const stem = colorize(clean(new THREE.CylinderGeometry(0.045, 0.06, 1.6, 5).translate(0, 0.8, 0)), 0x3f6b35);
    const leaf = colorize(clean(new THREE.IcosahedronGeometry(0.17, 0).scale(1, 0.45, 0.6).rotateZ(0.5).translate(0.18, 0.72, 0)), 0x487a3c);
    const petals = colorize(clean(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 10).rotateX(0.35).translate(0, 1.66, 0)), 0xffd75e);
    const center = colorize(clean(new THREE.SphereGeometry(0.17, 8, 6).scale(1, 1, 0.5).translate(0, 1.7, 0.03)), 0x5d4426);
    return mergeGeometries([stem, leaf, petals, center]);
  })();

  // 23. Glowing dream mushroom (emissive at night)
  const mushroom = (() => {
    const stem = colorize(clean(new THREE.CylinderGeometry(0.09, 0.13, 0.5, 6).translate(0, 0.25, 0)), 0xf2ede2);
    const cap = colorize(clean(new THREE.SphereGeometry(0.36, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.48, 0)), 0xffffff);
    const stem2 = colorize(clean(new THREE.CylinderGeometry(0.055, 0.08, 0.3, 6).translate(0.31, 0.15, 0.12)), 0xf2ede2);
    const cap2 = colorize(clean(new THREE.SphereGeometry(0.21, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0.31, 0.29, 0.12)), 0xf8f8f8);
    return mergeGeometries([stem, cap, stem2, cap2]);
  })();

  // 24. Fallen mossy log
  const log = (() => {
    const body = colorize(clean(new THREE.CylinderGeometry(0.32, 0.38, 2.6, 7).rotateZ(Math.PI / 2).translate(0, 0.34, 0)), 0xffffff);
    const stub = colorize(clean(new THREE.CylinderGeometry(0.09, 0.13, 0.5, 5).rotateX(1.2).translate(0.45, 0.55, 0)), 0xf0f0f0);
    return mergeGeometries([body, stub]);
  })();

  // 25. Country fence segment (~9 m, chains along the road)
  const fence = (() => {
    const parts = [];
    for (const px of [-4.2, 0, 4.2]) {
      parts.push(colorize(clean(new THREE.BoxGeometry(0.16, 1.15, 0.16).translate(px, 0.55, 0)), 0xffffff));
    }
    parts.push(colorize(clean(new THREE.BoxGeometry(8.85, 0.11, 0.06).translate(0, 1.0, 0)), 0xf8f8f8));
    parts.push(colorize(clean(new THREE.BoxGeometry(8.85, 0.1, 0.06).translate(0, 0.62, 0)), 0xf4f4f4));
    return mergeGeometries(parts);
  })();

  // 26. Hay bale
  const hayBale = (() => {
    const roll = colorize(clean(new THREE.CylinderGeometry(0.72, 0.72, 1.3, 10).rotateZ(Math.PI / 2).translate(0, 0.72, 0)), 0xffffff);
    const band = colorize(clean(new THREE.CylinderGeometry(0.735, 0.735, 0.2, 10).rotateZ(Math.PI / 2).translate(0, 0.72, 0)), 0xb9a06b);
    return mergeGeometries([roll, band]);
  })();

  // 27. Windmill tower (blades are a separate, shader-animated prop)
  const windmill = (() => {
    const base = colorize(clean(new THREE.CylinderGeometry(1.5, 1.95, 2.4, 8).translate(0, 1.2, 0)), 0xe8e4da);
    const body = colorize(clean(new THREE.CylinderGeometry(1.1, 1.55, 4.4, 8).translate(0, 4.2, 0)), 0xffffff);
    const cap = colorize(clean(new THREE.ConeGeometry(1.35, 1.3, 8).translate(0, 7.05, 0)), 0x8a6a52);
    const door = colorize(clean(new THREE.BoxGeometry(0.7, 1.15, 0.12).translate(0, 0.85, 1.42)), 0x54402e);
    const hub = colorize(clean(new THREE.CylinderGeometry(0.14, 0.14, 0.75, 6).rotateX(Math.PI / 2).translate(0, 6.0, 1.0)), 0x4a3826);
    return mergeGeometries([base, body, cap, door, hub]);
  })();

  // 28. Windmill sails — rotate around their hub in the vertex shader
  const windmillBlades = (() => {
    const parts = [];
    parts.push(colorize(clean(new THREE.CylinderGeometry(0.16, 0.16, 0.3, 6).rotateX(Math.PI / 2)), 0x4a3826));
    const arm = new THREE.BoxGeometry(0.1, 2.7, 0.07).translate(0, 1.35, 0);
    const sail = new THREE.BoxGeometry(0.56, 1.85, 0.03).translate(0.3, 1.5, 0.05);
    for (let k = 0; k < 4; k++) {
      const a = arm.clone().rotateZ((k * Math.PI) / 2);
      const s = sail.clone().rotateZ((k * Math.PI) / 2);
      parts.push(colorize(clean(a), 0xffffff), colorize(clean(s), 0xf6f4ee));
    }
    return mergeGeometries(parts);
  })();

  // 29. Hot-air balloon (bobbing high above the world)
  const balloon = (() => {
    const env = colorize(clean(new THREE.SphereGeometry(2.4, 10, 8).scale(1, 1.12, 1).translate(0, 4.4, 0)), 0xffffff);
    const stripe = colorize(clean(new THREE.SphereGeometry(2.42, 10, 3, 0, Math.PI * 2, Math.PI * 0.32, Math.PI * 0.2).scale(1, 1.12, 1).translate(0, 4.4, 0)), 0xfff3d9);
    const skirt = colorize(clean(new THREE.ConeGeometry(1.0, 0.9, 8).rotateX(Math.PI).translate(0, 2.65, 0)), 0x8a6a52);
    const basket = colorize(clean(new THREE.BoxGeometry(0.78, 0.6, 0.78).translate(0, 1.6, 0)), 0xffffff);
    const rope1 = colorize(clean(new THREE.CylinderGeometry(0.016, 0.016, 1.15, 4).rotateZ(0.12).translate(-0.42, 2.4, -0.42)), 0x6b5138);
    const rope2 = colorize(clean(new THREE.CylinderGeometry(0.016, 0.016, 1.15, 4).rotateZ(-0.12).translate(0.42, 2.4, -0.42)), 0x6b5138);
    const rope3 = colorize(clean(new THREE.CylinderGeometry(0.016, 0.016, 1.15, 4).rotateX(0.12).translate(-0.42, 2.4, 0.42)), 0x6b5138);
    const rope4 = colorize(clean(new THREE.CylinderGeometry(0.016, 0.016, 1.15, 4).rotateX(-0.12).translate(0.42, 2.4, 0.42)), 0x6b5138);
    return mergeGeometries([env, stripe, skirt, basket, rope1, rope2, rope3, rope4]);
  })();

  // 30. Dark dreamcore monolith
  const monolith = (() => {
    const slab = colorize(clean(new THREE.BoxGeometry(1.15, 6.8, 0.55).rotateZ(0.035).translate(0, 3.4, 0)), 0xffffff);
    const cap = colorize(clean(new THREE.ConeGeometry(0.82, 0.9, 4).rotateY(Math.PI / 4).rotateZ(0.035).translate(0.12, 7.2, 0)), 0xf2f2f8);
    return mergeGeometries([slab, cap]);
  })();

  // 31. Weathered stone arch
  const arch = (() => {
    const ring = colorize(clean(new THREE.TorusGeometry(3.0, 0.52, 7, 13, Math.PI).translate(0, 0.55, 0)), 0xffffff);
    const footL = colorize(clean(new THREE.BoxGeometry(0.9, 0.7, 0.9).translate(-2.95, 0.15, 0)), 0xf0f0f0);
    const footR = colorize(clean(new THREE.BoxGeometry(0.9, 0.7, 0.9).translate(2.95, 0.15, 0)), 0xf0f0f0);
    return mergeGeometries([ring, footL, footR]);
  })();

  // 32. Standing stone / menhir (placed in henge rings)
  const standingStone = colorize(clean(new THREE.CylinderGeometry(0.28, 0.52, 2.5, 5).translate(0, 1.25, 0)), 0xffffff);

  // ------------------------------------------------------------- materials
  const foliageMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0, flatShading: true });
  const pillarMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.05 });
  const signMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const snowMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
  const cactusMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  const hayMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0, flatShading: true });
  const lilyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
  const monolithMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.35, metalness: 0.15,
    emissive: 0x1a1430, emissiveIntensity: 0.35,
  });

  const crystalMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.2, metalness: 0.25,
    emissive: 0x112233, emissiveIntensity: 0.45,
  });
  const lanternMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.5,
    emissive: 0x442a12, emissiveIntensity: 0.75,
  });
  const mushroomMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.55, flatShading: true,
    emissive: 0x2a1f3a, emissiveIntensity: 0.3,
  });

  // Floating objects material with vertex shader bobbing (per-instance phase)
  const bob = (speed, amp, swayAmp, emissive) => {
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.22, metalness: 0.35,
      emissive, emissiveIntensity: 0.45,
    });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = floatingTimeUniform;
      shader.vertexShader = `uniform float uTime;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        ${INSTANCE_PHASE}
        float bob = sin(uTime * ${speed.toFixed(3)} + iph) * ${amp.toFixed(3)};
        float sway = cos(uTime * ${(speed * 0.7).toFixed(3)} + iph * 1.3) * ${swayAmp.toFixed(3)};
        transformed.y += bob;
        transformed.x += sway;
        `
      );
    };
    return m;
  };

  const floatingMat = bob(1.35, 0.75, 0.3, 0x221533);
  const balloonMat = bob(0.55, 1.25, 0.5, 0x2a1a30);

  // Windmill sails: continuous rotation around the local Z (hub) axis
  const bladesMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  bladesMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = floatingTimeUniform;
    shader.vertexShader = `uniform float uTime;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      ${INSTANCE_PHASE}
      float wang = uTime * 1.15 + iph;
      float wc = cos(wang), ws = sin(wang);
      mat2 wrot = mat2(wc, ws, -ws, wc);
      transformed.xy = wrot * transformed.xy;
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
    cactus: { geo: cactus, mat: cactusMat },
    deadTree: { geo: deadTree, mat: woodMat },
    tumbleweed: { geo: tumbleweed, mat: foliageMat },
    palm: { geo: palm, mat: foliageMat },
    reed: { geo: reed, mat: foliageMat },
    lilyPad: { geo: lilyPad, mat: lilyMat, castShadow: false },
    snowPine: { geo: snowPine, mat: foliageMat },
    snowman: { geo: snowman, mat: snowMat },
    autumnTree: { geo: autumnTree, mat: foliageMat },
    sunflower: { geo: sunflower, mat: foliageMat },
    mushroom: { geo: mushroom, mat: mushroomMat },
    log: { geo: log, mat: woodMat },
    fence: { geo: fence, mat: woodMat },
    hayBale: { geo: hayBale, mat: hayMat },
    windmill: { geo: windmill, mat: pillarMat },
    windmillBlades: { geo: windmillBlades, mat: bladesMat, castShadow: false },
    balloon: { geo: balloon, mat: balloonMat, castShadow: false },
    monolith: { geo: monolith, mat: monolithMat },
    arch: { geo: arch, mat: rockMat },
    standingStone: { geo: standingStone, mat: rockMat },
  };
}

/** Dial every glowing prop up as darkness falls (called from applyTime). */
export function setPropNight(mats, n) {
  mats.lantern.mat.emissiveIntensity = 0.35 + n * 2.6;
  mats.crystal.mat.emissiveIntensity = 0.3 + n * 1.3;
  mats.mushroom.mat.emissiveIntensity = 0.3 + n * 1.8;
  mats.floatingDiamond.mat.emissiveIntensity = 0.45 + n * 1.4;
  mats.floatingRing.mat.emissiveIntensity = 0.45 + n * 1.4;
  mats.balloon.mat.emissiveIntensity = 0.25 + n * 1.1;
  mats.monolith.mat.emissiveIntensity = 0.2 + n * 1.2;
}
