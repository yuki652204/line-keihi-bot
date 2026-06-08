import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { verifyLineSignature, replyMessage, pushMessage, getLineImageContent, getLineFileContent, textMessage } from '@/lib/line'
import { extractExpenseFromImage, classifyCsvExpenses } from '@/lib/anthropic'
import { insertExpenseIfNotDuplicate, getMonthlyExpenses } from '@/lib/supabase'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-line-signature') || ''
  const channelSecret = process.env.LINE_CHANNEL_SECRET!

  if (!verifyLineSignature(rawBody, signature, channelSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const body = JSON.parse(rawBody)
  const events = body.events || []

  for (const event of events) {
    if (event.type !== 'message') continue

    const replyToken = event.replyToken
    const userId = event.source.userId
    const message = event.message

    try {
      if (message.type === 'image') {
        await replyMessage(replyToken, [textMessage('🔍 画像を解析中です...')])
        waitUntil(processImageInBackground(userId, message.id))
      } else if (message.type === 'file') {
        if (!message.fileName?.toLowerCase().endsWith('.csv')) {
          await replyMessage(replyToken, [textMessage('CSVファイルのみ対応しています。')])
        } else {
          await replyMessage(replyToken, [textMessage('📊 CSVを解析中です...')])
          waitUntil(processFileInBackground(userId, message.id))
        }
      } else if (message.type === 'text') {
        await handleTextMessage(replyToken, userId, message.text)
      }
    } catch (err) {
      console.error('Error handling event:', err)
      await replyMessage(replyToken, [textMessage('処理中にエラーが発生しました。もう一度お試しください。')])
    }
  }

  return NextResponse.json({ ok: true })
}

async function processImageInBackground(userId: string, messageId: string) {
  try {
    const { base64, mimeType } = await getLineImageContent(messageId)
    const extracted = await extractExpenseFromImage(base64, mimeType)

    if (!extracted || !extracted.amount) {
      await pushMessage(userId, [textMessage('❌ 領収書の情報を読み取れませんでした。別の画像をお試しください。')])
      return
    }

    const date = extracted.date || new Date().toISOString().split('T')[0]
    const vendor = extracted.vendor || '不明'

    const { inserted } = await insertExpenseIfNotDuplicate({
      line_user_id: userId,
      date,
      amount: extracted.amount,
      vendor,
      category: extracted.category || 'その他',
      memo: extracted.memo,
    })

    if (!inserted) {
      await pushMessage(userId, [
        textMessage(`⚠️ すでに登録済みです。\n\n📅 ${date}\n💴 ¥${extracted.amount.toLocaleString()}\n🏢 ${vendor}`),
      ])
      return
    }

    const resultText = `✅ 経費を登録しました！\n\n📅 日付: ${date}\n💴 金額: ¥${extracted.amount.toLocaleString()}\n🏢 取引先: ${vendor}\n📂 勘定科目: ${extracted.category}${extracted.memo ? `\n📝 備考: ${extracted.memo}` : ''}`
    await pushMessage(userId, [textMessage(resultText)])
  } catch (err) {
    console.error('Error in image background processing:', err)
    await pushMessage(userId, [textMessage('❌ 解析中にエラーが発生しました。もう一度お試しください。')])
  }
}

async function processFileInBackground(userId: string, messageId: string) {
  try {
    const csvContent = await getLineFileContent(messageId)
    const expenses = await classifyCsvExpenses(csvContent)

    if (!expenses.length) {
      await pushMessage(userId, [textMessage('❌ CSVから経費情報を抽出できませんでした。')])
      return
    }

    let inserted = 0
    let skipped = 0
    let total = 0

    for (const expense of expenses) {
      const result = await insertExpenseIfNotDuplicate({
        line_user_id: userId,
        date: expense.date || new Date().toISOString().split('T')[0],
        amount: expense.amount,
        vendor: expense.vendor || '不明',
        category: expense.category || 'その他',
        memo: expense.memo,
      })
      if (result.inserted) {
        inserted++
        total += expense.amount
      } else {
        skipped++
      }
    }

    const skipNote = skipped > 0 ? `\n⚠️ 重複スキップ: ${skipped}件` : ''
    await pushMessage(userId, [
      textMessage(`✅ ${inserted}件の経費を登録しました！\n💴 合計: ¥${total.toLocaleString()}${skipNote}`),
    ])
  } catch (err) {
    console.error('Error in file background processing:', err)
    await pushMessage(userId, [textMessage('❌ CSV処理中にエラーが発生しました。もう一度お試しください。')])
  }
}

// テキストから集計対象の年月を解析する
function parseTargetMonth(text: string): { year: number; month: number; label: string } | null {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  if (text.includes('今月')) {
    return { year: currentYear, month: currentMonth, label: `${currentYear}年${currentMonth}月` }
  }

  if (text.includes('先月')) {
    const d = new Date(currentYear, currentMonth - 2, 1)
    return { year: d.getFullYear(), month: d.getMonth() + 1, label: `${d.getFullYear()}年${d.getMonth() + 1}月` }
  }

  // 「5月」「12月」など月指定
  const monthMatch = text.match(/(\d{1,2})月/)
  if (monthMatch) {
    const month = parseInt(monthMatch[1])
    if (month >= 1 && month <= 12) {
      // 指定月が現在月より大きければ前年と判断
      const year = month > currentMonth ? currentYear - 1 : currentYear
      return { year, month, label: `${year}年${month}月` }
    }
  }

  return null
}

async function handleTextMessage(replyToken: string, userId: string, text: string) {
  const isSummaryRequest = text.includes('経費まとめて') || text.includes('経費まとめ')

  if (!isSummaryRequest) {
    await replyMessage(replyToken, [
      textMessage(
        '以下の操作ができます：\n\n📸 領収書画像を送る → 自動で経費登録\n📄 CSVファイルを送る → 一括登録\n\n💬 集計コマンド:\n・「今月の経費まとめて」\n・「先月の経費まとめて」\n・「5月の経費まとめて」'
      ),
    ])
    return
  }

  const target = parseTargetMonth(text)
  if (!target) {
    await replyMessage(replyToken, [textMessage('月を指定してください。例：「今月の経費まとめて」「先月の経費まとめて」「5月の経費まとめて」')])
    return
  }

  const expenses = await getMonthlyExpenses(userId, target.year, target.month)

  if (!expenses.length) {
    await replyMessage(replyToken, [textMessage(`${target.label}の経費データがありません。`)])
    return
  }

  const total = expenses.reduce((sum, e) => sum + e.amount, 0)
  const byCategory: Record<string, number> = {}
  for (const e of expenses) {
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount
  }

  const sep = '━━━━━━━━━━━━━'

  const detailLines = expenses
    .map((e) => {
      const d = new Date(e.date)
      const mmdd = `${d.getMonth() + 1}/${d.getDate()}`
      return `${mmdd} ${e.vendor}\n　${e.category} ¥${e.amount.toLocaleString()}`
    })
    .join('\n\n')

  const categoryLines = Object.entries(byCategory)
    .map(([cat, amt]) => `${cat}：¥${amt.toLocaleString()}`)
    .join('\n')

  const summaryText = [
    sep,
    `📊 ${target.label}の経費まとめ`,
    sep,
    `件数：${expenses.length}件`,
    `合計：¥${total.toLocaleString()}`,
    '',
    '【明細】',
    detailLines,
    '',
    '【科目別合計】',
    categoryLines,
    sep,
  ].join('\n')

  await replyMessage(replyToken, [textMessage(summaryText)])
}
