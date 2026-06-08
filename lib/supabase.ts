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
