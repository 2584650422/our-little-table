#!/usr/bin/env bash
# Run as root on the existing K3s/MySQL host, after rehearsal and integration checks.
# Usage: cutover_database.sh RELEASE_DIR BACKUP_DIR IMMUTABLE_IMAGE
set -Eeuo pipefail
umask 077
[[ $# -eq 3 ]] || { echo 'Expected release dir, backup dir and image@sha256' >&2; exit 2; }
release=$1
backup=$2
image=$3
[[ "$image" == *@sha256:* && -s "$backup/server.env" && -s "$backup/image.txt" ]] || exit 2
env_file=/data/software/compose/our-time/server/.env
# Refuse to replay the one-time migration against an existing target database.
existing=$(docker exec mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -e "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name=\"our_time\""')
[[ "$existing" == 0 ]] || { echo 'Target our_time already exists; refusing to replay schema 015' >&2; exit 2; }
candidate=$image
printf '%s\n' "$image" > "$backup/new-image.txt"
new_started=0
verify_copy() {
  docker run --rm --network host --env-file "$backup/candidate.env" \
    -v "$release/server/scripts:/checks":ro -v "$release/database:/database":ro \
    "$candidate" python /checks/schema_admin.py little_table our_time /database/rename-map.json
}
restore_old() {
  cp "$backup/server.env" "$env_file"
  kubectl -n homelab patch configmap our-time-config --type merge -p '{"data":{"MYSQL_DATABASE":"little_table"}}'
  kubectl -n homelab set image deployment/our-time-api api="$(cat "$backup/image.txt")"
  kubectl -n homelab scale deployment/our-time-api --replicas=1
  kubectl -n homelab rollout status deployment/our-time-api --timeout=120s
}
on_error() {
  trap - ERR
  echo 'Cutover failed; stopping writes before rollback checks' >&2
  kubectl -n homelab scale deployment/our-time-api --replicas=0
  kubectl -n homelab wait --for=delete pod -l app=our-time-api --timeout=90s || true
  if [[ "$new_started" == 0 ]] || verify_copy > "$backup/rollback-check.log" 2>&1; then
    restore_old
    echo 'Restored old database config and backend image' >&2
  else
    echo 'New data may exist: API remains stopped; do not discard new database writes' >&2
  fi
  exit 1
}
trap on_error ERR
kubectl -n homelab scale deployment/our-time-api --replicas=0
kubectl -n homelab wait --for=delete pod -l app=our-time-api --timeout=90s
docker exec mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines --triggers --set-gtid-purged=OFF --default-character-set=utf8mb4 little_table' > "$backup/final.sql"
test -s "$backup/final.sql"
sha256sum "$backup/final.sql" > "$backup/final.sha256"
docker exec mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -e "CREATE DATABASE our_time CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"'
docker exec -i mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --default-character-set=utf8mb4 our_time' < "$backup/final.sql"
docker exec -i mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --default-character-set=utf8mb4 our_time' < "$release/database/migrations/015_space_schema.sql"
verify_copy > "$backup/final-check.log" 2>&1
tail -2 "$backup/final-check.log"
python3 - "$env_file" <<'PY'
from pathlib import Path
import re, sys
p=Path(sys.argv[1]); s=p.read_text()
s,n=re.subn(r'^MYSQL_DATABASE=.*$', 'MYSQL_DATABASE=our_time', s, flags=re.M)
assert n==1,'Expected exactly one MYSQL_DATABASE entry'
p.write_text(s); p.chmod(0o600)
PY
kubectl -n homelab patch configmap our-time-config --type merge -p '{"data":{"MYSQL_DATABASE":"our_time"}}'
kubectl -n homelab set image deployment/our-time-api api="$image"
new_started=1
kubectl -n homelab scale deployment/our-time-api --replicas=1
kubectl -n homelab rollout status deployment/our-time-api --timeout=120s
curl --max-time 15 -fsS https://aaa.imlyc.cn/health > "$backup/health.json"
python3 - "$backup/health.json" <<'PY'
import json,sys
body=json.load(open(sys.argv[1]))['data']
assert body['version']=='20261105-02' and body['database']=='connected',body
print('PASS: production version 20261105-02, database connected')
PY
trap - ERR
printf '%s\n' 'Cutover complete; old database retained for rollback'
