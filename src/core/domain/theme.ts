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

export function profileForHue(value: number): { saturation: number; lightness: number } {
  const hue = normalizeHue(value)
  const zone = Math.floor(hue / 30)
  const ratio = (hue % 30) / 30
  const from = hueProfiles[zone]!
  const to = hueProfiles[zone + 1]!
  return {
    saturation: Number(((1 - ratio) * from.saturationScale + ratio * to.saturationScale).toFixed(2)),
    lightness: Number(((1 - ratio) * from.lightnessScale + ratio * to.lightnessScale).toFixed(2)),
  }
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
