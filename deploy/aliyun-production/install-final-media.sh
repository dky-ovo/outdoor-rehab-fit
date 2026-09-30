#!/usr/bin/env bash
# One-time installation of the verified 2026-09-24 final media snapshot.
# Run as root on ECS, before starting the production application.
set -euo pipefail
umask 077
trap 'printf "FINAL_MEDIA_INSTALL=FAILED; preserve staging and inspect before retry\n" >&2' ERR

[[ $(id -u) == 0 ]]
state=/opt/outdoor-fit/production/state
archive=/opt/outdoor-fit/migration/outdoor-fit-final-e_hjixlt/media.tar.gz
names=(equipment-images media-library media-seed)

check_empty_targets() {
  [[ -d "$state" && ! -L "$state" ]]
  for name in "${names[@]}"; do
    [[ -d "$state/$name" && ! -L "$state/$name" ]]
    existing=$(find "$state/$name" -mindepth 1 -print -quit)
    [[ -z "$existing" ]]
  done
}
running=$(docker ps -q --filter label=com.docker.compose.project=outdoor-fit-production)
[[ -z "$running" ]]
check_empty_targets
printf '%s  %s\n' \
  a5eb1cb8f8684a9441379234dcc62650536d8877eba734933c77bddec0304dd6 \
  "$archive" | sha256sum -c -

staging=$(mktemp -d "$state/.final-media.XXXXXXXX")
printf 'MEDIA_STAGING_DIR=%s\n' "$staging"
# The exact SHA above binds this archive to capture-final-snapshot.py output:
# only regular files/directories under the three known trees, without links.
env -u TAR_OPTIONS tar --extract --gzip --file="$archive" \
  --directory="$staging" --no-same-owner --no-same-permissions --keep-old-files
special=$(find "$staging" ! -type d ! -type f -print -quit)
[[ -z "$special" ]]
file_count=$(find "$staging" -type f -printf '.' | wc -c)
file_bytes=$(find "$staging" -type f -printf '%s\n' | awk '{n += $1} END {printf "%.0f\n", n}')
[[ "$file_count" -eq 117 && "$file_bytes" -eq 653151118 ]]

sources=("$staging/data/equipment-images" "$staging/data/media-library" "$staging/media-seed")
for source in "${sources[@]}"; do
  [[ -d "$source" && ! -L "$source" ]]
  chown -R 1000:1000 -- "$source"
  find "$source" -type d -exec chmod 0750 {} +
  find "$source" -type f -exec chmod 0640 {} +
done

running=$(docker ps -q --filter label=com.docker.compose.project=outdoor-fit-production)
[[ -z "$running" ]]
check_empty_targets
for index in 0 1 2; do
  # Same-filesystem rename refuses a nonempty destination; no recursive delete.
  mv -T -- "${sources[$index]}" "$state/${names[$index]}"
done
sync -f "$state"
printf 'FINAL_MEDIA_RESTORE=PASS\nFILE_COUNT=%s\nMEDIA_BYTES=%s\nMEDIA_OWNER=1000:1000\n' \
  "$file_count" "$file_bytes"
