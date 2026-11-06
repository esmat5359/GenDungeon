#!/usr/bin/env python3
"""Trace the GenLayer mark from a raster image into clean vector geometry.

The mark is a set of straight-edged solids, so the trace is done in four
steps that never invent geometry:

  1. threshold the image and extract sub-pixel contours (marching squares),
  2. find the corners with a Douglas-Peucker pass,
  3. fit one straight line per edge to the original contour points and
     intersect neighbouring lines (this restores the sharp corners that
     anti-aliasing rounds off); edges within a degree or two of vertical or
     horizontal are snapped to exact axis-aligned lines,
  4. normalise everything into a 0..100 square (aspect ratio kept, centred).

Outputs
  src/assets/genlayer-mark.svg   the mark as one even-odd path
  src/assets/genlayerMark.ts     the same polygons as data (used by the 3D hero)

The script then rasterises the written SVG with rsvg-convert, lines it up with
the source pixels and prints the intersection-over-union against the
thresholded original.

Usage
  python3 scripts/logo/trace_mark.py /path/to/mark.jpg

Requires numpy, Pillow, scikit-image and (for the round-trip check) rsvg-convert.
"""

from __future__ import annotations

import argparse
import io
import re
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from skimage import measure

ROOT = Path(__file__).resolve().parents[2]
SVG_OUT = ROOT / "src" / "assets" / "genlayer-mark.svg"
TS_OUT = ROOT / "src" / "assets" / "genlayerMark.ts"

THRESHOLD = 0.5            # on a 0..1 darkness scale
MIN_AREA_PX = 200.0        # ignore specks produced by compression noise
CORNER_TOLERANCE_PX = 2.0  # Douglas-Peucker tolerance for corner detection
MIN_EDGE_PX = 8.0          # edges shorter than this are not real edges
AXIS_SNAP_DEGREES = 2.0    # near-vertical / near-horizontal edges become exact
TRIM = 0.12                # fraction of each edge ignored at both ends when fitting
VIEW = 100.0


def load_darkness(path: Path) -> np.ndarray:
    gray = np.asarray(Image.open(path).convert("L"), dtype=float) / 255.0
    return 1.0 - gray


def polygon_area(points: np.ndarray) -> float:
    x, y = points[:, 0], points[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def fit_line(points: np.ndarray):
    """Total-least-squares line through points: returns (point, unit direction)."""
    centre = points.mean(axis=0)
    _, _, vt = np.linalg.svd(points - centre)
    return centre, vt[0]


def intersect(a, b):
    (p, d), (q, e) = a, b
    m = np.array([d, -e]).T
    if abs(np.linalg.det(m)) < 1e-9:
        return None
    t, _ = np.linalg.solve(m, q - p)
    return p + t * d


def snap_axis(line):
    point, direction = line
    angle = np.degrees(np.arctan2(direction[1], direction[0])) % 180.0
    if min(angle, 180.0 - angle) < AXIS_SNAP_DEGREES:
        return point, np.array([1.0, 0.0])
    if abs(angle - 90.0) < AXIS_SNAP_DEGREES:
        return point, np.array([0.0, 1.0])
    return line


def trace_polygon(contour_rc: np.ndarray) -> np.ndarray:
    """Contour in (row, col) order -> sharp polygon in (x, y) pixel order."""
    # find_contours puts pixel centres on integer coordinates; SVG and raster
    # grids put pixel edges there, so shift by half a pixel.
    contour = contour_rc[:, ::-1] + 0.5
    if np.allclose(contour[0], contour[-1]):
        contour = contour[:-1]
    simple = measure.approximate_polygon(np.vstack([contour, contour[:1]]), CORNER_TOLERANCE_PX)[:-1]

    # Map the simplified corners back to indices on the dense contour.
    idx = sorted({int(np.argmin(np.hypot(*(contour - v).T))) for v in simple})

    # Drop corners that create edges too short to be real (rounded tips).
    changed = True
    while changed and len(idx) > 3:
        changed = False
        for i in range(len(idx)):
            a, b = contour[idx[i]], contour[idx[(i + 1) % len(idx)]]
            if np.hypot(*(a - b)) < MIN_EDGE_PX:
                del idx[(i + 1) % len(idx)]
                changed = True
                break

    lines = []
    for i in range(len(idx)):
        a, b = idx[i], idx[(i + 1) % len(idx)]
        run = contour[a : b + 1] if b > a else np.vstack([contour[a:], contour[: b + 1]])
        trim = max(1, int(len(run) * TRIM))
        lines.append(snap_axis(fit_line(run[trim : len(run) - trim])))

    corners = []
    for i in range(len(lines)):
        corner = intersect(lines[i - 1], lines[i])
        if corner is None:
            raise RuntimeError("two neighbouring edges are parallel; cannot intersect")
        corners.append(corner)
    return np.array(corners)


def extract_polygons(darkness: np.ndarray):
    polygons = []
    for contour in measure.find_contours(darkness, THRESHOLD):
        if polygon_area(contour) < MIN_AREA_PX:
            continue
        polygons.append(trace_polygon(contour))
    # Stable order: left to right, then top to bottom.
    polygons.sort(key=lambda p: (round(p[:, 0].mean() / 40), p[:, 1].mean()))
    return polygons


def normalise(polygons):
    stack = np.vstack(polygons)
    lo, hi = stack.min(axis=0), stack.max(axis=0)
    size = float((hi - lo).max())
    scale = VIEW / size
    offset = (VIEW - (hi - lo) * scale) / 2.0 - lo * scale
    out = [p * scale + offset for p in polygons]
    return out, scale, offset


def fmt(value: float) -> str:
    text = f"{value:.2f}".rstrip("0").rstrip(".")
    return text if text not in ("-0", "") else "0"


def path_data(polygons) -> str:
    parts = []
    for poly in polygons:
        pts = [f"{fmt(x)} {fmt(y)}" for x, y in poly]
        parts.append("M" + " L".join(pts) + "Z")
    return " ".join(parts)


def write_outputs(polygons, bounds):
    d = path_data(polygons)
    SVG_OUT.parent.mkdir(parents=True, exist_ok=True)
    SVG_OUT.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="GenLayer mark">'
        f'<path fill="#000" fill-rule="evenodd" d="{d}"/></svg>\n'
    )
    rows = ",\n  ".join(
        "[" + ", ".join(f"[{fmt(x)}, {fmt(y)}]" for x, y in poly) + "]" for poly in polygons
    )
    TS_OUT.write_text(
        "// Generated by scripts/logo/trace_mark.py - do not edit by hand.\n"
        "// The GenLayer mark traced from the official artwork, in a 0..100 square.\n\n"
        "export type MarkPoint = readonly [number, number];\n\n"
        "export const MARK_VIEWBOX = 100;\n\n"
        "/** Solid pieces of the mark (none of them has a hole). */\n"
        f"export const MARK_POLYGONS: ReadonlyArray<ReadonlyArray<MarkPoint>> = [\n  {rows},\n];\n\n"
        "/** Bounding box of the mark inside the 0..100 square. */\n"
        f"export const MARK_BOUNDS = {{ x0: {fmt(bounds[0])}, y0: {fmt(bounds[1])}, x1: {fmt(bounds[2])}, y1: {fmt(bounds[3])} }} as const;\n\n"
        f'export const MARK_PATH = "{d}";\n'
    )


def rasterise_svg(svg_text: str, px: int) -> np.ndarray:
    exe = shutil.which("rsvg-convert")
    if not exe:
        raise RuntimeError("rsvg-convert is required for the round-trip check")
    png = subprocess.run(
        [exe, "-w", str(px), "-h", str(px), "-b", "white", "-f", "png"],
        input=svg_text.encode(),
        check=True,
        capture_output=True,
    ).stdout
    gray = np.asarray(Image.open(io.BytesIO(png)).convert("L"), dtype=float) / 255.0
    return 1.0 - gray


def round_trip_iou(darkness: np.ndarray, scale: float, offset: np.ndarray, svg_path: Path) -> float:
    """Read the path back out of the written SVG file, map it exactly back to
    source-pixel coordinates (the inverse of normalise()), rasterise it with
    rsvg-convert on the source pixel grid and compare masks."""
    path_d = re.search(r' d="([^"]+)"', svg_path.read_text()).group(1)
    h, w = darkness.shape
    wrapper = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
        f'<g transform="scale({1.0 / scale:.9f}) translate({-offset[0]:.9f} {-offset[1]:.9f})">'
        f'<path fill="#000" fill-rule="evenodd" d="{path_d}"/></g></svg>'
    )
    # The wrapper maps unit -> pixel as (unit - offset) / scale; rsvg applies
    # the inner translate first, then the scale, which is the same thing.
    raster = rasterise_svg(wrapper, w) >= THRESHOLD
    ref = darkness >= THRESHOLD
    inter = np.logical_and(raster, ref).sum()
    union = np.logical_or(raster, ref).sum()
    return float(inter) / float(union)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("image", type=Path, help="raster image of the mark (dark mark on a light ground)")
    args = parser.parse_args()

    darkness = load_darkness(args.image)
    pixel_polygons = extract_polygons(darkness)
    if not pixel_polygons:
        print("no solid shapes found", file=sys.stderr)
        return 1
    polygons, scale, offset = normalise(pixel_polygons)
    stack = np.vstack(polygons)
    bounds = (*stack.min(axis=0), *stack.max(axis=0))
    write_outputs(polygons, bounds)

    print(f"pieces: {len(polygons)}  vertices: {[len(p) for p in polygons]}")
    print(f"wrote {SVG_OUT.relative_to(ROOT)} and {TS_OUT.relative_to(ROOT)}")
    iou = round_trip_iou(darkness, scale, offset, SVG_OUT)
    print(f"IoU against the thresholded original: {iou:.4f}")
    return 0 if iou > 0.97 else 2


if __name__ == "__main__":
    sys.exit(main())
