#!/usr/bin/env python3
"""Generate PNG app icons with no external dependencies (stdlib zlib only).
Draws a teal rounded square with a white checkmark — the app mark."""
import zlib, struct, os, math

TEAL = (15, 118, 110)
TEAL_DK = (11, 86, 80)
WHITE = (255, 255, 255)

def png(path, size, maskable=False):
    w = h = size
    # padding for maskable (safe zone): draw smaller mark inside
    px = bytearray()
    cx, cy = w / 2, h / 2
    radius = size * 0.22  # corner radius for rounded square
    # checkmark geometry (relative to size)
    scale = 0.62 if maskable else 0.78
    # check points
    p1 = (0.30, 0.52); p2 = (0.44, 0.66); p3 = (0.72, 0.34)
    stroke = size * 0.075

    def in_rounded_rect(x, y):
        # full-bleed rounded square
        rx = ry = radius
        if x < rx and y < ry:   return (x - rx) ** 2 + (y - ry) ** 2 <= rx * rx
        if x > w - rx and y < ry: return (x - (w - rx)) ** 2 + (y - ry) ** 2 <= rx * rx
        if x < rx and y > h - ry: return (x - rx) ** 2 + (y - (h - ry)) ** 2 <= rx * rx
        if x > w - rx and y > h - ry: return (x - (w - rx)) ** 2 + (y - (h - ry)) ** 2 <= rx * rx
        return True

    def dist_to_seg(px_, py_, ax, ay, bx, by):
        dx, dy = bx - ax, by - ay
        if dx == 0 and dy == 0:
            return math.hypot(px_ - ax, py_ - ay)
        t = max(0, min(1, ((px_ - ax) * dx + (py_ - ay) * dy) / (dx * dx + dy * dy)))
        return math.hypot(px_ - (ax + t * dx), py_ - (ay + t * dy))

    A = (w * (0.5 + (p1[0]-0.5)*scale), h * (0.5 + (p1[1]-0.5)*scale))
    B = (w * (0.5 + (p2[0]-0.5)*scale), h * (0.5 + (p2[1]-0.5)*scale))
    C = (w * (0.5 + (p3[0]-0.5)*scale), h * (0.5 + (p3[1]-0.5)*scale))

    for y in range(h):
        px.append(0)  # filter byte per scanline
        for x in range(w):
            inside = in_rounded_rect(x + 0.5, y + 0.5) if not maskable else True
            if not inside:
                px += bytes((0, 0, 0, 0))
                continue
            # vertical gradient teal
            t = y / h
            r = int(TEAL[0] * (1 - t) + TEAL_DK[0] * t)
            g = int(TEAL[1] * (1 - t) + TEAL_DK[1] * t)
            b = int(TEAL[2] * (1 - t) + TEAL_DK[2] * t)
            # checkmark
            d = min(dist_to_seg(x + 0.5, y + 0.5, *A, *B),
                    dist_to_seg(x + 0.5, y + 0.5, *B, *C))
            if d <= stroke:
                r, g, b = WHITE
            px += bytes((r, g, b, 255))

    raw = bytes(px)
    comp = zlib.compress(raw, 9)

    def chunk(typ, data):
        c = struct.pack('>I', len(data)) + typ + data
        return c + struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff)

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)  # 8-bit RGBA
    with open(path, 'wb') as f:
        f.write(sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', comp) + chunk(b'IEND', b''))
    print('wrote', path, size)

os.makedirs('icons', exist_ok=True)
png('icons/icon-180.png', 180)
png('icons/icon-192.png', 192)
png('icons/icon-512.png', 512)
png('icons/icon-maskable-512.png', 512, maskable=True)
