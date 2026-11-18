"""Draws the extension icons (a rounded blue square with a white check mark) without any image library.

Usage: python3 tools/make-icons.py
"""
import os
import struct
import zlib

BLUE = (11, 92, 173)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'extension', 'icons')


def segment_distance(p, q, x, y):
    (x1, y1), (x2, y2) = p, q
    dx, dy = x2 - x1, y2 - y1
    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return ((x - (x1 + t * dx)) ** 2 + (y - (y1 + t * dy)) ** 2) ** 0.5


def png(size):
    radius = size * 0.2
    a, b, c = (size * 0.24, size * 0.54), (size * 0.43, size * 0.72), (size * 0.78, size * 0.32)
    stroke = size * 0.085

    def in_square(x, y):
        cx = min(max(x, radius), size - radius)
        cy = min(max(y, radius), size - radius)
        return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius

    rows = bytearray()
    for y in range(size):
        rows.append(0)  # filter type: none
        for x in range(size):
            background = 0
            mark = 0
            # 3x3 samples per pixel for smooth edges
            for sy in (0.17, 0.5, 0.83):
                for sx in (0.17, 0.5, 0.83):
                    px, py = x + sx, y + sy
                    if in_square(px, py):
                        background += 1
                        if min(segment_distance(a, b, px, py), segment_distance(b, c, px, py)) <= stroke:
                            mark += 1
            share = mark / background if background else 0
            rows.extend(int(channel + (255 - channel) * share) for channel in BLUE)
            rows.append(int(255 * background / 9))

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(rows), 9))
            + chunk(b'IEND', b''))


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for size in (16, 32, 48, 128):
        with open(os.path.join(OUT, 'icon-%d.png' % size), 'wb') as handle:
            handle.write(png(size))
        print('wrote icon-%d.png' % size)
