#!/usr/bin/env bash
# Run as root. Private credentials are installed separately, never committed.
set -euo pipefail
exec 9>/run/omniobserve-backup.lock
flock -n 9 || exit 0
export RESTIC_PASSWORD_FILE=/etc/omniobserve-backup/password
export XDG_CACHE_HOME=/var/cache/omniobserve-backup
repository=sftp:omni-backup@217.142.232.200:/var/lib/omni-backup/omniobserve
transport='ssh -i /etc/omniobserve-backup/id_ed25519 -o UserKnownHostsFile=/etc/omniobserve-backup/known_hosts -o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=15 omni-backup@217.142.232.200 -s sftp'
restic_args=(-r "$repository" -o "sftp.command=$transport")
stage=/var/lib/omniobserve-backup/staging
install -d -m 700 "$stage/databases"
umask 077
find "$stage/databases" -maxdepth 1 -type f -name '*.dump' -delete
failed() {
  printf '{"status":"failed","timestamp":"%s"}\n' "$(date -u +%FT%TZ)" > /var/lib/omniobserve-backup/status.json
}
trap failed ERR
while read -r id name; do
  case "$name" in
    omniobserve-*-db-1|dokploy-postgres.*)
      docker exec "$id" sh -c 'pg_dump -U "${POSTGRES_USER:-postgres}" -Fc "${POSTGRES_DB:-$POSTGRES_USER}"' > "$stage/databases/$name.dump"
      ;;
  esac
done < <(docker ps --format '{{.ID}} {{.Names}}')
test "$(find "$stage/databases" -name '*.dump' -size +0c | wc -l)" -ge 7
# Include durable application volumes; PostgreSQL uses the dumps above.
# Model downloads are reproducible and excluded from the backup.
backup_volumes() {
 docker volume ls --format '{{.Name}}' | while read -r volume; do
  case "$volume" in
    *postgres*|*ollama*|*asr-models*|*restore-check*) continue ;;
    omni*|dokploy*) docker volume inspect "$volume" --format '{{.Mountpoint}}' ;;
  esac
 done
}
mapfile -t volumes < <(backup_volumes)
install -d -m 700 "$stage/volumes"
for path in "${volumes[@]}"; do
  volume=$(basename "$(dirname "$path")")
  install -d -m 700 "$stage/volumes/$volume"
  rsync -a --delete "$path/" "$stage/volumes/$volume/"
  # SQLite's backup API produces a consistent image, including WAL contents.
  python3 - "$path" "$stage/volumes/$volume" <<'PY'
import pathlib, sqlite3, sys
source, target = map(pathlib.Path, sys.argv[1:])
for file in source.rglob('*'):
    if not file.is_file():
        continue
    with file.open('rb') as stream:
        is_sqlite = stream.read(16) == b'SQLite format 3\0'
    if is_sqlite:
        dest = target / file.relative_to(source)
        dest.unlink(missing_ok=True)
        for suffix in ('-wal', '-shm'):
            pathlib.Path(str(dest) + suffix).unlink(missing_ok=True)
        with sqlite3.connect(file.as_uri() + '?mode=ro', uri=True) as src:
            with sqlite3.connect(dest) as out:
                src.backup(out)
PY
done
restic "${restic_args[@]}" backup --tag omniobserve --host omniobserve-gpu \
  "$stage" /etc/dokploy /home/ubuntu/omniobserve-cd /etc/omniobserve-backup \
  /etc/systemd/system/omniobserve-cd.service
restic "${restic_args[@]}" forget --host omniobserve-gpu --tag omniobserve \
  --keep-daily 14 --keep-weekly 8 --keep-monthly 6 --prune
printf '{"status":"ok","timestamp":"%s"}\n' "$(date -u +%FT%TZ)" > /var/lib/omniobserve-backup/status.json
