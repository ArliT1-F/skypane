import { World } from './world.js';

let world = null;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    world = new World(msg.seed);
    return;
  }
  if (msg.type === 'build' && world) {
    const r = world.buildChunk(msg.cx, msg.cz, msg.segs, msg.props);
    const transfer = [r.pos.buffer, r.nor.buffer, r.col.buffer];
    for (const k of ['conifer', 'broad', 'rock']) {
      if (r[k]) transfer.push(r[k].mats.buffer, r[k].cols.buffer);
    }
    self.postMessage({ type: 'chunk', id: msg.id, gen: msg.gen, data: r }, transfer);
  }
};
