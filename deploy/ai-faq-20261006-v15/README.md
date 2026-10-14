# FAQ and AI queue update, 2026-10-06 v15

This package replaces three public server source files and the exported website. It inherits the running API image without downloading dependencies. It captures API and Caddy separately from their current Compose labels, including migrated SSH-tunnel startup, TLS, database configuration, media settings, resource limits and mounts. Only the API image and Caddy `/srv/admin` bind change. Existing hashed website assets remain available to older open browser tabs.

The supported baseline is the exact v14 website and the three verified v13/v14 source hashes. An unknown live edit, another deployment, missing Compose source, absent TLS certificate, public API port, busy AI queue or changed rollback file stops the update. Do not delete its state to force a retry.

Run as root on the server currently serving the website, after verifying the archive checksum and extracting the package to a new directory:

```bash
python3 /path/to/outdoor-fit-ai-faq-20261006-v15/install.py --check-only
python3 /path/to/outdoor-fit-ai-faq-20261006-v15/install.py --prepare
# Only prepare completes here; the website continues running.
python3 /opt/outdoor-fit/production/releases/outdoor-fit-ai-faq-20261006-v15/package/install.py --apply
```

Apply briefly stops Caddy, checks the queue again, recreates the API with `--no-deps`, checks health, starts Caddy and verifies local HTTPS using the production hostnames. It never starts two API workers at once. DNS need not point to the target server for the local HTTPS check. Failure triggers guarded restoration of the captured images and Compose configurations. Database schema and rows are not migrated or modified by installer scripts; the normal application startup retains its existing job recovery behavior.

Rollback:

```bash
python3 /opt/outdoor-fit/production/releases/outdoor-fit-ai-faq-20261006-v15/package/install.py --rollback
```

Configuration and recovery files contain private deployment settings and are root-readable only under `.update-state/ai-faq-20261006-v15`. Keep them on the server; send only the fixed success/error marker. `UPDATE_AI_BUSY_TRY_LATER` means let current AI requests finish before applying. Do not run `docker compose down`, remove data volumes or change the existing SSH tunnel.

This updater has local syntax and mocked guard tests only. It has not been run against either remote server. Installer health checks do not establish real DeepSeek/RDS load capacity; the authenticated live AI load test follows successful deployment.
