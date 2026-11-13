#!/usr/bin/env python3
"""Build compact province polygons for the native atlas canvas.

Source: Alibaba DataV public GeoAtlas, https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json
The output is projected to the same 600 x 465 Mercator map used by atlas-map.js.
"""

import json
import math
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json"
OUTPUT = ROOT / "miniprogram/assets/atlas-provinces.js"
SCALE = 416.3695106850359
TRANSLATE_X = -457.9428915814261
TRANSLATE_Y = 474.7017167958825
DEG = math.pi / 180
TOLERANCE = 0.12


def project(point):
    longitude, latitude = point[:2]
    latitude = max(-84.9, min(84.9, latitude))
    x = SCALE * longitude * DEG + TRANSLATE_X
    y = TRANSLATE_Y - SCALE * math.log(math.tan(math.pi / 4 + (latitude * DEG) / 2))
    return [round(x, 2), round(y, 2)]


def distance_to_segment(point, start, end):
    dx, dy = end[0] - start[0], end[1] - start[1]
    if dx == 0 and dy == 0:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    ratio = max(0, min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(point[0] - (start[0] + ratio * dx), point[1] - (start[1] + ratio * dy))


def simplify_open(points, tolerance):
    if len(points) <= 2:
        return points
    distances = [distance_to_segment(point, points[0], points[-1]) for point in points[1:-1]]
    if not distances:
        return [points[0], points[-1]]
    maximum = max(distances)
    if maximum <= tolerance:
        return [points[0], points[-1]]
    index = distances.index(maximum) + 1
    return simplify_open(points[: index + 1], tolerance)[:-1] + simplify_open(points[index:], tolerance)


def simplify_ring(points):
    projected = [project(point) for point in points]
    if len(projected) > 1 and projected[0] == projected[-1]:
        projected.pop()
    if len(projected) < 4:
        return projected
    farthest = max(range(1, len(projected)), key=lambda index: math.dist(projected[0], projected[index]))
    first = simplify_open(projected[: farthest + 1], TOLERANCE)
    second = simplify_open(projected[farthest:] + [projected[0]], TOLERANCE)
    ring = first[:-1] + second[:-1]
    return ring if len(ring) >= 3 else projected[:3]


def geometry_polygons(geometry):
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return geometry["coordinates"]
    return []


def main():
    with urllib.request.urlopen(SOURCE, timeout=30) as response:
        source = json.load(response)
    provinces = []
    for feature in source["features"]:
        geometry = feature.get("geometry")
        if not geometry:
            continue
        polygons = []
        for polygon in geometry_polygons(geometry):
            rings = [simplify_ring(ring) for ring in polygon]
            rings = [ring for ring in rings if len(ring) >= 3]
            if rings:
                polygons.append(rings)
        if polygons:
            provinces.append(
                {
                    "name": feature["properties"]["name"],
                    "code": feature["properties"].get("adcode"),
                    "polygons": polygons,
                }
            )
    data = json.dumps(provinces, ensure_ascii=False, separators=(",", ":"))
    OUTPUT.write_text(f"// Generated from the public DataV GeoAtlas source. Do not edit by hand.\nmodule.exports = {data}\n")
    print(f"Wrote {len(provinces)} provinces, {OUTPUT.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
