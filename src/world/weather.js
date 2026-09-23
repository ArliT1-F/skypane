// Rain / snow particles that live in a box around the camera.
import * as THREE from 'three';

export const WEATHER = {
  clear: { label: 'Clear', overcast: 0, fog: 0, precip: 0 },
  cloudy: { label: 'Cloudy', overcast: 0.55, fog: 0.1, precip: 0 },
  foggy: { label: 'Fog', overcast: 0.5, fog: 0.72, precip: 0 },
  rain: { label: 'Rain', overcast: 0.85, fog: 0.35, precip: 1 },
  snow: { label: 'Snowfall', overcast: 0.7, fog: 0.4, precip: 1 },
};

const BOX = 60;
const HEIGHT = 40;

export class Precipitation {
  constructor(scene, count = 9000) {
    this.count = count;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random() * BOX;
      pos[i * 3 + 1] = Math.random() * HEIGHT;
      pos[i * 3 + 2] = Math.random() * BOX;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.uniforms = {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uVel: { value: new THREE.Vector3() },
      uMode: { value: 0 }, // 0 rain, 1 snow
      uAmount: { value: 0 },
      uColor: { value: new THREE.Color(0xffffff) },
      uScale: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float seed;
        uniform float uTime, uMode, uAmount, uScale;
        uniform vec3 uCam, uVel;
        varying float vA;
        varying float vMode;
        void main() {
          vec3 p = position;
          float fall = mix(14.0, 1.6, uMode) * (0.8 + seed * 0.4);
          p.y -= uTime * fall;
          // snow sways
          p.x += uMode * sin(uTime * 0.9 + seed * 40.0) * 0.9;
          p.z += uMode * cos(uTime * 0.7 + seed * 30.0) * 0.9;
          // wrap into a box centred on the camera
          vec3 box = vec3(${BOX.toFixed(1)}, ${HEIGHT.toFixed(1)}, ${BOX.toFixed(1)});
          vec3 origin = uCam - box * 0.5;
          p = mod(p - origin, box) + origin;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float visible = step(seed, uAmount);
          float d = -mv.z;
          gl_PointSize = visible * mix(1.6, 3.2, uMode) * uScale * (30.0 / max(d, 2.0));
          vA = visible * smoothstep(${(BOX * 0.5).toFixed(1)}, 4.0, d) * smoothstep(0.5, 2.5, d);
          vMode = uMode;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vA;
        varying float vMode;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a;
          if (vMode > 0.5) {
            a = smoothstep(0.5, 0.15, length(c));
          } else {
            // streak
            a = smoothstep(0.14, 0.0, abs(c.x)) * smoothstep(0.5, 0.0, abs(c.y) * 0.9);
          }
          gl_FragColor = vec4(uColor, a * vA * mix(0.45, 0.9, vMode));
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
    this.amount = 0;
  }

  update(dt, camera, mode, target, brightness, scale) {
    this.amount += (target - this.amount) * Math.min(1, dt * 0.8);
    const u = this.uniforms;
    u.uTime.value += dt;
    u.uCam.value.copy(camera.position);
    u.uMode.value = mode === 'snow' ? 1 : 0;
    u.uAmount.value = this.amount;
    u.uScale.value = scale;
    u.uColor.value.setScalar(0.35 + brightness * 0.65);
    this.points.visible = this.amount > 0.01;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
