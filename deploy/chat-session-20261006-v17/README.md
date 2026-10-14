# App-only AI, idle logout and keyboard update — 2026-10-06 v17

This delta inherits the currently running v15 or v16 API image, delivers all v16 fixes plus app-only AI output rules, and updates the exported app/admin website. It contains eleven backend modules including the new content-policy helper. It does not download dependencies or migrate database data. The Android Build 17 OTA export is a separate artifact and must be published separately.

The installer accepts exactly one known source/web pair, derived from the sealed v14/v15/v16 archives. A v15 backend mixed with v16 web, unknown code, or extra files is rejected. The deadline helper must be absent on v15 and match v16 on v16; the content-policy helper must be absent on both. API and Caddy Compose definitions are captured separately from each running container's labels. The current SSH tunnel, entrypoint, database TLS, secrets, media/video mounts, resource limits, official website and Caddyfile remain intact. Only the API image and Caddy `/srv/admin` web bind change. Existing hashed browser assets remain available.

The client restores the confirmed 90-minute inactivity policy. User taps, dragging and text editing renew it; background synchronization does not. Expired sessions are rejected on cold start and foreground return. Logging out detaches the local account session without deleting queued account data or cancelling accepted backend AI jobs. FAQ and login notices describe the same policy.

After verifying the archive checksum and extracting into a fresh directory, run as root on the server currently serving the app:

```bash
python3 /path/to/outdoor-fit-chat-session-20261006-v17/install.py --check-only
python3 /path/to/outdoor-fit-chat-session-20261006-v17/install.py --prepare
python3 /opt/outdoor-fit/production/releases/outdoor-fit-chat-session-20261006-v17/package/install.py --apply
```

Prepare builds the inherited image and captures rollback configuration while the old services remain running. Apply requires the AI queue to be idle, drains Caddy, rechecks the queue, replaces the sole API worker, verifies health, starts Caddy and checks app/admin/API HTTPS locally against production hostnames. It never starts a second production worker against the same database. Failure restores the captured service images/configuration when the guarded state permits it.

`UPDATE_AI_BUSY_TRY_LATER` preserves the old services. Do not clear production jobs or bypass that guard; diagnose stale work separately. This package includes no switch that silently deletes or marks tasks complete.

If HTTPS verification fails after the new server has already accepted AI work, automatic rollback closes ingress and checks the queue again. `UPDATE_ROLLBACK_WAITING_FOR_AI` keeps that worker and its Caddy running, records `rollback_blocked`, and requires retrying the guarded rollback after the accepted work finishes. `UPDATE_ROLLBACK_AI_CHECK_FAILED` similarly preserves the worker when queue status cannot be established. Neither condition restarts an active API blindly.

Rollback, only while no later deployment has replaced this update:

```bash
python3 /opt/outdoor-fit/production/releases/outdoor-fit-chat-session-20261006-v17/package/install.py --rollback
```

Private recovery and resolved Compose files are root-readable under `.update-state/chat-session-20261006-v17`; do not paste them into chat. Do not remove that state, run `docker compose down`, delete media volumes or alter the SSH tunnel to force installation.

Local mocked tests do not contact Docker, SSH or RDS. Preparing these artifacts does not mean they have been uploaded, deployed, or published through Expo OTA.

## Validation before release

Client authentication, account deletion, activity capture and account-sync regressions passed 77 tests, including the exact idle boundary, suspended timers, delayed writes, offline access and preserving pending changes. Installer tests cover both supported source/web pairs, rejecting mixed versions, new-module absence/presence, separate Compose capture, inherited tunnel configuration, rollback guards and newly accepted AI work during HTTPS validation. The Android manifest verifies source files and assets and refuses altered exports. Software-keyboard placement still requires an Android device check after receiving the update; local exports do not establish that device behavior.

Primary references reviewed for the repair:

- [TanStack Query mutation persistence and resumption](https://github.com/TanStack/query/blob/main/docs/framework/react/guides/mutations.md): durable pending mutations and explicit recovery rather than treating a lost response as a rejected write.
- [Node.js AbortController/AbortSignal documentation](https://github.com/nodejs/node/blob/v22.x/doc/api/globals.md): cancellation signalling is distinct from bounding how long a caller waits.
- [React Native Android keyboard discussion #49759](https://github.com/facebook/react-native/issues/49759): Android edge-to-edge keyboard/layout behavior must be measured instead of adding keyboard height twice.

These references inform the implementation and regression cases; they are not additional runtime dependencies.
