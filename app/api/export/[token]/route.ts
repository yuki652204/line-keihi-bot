import { NextRequest, NextResponse } from 'next/server'
import { stringify } from 'csv-stringify/sync'
import { validateExportToken, getExportData } from '@/lib/supabase'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const tokenInfo = await validateExportToken(token)
  if (!tokenInfo) {
    return NextResponse.json({ error: 'トークンが無効か期限切れです' }, { status: 404 })
  }

  const rows = await getExportData(tokenInfo.line_user_id, tokenInfo.year, tokenInfo.month)

  const csvRows = rows.map((r) => ({
    日付: r.date,
    金額: r.amount,
    取引先: r.vendor,
    勘定科目: r.category,
    備考: r.memo ?? '',
    インボイス判定: r.invoice_status ?? '',
    理由コード: r.invoice_reason_code ?? '',
    コメント: r.invoice_comment ?? '',
    少額特例適用: r.shogaku_tokurei_applied ? '有' : '無',
    控除率: r.deduction_rate !== null ? `${Math.round(r.deduction_rate * 100)}%` : '',
  }))

  const csv = stringify(csvRows, { header: true, bom: true })
  const filename = `keihi_${tokenInfo.year}-${String(tokenInfo.month).padStart(2, '0')}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
