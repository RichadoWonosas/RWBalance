export type ThemeChannel = 'primary' | 'secondary'
export type ColorTone = 'light' | 'dark'
export interface AppearanceSettings { primaryHue: number; secondaryHue: number; colorTone: ColorTone }

export const defaultTheme: Readonly<AppearanceSettings> = Object.freeze({ primaryHue: 270, secondaryHue: 225, colorTone: 'light' })

const hueProfiles = [
  { hue: 0, saturationScale: 1, lightnessScale: 0.88 },
  { hue: 30, saturationScale: 1, lightnessScale: 0.84 },
  { hue: 60, saturationScale: 0.84, lightnessScale: 0.8 },
  { hue: 90, saturationScale: 0.84, lightnessScale: 0.8 },
  { hue: 120, saturationScale: 0.75, lightnessScale: 0.8 },
  { hue: 150, saturationScale: 0.8, lightnessScale: 0.8 },
  { hue: 180, saturationScale: 0.75, lightnessScale: 0.8 },
  { hue: 210, saturationScale: 0.88, lightnessScale: 0.9 },
  { hue: 240, saturationScale: 1, lightnessScale: 1 },
  { hue: 270, saturationScale: 1, lightnessScale: 1 },
  { hue: 300, saturationScale: 1, lightnessScale: 1 },
  { hue: 330, saturationScale: 1, lightnessScale: 0.96 },
  { hue: 360, saturationScale: 1, lightnessScale: 0.88 },
] as const

export function normalizeHue(value: unknown, fallback = 0): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return ((Math.round(numeric) % 360) + 360) % 360
}

export function profileForHue(value: number, tone: ColorTone = 'dark'): { saturation: number; lightness: number } {
  const hue = normalizeHue(value)
  const zone = Math.floor(hue / 30)
  const ratio = (hue % 30) / 30
  const from = hueProfiles[zone]!
  const to = hueProfiles[zone + 1]!
  const profile = {
    saturation: Number(((1 - ratio) * from.saturationScale + ratio * to.saturationScale).toFixed(2)),
    lightness: Number(((1 - ratio) * from.lightnessScale + ratio * to.lightnessScale).toFixed(2)),
  }
  // Light surfaces stay near white at every hue. Only gently soften vivid hues;
  // the stronger historical corrections are reserved for the dark palette.
  return tone === 'light'
    ? { saturation: 0.92 + 0.08 * profile.saturation, lightness: 1 }
    : profile
}

export interface HslColor { hue: number; saturation: number; lightness: number }
export function hslColor(color: HslColor): string {
  return `hsl(${normalizeHue(color.hue)} ${color.saturation}% ${color.lightness}%)`
}

// HSL remains the authoring format; linear channels are used only to measure contrast.
export function relativeLuminance({ hue, saturation, lightness }: HslColor): number {
  const h = normalizeHue(hue) / 30, s = saturation / 100, l = lightness / 100
  const a = s * Math.min(l, 1 - l)
  const channels = [0, 8, 4].map((offset) => {
    const k = (offset + h) % 12
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
}

export function lightThemeColor(hue: number, role: 'action' | 'banner' | 'preview'): HslColor {
  const profile = profileForHue(hue, 'light')
  const color = {
    hue: normalizeHue(hue),
    saturation: Math.round((role === 'preview' ? 82 : role === 'banner' ? 80 : 76) * profile.saturation),
    lightness: role === 'preview' ? 66 : role === 'banner' ? 60 : 48,
  }
  // Swatches contain no text: keep them bright. Filled surfaces must support white labels.
  if (role !== 'preview') {
    while (color.lightness > 1 && 1.05 / (relativeLuminance(color) + 0.05) < 4.5) color.lightness -= 0.5
  }
  return color
}

export function previewThemeColor(hue: number, tone: ColorTone): string {
  if (tone === 'light') return hslColor(lightThemeColor(hue, 'preview'))
  const profile = profileForHue(hue, tone)
  return hslColor({ hue, saturation: Math.round(72 * profile.saturation), lightness: Math.round(58 * profile.lightness) })
}

export function encodeAppearance(settings: { primaryHue?: number; secondaryHue?: number; colorTone?: string }): string {
  const primaryHue = normalizeHue(settings.primaryHue, defaultTheme.primaryHue)
  const secondaryHue = normalizeHue(settings.secondaryHue, defaultTheme.secondaryHue)
  const toneBit = settings.colorTone === 'dark' ? 1 : 0
  return (primaryHue | (secondaryHue << 9) | (toneBit << 18)).toString(36)
}

export function decodeAppearance(value?: string): AppearanceSettings {
  const packed = value ? Number.parseInt(value, 36) : Number.NaN
  if (!Number.isSafeInteger(packed) || packed < 0) return { ...defaultTheme }
  return {
    primaryHue: normalizeHue(packed & 0x1ff, defaultTheme.primaryHue),
    secondaryHue: normalizeHue((packed >> 9) & 0x1ff, defaultTheme.secondaryHue),
    colorTone: ((packed >> 18) & 1) === 1 ? 'dark' : 'light',
  }
}
