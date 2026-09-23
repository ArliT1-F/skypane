// A small procedural low-poly car, in the spirit of a boxy 80s hatchback.
import * as THREE from 'three';

export const CAR_COLORS = {
  sage: 0x8fa58a,
  cream: 0xe9dfc6,
  coral: 0xd9725e,
  ocean: 0x3d6f8f,
  ink: 0x2a2d33,
  mustard: 0xd8a93b,
};

function extrudeSide(points, width) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1 });
  g.translate(0, 0, -width / 2);
  // profile is drawn in (z, y); rotate so +x of shape -> -z (forward) of car
  g.rotateY(Math.PI / 2);
  return g;
}

export function buildCar(colorHex) {
  const car = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.38, metalness: 0.15 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.08, metalness: 0.6 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xcfd3d6, roughness: 0.25, metalness: 0.9 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6dd, emissive: 0xfff1c9, emissiveIntensity: 0.2, roughness: 0.2 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x8a1010, emissive: 0xff2a1a, emissiveIntensity: 0.25, roughness: 0.3 });

  const body = new THREE.Group();
  car.add(body);

  // lower body profile (x = forward along car, y = up), car length ~4.1m
  const lower = extrudeSide(
    [
      [-2.05, 0.32],
      [2.05, 0.32],
      [2.1, 0.62],
      [1.95, 0.86],
      [-1.9, 0.9],
      [-2.08, 0.72],
    ],
    1.66,
  );
  const lowerMesh = new THREE.Mesh(lower, paint);
  lowerMesh.castShadow = true;
  body.add(lowerMesh);

  // cabin
  const cabin = extrudeSide(
    [
      [-1.75, 0.88],
      [1.05, 0.88],
      [0.35, 1.42],
      [-1.45, 1.44],
      [-1.8, 1.0],
    ],
    1.44,
  );
  const cabinMesh = new THREE.Mesh(cabin, paint);
  cabinMesh.castShadow = true;
  body.add(cabinMesh);

  // glass band (slightly inset shell of the cabin)
  const glassGeo = extrudeSide(
    [
      [-1.68, 0.95],
      [0.98, 0.95],
      [0.36, 1.37],
      [-1.4, 1.39],
      [-1.73, 1.03],
    ],
    1.5,
  );
  body.add(new THREE.Mesh(glassGeo, glass));

  // bumpers
  const bumperGeo = new THREE.BoxGeometry(1.78, 0.2, 0.22);
  const fb = new THREE.Mesh(bumperGeo, trim);
  fb.position.set(0, 0.4, -2.12);
  const rb = fb.clone();
  rb.position.z = 2.1;
  body.add(fb, rb);

  // lights
  const hl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.06), headMat);
  hl.position.set(-0.58, 0.68, -2.1);
  const hr = hl.clone();
  hr.position.x = 0.58;
  const tl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.06), tailMat);
  tl.position.set(-0.6, 0.72, 2.08);
  const tr = tl.clone();
  tr.position.x = 0.6;
  body.add(hl, hr, tl, tr);

  // grille
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.14, 0.05), trim);
  grille.position.set(0, 0.66, -2.12);
  body.add(grille);

  // mirrors
  const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.1), trim);
  mirror.position.set(-0.86, 1.0, -0.65);
  const mirror2 = mirror.clone();
  mirror2.position.x = 0.86;
  body.add(mirror, mirror2);

  // roof rack
  for (const z of [-0.9, 0.0]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.04, 0.05), chrome);
    bar.position.set(0, 1.5, z);
    body.add(bar);
  }

  // wheels
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 16).rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.26, 8).rotateZ(Math.PI / 2);
  const tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  const wheels = [];
  const wpos = [
    [-0.78, -1.32, true],
    [0.78, -1.32, true],
    [-0.78, 1.3, false],
    [0.78, 1.3, false],
  ];
  for (const [x, z, front] of wpos) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.34, z);
    const spin = new THREE.Group();
    const w = new THREE.Mesh(wheelGeo, tire);
    w.castShadow = true;
    const hub = new THREE.Mesh(hubGeo, chrome);
    spin.add(w, hub);
    pivot.add(spin);
    car.add(pivot);
    wheels.push({ pivot, spin, front });
  }

  // headlight beams (only visible at night)
  const beams = [];
  for (const x of [-0.58, 0.58]) {
    const spot = new THREE.SpotLight(0xfff0d0, 0, 90, 0.42, 0.55, 1.4);
    spot.position.set(x, 0.7, -2.0);
    spot.target.position.set(x * 1.4, 0, -30);
    spot.castShadow = false;
    car.add(spot, spot.target);
    beams.push(spot);
  }

  // soft blob shadow for when real shadows are off / far away
  const blobTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  })();
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 5.0).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
  );
  blob.position.y = 0.03;
  blob.renderOrder = 2;
  car.add(blob);

  return {
    group: car,
    body,
    wheels,
    beams,
    paint,
    headMat,
    tailMat,
    setColor(hex) {
      paint.color.setHex(hex);
    },
  };
}
