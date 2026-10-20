import type { ElementRole } from '@/types/pageState'

/**
 * Risk scoring (spec §9). Every action gets a level from the tool's base
 * risk plus signals from the page (URL, target element). Some contexts are
 * HARD BLOCKS: payment, password creation, legal consent, OTP, destructive
 * confirmations and sensitive uploads never run without the user's explicit
 * approval, regardless of mode.
 */

export type RiskLevel = 'safe' | 'low' | 'medium' | 'high'

export type HardBlockKind =
  | 'payment'
  | 'password-create'
  | 'legal-consent'
  | 'otp'
  | 'delete-or-confirm'
  | 'sensitive-upload'

export interface RiskInput {
  tool: string
  /** 'read' | 'write' | 'control' */
  kind: string
  url?: string
  element?: {
    role?: ElementRole
    tag?: string
    inputType?: string
    /** Visible text, aria-label, placeholder, name, id. */
    text?: string
  } | null
}

export interface RiskAssessment {
  level: RiskLevel
  reasons: string[]
  hardBlock: HardBlockKind | null
}

const BASE_RISK: Record<string, RiskLevel> = {
  read_page: 'safe',
  wait: 'safe',
  ask_user: 'safe',
  finish: 'safe',
  navigate: 'low',
  scroll: 'low',
  click: 'medium',
  type_text: 'medium',
}

const PAYMENT = /\b(checkout|pay now|place order|buy now|purchase|subscribe|proceed to payment)\b|\bcard (number|cvv|details)\b|\bbilling address\b/i
const LEGAL = /\b(i agree|accept terms|terms of (service|use)|legal consent|sign contract|agree to the)\b/i
const OTP = /\b(otp|one[-\s]?time (password|code)|verification code|security code)\b/i
const DESTRUCTIVE = /\b(delete|remove|unsubscribe|cancel (account|subscription)|confirm (purchase|deletion|delete)|drop (table|account))\b/i
const SENSITIVE_UPLOAD = /\b(tax|passport|id (card|document)|drivers? license|salary|pay ?stub|medical)\b/i

function escalate(level: RiskLevel, to: RiskLevel): RiskLevel {
  const order: RiskLevel[] = ['safe', 'low', 'medium', 'high']
  return order[Math.max(order.indexOf(level), order.indexOf(to))]!
}

function haystack(input: RiskInput): string {
  const el = input.element
  return [input.url ?? '', el?.text ?? '', el?.inputType ?? ''].join(' ')
}

export function assessRisk(input: RiskInput): RiskAssessment {
  const reasons: string[] = []
  let level = BASE_RISK[input.tool] ?? (input.kind === 'read' ? 'safe' : 'medium')
  let hardBlock: HardBlockKind | null = null

  const el = input.element
  const text = el?.text ?? ''
  const inputType = el?.inputType?.toLowerCase()

  if (inputType === 'password') {
    if (/new|confirm|create|signup|register/i.test(text)) {
      hardBlock = 'password-create'
      reasons.push('Creating or confirming a password.')
    } else {
      level = escalate(level, 'high')
      reasons.push('Typing into a password field.')
    }
  }

  if (OTP.test(haystack(input))) {
    hardBlock = 'otp'
    reasons.push('One-time codes are never solved automatically.')
  }

  if (PAYMENT.test(haystack(input))) {
    hardBlock = 'payment'
    reasons.push('Payment or purchase flow.')
  }

  if (LEGAL.test(text)) {
    hardBlock = 'legal-consent'
    reasons.push('Legal consent checkbox or agreement.')
  }

  if (DESTRUCTIVE.test(text)) {
    hardBlock = 'delete-or-confirm'
    reasons.push('Destructive or final confirmation.')
  }

  if (el?.role === 'file' || inputType === 'file') {
    if (SENSITIVE_UPLOAD.test(haystack(input))) {
      hardBlock = 'sensitive-upload'
      reasons.push('Uploading a sensitive document.')
    } else {
      level = escalate(level, 'medium')
      reasons.push('File upload.')
    }
  }

  if (input.tool === 'navigate' && input.url && PAYMENT.test(input.url)) {
    hardBlock = 'payment'
    reasons.push('Navigating to a payment page.')
  }

  if (input.kind === 'read' && hardBlock === null) level = 'safe'

  return { level, reasons, hardBlock }
}
