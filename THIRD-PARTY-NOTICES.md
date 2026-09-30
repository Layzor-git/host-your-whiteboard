# Third-party notices

Whiteboard itself is licensed under the [AGPL-3.0](LICENSE). It ships with, or
is built from, the following third-party components under their own licenses.
All of them allow redistribution as part of this project.

## Fonts (bundled into the web app)

| Font | Copyright | License | Source |
|---|---|---|---|
| Onest | © 2021 The Onest Project Authors | SIL Open Font License 1.1 | <https://fonts.google.com/specimen/Onest>, packaged by `@fontsource/onest` |
| Caveat | © 2014 The Caveat Project Authors | SIL Open Font License 1.1 | <https://fonts.google.com/specimen/Caveat>, packaged by `@fontsource/caveat` |
| JetBrains Mono | © 2020 The JetBrains Mono Project Authors | SIL Open Font License 1.1 | <https://fonts.google.com/specimen/JetBrains+Mono>, packaged by `@fontsource/jetbrains-mono` |

The full license text of each font is included in its npm package
(`node_modules/@fontsource/*/LICENSE`) and at <https://openfontlicense.org>.
The fonts are used unmodified. The handwriting in the demo images under
`docs/` was generated from Caveat.

## Web app (runtime)

| Package | License |
|---|---|
| react, react-dom, scheduler | MIT |
| gifuct-js, js-binary-schema-parser | MIT |

## Server (runtime)

| Package | License |
|---|---|
| fastify and its dependencies (@fastify/*, avvio, find-my-way, light-my-request, pino, ...) | MIT, ISC, BSD-3-Clause |
| @fastify/websocket, ws | MIT |
| jose | MIT |

The exact list with versions is in `server/package-lock.json` and
`web/package-lock.json`; `npm ls --omit=dev` prints it.

## Build tools (not shipped)

Vite, @vitejs/plugin-react (MIT) and @resvg/resvg-js (MPL-2.0, only used by
`web/icons-bauen.mjs` to render the app icons from `web/public/logo.svg`).

## Container base images

`node:24-alpine` and `caddy:2-alpine` (Apache-2.0) from Docker Hub, pulled at
build time.
