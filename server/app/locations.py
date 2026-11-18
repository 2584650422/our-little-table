"""Offline point-in-polygon city lookup; no nearest-city guessing or external keys."""
import json
import math
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def boundaries():
    return json.loads((Path(__file__).parent / 'data/city_boundaries.json').read_text())


def in_ring(lng, lat, ring):
    inside = False
    for a, b in zip(ring, ring[1:] + ring[:1]):
        if (a[1] > lat) != (b[1] > lat):
            if lng < (b[0] - a[0]) * (lat - a[1]) / (b[1] - a[1]) + a[0]:
                inside = not inside
    return inside


@lru_cache(maxsize=4096)
def resolve(latitude, longitude):
    if latitude is None or longitude is None:
        return {}
    lat, lng = float(latitude), float(longitude)
    if not math.isfinite(lat) or not math.isfinite(lng):
        return {}
    for area in boundaries():
        x1, y1, x2, y2 = area['bbox']
        if not (x1 <= lng <= x2 and y1 <= lat <= y2):
            continue
        for polygon in area['polygons']:
            if in_ring(lng, lat, polygon[0]) and not any(in_ring(lng, lat, hole) for hole in polygon[1:]):
                return {
                    'provinceName': area['provinceName'], 'cityName': area['cityName'],
                    'cityCode': area['cityCode'],
                    'cityLongitude': area['center'][0], 'cityLatitude': area['center'][1],
                }
    return {}
