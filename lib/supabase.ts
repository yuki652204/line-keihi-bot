import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export const supabase = createClient(supabaseUrl, supabaseServiceKey)

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
  const { data: existing } = await supabase
    .from('keihi_expenses')
    .select('id')
    .eq('line_user_id', expense.line_user_id)
    .eq('date', expense.date)
    .eq('amount', expense.amount)
    .eq('vendor', expense.vendor)
    .maybeSingle()

  if (existing) return { inserted: false }

  const { data, error } = await supabase.from('keihi_expenses').insert(expense).select().single()
  if (error) throw error
  return { inserted: true, data: data as Expense }
}

export async function getMonthlyExpenses(lineUserId: string, year: number, month: number) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  const { data, error } = await supabase
    .from('keihi_expenses')
    .select('*')
    .eq('line_user_id', lineUserId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true })

  if (error) throw error
  return data as Expense[]
}
