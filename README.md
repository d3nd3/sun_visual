# SunVisualizer

Browser-based Earth–Sun visualization (desktop + mobile). Pick a location on the globe, scrub date/time, and compare an orbital day/night view with a surface sky view.

## Features

- **Orbital view** — textured Earth with day/night terminator, atmosphere, subsolar marker; tap to set location; up/east/north and sun vectors
- **Surface view** — horizon compass, sun disk, daily sun path, optional analemma; drag to look around
- **Time controls** — date, local-time slider, sunrise / solar noon / sunset, play speeds (1×–1 day/s)
- **Seasons** — equinox / solstice jumps; axial tilt via solar declination
- **Readouts** — elevation, azimuth, zenith angle, day length, shadow length, declination
- **Geolocation** — use device GPS when available

## Run

```bash
npm install
npm run dev
```

Build: `npm run build`

## Tech

Vite · TypeScript · Three.js. Solar position uses NOAA-style approximations (fine for visualization, not navigation-grade).

## Textures

Earth maps in `public/textures/` are from the [three.js examples](https://github.com/mrdoob/three.js) planet textures (derived from NASA Blue Marble / city lights).
