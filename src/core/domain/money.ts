import type { Currency, Money } from './types'

export interface CurrencyRule {
  fractionDigits: number
  maxMinorUnits: number
  rounding: 'half-up'
}

export const currencyRules: Record<Currency, CurrencyRule> = {
  CNY: { fractionDigits: 2, maxMinorUnits: 9_000_000_000_000_000, rounding: 'half-up' },
  USD: { fractionDigits: 2, maxMinorUnits: 9_000_000_000_000_000, rounding: 'half-up' },
  GBP: { fractionDigits: 2, maxMinorUnits: 9_000_000_000_000_000, rounding: 'half-up' },
  JPY: { fractionDigits: 0, maxMinorUnits: 9_000_000_000_000_000, rounding: 'half-up' },
}

export function toMinorUnits(value: string | number, currency: Currency): number {
  const text = String(value).trim()
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text)
  if (!match) throw new Error('金额必须是大于或等于 0 的有效数值')
  const rule = currencyRules[currency]
  const fraction = match[2] ?? ''
  const kept = fraction.slice(0, rule.fractionDigits).padEnd(rule.fractionDigits, '0')
  let minorUnits = BigInt(match[1]!) * 10n ** BigInt(rule.fractionDigits) + BigInt(kept || '0')
  if ((fraction[rule.fractionDigits] ?? '0') >= '5') minorUnits += 1n
  if (minorUnits > BigInt(rule.maxMinorUnits)) throw new Error(`${currency} 金额超过允许上限`)
  return Number(minorUnits)
}

export function formatMoney(money: Money): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: money.currency,
    minimumFractionDigits: currencyRules[money.currency].fractionDigits,
    maximumFractionDigits: currencyRules[money.currency].fractionDigits,
  }).format(money.minorUnits / 10 ** currencyRules[money.currency].fractionDigits)
}

export function formatMinorUnits(value: number, currency: Currency): string {
  return formatMoney({ minorUnits: value, currency })
}
