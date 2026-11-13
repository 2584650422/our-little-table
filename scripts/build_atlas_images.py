"""Render atlas assets from checked-in projected polygons. Requires Pillow; no network."""
import json
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'miniprogram/assets'
OUTPUT = ASSETS / 'atlas-maps'


def main():
    source = subprocess.check_output(['node', '-e', "process.stdout.write(JSON.stringify(require('./miniprogram/assets/atlas-provinces')))"], cwd=ROOT, text=True)
    provinces = json.loads(source)
    OUTPUT.mkdir(exist_ok=True)
    def render(items, name, focus=False, compact=False):
        zoom, tx, ty = 1, 0, 0
        if focus and not compact:
            boxes = []
            for polygon in items[0]['polygons']:
                xs, ys = zip(*polygon[0])
                boxes.append((min(xs), min(ys), max(xs)-min(xs), max(ys)-min(ys)))
            x, y, w, h = max(boxes, key=lambda box: box[2]*box[3])
            zoom = min(40, 540/max(w, 1), 405/max(h, 1))
            tx, ty = 300-(x+w/2)*zoom, 232.5-(y+h/2)*zoom
        image = Image.new('RGBA', (1200, 930))
        draw = ImageDraw.Draw(image)
        for province in items:
            for polygon in province['polygons']:
                for index, ring in enumerate(polygon):
                    points = [((x*zoom+tx)*2, (y*zoom+ty)*2) for x,y in ring]
                    draw.polygon(points, fill=('#c6d5ba' if focus else '#fffef9') if index == 0 else (0,0,0,0))
                    draw.line(points+[points[0]], fill='#789274' if focus else '#d5ddce', width=1)
        # Indexed transparency keeps all province images small without changing geometry.
        image.quantize(colors=64).save(OUTPUT / name, optimize=True)
    render([p for p in provinces if p['name']], 'country.png')
    for province in provinces:
        render([province], f"{province['code']}.png", focus=True)
        render([province], f"{province['code']}-compact.png", focus=True, compact=True)
    print(f'Rendered {len(provinces)} provinces; {sum(p.stat().st_size for p in OUTPUT.glob("*.png")):,} bytes')


if __name__ == '__main__':
    main()
