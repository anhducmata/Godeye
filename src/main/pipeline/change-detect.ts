/**
 * Frame change detection using simple pixel difference.
 * Used to skip OCR on frames that haven't changed significantly.
 */

/**
 * Compare two image buffers (raw RGBA pixel data) and return
 * whether the change exceeds the threshold.
 * 
 * @param prev - Previous frame buffer (RGBA)
 * @param curr - Current frame buffer (RGBA)
 * @param threshold - Fraction of pixels that must differ (0-1), default 0.05 (5%)
 * @returns true if the frame has changed significantly
 */
export function hasSignificantChange(
  prev: Buffer | Uint8Array,
  curr: Buffer | Uint8Array,
  threshold: number = 0.05
): boolean {
  if (prev.length !== curr.length) return true
  if (prev.length === 0) return true

  let diffCount = 0
  const pixelCount = prev.length / 4 // RGBA

  for (let i = 0; i < prev.length; i += 4) {
    const dr = Math.abs(prev[i] - curr[i])
    const dg = Math.abs(prev[i + 1] - curr[i + 1])
    const db = Math.abs(prev[i + 2] - curr[i + 2])

    // If combined channel difference exceeds threshold, count as changed pixel
    if (dr + dg + db > 40) {
      diffCount++
    }
  }

  const changeRatio = diffCount / pixelCount
  return changeRatio > threshold
}

/**
 * Compute a simple perceptual hash of a frame for quick comparison.
 * Uses average grayscale of 8x8 downsampled grid.
 */
export function computeFrameHash(data: Buffer | Uint8Array, width: number, height: number): string {
  const gridSize = 8
  const cellW = Math.floor(width / gridSize)
  const cellH = Math.floor(height / gridSize)
  let hash = ''

  let totalAvg = 0
  const cellAvgs: number[] = []

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      let sum = 0
      let count = 0
      for (let y = gy * cellH; y < (gy + 1) * cellH && y < height; y++) {
        for (let x = gx * cellW; x < (gx + 1) * cellW && x < width; x++) {
          const idx = (y * width + x) * 4
          // Grayscale approximation
          sum += data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114
          count++
        }
      }
      const avg = count > 0 ? sum / count : 0
      cellAvgs.push(avg)
      totalAvg += avg
    }
  }

  totalAvg /= cellAvgs.length

  // Create hash: 1 if above average, 0 if below
  for (const avg of cellAvgs) {
    hash += avg >= totalAvg ? '1' : '0'
  }

  return hash
}

/**
 * Compare two perceptual hashes.
 * Returns the Hamming distance (number of differing bits).
 */
export function hashDistance(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) return hash1.length
  let dist = 0
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) dist++
  }
  return dist
}
