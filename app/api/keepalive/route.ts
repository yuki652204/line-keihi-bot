import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'

export const runtime = 'edge'

async function notifyAdmin(message: string) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: process.env.LINE_ADMIN_USER_ID,
        messages: [{ type: 'text', text: message }],
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)
  } catch (e) {
    console.error('Failed to notify admin via LINE:', e)
  }
}

export async function GET(req: NextRequest) {
  const isVercelCron = req.headers.get('user-agent')?.includes('vercel-cron')
  const auth = req.headers.get('authorization') ?? ''

  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    if (isVercelCron) {
      waitUntil(
        notifyAdmin(
          '⚠️ keepalive失敗: CRON_SECRETの認証に失敗しました。Vercelの環境変数を確認してください。'
        )
      )
    }
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { error } = await supabase.from('keihi_expenses').select('id').limit(1)

    if (error) {
      waitUntil(notifyAdmin(`⚠️ keepalive失敗: Supabaseクエリエラー\n${error.message}`))
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, ts: new Date().toISOString() })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error'
    waitUntil(notifyAdmin(`⚠️ keepalive失敗: 予期しないエラー\n${msg}`))
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
