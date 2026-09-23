import * as THREE from 'three';
import { ROAD_HALF, SHOULDER, LANE_WIDTH, WATER_LEVEL, ROAD_STEP } from './world.js';
import { clamp, lerp } from './noise.js';

// ----------------------------------------------------------------------------- vehicles
export const VEHICLES = {
  coupe: {
    label: 'coupe',
    length: 4.3, width: 1.85, wheelBase: 2.55, wheelR: 0.34, track: 1.58,
    profile: [[-2.15, 0.32], [2.15, 0.32], [2.2, 0.62], [1.95, 0.78], [0.75, 0.9], [-0.05, 1.3], [-1.3, 1.3], [-2.0, 0.98], [-2.2, 0.8]],
    glass: [[0.62, 0.92], [-0.05, 1.26], [-1.25, 1.26], [-1.85, 0.97]],
    maxSpeed: 46, accel: 5.2, brake: 11, maxSteer: 0.52, mass: 1,
    engine: { base: 34, range: 95, gears: 6 },
  },
  wagon: {
    label: 'wagon',
    length: 4.6, width: 1.85, wheelBase: 2.75, wheelR: 0.35, track: 1.6,
    profile: [[-2.3, 0.33], [2.3, 0.33], [2.33, 0.66], [2.05, 0.84], [1.0, 0.95], [0.3, 1.42], [-2.1, 1.44], [-2.33, 1.2], [-2.35, 0.66]],
    glass: [[0.85, 0.97], [0.3, 1.38], [-2.05, 1.4], [-2.2, 0.98]],
    maxSpeed: 41, accel: 4.3, brake: 10, maxSteer: 0.5, mass: 1.15,
    engine: { base: 30, range: 80, gears: 5 },
  },
  van: {
    label: 'camper van',
    length: 4.9, width: 1.95, wheelBase: 3.0, wheelR: 0.37, track: 1.66,
    profile: [[-2.45, 0.34], [2.45, 0.34], [2.5, 0.8], [2.3, 1.1], [1.8, 1.95], [1.5, 2.05], [-2.4, 2.05], [-2.48, 1.9], [-2.5, 0.6]],
    glass: [[2.2, 1.12], [1.8, 1.88], [1.25, 1.9], [1.25, 1.12]],
    maxSpeed: 33, accel: 3.1, brake: 8, maxSteer: 0.46, mass: 1.5,
    engine: { base: 24, range: 60, gears: 5 },
    twoTone: true,
  },
  motorcycle: {
    label: 'motorcycle',
    isBike: true,
    length: 2.25, width: 0.82, wheelBase: 1.52, wheelR: 0.33, track: 0.2,
    maxSpeed: 48, accel: 7.2, brake: 13, maxSteer: 0.48, mass: 0.35,
    engine: { base: 45, range: 110, gears: 6 },
  },
};

export const COLORS = ['#e4572e', '#f3a712', '#2e86ab', '#3a7d44', '#f2efe9', '#2d2d34', '#b48ead', '#76b3a8'];

function buildBody(v, color) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.25 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.08, metalness: 0.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.85 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xcfd3d6, roughness: 0.25, metalness: 0.9 });

  const shape = new THREE.Shape(v.profile.map(([x, y]) => new THREE.Vector2(x, y)));
  const bodyW = v.width - 0.08;
  const bodyGeo = new THREE.ExtrudeGeometry(shape, {
    depth: bodyW, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2, curveSegments: 1,
  });
  bodyGeo.translate(0, 0, -bodyW / 2);
  bodyGeo.rotateY(-Math.PI / 2);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true;
  group.add(body);

  if (v.twoTone) {
    const upper = v.profile.filter(([, y]) => y > 1.0);
    const s2 = new THREE.Shape([new THREE.Vector2(2.18, 1.15), new THREE.Vector2(1.8, 1.96), new THREE.Vector2(1.5, 2.06), new THREE.Vector2(-2.41, 2.06), new THREE.Vector2(-2.49, 1.91), new THREE.Vector2(-2.5, 1.15)]);
    void upper;
    const g2 = new THREE.ExtrudeGeometry(s2, { depth: bodyW + 0.02, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2 });
    g2.translate(0, 0, -(bodyW + 0.02) / 2);
    g2.rotateY(-Math.PI / 2);
    const m2 = new THREE.Mesh(g2, new THREE.MeshStandardMaterial({ color: 0xf4efe3, roughness: 0.5 }));
    m2.castShadow = true;
    group.add(m2);
  }

  // side windows
  const gShape = new THREE.Shape(v.glass.map(([x, y]) => new THREE.Vector2(x, y)));
  const gw = bodyW + 0.14;
  const glassGeo = new THREE.ExtrudeGeometry(gShape, { depth: gw, bevelEnabled: false });
  glassGeo.translate(0, 0, -gw / 2);
  glassGeo.rotateY(-Math.PI / 2);
  group.add(new THREE.Mesh(glassGeo, glassMat));

  if (!v.twoTone) {
    const front = v.glass[0], topF = v.glass[1];
    const fsx = (front[0] + topF[0]) / 2, fsy = (front[1] + topF[1]) / 2;
    const flen = Math.hypot(front[0] - topF[0], front[1] - topF[1]);
    const ws = new THREE.Mesh(new THREE.BoxGeometry(bodyW - 0.12, 0.03, flen), glassMat);
    ws.position.set(0, fsy + 0.04, fsx + 0.03);
    ws.rotation.x = Math.atan2(topF[1] - front[1], front[0] - topF[0]);
    group.add(ws);
    const rTop = v.glass[2], rBot = v.glass[3];
    const rlen = Math.hypot(rTop[0] - rBot[0], rTop[1] - rBot[1]);
    const rw = new THREE.Mesh(new THREE.BoxGeometry(bodyW - 0.2, 0.03, rlen * 0.9), glassMat);
    rw.position.set(0, (rTop[1] + rBot[1]) / 2 + 0.05, (rTop[0] + rBot[0]) / 2 - 0.04);
    rw.rotation.x = -Math.atan2(rTop[1] - rBot[1], rTop[0] - rBot[0]);
    group.add(rw);
  } else {
    const ws = new THREE.Mesh(new THREE.BoxGeometry(bodyW - 0.2, 0.7, 0.04), glassMat);
    ws.position.set(0, 1.52, 2.07);
    ws.rotation.x = -0.45;
    group.add(ws);
  }

  const L = v.length / 2;
  const bump = new THREE.BoxGeometry(v.width - 0.1, 0.16, 0.18);
  const fb = new THREE.Mesh(bump, darkMat);
  fb.position.set(0, 0.4, L + 0.02);
  const rb = new THREE.Mesh(bump, darkMat);
  rb.position.set(0, 0.4, -L - 0.02);
  group.add(fb, rb);

  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6dd, emissive: 0xfff2cc, emissiveIntensity: 0.2 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x8a0b0b, emissive: 0xff2211, emissiveIntensity: 0.25 });
  const hl = new THREE.BoxGeometry(0.38, 0.12, 0.08);
  const tl = new THREE.BoxGeometry(0.42, 0.13, 0.08);
  const frontY = v.twoTone ? 0.72 : 0.6;
  const rearY = v.twoTone ? 0.95 : 0.72;
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(hl, headMat);
    h.position.set(s * (v.width / 2 - 0.32), frontY, L + 0.08);
    const t = new THREE.Mesh(tl, tailMat);
    t.position.set(s * (v.width / 2 - 0.3), rearY, -L - 0.09);
    group.add(h, t);
  }
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.03), new THREE.MeshStandardMaterial({ color: 0xf2f0e6, roughness: 0.5 }));
  plate.position.set(0, rearY - 0.02, -L - 0.08);
  group.add(plate);
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.12), bodyMat);
    m.position.set(s * (v.width / 2 + 0.08), v.twoTone ? 1.25 : 0.95, v.twoTone ? 1.75 : 0.65);
    group.add(m);
  }
  if (v.twoTone) {
    const rack = new THREE.Mesh(new THREE.BoxGeometry(v.width - 0.4, 0.06, 2.6), chromeMat);
    rack.position.set(0, 2.16, -0.6);
    group.add(rack);
  }
  return { group, headMat, tailMat, bodyMat };
}

function buildMotorcycle(v, color) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.35 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x161618, roughness: 0.85 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x36393f, roughness: 0.6, metalness: 0.65 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.18, metalness: 0.92 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6dd, emissive: 0xfff2cc, emissiveIntensity: 0.35 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x990f0f, emissive: 0xff2211, emissiveIntensity: 0.4 });
  const leatherMat = new THREE.MeshStandardMaterial({ color: 0x221e1d, roughness: 0.75 });

  // 1. Tubular chassis frame
  const frameGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6);
  frameGeo.rotateX(Math.PI / 3);
  const frameL = new THREE.Mesh(frameGeo, metalMat);
  frameL.position.set(-0.1, 0.58, 0.1);
  const frameR = frameL.clone();
  frameR.position.x = 0.1;
  group.add(frameL, frameR);

  // Bottom cradle tube
  const cradle = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.85), metalMat);
  cradle.position.set(0, 0.28, 0.0);
  group.add(cradle);

  // 2. Engine Block (V-twin with chrome cooling fins)
  const crank = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.3, 10), metalMat);
  crank.rotateZ(Math.PI / 2);
  crank.position.set(0, 0.42, 0.02);
  group.add(crank);

  const cyl1 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.26, 8), darkMat);
  cyl1.rotateX(0.28);
  cyl1.position.set(0, 0.58, 0.14);
  const cyl2 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.26, 8), darkMat);
  cyl2.rotateX(-0.28);
  cyl2.position.set(0, 0.58, -0.12);
  group.add(cyl1, cyl2);

  // Chrome exhaust pipe & muffler
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.75, 8), chromeMat);
  pipe.rotateX(Math.PI / 2.2);
  pipe.position.set(0.17, 0.38, -0.2);
  const muffler = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.052, 0.62, 10), chromeMat);
  muffler.rotateX(Math.PI / 2.15);
  muffler.position.set(0.18, 0.43, -0.65);
  group.add(pipe, muffler);

  // 3. Fuel Tank (sculpted teardrop shape in body color)
  const tankShape = new THREE.Shape();
  tankShape.moveTo(-0.28, 0);
  tankShape.quadraticCurveTo(0.0, 0.18, 0.32, 0.12);
  tankShape.quadraticCurveTo(0.4, 0.0, 0.35, -0.07);
  tankShape.quadraticCurveTo(0.0, -0.12, -0.28, -0.05);
  tankShape.closePath();
  const tankGeo = new THREE.ExtrudeGeometry(tankShape, {
    depth: 0.36, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 2,
  });
  tankGeo.translate(0, 0, -0.18);
  tankGeo.rotateY(-Math.PI / 2);
  const tank = new THREE.Mesh(tankGeo, bodyMat);
  tank.position.set(0, 0.82, 0.22);
  tank.castShadow = true;
  group.add(tank);

  // Chrome fuel cap
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 10), chromeMat);
  cap.position.set(0, 0.99, 0.22);
  group.add(cap);

  // 4. Contoured saddle seat
  const seatShape = new THREE.Shape();
  seatShape.moveTo(-0.38, 0);
  seatShape.lineTo(0.12, 0);
  seatShape.quadraticCurveTo(0.14, -0.06, -0.05, -0.08);
  seatShape.lineTo(-0.36, -0.06);
  seatShape.closePath();
  const seatGeo = new THREE.ExtrudeGeometry(seatShape, {
    depth: 0.26, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 2,
  });
  seatGeo.translate(0, 0, -0.13);
  seatGeo.rotateY(-Math.PI / 2);
  const seat = new THREE.Mesh(seatGeo, leatherMat);
  seat.position.set(0, 0.81, -0.18);
  seat.castShadow = true;
  group.add(seat);

  // 5. Tail cowl & rear assembly
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.38), bodyMat);
  tail.position.set(0, 0.82, -0.56);
  tail.castShadow = true;
  group.add(tail);

  // Rear LED brake light
  const tl = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.065, 0.05), tailMat);
  tl.position.set(0, 0.82, -0.76);
  group.add(tl);

  // License plate
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.11, 0.02), new THREE.MeshStandardMaterial({ color: 0xf2f0e6, roughness: 0.6 }));
  plate.position.set(0, 0.68, -0.75);
  plate.rotation.x = -0.22;
  group.add(plate);

  // Rear swingarm
  const swingarmL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.055, 0.58), metalMat);
  swingarmL.position.set(-0.11, 0.35, -0.45);
  const swingarmR = swingarmL.clone();
  swingarmR.position.x = 0.11;
  group.add(swingarmL, swingarmR);

  // 6. Steerable Front Fork Assembly
  const forkGroup = new THREE.Group();
  forkGroup.position.set(0, 0.76, 0.56);

  // Fork stanchions
  for (const s of [-1, 1]) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.82, 8), chromeMat);
    tube.position.set(s * 0.11, -0.22, 0);
    tube.rotation.x = 0.36; // rake
    forkGroup.add(tube);
  }

  // Handlebars
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.72, 8), chromeMat);
  bar.rotateZ(Math.PI / 2);
  bar.position.set(0, 0.26, -0.02);
  forkGroup.add(bar);

  // Grips & mirrors
  for (const s of [-1, 1]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.14, 8), darkMat);
    grip.rotateZ(Math.PI / 2);
    grip.position.set(s * 0.28, 0.26, -0.02);
    forkGroup.add(grip);

    const mirrorStem = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.13, 6), chromeMat);
    mirrorStem.position.set(s * 0.31, 0.33, 0.03);
    const mirrorHead = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.014, 10), chromeMat);
    mirrorHead.rotateX(Math.PI / 2);
    mirrorHead.position.set(s * 0.31, 0.41, 0.03);
    forkGroup.add(mirrorStem, mirrorHead);
  }

  // Speedometer
  const speedo = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.035, 10), darkMat);
  speedo.position.set(0, 0.27, 0.05);
  forkGroup.add(speedo);

  // Round chrome LED headlight
  const hlHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.13, 12), chromeMat);
  hlHousing.rotateX(Math.PI / 2);
  hlHousing.position.set(0, 0.14, 0.15);
  const hlLens = new THREE.Mesh(new THREE.CylinderGeometry(0.098, 0.098, 0.02, 12), headMat);
  hlLens.rotateX(Math.PI / 2);
  hlLens.position.set(0, 0.14, 0.22);
  forkGroup.add(hlHousing, hlLens);

  // Front fender
  const fenderGeo = new THREE.CylinderGeometry(v.wheelR + 0.04, v.wheelR + 0.04, 0.13, 12, 1, true, 0, Math.PI * 0.58);
  fenderGeo.rotateZ(Math.PI / 2);
  fenderGeo.rotateY(Math.PI * 0.22);
  const fender = new THREE.Mesh(fenderGeo, bodyMat);
  fender.position.set(0, -0.4, 0.16);
  forkGroup.add(fender);

  group.add(forkGroup);

  return { group, headMat, tailMat, bodyMat, forkGroup };
}

function buildWheel(v) {
  const tyre = new THREE.CylinderGeometry(v.wheelR, v.wheelR, 0.24, 18);
  tyre.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(v.wheelR * 0.58, v.wheelR * 0.58, 0.25, 10);
  hub.rotateZ(Math.PI / 2);
  const tyreM = new THREE.Mesh(tyre, new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.9 }));
  const hubM = new THREE.Mesh(hub, new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.3, metalness: 0.8 }));
  tyreM.castShadow = true;
  const w = new THREE.Group();
  w.add(tyreM, hubM);
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.26, v.wheelR * 1.1, 0.06), hubM.material);
  const spoke2 = spoke.clone();
  spoke2.rotation.x = Math.PI / 2;
  w.add(spoke, spoke2);
  return w;
}

function buildMotorcycleWheel(v) {
  const tyre = new THREE.CylinderGeometry(v.wheelR, v.wheelR, 0.11, 20);
  tyre.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(v.wheelR * 0.52, v.wheelR * 0.52, 0.12, 12);
  hub.rotateZ(Math.PI / 2);
  const tyreM = new THREE.Mesh(tyre, new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.9 }));
  const hubM = new THREE.Mesh(hub, new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.3, metalness: 0.85 }));
  tyreM.castShadow = true;
  const w = new THREE.Group();
  w.add(tyreM, hubM);

  // Chrome brake disc
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(v.wheelR * 0.68, v.wheelR * 0.68, 0.015, 14),
    new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.92, roughness: 0.2 })
  );
  disc.rotateZ(Math.PI / 2);
  disc.position.x = 0.068;
  w.add(disc);

  // Slender spokes
  const spokeMat = hubM.material;
  for (let a = 0; a < 3; a++) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.12, v.wheelR * 1.05, 0.025), spokeMat);
    sp.rotation.x = (a * Math.PI) / 3;
    w.add(sp);
  }
  return w;
}

// ----------------------------------------------------------------------------- the car
export class Car {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.chassis = new THREE.Group();
    this.root.add(this.chassis);
    scene.add(this.root);

    this.headlight = new THREE.SpotLight(0xfff1d6, 0, 95, 0.55, 0.55, 1.2);
    this.headlight.position.set(0, 0.8, 1.8);
    this.headlight.target.position.set(0, -1.5, 25);
    this.chassis.add(this.headlight, this.headlight.target);

    this.x = 0; this.y = 0; this.z = 0;
    this.heading = 0;
    this.speed = 0;
    this.vy = 0;
    this.steer = 0;
    this.smoothedSteer = 0;
    this.yawRate = 0;
    this.lateralVel = 0;
    this.lean = 0;
    this.pitch = 0; this.roll = 0;
    this.wheelSpin = 0;
    this.roadIndex = 0;
    this.lateral = 0;
    this.offRoad = 0;
    this.distance = 0;
    this.gearRatio = 0;
    this.rpm = 0;
    this.throttleVis = 0;
    this.forkGroup = null;
    this.setVehicle('coupe', COLORS[0]);
  }

  setVehicle(type, color) {
    this.type = type;
    this.color = color;
    this.spec = VEHICLES[type];
    for (const c of [...this.chassis.children]) {
      if (c === this.headlight || c === this.headlight.target) continue;
      this.chassis.remove(c);
      c.traverse((o) => {
        if (o.isMesh) o.geometry.dispose();
      });
    }
    const v = this.spec;
    this.forkGroup = null;
    this.wheels = [];

    if (v.isBike) {
      const { group, headMat, tailMat, forkGroup } = buildMotorcycle(v, color);
      this.headMat = headMat;
      this.tailMat = tailMat;
      this.body = group;
      this.forkGroup = forkGroup;
      this.chassis.add(group);

      // Two motorcycle wheels (front and rear)
      const wRear = buildMotorcycleWheel(v);
      wRear.position.set(0, v.wheelR, -v.wheelBase / 2);
      wRear.userData.front = false;
      this.chassis.add(wRear);
      this.wheels.push(wRear);

      const wFront = buildMotorcycleWheel(v);
      wFront.position.set(0, v.wheelR, v.wheelBase / 2);
      wFront.userData.front = true;
      this.chassis.add(wFront);
      this.wheels.push(wFront);

      this.headlight.position.set(0, 0.85, 0.7);
    } else {
      const { group, headMat, tailMat } = buildBody(v, color);
      this.headMat = headMat;
      this.tailMat = tailMat;
      this.body = group;
      this.chassis.add(group);

      for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
        const w = buildWheel(v);
        w.position.set(sx * v.track / 2, v.wheelR, sz * v.wheelBase / 2);
        w.userData.front = sz > 0;
        this.chassis.add(w);
        this.wheels.push(w);
      }
      this.headlight.position.set(0, 0.8, v.length / 2);
    }
  }

  setNight(n) {
    this.headMat.emissiveIntensity = 0.2 + n * 3.2;
    this.headlight.intensity = n * 65;
    this.tailBase = 0.25 + n * 1.3;
  }

  placeOnRoad(world, index) {
    world.ensureRoadTo(world.rz[Math.min(index, world.length - 1)] + 1200);
    while (world.length <= index + 2) world.ensureRoadTo(world.rz[world.length - 1] + 200);
    const h = world.rh[index];
    const off = -LANE_WIDTH / 2;
    this.x = world.rx[index] + Math.cos(h) * off;
    this.z = world.rz[index] - Math.sin(h) * off;
    this.heading = h;
    this.speed = 0;
    this.vy = 0;
    this.steer = 0;
    this.smoothedSteer = 0;
    this.yawRate = 0;
    this.lateralVel = 0;
    this.lean = 0;
    this.roadIndex = index;
    this.y = this.groundAt(world, this.x, this.z);
    this.pitch = this.roll = 0;
  }

  groundAt(world, x, z) {
    const r = world.heightAt(x, z);
    const edge = ROAD_HALF + SHOULDER;
    if (r.d < edge) {
      const drop = r.d > ROAD_HALF ? ((r.d - ROAD_HALF) / SHOULDER) * 0.12 : 0;
      return r.ry - drop;
    }
    return r.h;
  }

  /**
   * input: { throttle 0..1, brake 0..1, steer -1..1 (positive = left) }
   */
  update(dt, world, input, autodrive) {
    const v = this.spec;

    // ------------------------------------------------ road tracking
    this.roadIndex = world.nearestIndex(this.x, this.z, this.roadIndex);
    world.ensureRoadTo(world.rz[this.roadIndex] + 1400);
    const i = this.roadIndex;
    const rh = world.rh[i];
    const lx = Math.cos(rh), lz = -Math.sin(rh);
    this.lateral = (this.x - world.rx[i]) * lx + (this.z - world.rz[i]) * lz;
    const absLat = Math.abs(this.lateral);
    const offRoadTarget = absLat > ROAD_HALF + SHOULDER ? 1 : absLat > ROAD_HALF + 0.2 ? 0.4 : 0;
    this.offRoad = lerp(this.offRoad, offRoadTarget, 1 - Math.exp(-dt * 10));

    let { throttle, brake, steer } = input;

    if (autodrive) {
      // Slow Roads autodrive pure-pursuit: smooth, lookahead tracking
      const look = clamp(12 + this.speed * 1.1, 14, 52);
      const j = Math.min(world.length - 1, i + Math.round(look / ROAD_STEP));
      const th = world.rh[j];
      const off = -LANE_WIDTH / 2;
      const tx = world.rx[j] + Math.cos(th) * off;
      const tz = world.rz[j] - Math.sin(th) * off;
      const dx = tx - this.x, dz = tz - this.z;
      let ang = Math.atan2(dx, dz) - this.heading;
      ang = Math.atan2(Math.sin(ang), Math.cos(ang));
      const desiredSteer = Math.atan2(2 * v.wheelBase * Math.sin(ang), Math.hypot(dx, dz));
      steer = clamp(desiredSteer / (v.maxSteer * this.steerLimit()), -1, 1);

      let maxK = 0;
      for (let k = 0; k < 90; k += 3) maxK = Math.max(maxK, Math.abs(world.curvatureAt(Math.min(world.length - 1, i + k))));
      const target = Math.min(this.cruise ?? v.maxSpeed * 0.65, Math.sqrt(3.6 / Math.max(maxK, 1e-4)));
      const err = target - this.speed;
      throttle = clamp(err * 0.35, 0, 1);
      brake = clamp(-err * 0.25, 0, 1);
    }

    // ------------------------------------------------ Slow Roads steering mechanics
    // 1. Non-linear input shaping: gentle near center, full turn on hold
    const steerSign = Math.sign(steer);
    const steerMag = Math.pow(Math.abs(steer), 1.35);
    const shapedSteer = steerSign * steerMag;

    // 2. Progressive input buildup:
    // Attack rate: smooth build-up so tapping gives micro-corrections
    // Return rate: snappy, critically damped recentering
    // Counter-steer: responsive transitions when reversing direction
    let steerRate = 2.4;
    if (steer === 0) {
      steerRate = 4.8;
    } else if (this.smoothedSteer !== 0 && Math.sign(steer) !== Math.sign(this.smoothedSteer)) {
      steerRate = 4.0;
    }
    this.smoothedSteer = (this.smoothedSteer || 0) + clamp(shapedSteer - (this.smoothedSteer || 0), -steerRate * dt, steerRate * dt);

    // 3. Speed-dependent steering angle limiter (prevents sharp twitchy snap at speed)
    const limit = this.steerLimit();
    const steerTarget = (autodrive ? steer : this.smoothedSteer) * v.maxSteer * limit;
    const steerTrackingRate = autodrive ? 3.5 : 8.0;
    this.steer += clamp(steerTarget - this.steer, -steerTrackingRate * dt, steerTrackingRate * dt);

    // ------------------------------------------------ longitudinal physics
    const g = 9.81;
    const slope = this.pitchSlope || 0;
    const offDrag = this.offRoad * 0.9;
    const maxSpd = v.maxSpeed * (1 - this.offRoad * 0.45);
    let acc = 0;
    if (throttle > 0) acc += throttle * v.accel * clamp(1.15 - this.speed / maxSpd, 0, 1);
    if (brake > 0) {
      if (this.speed > 0.5) acc -= brake * v.brake;
      else acc -= brake * 3.5;
    }
    acc -= g * slope / Math.sqrt(1 + slope * slope);
    acc -= this.speed * 0.011 + this.speed * Math.abs(this.speed) * 0.00032;
    acc -= Math.sign(this.speed) * offDrag;
    if (this.airborne) acc = 0;
    const prev = this.speed;
    this.speed += acc * dt;
    if (!throttle && prev > 0 && this.speed < 0 && brake < 0.01) this.speed = 0;
    if (brake > 0 && prev > 0.5 && this.speed < 0) this.speed = 0;
    this.speed = clamp(this.speed, -6, v.maxSpeed * 1.05);
    this.throttleVis = lerp(this.throttleVis, throttle, 1 - Math.exp(-dt * 6));

    // ------------------------------------------------ yaw & move (fluid momentum)
    const targetYawRate = (this.speed * Math.tan(this.steer)) / v.wheelBase;
    this.yawRate = lerp(this.yawRate || 0, targetYawRate, 1 - Math.exp(-dt * 13));
    if (!this.airborne) this.heading += this.yawRate * dt;

    // Lateral grip and weight momentum
    const latGrip = this.offRoad > 0.5 ? 6.0 : 16.0;
    this.lateralVel = lerp(this.lateralVel || 0, 0, 1 - Math.exp(-dt * latGrip));
    this.lateralVel += this.yawRate * this.speed * dt * (this.offRoad > 0.5 ? 0.22 : 0.05);
    this.lateralVel = clamp(this.lateralVel, -4, 4);

    const nfx = Math.sin(this.heading), nfz = Math.cos(this.heading);
    const nrx = Math.cos(this.heading), nrz = -Math.sin(this.heading);
    this.x += (nfx * this.speed + nrx * this.lateralVel) * dt;
    this.z += (nfz * this.speed + nrz * this.lateralVel) * dt;
    this.distance += Math.abs(this.speed) * dt;

    // ------------------------------------------------ ground contact
    let ground, pitchT, rollT;
    if (v.isBike) {
      const hb = v.wheelBase / 2;
      const hFront = this.groundAt(world, this.x + nfx * hb, this.z + nfz * hb);
      const hRear = this.groundAt(world, this.x - nfx * hb, this.z - nfz * hb);
      ground = (hFront + hRear) / 2;
      pitchT = Math.atan2(hFront - hRear, v.wheelBase);

      // Motorcycle banking physics: leans into turns proportional to speed & yaw rate
      const targetLean = clamp(-this.yawRate * this.speed * 0.09, -0.42, 0.42);
      this.lean = lerp(this.lean || 0, targetLean, 1 - Math.exp(-dt * 6.5));

      const hL = this.groundAt(world, this.x + nrx * 0.5, this.z + nrz * 0.5);
      const hR = this.groundAt(world, this.x - nrx * 0.5, this.z - nrz * 0.5);
      rollT = Math.atan2(hL - hR, 1.0) + this.lean;
      this.pitchSlope = Math.tan(pitchT);

      if (this.forkGroup) {
        this.forkGroup.rotation.y = this.steer * 1.15;
      }
    } else {
      const hw = v.track / 2, hb = v.wheelBase / 2;
      const hFL = this.groundAt(world, this.x + nfx * hb + nrx * hw, this.z + nfz * hb + nrz * hw);
      const hFR = this.groundAt(world, this.x + nfx * hb - nrx * hw, this.z + nfz * hb - nrz * hw);
      const hRL = this.groundAt(world, this.x - nfx * hb + nrx * hw, this.z - nfz * hb + nrz * hw);
      const hRR = this.groundAt(world, this.x - nfx * hb - nrx * hw, this.z - nfz * hb - nrz * hw);
      ground = (hFL + hFR + hRL + hRR) / 4;
      pitchT = Math.atan2((hFL + hFR) / 2 - (hRL + hRR) / 2, v.wheelBase);
      rollT = Math.atan2((hFL + hRL) / 2 - (hFR + hRR) / 2, v.track);
      this.pitchSlope = Math.tan(pitchT);
    }

    this.vy -= g * dt;
    this.y += this.vy * dt;
    if (this.y <= ground) {
      const impact = -this.vy;
      this.y = ground;
      this.vy = Math.max(0, (ground - (this.prevGround ?? ground)) / Math.max(dt, 1e-3));
      this.vy = Math.min(this.vy, 6);
      if (this.airborne && impact > 3) this.landBump = Math.min(impact * 0.02, 0.12);
      this.airborne = false;
    } else if (this.y > ground + 0.25) {
      this.airborne = true;
    }
    this.prevGround = ground;

    const k = 1 - Math.exp(-dt * (this.airborne ? 1.5 : 12));
    this.pitch = lerp(this.pitch, pitchT, k);
    this.roll = lerp(this.roll, rollT, k);

    // Body motion: lean in corners, squat under throttle, dive under braking
    const lat = this.yawRate * this.speed;
    this.bodyRoll = lerp(this.bodyRoll || 0, clamp(-lat * (v.isBike ? 0.002 : 0.006), -0.06, 0.06), 1 - Math.exp(-dt * 5));
    this.bodyPitch = lerp(this.bodyPitch || 0, clamp(-acc * 0.004, -0.04, 0.04), 1 - Math.exp(-dt * 5));
    this.landBump = (this.landBump || 0) * Math.exp(-dt * 8);
    const rumble = this.offRoad > 0.5 ? (Math.sin(this.distance * 7.1) * 0.5 + Math.sin(this.distance * 12.7) * 0.5) * 0.012 * Math.min(1, Math.abs(this.speed) / 8) : 0;

    // ------------------------------------------------ scene graph transforms
    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.set(0, this.heading, 0);
    this.chassis.rotation.set(-this.pitch, 0, this.roll, 'YXZ');
    this.body.rotation.set(-this.bodyPitch, 0, this.bodyRoll);
    this.body.position.y = (v.isBike ? 0.0 : 0.02) - this.landBump + rumble;

    this.wheelSpin += (this.speed * dt) / v.wheelR;
    for (const w of this.wheels) {
      w.rotation.set(this.wheelSpin, w.userData.front ? this.steer : 0, 0, 'YXZ');
    }

    // Brake lights
    const braking = brake > 0.05 && this.speed > 0.5;
    this.tailMat.emissiveIntensity = (this.tailBase ?? 0.25) + (braking ? 2.5 : 0);

    // Engine model for audio
    const gears = v.engine.gears;
    const spd = Math.abs(this.speed) / v.maxSpeed;
    const gear = Math.min(gears - 1, Math.floor(spd * gears * 0.999));
    const inGear = spd * gears - gear;
    const rpmT = 0.18 + 0.82 * (gear === 0 ? spd * gears : 0.35 + 0.65 * inGear) * (0.85 + 0.15 * this.throttleVis);
    this.rpm = lerp(this.rpm, clamp(rpmT, 0.15, 1.05), 1 - Math.exp(-dt * 8));
    this.gear = gear + 1;

    return this.y < WATER_LEVEL - 1.2;
  }

  steerLimit() {
    // Slow Roads speed-dependent steering limiter:
    // Keeps turns calm, smooth, and prevents high-speed sharp spinouts
    const spd = Math.abs(this.speed);
    const factor = 1.0 / (1.0 + Math.pow(spd / 6.8, 1.42));
    return Math.max(0.06, factor);
  }
}
