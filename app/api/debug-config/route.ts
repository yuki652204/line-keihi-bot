import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

// [DEBUG] 本番環境の実行時設定を調査するための一時的なエンドポイント。確認後に削除すること。
function hash(value: string | undefined): string | null {
  if (!value) return null
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12)
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-debug-secret')
  if (!secret || secret !== process.env.DEBUG_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    supabaseUrlHash: hash(process.env.NEXT_PUBLIC_SUPABASE_URL),
    lineTokenHash: hash(process.env.LINE_CHANNEL_ACCESS_TOKEN),
    lineSecretHash: hash(process.env.LINE_CHANNEL_SECRET),
    anthropicKeyHash: hash(process.env.ANTHROPIC_API_KEY),
  })
}
