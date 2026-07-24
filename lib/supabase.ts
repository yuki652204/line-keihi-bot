import { createClient } from '@supabase/supabase-js'
import jwt from 'jsonwebtoken'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const jwtSecret = process.env.SUPABASE_JWT_SECRET!

function createUserSupabaseClient(lineUserId: string) {
  const token = jwt.sign(
    {
      role: 'authenticated',
      iss: 'supabase',
      sub: lineUserId,
      line_user_id: lineUserId,
    },
    jwtSecret,
    { expiresIn: '1h' }
  )

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

export interface Expense {
  id?: string
  line_user_id: string
  date: string
  amount: number
  vendor: string
  category: string
  memo?: string
  created_at?: string
}

// 重複チェック付きinsert。重複の場合は false を返す
export async function insertExpenseIfNotDuplicate(
  expense: Omit<Expense, 'id' | 'created_at'>
): Promise<{ inserted: boolean; data?: Expense }> {
  const client = createUserSupabaseClient(expense.line_user_id)

  const { data: existing } = await client
    .from('keihi_expenses')
    .select('id')
    .eq('line_user_id', expense.line_user_id)
    .eq('date', expense.date)
    .eq('amount', expense.amount)
    .eq('vendor', expense.vendor)
    .maybeSingle()

  if (existing) return { inserted: false }

  const { data, error } = await client.from('keihi_expenses').insert(expense).select().single()
  if (error) throw error
  return { inserted: true, data: data as Expense }
}

export async function getYearlyExpenses(lineUserId: string, year: number) {
  const client = createUserSupabaseClient(lineUserId)

  const { data, error } = await client
    .from('keihi_expenses')
    .select('*')
    .eq('line_user_id', lineUserId)
    .gte('date', `${year}-01-01`)
    .lte('date', `${year}-12-31`)
    .order('date', { ascending: true })

  if (error) throw error
  return data as Expense[]
}

export async function deleteAllExpenses(lineUserId: string): Promise<number> {
  const client = createUserSupabaseClient(lineUserId)

  const { data, error } = await client
    .from('keihi_expenses')
    .delete()
    .eq('line_user_id', lineUserId)
    .select('id')

  if (error) throw error
  return data?.length ?? 0
}

export async function getAllExpenses(lineUserId: string) {
  const client = createUserSupabaseClient(lineUserId)

  const { data, error } = await client
    .from('keihi_expenses')
    .select('*')
    .eq('line_user_id', lineUserId)
    .order('date', { ascending: true })

  if (error) throw error
  return data as Expense[]
}

export type InvoiceJudgmentStatus = '適格扱い' | '要確認' | '自動判定確定'

export type InvoiceReasonCode =
  | 'EXC_TRANSIT'
  | 'EXC_OCR_MISREAD'
  | 'EXC_NO_NUMBER_HIGH'
  | 'EXC_RATE_MISSING'
  | 'EXC_UNVERIFIED_NUMBER'
  | 'EXC_SHOGAKU_TOKUREI'
  | 'EXC_NO_NUMBER_LOW'

export interface InvoiceOcrResult {
  registration_number_raw?: string | null
  registration_number?: string | null
  rate_breakdown_amount?: number | null
}

export interface InvoiceJudgment {
  id?: string
  expense_id: string
  line_user_id: string
  status: InvoiceJudgmentStatus
  reason_code: InvoiceReasonCode | null
  comment: string | null
  registration_number_raw?: string | null
  registration_number?: string | null
  rate_breakdown_amount?: number | null
  judged_at?: string
  created_at?: string
  shogaku_tokurei_applied?: boolean
  shogaku_tokurei_period_valid?: boolean
}

const SHOGAKU_TOKUREI_START_DATE = '2023-10-01'
const SHOGAKU_TOKUREI_END_DATE = '2029-09-30'

interface JudgeInvoiceInput extends InvoiceOcrResult {
  amount: number
  category: string
  // 少額特例（基準期間の課税売上高1億円以下等）の対象事業者かどうか。business_settingsより取得
  shogakuTokureiEligible: boolean
  // 判定基準日（YYYY-MM-DD）。少額特例の適用期間判定に使用
  currentDate: string
}

interface JudgeInvoiceOutput {
  status: InvoiceJudgmentStatus
  reason_code: InvoiceReasonCode | null
  comment: string | null
  shogaku_tokurei_applied: boolean
  shogaku_tokurei_period_valid: boolean
}

// CLAUDE.md記載のjudgeInvoice疑似コードの実装。
// EXC_UNVERIFIED_NUMBER（国税庁公表サイトとの照合）は外部API連携が必要なため、
// このジャッジロジックではスコープ外として保留し、この関数からは発生しない。
export function judgeInvoice(receipt: JudgeInvoiceInput): JudgeInvoiceOutput {
  const periodValid =
    receipt.currentDate >= SHOGAKU_TOKUREI_START_DATE && receipt.currentDate <= SHOGAKU_TOKUREI_END_DATE

  // 登録番号・税率別合計金額が揃っていれば、交通費特例を待たず通常の自動判定
  if (receipt.registration_number && receipt.rate_breakdown_amount) {
    return {
      status: '自動判定確定',
      reason_code: null,
      comment: null,
      shogaku_tokurei_applied: false,
      shogaku_tokurei_period_valid: periodValid,
    }
  }

  if (receipt.registration_number_raw && receipt.registration_number_raw.length !== 13) {
    return {
      status: '要確認',
      reason_code: 'EXC_OCR_MISREAD',
      comment: '登録番号が13桁と一致しません。画像不鮮明の可能性があるため再確認してください',
      shogaku_tokurei_applied: false,
      shogaku_tokurei_period_valid: periodValid,
    }
  }

  // 交通費特例は「登録番号がない場合の救済」なので、登録番号がある場合は適用しない
  if (!receipt.registration_number && receipt.amount < 30000 && receipt.category === '交通費') {
    return {
      status: '適格扱い',
      reason_code: 'EXC_TRANSIT',
      comment: '3万円未満の交通費のため、公共交通機関特例により登録番号なしでも適格請求書とみなされます',
      shogaku_tokurei_applied: false,
      shogaku_tokurei_period_valid: periodValid,
    }
  }

  if (!receipt.registration_number && receipt.amount >= 10000) {
    return {
      status: '要確認',
      reason_code: 'EXC_NO_NUMBER_HIGH',
      comment: '登録番号が見つかりません。免税事業者からの仕入れか、単純な記載漏れかご確認ください',
      shogaku_tokurei_applied: false,
      shogaku_tokurei_period_valid: periodValid,
    }
  }

  // 登録番号なし・交通費特例非該当・1万円未満 → 少額特例の対象かどうかで判定
  if (!receipt.registration_number && receipt.amount < 10000) {
    if (receipt.shogakuTokureiEligible && periodValid) {
      return {
        status: '適格扱い',
        reason_code: 'EXC_SHOGAKU_TOKUREI',
        comment: '少額特例（基準期間の課税売上高1億円以下等）により、1万円未満の課税仕入れはインボイス保存なしで全額控除可能です',
        shogaku_tokurei_applied: true,
        shogaku_tokurei_period_valid: periodValid,
      }
    }
    return {
      status: '要確認',
      reason_code: 'EXC_NO_NUMBER_LOW',
      comment: '登録番号がなく1万円未満の取引です。少額特例の対象事業者でない、または適用期間（2023-10-01〜2029-09-30）外のため確認が必要です',
      shogaku_tokurei_applied: false,
      shogaku_tokurei_period_valid: periodValid,
    }
  }

  if (receipt.registration_number && !receipt.rate_breakdown_amount) {
    return {
      status: '要確認',
      reason_code: 'EXC_RATE_MISSING',
      comment: '税率ごとの合計金額が確認できません。簡易インボイスの要件を満たしているかご確認ください',
      shogaku_tokurei_applied: false,
      shogaku_tokurei_period_valid: periodValid,
    }
  }

  return {
    status: '自動判定確定',
    reason_code: null,
    comment: null,
    shogaku_tokurei_applied: false,
    shogaku_tokurei_period_valid: periodValid,
  }
}

// expense.dateが属する経過措置期間の控除率をinvoice_deduction_ratesから取得
export async function getApplicableDeductionRate(
  lineUserId: string,
  date: string
): Promise<number | null> {
  const client = createUserSupabaseClient(lineUserId)

  const { data, error } = await client
    .from('invoice_deduction_rates')
    .select('deduction_rate')
    .lte('start_date', date)
    .gte('end_date', date)
    .maybeSingle()

  if (error) throw error
  return data ? Number(data.deduction_rate) : null
}

// business_settingsからline_user_idの少額特例対象事業者フラグを取得。行が無ければfalse（未設定＝対象外扱い）
export async function getShogakuTokureiEligible(lineUserId: string): Promise<boolean> {
  const client = createUserSupabaseClient(lineUserId)

  const { data, error } = await client
    .from('business_settings')
    .select('shogaku_tokurei_eligible')
    .eq('line_user_id', lineUserId)
    .maybeSingle()

  if (error) throw error
  return data?.shogaku_tokurei_eligible ?? false
}

// OCR結果からjudgeInvoiceで判定し、invoice_judgmentsに保存する
export async function judgeAndSaveInvoice(
  expense: Pick<Expense, 'id' | 'line_user_id' | 'date' | 'amount' | 'category'>,
  ocr: InvoiceOcrResult
): Promise<{ judgment: InvoiceJudgment; deductionRate: number | null }> {
  if (!expense.id) throw new Error('expense.id is required')

  const client = createUserSupabaseClient(expense.line_user_id)

  const shogakuTokureiEligible = await getShogakuTokureiEligible(expense.line_user_id)
  const currentDate = new Date().toISOString().split('T')[0]

  const result = judgeInvoice({
    amount: expense.amount,
    category: expense.category,
    registration_number_raw: ocr.registration_number_raw,
    registration_number: ocr.registration_number,
    rate_breakdown_amount: ocr.rate_breakdown_amount,
    shogakuTokureiEligible,
    currentDate,
  })

  const deductionRate = await getApplicableDeductionRate(expense.line_user_id, expense.date)

  const { data, error } = await client
    .from('invoice_judgments')
    .insert({
      expense_id: expense.id,
      line_user_id: expense.line_user_id,
      status: result.status,
      reason_code: result.reason_code,
      comment: result.comment,
      registration_number_raw: ocr.registration_number_raw ?? null,
      registration_number: ocr.registration_number ?? null,
      rate_breakdown_amount: ocr.rate_breakdown_amount ?? null,
      shogaku_tokurei_applied: result.shogaku_tokurei_applied,
      shogaku_tokurei_period_valid: result.shogaku_tokurei_period_valid,
    })
    .select()
    .single()

  if (error) throw error
  return { judgment: data as InvoiceJudgment, deductionRate }
}

export async function getMonthlyExpenses(lineUserId: string, year: number, month: number) {
  const client = createUserSupabaseClient(lineUserId)

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  const { data, error } = await client
    .from('keihi_expenses')
    .select('*')
    .eq('line_user_id', lineUserId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true })

  if (error) throw error
  return data as Expense[]
}
