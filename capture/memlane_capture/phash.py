"""A photo's perceptual fingerprint: a 64-bit difference hash (dHash), with Pillow only.

The same picture resized, recompressed or lightly cropped gives the same or a nearby hash; a different picture
gives a distant one. Two photos are "similar" when their hashes differ in at most SIMILAR_BITS of 64 bits
(Hamming distance), which Postgres computes as bit_count((a # b)::bit(64)).
"""

from PIL import Image, ImageOps

SIMILAR_BITS = 6


def dhash(src) -> int:
    """Signed 64-bit (a Postgres bigint): row by row, is each pixel brighter than its right neighbour?
    `src`: a path or a binary file object."""
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im).convert("L").resize((9, 8), Image.Resampling.LANCZOS)
        px = im.tobytes()   # greyscale: one byte per pixel
    bits = 0
    for row in range(8):
        for col in range(8):
            bits = (bits << 1) | (px[row * 9 + col] > px[row * 9 + col + 1])
    return bits - (1 << 64) if bits >= (1 << 63) else bits


def distance(a: int, b: int) -> int:
    return bin((a ^ b) & ((1 << 64) - 1)).count("1")
