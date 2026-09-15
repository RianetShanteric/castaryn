# Castaryn

Castaryn 0.1.6 is a Windows companion for Perfect World players and streamers.
It has a local-first Player module and optional online Creator tools.

## Local Player module

Player includes a local profile, a persistent PvE plan, packs and dungeons,
timers, per-slot reward tracking, the daily loot-category cycle, PvE history,
a farm-value calculator, a manual PvP tracker, backup/import and built-in help.

The farm calculator can work from a character forecast, the full local chest
inventory or selected packs. Prices can be overridden locally; the bundled
base-price dataset is an explicitly dated snapshot.

Player works without a Castaryn account and remains available offline. The
Windows build also provides global shortcuts and a compact focus panel.

## Streaming tools

Optional online tools include:

- Twitch and YouTube OAuth connections;
- channel commands and moderator access;
- one configurable OBS Browser Source Overlay;
- safe, server-controlled stream events and effects.

Creator tools require a configured server environment and do not fake an online
connection when that environment is unavailable. Online-service availability
does not block local Player features or local data.

These online tools are intentionally separate from the local Player. They
depend on externally managed identity, PostgreSQL, provider credentials, and
deployment infrastructure; the offline Player does not require any of them.

## Product boundary

Castaryn does not connect to the Perfect World client, inspect game processes,
read game files, automate input or collect game data automatically. PvE and PvP
records are entered by the user.
