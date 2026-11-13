#!/usr/bin/env bash
# Revert schema-015 cutover only when no new business data would be lost.
# Usage: rollback_database.sh RELEASE_DIR BACKUP_DIR
set -euo pipefail
umask 077
[[ $# -eq 2 ]] || exit 2
release=$1
backup=$2
[[ -s "$backup/server.env" && -s "$backup/image.txt" && -s "$backup/new-image.txt" ]] || exit 2
kubectl -n homelab scale deployment/our-time-api --replicas=0
kubectl -n homelab wait --for=delete pod -l app=our-time-api --timeout=90s
if ! docker run --rm --network host --env-file "$backup/candidate.env" \
  -v "$release/server/scripts:/checks":ro -v "$release/database:/database":ro \
  "$(cat "$backup/new-image.txt")" python /checks/schema_admin.py little_table our_time /database/rename-map.json > "$backup/rollback-check.log" 2>&1; then
  kubectl -n homelab scale deployment/our-time-api --replicas=1
  echo 'Rollback refused: data differ. New backend resumed; reconcile new records before reverting.' >&2
  exit 1
fi
cp "$backup/server.env" /data/software/compose/our-time/server/.env
kubectl -n homelab patch configmap our-time-config --type merge -p '{"data":{"MYSQL_DATABASE":"little_table"}}'
kubectl -n homelab set image deployment/our-time-api api="$(cat "$backup/image.txt")"
kubectl -n homelab scale deployment/our-time-api --replicas=1
kubectl -n homelab rollout status deployment/our-time-api --timeout=120s
echo 'Old backend and database config restored. Neither database was deleted.'
