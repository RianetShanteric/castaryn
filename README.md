# Castaryn

Castaryn is a local-first Windows companion for Perfect World players. Its
Tauri desktop Player keeps progress on the local machine while helping players
plan PvE routes, track rewards and PvP progress, and estimate the value of
their farm runs.

## Screenshots

### First-run onboarding

![Castaryn onboarding](docs/screenshots/onboarding.png)

### Player — Today

![Castaryn Player Today](docs/screenshots/player-today.png)

The screenshots use a synthetic demo profile (`Portfolio Demo`, `Aurora`);
they contain no external account or personal game data.

## Features

- Local-first Player that works without an account or online service.
- Profile onboarding for a single character and multi-window setups.
- Manual PvE planning with packs, dungeons, timers, rewards, and day history.
- A configurable daily loot-category cycle.
- Farm calculator based on a character forecast, local chest inventory, or
  selected packs.
- Local price overrides and saved farm calculations.
- Manual PvP tracking for Aurora Arena and Imperial Battle.
- Built-in help, interface settings, local backup/import, and undo for the
  latest action.

Castaryn does not connect to the Perfect World client, inspect game processes
or files, automate input, or collect game data automatically. PvE and PvP
records are entered by the player.

## Tech Stack

- Tauri 2, Rust, and SQLite for the Windows desktop application.
- React 19, TypeScript, Vite, and Zustand for the Player UI.
- Vitest, Testing Library, ESLint, and pnpm workspaces.
- Optional workspace contours: Fastify Creator API, PostgreSQL, OAuth,
  Keycloak-compatible identity, Telegram, Docker, and separate Admin/Site
  frontends.

## Architecture

The Player is deliberately independent of the online workspace contours:

```text
Tauri WebView
  └── React / TypeScript / Vite
        └── Zustand store
              └── local storage adapter
                    ├── browser fallback for web development
                    └── Tauri commands → Rust validation → SQLite

Optional workspace applications:
  Creator API · Admin · public Site · Telegram Admin
```

The repository is a pnpm monorepo. The local Player is the primary runnable
surface; the additional applications share domain and service boundaries but
are not required by the Player.

## Development

### Prerequisites

- Windows
- Node.js `>=22 <25`
- pnpm `11.9.0`
- Rust stable with the Windows MSVC toolchain
- `cargo-audit` for the Rust dependency audit

### Install and run

```bash
pnpm install --frozen-lockfile
```

Run the web development surface:

```bash
pnpm dev
```

Run the native desktop development surface:

```bash
pnpm tauri dev
```

### Checks and builds

```bash
pnpm check
pnpm security:check
pnpm build
pnpm creator:build
pnpm admin:build
pnpm site:build
pnpm telegram:build
```

Rust checks:

```bash
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo audit --file src-tauri/Cargo.lock
```

Windows packaging:

```bash
pnpm tauri build --no-bundle
pnpm release:player:windows
```

## Quality

The repository includes automated Player, Creator API, Admin, Telegram Admin,
and Rust tests, together with TypeScript, lint, Rust formatting/clippy,
dependency, and signature checks. The current Windows workflow also produces
the desktop executable and an NSIS installer from the locked dependencies.

## Limitations

Castaryn currently focuses on its local-first Player functionality. The Player
is intentionally manual and does not read or control the game client.

Streaming and service features — including Twitch/YouTube OAuth, live chat,
OBS Browser Source, Creator API, Keycloak/PostgreSQL deployment, and Telegram
delivery — are separate development contours that require external services
and credentials. They are not part of the validated local MVP.

The Windows installer is currently unsigned. Native tray behavior, global
shortcuts, the compact panel, file dialogs, and persistence after installation
still need hands-on validation on a clean Windows environment.

Some transitive Rust dependencies also have upstream maintenance or advisory
caveats and may require future dependency upgrades.

More product context is available in
[`docs/PRODUCT_OVERVIEW.md`](docs/PRODUCT_OVERVIEW.md).
