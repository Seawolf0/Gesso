# Usage: pix.py shot.png scale x,y [x,y ...]  → RGB at CSS-pixel coordinates (screenshot is device-scaled)
import sys, struct, zlib
def read(path):
    data = open(path, 'rb').read(); pos = 8; idat = b''
    while pos < len(data):
        n, t = struct.unpack('>I4s', data[pos:pos+8]); body = data[pos+8:pos+8+n]; pos += 12 + n
        if t == b'IHDR': w, h, bd, ct = struct.unpack('>IIBB', body[:10])
        elif t == b'IDAT': idat += body
    bpp = {2: 3, 6: 4}[ct]; raw = zlib.decompress(idat); stride = w * bpp; rows = []; prev = bytearray(stride); i = 0
    for _ in range(h):
        f = raw[i]; line = bytearray(raw[i+1:i+1+stride]); i += 1 + stride
        for x in range(stride):
            a = line[x-bpp] if x >= bpp else 0; b = prev[x]; c = prev[x-bpp] if x >= bpp else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c; pa, pb, pc = abs(p-a), abs(p-b), abs(p-c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line); prev = line
    return rows, bpp
if __name__ == "__main__":
  rows, bpp = read(sys.argv[1]); k = float(sys.argv[2])
  for xy in sys.argv[3:]:
      x, y = (int(float(v) * k) for v in xy.split(","))
      print(xy, tuple(rows[y][x*bpp:x*bpp+3]))
