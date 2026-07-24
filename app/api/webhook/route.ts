import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { verifyLineSignature, replyMessage, pushMessage, getLineImageContent, getLineFileContent, textMessage } from '@/lib/line'
import { extractExpenseFromImage, classifyCsvExpenses } from '@/lib/anthropic'
import { insertExpenseIfNotDuplicate, getMonthlyExpenses, getYearlyExpenses, getAllExpenses, deleteAllExpenses, judgeAndSaveInvoice, Expense } from '@/lib/supabase'

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

    const { inserted, data: insertedExpense } = await insertExpenseIfNotDuplicate({
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

    let resultText = `✅ 経費を登録しました！\n\n📅 日付: ${date}\n💴 金額: ¥${extracted.amount.toLocaleString()}\n🏢 取引先: ${vendor}\n📂 勘定科目: ${extracted.category}${extracted.memo ? `\n📝 備考: ${extracted.memo}` : ''}`

    try {
      const rawNumber = extracted.registration_number_raw || null
      const { judgment } = await judgeAndSaveInvoice(
        {
          id: insertedExpense!.id!,
          line_user_id: userId,
          date,
          amount: extracted.amount,
          category: extracted.category || 'その他',
        },
        {
          registration_number_raw: rawNumber,
          registration_number: rawNumber && rawNumber.length === 13 ? rawNumber : null,
          rate_breakdown_amount: extracted.rate_breakdown_amount || null,
        }
      )

      if (judgment.status === '要確認' && judgment.comment) {
        resultText += `\n\n⚠️ インボイス要確認: ${judgment.comment}`
      }
    } catch (judgeErr) {
      console.error('Error in invoice judgment:', judgeErr)
    }

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

    // [DEBUG] CSV合算調査用の一時的なデバッグ通知。確認後に削除すること。
    const debugItems = expenses
      .slice(0, 20)
      .map((e, i) => `${i + 1}. ¥${e.amount} ${e.vendor}`)
      .join('\n')
    await pushMessage(userId, [
      textMessage(`[DEBUG] classifyCsvExpenses結果: ${expenses.length}件\n${debugItems || '（0件）'}`),
      textMessage(`[DEBUG] getLineFileContent先頭200文字:\n${csvContent.slice(0, 200)}`),
    ])

    if (!expenses.length) {
      await pushMessage(userId, [textMessage('❌ CSVから経費情報を抽出できませんでした。')])
      return
    }

    let inserted = 0
    let skipped = 0
    let total = 0
    let needsReview = 0
    // [DEBUG] CSV合算調査用の一時的な行ごとステータス記録。確認後に削除すること。
    const rowStatuses: string[] = []

    for (let i = 0; i < expenses.length; i++) {
      const expense = expenses[i]
      const rowLabel = `${i + 1}. ¥${expense.amount} ${expense.vendor}`
      const date = expense.date || new Date().toISOString().split('T')[0]
      const category = expense.category || 'その他'

      let result
      try {
        result = await insertExpenseIfNotDuplicate({
          line_user_id: userId,
          date,
          amount: expense.amount,
          vendor: expense.vendor || '不明',
          category,
          memo: expense.memo,
        })
      } catch (insertErr) {
        console.error('Error in insertExpenseIfNotDuplicate (CSV):', insertErr)
        rowStatuses.push(`${rowLabel} → ❌ insertエラー: ${insertErr instanceof Error ? insertErr.message : String(insertErr)}`)
        continue
      }

      if (result.inserted) {
        inserted++
        total += expense.amount
        rowStatuses.push(`${rowLabel} → ✅ 登録成功`)

        try {
          const rawNumber = expense.registration_number_raw || null
          const { judgment } = await judgeAndSaveInvoice(
            {
              id: result.data!.id!,
              line_user_id: userId,
              date,
              amount: expense.amount,
              category,
            },
            {
              registration_number_raw: rawNumber,
              registration_number: rawNumber && rawNumber.length === 13 ? rawNumber : null,
              rate_breakdown_amount: expense.rate_breakdown_amount || null,
            }
          )
          if (judgment.status === '要確認') needsReview++
        } catch (judgeErr) {
          console.error('Error in invoice judgment (CSV):', judgeErr)
        }
      } else {
        skipped++
        rowStatuses.push(`${rowLabel} → ⚠️ 重複スキップ`)
      }
    }

    await pushMessage(userId, [textMessage(`[DEBUG] 行ごとの処理結果:\n${rowStatuses.join('\n')}`)])

    const skipNote = skipped > 0 ? `\n⚠️ 重複スキップ: ${skipped}件` : ''
    const reviewNote = needsReview > 0 ? `\n📋 インボイス要確認: ${needsReview}件\n　（CSVに登録番号列がない場合、該当なしとして要確認になります）` : ''
    await pushMessage(userId, [
      textMessage(`✅ ${inserted}件の経費を登録しました！\n💴 合計: ¥${total.toLocaleString()}${skipNote}${reviewNote}`),
    ])
  } catch (err) {
    console.error('Error in file background processing:', err)
    await pushMessage(userId, [textMessage('❌ CSV処理中にエラーが発生しました。もう一度お試しください。')])
  }
}

type Target =
  | { type: 'month'; year: number; month: number; label: string }
  | { type: 'year'; year: number; label: string }
  | { type: 'all'; label: string }

// 全角→半角・大文字→小文字・カタカナ→ひらがな
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
}

function parseTarget(n: string): Target | null {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  if (n.includes('全期間') || n.includes('ぜんきかん')) return { type: 'all', label: '全期間' }
  if (n.includes('今年') || n.includes('ことし')) return { type: 'year', year: currentYear, label: `${currentYear}年` }
  if (n.includes('今月') || n.includes('こんげつ')) return { type: 'month', year: currentYear, month: currentMonth, label: `${currentYear}年${currentMonth}月` }

  if (n.includes('先月') || n.includes('せんげつ')) {
    const d = new Date(currentYear, currentMonth - 2, 1)
    return { type: 'month', year: d.getFullYear(), month: d.getMonth() + 1, label: `${d.getFullYear()}年${d.getMonth() + 1}月` }
  }

  // 「2025年12月」— 年月指定（年のみより先にチェック）
  const yearMonthMatch = n.match(/(\d{4})年(\d{1,2})月/)
  if (yearMonthMatch) {
    const year = parseInt(yearMonthMatch[1])
    const month = parseInt(yearMonthMatch[2])
    if (month >= 1 && month <= 12) return { type: 'month', year, month, label: `${year}年${month}月` }
  }

  // 「2025年」— 年のみ
  const yearOnlyMatch = n.match(/(\d{4})年/)
  if (yearOnlyMatch) {
    const year = parseInt(yearOnlyMatch[1])
    return { type: 'year', year, label: `${year}年` }
  }

  // 「5月」「12月」など月のみ
  const monthMatch = n.match(/(\d{1,2})月/)
  if (monthMatch) {
    const month = parseInt(monthMatch[1])
    if (month >= 1 && month <= 12) {
      const year = month > currentMonth ? currentYear - 1 : currentYear
      return { type: 'month', year, month, label: `${year}年${month}月` }
    }
  }

  return null
}

function buildYearOrAllSummary(expenses: Expense[], label: string): string {
  const total = expenses.reduce((s, e) => s + e.amount, 0)

  const byMonth: Record<string, { total: number; count: number }> = {}
  for (const e of expenses) {
    const d = new Date(e.date)
    const key = `${d.getFullYear()}年${d.getMonth() + 1}月`
    if (!byMonth[key]) byMonth[key] = { total: 0, count: 0 }
    byMonth[key].total += e.amount
    byMonth[key].count++
  }
  const monthLines = Object.entries(byMonth)
    .map(([k, v]) => `${k}：¥${v.total.toLocaleString()}（${v.count}件）`)
    .join('\n')

  const byCategory: Record<string, number> = {}
  for (const e of expenses) {
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount
  }
  const categoryLines = Object.entries(byCategory)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, amt]) => `${cat}：¥${amt.toLocaleString()}`)
    .join('\n')

  const sep = '━━━━━━━━━━━━━'
  return [sep, `📊 ${label}の経費まとめ`, sep, `件数：${expenses.length}件`, `合計：¥${total.toLocaleString()}`, '', '【月別内訳】', monthLines || 'データなし', '', '【科目別合計】', categoryLines, sep].join('\n')
}


async function handleTextMessage(replyToken: string, userId: string, text: string) {
  const n = normalize(text)

  if (n.includes('削除を確認') || n.includes('さくじょをかくにん')) {
    const count = await deleteAllExpenses(userId)
    await replyMessage(replyToken, [
      textMessage(`🗑️ データを削除しました。\n${count}件の経費データを削除しました。\nまたいつでもご利用ください。`),
    ])
    return
  }

  if (n.includes('でーたを削除') || n.includes('全でーた削除') || n.includes('でーたをさくじょ') || n.includes('ぜんでーたさくじょ')) {
    await replyMessage(replyToken, [
      textMessage('⚠️ 本当に削除しますか？\n\n「削除を確認」と送ると完全に削除します。\nこの操作は取り消せません。'),
    ])
    return
  }

  if (n.includes('ぷらいばしーぽりしー')) {
    await replyMessage(replyToken, [
      textMessage('🔒 プライバシーポリシー\n\n【収集するデータ】\n・経費情報（日付・金額・取引先・科目）\n・LINEユーザーID\n\n【利用目的】\n経費管理機能の提供のみ\n\n【第三者提供】\n一切行いません\n\n【データ削除】\n「データを削除して」と送ると\nご自身のデータを完全削除できます\n\n【お問い合わせ】\n開発者：Ichihiro\n連絡先：ookami2204@gmail.com'),
    ])
    return
  }

  if (n.includes('使い方') || n.includes('つかいかた')) {
    await replyMessage(replyToken, [
      textMessage('📖 経費Bot 使い方\n\n【基本操作】\n📷 レシート写真を送る\n　→ 自動で経費登録\n\n📄 CSVファイルを送る\n　→ 一括登録・科目自動分類\n\n【集計コマンド】\n・今月の経費まとめて\n・先月の経費まとめて\n・2025年12月の経費まとめて\n・今年の経費まとめて\n・全期間の経費まとめて\n\n【CSV出力】\n・今月の経費をCSVで\n・先月の経費をCSVで\n・〇月の経費をCSVで\n\n【データ管理】\n・「プライバシーポリシー」\n　→ データ取り扱い方針を表示\n・「データを削除して」\n　→ 全経費データの削除を開始\n・「削除を確認」\n　→ 削除を実行（取り消し不可）'),
    ])
    return
  }

  const isCsvRequest = n.includes('csvで')
  const isSummaryRequest = !isCsvRequest && (
    n.includes('経費まとめて') || n.includes('経費まとめ') || n.includes('経費合計') ||
    n.includes('けいひまとめて') || n.includes('けいひまとめ')
  )

  if (!isCsvRequest && !isSummaryRequest) {
    await replyMessage(replyToken, [
      textMessage('以下の操作ができます：\n\n📸 領収書画像を送る → 自動で経費登録\n📄 CSVファイルを送る → 一括登録\n\n💬 集計:\n・「今月の経費まとめて」\n・「先月の経費まとめて」\n・「今年の経費まとめて」\n・「全期間の経費まとめて」\n\n📥 明細リスト:\n・「今月の経費をCSVで」\n・「先月の経費をCSVで」'),
    ])
    return
  }

  const target = parseTarget(n)
  if (!target) {
    const example = isCsvRequest
      ? '「今月の経費をCSVで」「先月の経費をCSVで」「6月の経費をCSVで」'
      : '「今月の経費まとめて」「今年の経費まとめて」「2025年12月の経費まとめて」'
    await replyMessage(replyToken, [textMessage(`期間を指定してください。例：${example}`)])
    return
  }

  // CSV は月単位のみ対応
  if (isCsvRequest) {
    if (target.type !== 'month') {
      await replyMessage(replyToken, [textMessage('CSVは月単位で指定してください。例：「今月の経費をCSVで」「6月の経費をCSVで」')])
      return
    }
    const expenses = await getMonthlyExpenses(userId, target.year, target.month)
    if (!expenses.length) {
      await replyMessage(replyToken, [textMessage(`${target.label}の経費データがありません。`)])
      return
    }
    const total = expenses.reduce((sum, e) => sum + e.amount, 0)
    const items = expenses.map((e) => {
      const date = e.date.replace(/-/g, '/')
      const lines = [`${date} ¥${e.amount.toLocaleString()}`, `　取引先：${e.vendor}`, `　科目：${e.category}`]
      if (e.memo) lines.push(`　備考：${e.memo}`)
      return lines.join('\n')
    })
    const listText = [`📄 ${target.label} 経費データ`, '', items.join('\n\n'), '', '---', `合計：¥${total.toLocaleString()}（${expenses.length}件）`].join('\n')
    await replyMessage(replyToken, [textMessage(listText)])
    return
  }

  // まとめて（月・年・全期間）
  if (target.type === 'month') {
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
        return `${d.getMonth() + 1}/${d.getDate()} ${e.vendor}\n　${e.category} ¥${e.amount.toLocaleString()}`
      })
      .join('\n\n')
    const categoryLines = Object.entries(byCategory)
      .map(([cat, amt]) => `${cat}：¥${amt.toLocaleString()}`)
      .join('\n')
    const summaryText = [sep, `📊 ${target.label}の経費まとめ`, sep, `件数：${expenses.length}件`, `合計：¥${total.toLocaleString()}`, '', '【明細】', detailLines, '', '【科目別合計】', categoryLines, sep].join('\n')
    await replyMessage(replyToken, [textMessage(summaryText)])
  } else {
    const expenses = target.type === 'all'
      ? await getAllExpenses(userId)
      : await getYearlyExpenses(userId, target.year)
    if (!expenses.length) {
      await replyMessage(replyToken, [textMessage(`${target.label}の経費データがありません。`)])
      return
    }
    await replyMessage(replyToken, [textMessage(buildYearOrAllSummary(expenses, target.label))])
  }
}
