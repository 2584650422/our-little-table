#!/usr/bin/env bash
set -euo pipefail
backup=/data/software/compose/backups/our-time-service-rename-20261105
python3 - "$backup" <<'PYRESTORE'
import json,subprocess,sys
from pathlib import Path
backup=Path(sys.argv[1])
for file in ('configmap-little-table-config','secret-little-table-secrets','service-little-table-api','deployment-little-table-api'):
 obj=json.loads((backup/(file+'.json')).read_text())
 if obj['kind']=='Service':
  for key in ('clusterIP','clusterIPs','ipFamilies','ipFamilyPolicy'):
   obj['spec'].pop(key,None)
 subprocess.run(['kubectl','apply','-f','-'],input=json.dumps(obj).encode(),check=True)
PYRESTORE
kubectl -n homelab scale deployment/little-table-api --replicas=1
kubectl -n homelab rollout status deployment/little-table-api --timeout=120s
kubectl apply -f "$backup/configmap-business-nginx-config.json"
kubectl -n homelab annotate pod -l app=business-nginx our-time/config-refresh="$(date +%s)" --overwrite
mounted=0
for attempt in $(seq 1 60); do
 if kubectl -n homelab exec deployment/business-nginx -- grep -q 'proxy_pass http://little-table-api.homelab.svc.cluster.local:3000' /etc/nginx/conf.d/sites.conf; then mounted=1; break; fi
 sleep 2
done
[[ "$mounted" == 1 ]]
kubectl -n homelab exec deployment/business-nginx -- nginx -t
kubectl -n homelab exec deployment/business-nginx -- nginx -s reload
if kubectl -n homelab get deployment our-time-api >/dev/null 2>&1; then
 kubectl -n homelab scale deployment/our-time-api --replicas=0
fi
curl --max-time 15 -fsS https://aaa.imlyc.cn/health
echo 'Service naming rollback complete; current our_time database was not changed'
