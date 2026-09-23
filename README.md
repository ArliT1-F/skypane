# zen drive

An endless, procedurally generated driving game for the browser. No traffic, no score, no destination. Pick a landscape, turn on some music, and just drive.

It's inspired by [Slow Roads](https://slow-roads.github.io/) and other "zen driving" games like [elsewhere](https://github.com/yogeshwar-2004y/Elsewhere---Web-Based-Car-Game). It's built from scratch with [three.js](https://threejs.org/) and Vite. Every asset is generated in code: terrain, road, trees, sky, sound and music. There are no image or audio files.

## Features

- **An endless road.** The world is generated as you drive. The road steers toward valleys and along lake shores, eases over hills with a gentle grade, and crosses water on low causeways.
- **Four landscapes:** Meadow (pine forests and lakes), Autumn (copper woods), Desert (sandstone mesas and cacti) and Alpine (snowfields under tall peaks).
- **Time of day and weather.** Dawn, morning, noon, golden hour, sunset and a starry night. You can let time pass (one full day takes 20 minutes). Weather can be clear, cloudy, foggy, rain or snowfall.
- **Autodrive.** The car follows the road and slows down for bends. Press any driving key to nudge it or take over.
- **Cameras:** chase, wide, hood, and a cinematic mode that cycles through trackside, orbit and drone shots. Drag with the mouse to look around.
- **Procedural audio.** Engine sound with a fake 5-speed gearbox, wind, tyre rumble, rain, and an optional slow ambient pad with bell notes.
- **Seeds.** Type a word to get a road you can share, or leave the seed empty for a new road every time.
- **Forgiving.** You can't crash. If you drive into a lake or wander far away, the screen fades and you're put back on the road.
- **Keyboard, gamepad and touch controls.** The HUD fades while you drive calmly.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Accelerate | `W` / `↑` | RT / A |
| Brake / reverse | `S` / `↓` (`Space` = handbrake) | LT / B |
| Steer | `A` `D` / `←` `→` | left stick |
| Autodrive | `F` | RB |
| Next camera | `C` | Y |
| Change time of day | `T` | |
| Back to the road | `R` | X |
| Hide the HUD | `H` | |
| Music on/off | `M` | |
| Menu | `Esc` / `P` | Start |

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
npm run preview
```

The build is a static site with relative paths, so it can be hosted anywhere. To publish it on GitHub Pages, copy `deploy/github-pages.yml` into `.github/workflows/`, delete the old Gradle `.github/workflows/build.yml`, and enable Pages with the source set to **GitHub Actions**.

## How it works

```
src/
  main.js            game loop, settings, menu and HUD wiring
  core/
    noise.js         seeded RNG + simplex noise
    input.js         keyboard / gamepad / touch in one analog state
    camera.js        chase, hood and cinematic camera rigs
    audio.js         Web Audio engine, wind, rain and ambient music
  world/
    biomes.js        landscape presets (terrain shape, colours, plants)
    terrain.js       height field (warped fBm, ridged mountains, mesas) + colouring
    road.js          endless road generator, elevation smoothing, spatial lookups
    world.js         chunk streaming, LODs, road meshes, instanced plants
    sky.js           sky shader (sun, moon, stars, clouds) + time-of-day lighting
    water.js         lakes
    weather.js       rain and snow particles
  car/
    carModel.js      low-poly procedural hatchback
    car.js           arcade physics + autodrive
```

- **Road.** The road is a list of points spaced 5 m apart. Its heading changes smoothly, driven by noise. It also bends toward whichever side is lower, and it always keeps moving forward, so it can never loop back over itself. Elevation goes through two smoothing passes, and the slope is capped at 8.5%. Points are stored in a spatial grid, which makes "how far is the nearest road?" a quick lookup.
- **Terrain.** The ground is built in 256 m chunks with four levels of detail. Chunk edges get "skirts" that hide gaps between different detail levels. Near the road the ground is flattened into a gravel shoulder and blends back into the natural terrain over a distance that depends on how big the height difference is. This gives cuttings through hills and embankments across valleys.
- **Streaming.** Chunks are queued nearest-first and built within a small time budget each frame, so the view distance can reach about 3 km without stutter.

## License

CC0. Do whatever you like with it.
