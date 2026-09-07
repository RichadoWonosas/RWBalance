import { describe, expect, it } from 'vitest'
import { hslColor, lightThemeColor, previewThemeColor, profileForHue, relativeLuminance } from '../../src/core/domain/theme'

describe('tone-specific HSL palette', () => {
  it('keeps light surfaces light throughout the hue ring', () => {
    for (let hue = 0; hue < 360; hue++) {
      expect(profileForHue(hue, 'light').lightness).toBe(1)
      expect(lightThemeColor(hue, 'preview').lightness).toBe(66)
      for (const role of ['action', 'banner'] as const) {
        expect(1.05 / (relativeLuminance(lightThemeColor(hue, role)) + 0.05)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
  it('preserves the requested purple banner and authors previews in HSL', () => {
    expect(hslColor(lightThemeColor(270, 'banner'))).toBe('hsl(270 80% 60%)')
    expect(previewThemeColor(270, 'light')).toBe('hsl(270 82% 66%)')
    expect(profileForHue(120, 'dark').lightness).toBe(.8)
  })
})
