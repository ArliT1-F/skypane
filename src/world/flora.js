// Low-poly scenery geometry. Each piece carries vertex colors so the trunk and foliage
// read differently even though the whole thing is tinted per-instance.
import * as THREE from 'three';

function colorize(geo, r, g, b) {
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = r;
    c[i * 3 + 1] = g;
    c[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

/** Slightly shade the lower foliage vertices for fake ambient occlusion. */
function shadeByHeight(geo, y0, y1, dark = 0.72) {
  const p = geo.attributes.position;
  const c = geo.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const t = THREE.MathUtils.clamp((p.getY(i) - y0) / (y1 - y0), 0, 1);
    const k = dark + (1 - dark) * t;
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  return geo;
}

function merge(geos) {
  // tiny non-indexed merger to avoid pulling in addons
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

const TRUNK = [0.62, 0.5, 0.42];

function jitter(geo, amt, seed = 1) {
  const p = geo.attributes.position;
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + r() * amt, p.getY(i) + r() * amt * 0.6, p.getZ(i) + r() * amt);
  }
  geo.computeVertexNormals();
  return geo;
}

export function makePine() {
  const trunk = colorize(new THREE.CylinderGeometry(0.18, 0.28, 2.2, 5).translate(0, 1.1, 0), ...TRUNK);
  const layers = [];
  const tiers = [
    [2.4, 3.6, 1.6],
    [1.9, 3.2, 3.6],
    [1.3, 2.8, 5.4],
    [0.7, 2.0, 7.0],
  ];
  tiers.forEach(([r, h, y], i) => {
    const g = new THREE.ConeGeometry(r, h, 7, 1).translate(0, y + h / 2 - 0.4, 0);
    g.rotateY(i * 0.7);
    colorize(g, 1, 1, 1);
    layers.push(g);
  });
  const g = merge([trunk, ...layers]);
  shadeByHeight(g, 1, 9, 0.65);
  return g;
}

export function makeRound() {
  const trunk = colorize(new THREE.CylinderGeometry(0.2, 0.32, 3, 5).translate(0, 1.5, 0), ...TRUNK);
  const a = colorize(jitter(new THREE.IcosahedronGeometry(2.5, 1), 0.35, 3).translate(0, 4.6, 0), 1, 1, 1);
  const b = colorize(jitter(new THREE.IcosahedronGeometry(1.8, 1), 0.3, 7).translate(1.3, 3.7, 0.5), 1, 1, 1);
  const c = colorize(jitter(new THREE.IcosahedronGeometry(1.7, 1), 0.3, 11).translate(-1.1, 3.9, -0.7), 1, 1, 1);
  const g = merge([trunk, a, b, c]);
  shadeByHeight(g, 2, 7, 0.62);
  return g;
}

export function makeCactus() {
  const mk = (r, h) => new THREE.CylinderGeometry(r, r, h, 7);
  const main = colorize(mk(0.35, 4.2).translate(0, 2.1, 0), 1, 1, 1);
  const top = colorize(new THREE.SphereGeometry(0.35, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 4.2, 0), 1, 1, 1);
  const armL1 = colorize(mk(0.25, 1.1).rotateZ(Math.PI / 2).translate(-0.8, 1.9, 0), 1, 1, 1);
  const armL2 = colorize(mk(0.25, 1.4).translate(-1.3, 2.6, 0), 1, 1, 1);
  const armR1 = colorize(mk(0.23, 0.9).rotateZ(Math.PI / 2).translate(0.7, 2.6, 0), 1, 1, 1);
  const armR2 = colorize(mk(0.23, 1.1).translate(1.1, 3.1, 0), 1, 1, 1);
  const g = merge([main, top, armL1, armL2, armR1, armR2]);
  shadeByHeight(g, 0, 4, 0.75);
  return g;
}

export function makeShrub() {
  const a = colorize(jitter(new THREE.IcosahedronGeometry(0.9, 0), 0.2, 5).scale(1, 0.7, 1).translate(0, 0.45, 0), 1, 1, 1);
  const b = colorize(jitter(new THREE.IcosahedronGeometry(0.6, 0), 0.15, 9).scale(1, 0.7, 1).translate(0.7, 0.3, 0.3), 1, 1, 1);
  const g = merge([a, b]);
  shadeByHeight(g, 0, 1, 0.7);
  return g;
}

export function makeRock() {
  const g = jitter(new THREE.IcosahedronGeometry(1.2, 0), 0.45, 13).scale(1.3, 0.75, 1).translate(0, 0.3, 0);
  colorize(g, 1, 1, 1);
  shadeByHeight(g, -0.5, 1.2, 0.7);
  return g;
}

export const FLORA_BUILDERS = {
  pine: makePine,
  round: makeRound,
  cactus: makeCactus,
  shrub: makeShrub,
  rock: makeRock,
};

// size ranges for each type
export const FLORA_SCALE = {
  pine: [0.75, 1.5],
  round: [0.8, 1.35],
  cactus: [0.7, 1.25],
  shrub: [0.7, 1.6],
  rock: [0.5, 2.2],
};
