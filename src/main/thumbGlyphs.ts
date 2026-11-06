import type { Glyph } from './thumbModel.ts'

type Point = readonly [x: number, y: number]
type Shape = (x: number, y: number) => boolean

const rect = (x0: number, y0: number, x1: number, y1: number): Shape => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1

function triangle(a: Point, b: Point, c: Point): Shape {
  const side = (p: Point, q: Point, x: number, y: number) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0])
  return (x, y) => {
    const s1 = side(a, b, x, y)
    const s2 = side(b, c, x, y)
    const s3 = side(c, a, x, y)
    return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)
  }
}

// Shapes on a unit square. The same drawing is scaled to every icon size.
const SHAPES: Record<Glyph, Shape[]> = {
  play: [triangle([0.28, 0.12], [0.28, 0.88], [0.88, 0.5])],
  pause: [rect(0.2, 0.14, 0.4, 0.86), rect(0.6, 0.14, 0.8, 0.86)],
  previous: [rect(0.12, 0.16, 0.26, 0.84), triangle([0.88, 0.16], [0.88, 0.84], [0.34, 0.5])],
  next: [rect(0.74, 0.16, 0.88, 0.84), triangle([0.12, 0.16], [0.12, 0.84], [0.66, 0.5])],
}

/** The Brita orange, which stays visible on both the light and the dark taskbar thumbnail. */
const COLOR = { r: 0xff, g: 0x6f, b: 0x00 }

const SAMPLES = 4

/**
 * The pixels of one button icon: blue, green, red, alpha per pixel, colours already multiplied by alpha
 * (the layout Electron's `nativeImage.createFromBitmap` takes on Windows). Edges are smoothed by sampling.
 */
export function glyphBitmap(glyph: Glyph, size: number): Buffer {
  const out = Buffer.alloc(size * size * 4)
  const shapes = SHAPES[glyph]
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) / size
          const y = (py + (sy + 0.5) / SAMPLES) / size
          if (shapes.some((shape) => shape(x, y))) hits++
        }
      }
      const alpha = hits / (SAMPLES * SAMPLES)
      const at = (py * size + px) * 4
      out[at] = Math.round(COLOR.b * alpha)
      out[at + 1] = Math.round(COLOR.g * alpha)
      out[at + 2] = Math.round(COLOR.r * alpha)
      out[at + 3] = Math.round(255 * alpha)
    }
  }
  return out
}
