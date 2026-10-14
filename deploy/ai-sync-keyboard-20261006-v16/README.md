# AI, account sync and keyboard update — 2026-10-06 v16

This delta inherits the currently running v15 API image and adds the AI deadline helper, replaces eight explicitly verified source files, and updates the exported app/admin website. It does not download dependencies or migrate database data. The Android Build 17 OTA export is a separate artifact and must be published separately.

The installer verifies the v15 FAQ/worker hashes and the inherited v14 AI source hashes before changing anything. The deadline helper must be absent in the old image. API and Caddy Compose definitions are captured separately from each running container's labels. The current SSH tunnel, entrypoint, database TLS, secrets, media/video mounts, resource limits, official website and Caddyfile remain intact. Only the API image and Caddy `/srv/admin` web bind change. Existing hashed browser assets remain available.

After verifying the archive checksum and extracting into a fresh directory, run as root on the server currently serving the app:

```bash
python3 /path/to/outdoor-fit-ai-sync-keyboard-20261006-v16/install.py --check-only
python3 /path/to/outdoor-fit-ai-sync-keyboard-20261006-v16/install.py --prepare
python3 /opt/outdoor-fit/production/releases/outdoor-fit-ai-sync-keyboard-20261006-v16/package/install.py --apply
```

Prepare builds the inherited image and captures rollback configuration while the old services remain running. Apply requires the AI queue to be idle, drains Caddy, rechecks the queue, replaces the sole API worker, verifies health, starts Caddy and checks app/admin/API HTTPS locally against production hostnames. It never starts a second production worker against the same database. Failure restores the captured service images/configuration when the guarded state permits it.

`UPDATE_AI_BUSY_TRY_LATER` preserves the old services. Do not clear production jobs or bypass that guard; diagnose stale work separately. This package includes no switch that silently deletes or marks tasks complete.

If HTTPS verification fails after the new server has already accepted AI work, automatic rollback closes ingress and checks the queue again. `UPDATE_ROLLBACK_WAITING_FOR_AI` keeps that worker and its Caddy running, records `rollback_blocked`, and requires retrying the guarded rollback after the accepted work finishes. `UPDATE_ROLLBACK_AI_CHECK_FAILED` similarly preserves the worker when queue status cannot be established. Neither condition restarts an active API blindly.

Rollback, only while no later deployment has replaced this update:

```bash
python3 /opt/outdoor-fit/production/releases/outdoor-fit-ai-sync-keyboard-20261006-v16/package/install.py --rollback
```

Private recovery and resolved Compose files are root-readable under `.update-state/ai-sync-keyboard-20261006-v16`; do not paste them into chat. Do not remove that state, run `docker compose down`, delete media volumes or alter the SSH tunnel to force installation.

Local mocked tests do not contact Docker, SSH or RDS. Preparing these artifacts does not mean they have been uploaded, deployed, or published through Expo OTA.

## Validation before release

The account-sync fixes passed 150 focused client regressions, including lost-response favorites updates, cross-language history, rejected uploads that must not block downloads, account switches and screen-lock recovery. The root backend check passed 104 tests across worker capacity, deadlines, HTTP, FAQ and recommendation paths. Installer tests cover exact baseline hashes, new-module absence/presence, separate Compose capture, inherited tunnel configuration, rollback guards and newly accepted AI work during HTTPS validation. The Android manifest verifies both source files and assets and refuses altered exports.

Read-only observations on 2026-10-06 confirmed app/API/admin DNS still pointed to the existing ECS and the new lightweight server had no running containers. The production queued/running aggregate was empty. A dedicated test account reproduced the reported request successfully in approximately 508 ms, and the resulting history was retrieved under a second login. This establishes that the tested server path was available at that time; it does not establish that the user's earlier request completed or that the user's installed client has these fixes.

Primary references reviewed for the repair:

- [TanStack Query mutation persistence and resumption](https://github.com/TanStack/query/blob/main/docs/framework/react/guides/mutations.md): durable pending mutations and explicit recovery rather than treating a lost response as a rejected write.
- [Node.js AbortController/AbortSignal documentation](https://github.com/nodejs/node/blob/v22.x/doc/api/globals.md): cancellation signalling is distinct from bounding how long a caller waits.
- [React Native Android keyboard discussion #49759](https://github.com/facebook/react-native/issues/49759): Android edge-to-edge keyboard/layout behavior must be measured instead of adding keyboard height twice.

These references inform the implementation and regression cases; they are not additional runtime dependencies.
