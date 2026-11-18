"""Generate offline administrative lookup data from cached DataV city boundaries.

Run build_atlas_city_maps.py first if .cache/atlas-geo has not been populated.
The generated server asset does not add an external geocoding service or API key.
"""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
provinces = json.loads(subprocess.check_output([
    'node', '-e', "process.stdout.write(JSON.stringify(require('./miniprogram/assets/atlas-provinces')))"
], cwd=ROOT, text=True))
result = []
for province in provinces:
    path = ROOT / '.cache/atlas-geo' / f"{province['code']}.json"
    if not path.exists():
        continue
    for feature in json.loads(path.read_text())['features']:
        geometry, props = feature.get('geometry'), feature['properties']
        if not geometry or geometry['type'] not in ('Polygon', 'MultiPolygon'):
            continue
        polygons = geometry['coordinates']
        if geometry['type'] == 'Polygon':
            polygons = [polygons]
        polygons = [[[[round(x, 5), round(y, 5)] for x, y, *rest in ring]
                     for ring in polygon] for polygon in polygons]
        points = [point for polygon in polygons for point in polygon[0]]
        municipality = str(province['code']) in ('110000', '120000', '310000', '500000', '810000', '820000')
        center = props.get('center') or props.get('centroid')
        result.append(dict(
            provinceName=province['name'],
            cityName=province['name'] if municipality else props['name'],
            cityCode=str(province['code'] if municipality else props['adcode']),
            center=center,
            bbox=[min(p[0] for p in points), min(p[1] for p in points),
                  max(p[0] for p in points), max(p[1] for p in points)],
            polygons=polygons,
        ))
output = ROOT / 'server/app/data/city_boundaries.json'
output.parent.mkdir(exist_ok=True)
output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')))
print(f'Generated {len(result)} administrative areas; {output.stat().st_size} bytes')
