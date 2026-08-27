/**
 * Generates `build/icon.ico`, the application icon electron-builder stamps onto the
 * executable, the installer and the taskbar entry.
 *
 * Run it with `node build/icon.mjs`. It has no dependencies: PNG and ICO are both
 * simple enough to emit directly, and this repo keeps its dependency list short.
 *
 * The drawing is the app's own picture of itself — a curve, in the accent, over a
 * wash — because that is what four of its five views are. The palette below is
 * lifted from `src/renderer/src/app.css`; if the indigo ramp ever moves, re-run this
 * rather than hand-editing a binary. The tile is the *saturated* accent rather than
 * the app's near-black `--bg`, which would vanish against a dark taskbar.
 *
 * Every shape is a distance function sampled at SUPERSAMPLE× and box-filtered down,
 * which is where the antialiasing comes from. Sizes below 32px are drawn with a
 * proportionally fatter stroke: a 16px tile cannot spare the pixels for a hairline.
 */

import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** `--accent-strong`, the app's filled-button indigo, lit for the tile's top-left. */
const TILE_FROM = [0x63, 0x66, 0xf1]
/** One step down the same indigo ramp, for the bottom-right. */
const TILE_TO = [0x37, 0x30, 0xa3]
/** `--text`. The curve is drawn in ink, not in `--accent`: on this tile it would sink. */
const INK = [0xf8, 0xfa, 0xfc]

const SIZES = [16, 24, 32, 48, 64, 128, 256]
const SUPERSAMPLE = 4

/** The curve, in the inner box's own space: x left-to-right, y up from the baseline. */
const CURVE = [
  [0.0, 0.16],
  [0.26, 0.44],
  [0.48, 0.29],
  [0.72, 0.71],
  [1.0, 0.94],
]

const lerp = (a, b, t) => a + (b - a) * t
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Distance from a point to a line segment. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : clamp01(((px - ax) * dx + (py - ay) * dy) / lengthSquared)
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

/** Signed distance to a rounded square; negative inside. */
function roundedSquareDistance(px, py, size, radius) {
  const half = size / 2
  const qx = Math.abs(px - half) - (half - radius)
  const qy = Math.abs(py - half) - (half - radius)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  return outside + Math.min(Math.max(qx, qy), 0) - radius
}

/** Renders one square RGBA bitmap of the icon. */
function render(size) {
  const scale = SUPERSAMPLE
  const big = size * scale
  const radius = big * 0.185

  // The inner box the curve is drawn into.
  const marginX = big * 0.19
  const innerWidth = big - marginX * 2
  const top = big * 0.235
  const innerHeight = big * 0.53
  const baseline = top + innerHeight

  // A 16px tile cannot spare the pixels for a hairline; fatten the stroke as it shrinks.
  const strokeScale = size <= 16 ? 1.32 : size <= 24 ? 1.18 : size <= 32 ? 1.08 : 1
  const halfStroke = big * 0.048 * strokeScale

  const points = CURVE.map(([x, y]) => [marginX + x * innerWidth, baseline - y * innerHeight])

  /** The curve's y at a given x, for the wash beneath it. */
  function curveY(x) {
    if (x <= points[0][0]) return points[0][1]
    for (let i = 1; i < points.length; i += 1) {
      const [ax, ay] = points[i - 1]
      const [bx, by] = points[i]
      if (x <= bx) return lerp(ay, by, (x - ax) / (bx - ax))
    }
    return points[points.length - 1][1]
  }

  const accumulator = new Float64Array(size * size * 4)

  for (let sy = 0; sy < big; sy += 1) {
    for (let sx = 0; sx < big; sx += 1) {
      const px = sx + 0.5
      const py = sy + 0.5

      // Outside the tile the icon is transparent.
      if (roundedSquareDistance(px, py, big, radius) > 0) continue

      // Tile: a diagonal ramp down the indigo.
      const t = clamp01((px / big + py / big) / 2)
      let r = lerp(TILE_FROM[0], TILE_TO[0], t)
      let g = lerp(TILE_FROM[1], TILE_TO[1], t)
      let b = lerp(TILE_FROM[2], TILE_TO[2], t)

      // The wash under the curve, so the shape reads as an area and not a stray line.
      // It runs to the tile's own edges rather than stopping at the inner box: bounded,
      // its corners draw a rectangle that reads as a mistake next to the curve.
      if (py >= curveY(px)) {
        const wash = 0.17
        r = lerp(r, INK[0], wash)
        g = lerp(g, INK[1], wash)
        b = lerp(b, INK[2], wash)
      }

      // The curve itself.
      let nearest = Infinity
      for (let i = 1; i < points.length; i += 1) {
        const d = distanceToSegment(px, py, points[i - 1][0], points[i - 1][1], points[i][0], points[i][1])
        if (d < nearest) nearest = d
      }
      if (nearest <= halfStroke) {
        r = INK[0]
        g = INK[1]
        b = INK[2]
      }

      const target = (Math.floor(sy / scale) * size + Math.floor(sx / scale)) * 4
      accumulator[target] += r
      accumulator[target + 1] += g
      accumulator[target + 2] += b
      accumulator[target + 3] += 255
    }
  }

  const samples = scale * scale
  const rgba = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i += 1) {
    const alpha = accumulator[i * 4 + 3] / samples
    const coverage = alpha / 255
    // Colour was only accumulated where the tile covered the pixel, so divide by the
    // covered sample count rather than by all of them, or the edges darken.
    const covered = coverage === 0 ? 1 : accumulator[i * 4 + 3] / 255
    rgba[i * 4] = Math.round(accumulator[i * 4] / covered)
    rgba[i * 4 + 1] = Math.round(accumulator[i * 4 + 1] / covered)
    rgba[i * 4 + 2] = Math.round(accumulator[i * 4 + 2] / covered)
    rgba[i * 4 + 3] = Math.round(alpha)
  }
  return rgba
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** Encodes RGBA pixels as a PNG. Filter 0 on every scanline: these images compress fine. */
function encodePng(rgba, size) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** Packs PNGs into an ICO. Vista and later read PNG-compressed entries at every size. */
function encodeIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)

  const directory = Buffer.alloc(entries.length * 16)
  let offset = header.length + directory.length
  entries.forEach((entry, i) => {
    const at = i * 16
    directory[at] = entry.size >= 256 ? 0 : entry.size
    directory[at + 1] = entry.size >= 256 ? 0 : entry.size
    directory[at + 2] = 0 // palette size
    directory[at + 3] = 0 // reserved
    directory.writeUInt16LE(1, at + 4) // colour planes
    directory.writeUInt16LE(32, at + 6) // bits per pixel
    directory.writeUInt32LE(entry.png.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += entry.png.length
  })

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)])
}

const entries = SIZES.map((size) => ({ size, png: encodePng(render(size), size) }))
const out = join(dirname(fileURLToPath(import.meta.url)), 'icon.ico')
writeFileSync(out, encodeIco(entries))
console.log(`wrote ${out} — ${SIZES.join(', ')}px`)
