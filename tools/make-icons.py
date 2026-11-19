"""Renders the extension icons from tools/icon.svg (dark tile, natural brackets, magenta check).

Needs rsvg-convert on the PATH (macOS: brew install librsvg).

Usage: python3 tools/make-icons.py
"""
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(HERE, 'icon.svg')
OUT = os.path.join(HERE, '..', 'extension', 'icons')

if __name__ == '__main__':
    if not shutil.which('rsvg-convert'):
        sys.exit('rsvg-convert was not found. Install librsvg (macOS: brew install librsvg) and run again.')
    os.makedirs(OUT, exist_ok=True)
    for size in (16, 32, 48, 128):
        target = os.path.join(OUT, 'icon-%d.png' % size)
        subprocess.run(['rsvg-convert', '-w', str(size), '-h', str(size), SOURCE, '-o', target], check=True)
        print('wrote icon-%d.png' % size)
