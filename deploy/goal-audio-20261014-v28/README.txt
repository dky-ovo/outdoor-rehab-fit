Outdoor Fit v28 web update: complete goal text and coordinated facility audio.

This archive changes browser files only. It requires the installed v26 API
and a known complete v26 web tree. It does not restart or replace the API,
connect to RDS, alter database schemas or upload user media.

After verifying the archive SHA256SUMS and extracting into a new directory:

python3 install.py --check-only
python3 install.py --prepare
python3 install.py --apply

Expected completion: GOAL_AUDIO_WEB_UPDATE=PASS

Only Caddy is recreated, with the same pinned image and configuration apart
from the web directory. Saved recovery files remain root-only under:
/opt/outdoor-fit/production/.update-state/goal-audio-20261014-v28/

If activation fails, the installer attempts to restore the prior web mount.
Do not edit its recovery hashes. Retry the same command only after examining
the fixed error code. Manual rollback for this release, before any later
deployment, is available with:

python3 /opt/outdoor-fit/production/releases/outdoor-fit-goal-audio-20261014-v28/package/install.py --rollback

Android and iOS installations need their own corresponding OTA updates.
