# zen drive

An endless, relaxing, procedurally generated driving game for the browser, inspired by
[slow roads](https://slowroads.io). There's no score, no traffic and no timer. You just drive.

Built with [three.js](https://threejs.org) and [Vite](https://vite.dev). It uses no game engine
and no asset files: the terrain, trees, cars, sky, music and engine sound are all generated in code.

## Features

- **Endless procedural world**: a winding two-lane road carved through rolling hills, forests,
  lakes and snow-capped mountains. Terrain streams in around you on Web Workers, with 5 LOD rings.
- **Seeds**: every road comes from a seed. Share a road with `?seed=123456`.
- **Time of day**: dawn, morning, noon, afternoon, sunset or night, plus an optional
  20-minute day/night cycle. Includes stars, a moon, headlights and glowing roadside reflectors.
- **Four vehicles** (coupe, wagon, camper van, motorcycle) in 8 colours.
- **Slow Roads progressive steering mechanics**: smooth, non-linear steering input, speed-dependent steering lock limiter, and realistic vehicle lateral momentum and grip physics.
- **Dreamcore & rich procedural world**: floating luminous octahedrons & dream rings, classical marble pillars, glowing ground crystals, flowering bushes, wildflower patches, dream blossom trees, roadside chevrons and vintage lanterns.
- **Dreamy aesthetics & particles**: floating dream dust and fireflies drifting through the air, painterly sky palettes, atmospheric fog, and dynamic motorcycle banking physics.
- **Autodrive** (`E`): the car follows the road on its own. Tap throttle to speed up; steer or brake to take over.
- **Four cameras** (`C`): chase, low chase, bonnet and cinematic roadside shots.
- **Generative audio**: ambient pad music, engine, road/wind/gravel noise, birds by day and crickets at night.
  All of it is synthesised with the Web Audio API.
- Keyboard, **gamepad** and **touch** controls. Settings are saved to `localStorage`.

## Controls

| key | action |
| --- | --- |
| `W A S D` / arrows | drive |
| `E` | toggle autodrive |
| `C` | cycle camera |
| `T` | cycle time of day |
| `H` | hide / show HUD |
| `R` | reset onto the road |
| `N` | new random road |
| `F` | fullscreen |
| `Esc` / `P` | pause |

Gamepad: triggers for throttle/brake, left stick to steer, `Y` camera, `X` autodrive, `B` reset, `Start` pause.

## Development

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
npm run preview  # serve the production build
```

Requires Node 20.19+ or 22.12+.

## Deploying to Vercel

This is a plain static site, so no server or environment variables are needed.

1. Import the repo in Vercel (or run `npx vercel`).
2. Vercel reads `vercel.json`: framework **Vite**, build `npm run build`, output `dist`.
3. Deploy.

## Project layout

```
index.html            UI markup (menu, pause, HUD, touch controls)
src/main.js           renderer, game loop, camera, UI wiring
src/world.js          seeded road generation + terrain height/colour/props (shared with worker)
src/terrain.js        chunk streaming & LOD, builds meshes from worker output
src/terrain.worker.js generates terrain chunks off the main thread
src/road.js           road ribbon meshes, procedural asphalt texture, reflector posts
src/car.js            vehicle models + arcade physics + autodrive
src/sky.js            sky shader (gradient, sun, moon, stars, clouds) + lighting palette
src/audio.js          Web Audio engine, ambience and generative music
src/input.js          keyboard / gamepad / touch
src/noise.js          seeded simplex noise helpers
```

## License

MIT
