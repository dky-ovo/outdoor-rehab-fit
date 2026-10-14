# FAQ, automatic account sync and Android keyboard — 2026-10-07 v18

This update targets the sealed v17 installation. It fixes FAQ paraphrase routing and missing coverage from the authenticated 43-question report, removes the manual Settings sync button, and updates the website. The Android Build 17 OTA export is delivered separately. No database migration or dependency download is performed.

Both supported v17 source/web pairs are derived from previously sealed archives. They differ only in retained old hashed browser assets. Unknown source, edited web files, or missing files are rejected before changing running services. The symptom-evidence module and its existing equipment-catalog dependency are checked against their sealed v14 baselines before being delivered with the other eleven server modules.

The installer preserves the running API/Caddy configurations, database connection, JWT secrets, tunnel, media mounts, domain routing and existing browser assets. Only the API image and served app/admin web directory change. It never starts a second API worker against the production database.

Verify the archive checksum, extract into a new directory, then execute on the current ECS:

```bash
python3 /path/to/outdoor-fit-faq-sync-keyboard-20261007-v18/install.py --check-only
python3 /path/to/outdoor-fit-faq-sync-keyboard-20261007-v18/install.py --prepare
python3 /opt/outdoor-fit/production/releases/outdoor-fit-faq-sync-keyboard-20261007-v18/package/install.py --apply
```

Prepare builds from the current image while existing services keep running. Apply checks the AI queue, drains ingress, checks again, replaces the API, verifies health and app/admin/API HTTPS, and restores the captured installation if activation fails and no newly accepted AI work prevents safe rollback.

Success is `FAQ_SYNC_KEYBOARD_UPDATE=PASS`. `UPDATE_AI_BUSY_TRY_LATER` preserves the old services; wait for accepted jobs to finish. Do not delete production jobs or change the guard. `UPDATE_ROLLBACK_WAITING_FOR_AI` or `UPDATE_ROLLBACK_AI_CHECK_FAILED` keeps the current worker running until guarded rollback can safely proceed.

Rollback is available only before a later deployment replaces this update:

```bash
python3 /opt/outdoor-fit/production/releases/outdoor-fit-faq-sync-keyboard-20261007-v18/package/install.py --rollback
```

Private recovery/configuration files live under `.update-state/faq-sync-keyboard-20261007-v18`; never paste their contents into chat or delete them to force a retry.

The FAQ keeps the App-only response policy and qualified health guidance. Login triggers automatic per-collection incremental synchronization; local edits survive logout/offline retries and synchronization does not renew the 90-minute inactivity timer. Android uses the Reanimated IME observer already present in Build 17 instead of relying on a one-time keyboard height. Web retains visualViewport handling and iOS retains KeyboardAvoidingView.

Preparing, reviewing or exporting these files does not upload, deploy or publish them. Local regressions and successful Android export cannot establish physical keyboard placement; device verification remains necessary after receiving the OTA.
