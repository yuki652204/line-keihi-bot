import Anthropic from '@anthropic-ai/sdk'
import { parse } from 'csv-parse/sync'

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export interface ExtractedExpense {
  date: string
  amount: number
  vendor: string
  category: string
  memo?: string
  registration_number_raw?: string
  rate_breakdown_amount?: number
}

export async function extractExpenseFromImage(imageBase64: string, mimeType: string): Promise<ExtractedExpense | null> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: `この領収書・レシートから経費情報を抽出してください。
以下のJSON形式で返してください（他のテキストは含めないこと）:
{
  "date": "YYYY-MM-DD形式の日付",
  "amount": 数値（税込合計金額）,
  "vendor": "取引先・店舗名",
  "category": "勘定科目（交通費/食費/消耗品費/接待費/通信費/その他のいずれか）",
  "memo": "備考（任意）",
  "registration_number_raw": "インボイス登録番号（Tから始まる番号）のT以降の数字部分。見つかった通りにそのまま記載し、桁数の補正はしないこと。見つからない場合は空文字",
  "rate_breakdown_amount": 数値（レシートに記載された税率ごとの合計金額のうち、いずれか1つの金額。記載がなければ0）
}
情報が読み取れない場合はそのフィールドを空文字か0にしてください。`,
          },
        ],
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    return JSON.parse(jsonMatch[0]) as ExtractedExpense
  } catch {
    return null
  }
}

export interface ClassifiedExpense {
  date: string
  amount: number
  vendor: string
  category: string
  memo?: string
  registration_number_raw?: string
  rate_breakdown_amount?: number
}

// CSVの行分割はcsv-parseによる決定的な処理とし、AIには1行ごとの分類のみを行わせる。
// これにより「複数行が1件に合算される」ような非決定的な挙動を構造的に防ぐ。
export async function classifyCsvExpenses(csvContent: string): Promise<ClassifiedExpense[]> {
  let records: Record<string, string>[]
  try {
    records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    })
  } catch (err) {
    throw new Error(`CSVの解析に失敗しました: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!records.length) return []

  const results = await Promise.all(records.map((record) => classifyCsvRow(record)))

  const failedRows = results
    .map((r, i) => (r === null ? i + 1 : null))
    .filter((i): i is number => i !== null)

  if (failedRows.length > 0) {
    throw new Error(
      `CSVの一部の行を分類できませんでした（${failedRows.length}/${records.length}件、行番号: ${failedRows.join(', ')}）`
    )
  }

  if (results.length !== records.length) {
    // Promise.allの結果は入力順・件数と1:1のはずだが、念のため防御的に検証する
    throw new Error(`CSV行数（${records.length}）と分類結果件数（${results.length}）が一致しません`)
  }

  return results as ClassifiedExpense[]
}

async function classifyCsvRow(record: Record<string, string>): Promise<ClassifiedExpense | null> {
  const rowText = Object.entries(record)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: `以下は経費CSVの1行分のデータです。この1行のみを経費として分類し、
以下のJSONオブジェクト形式で返してください（配列にせず、必ずオブジェクト1つのみ。他のテキストは含めないこと）:
{
  "date": "YYYY-MM-DD形式の日付",
  "amount": 数値,
  "vendor": "取引先名",
  "category": "勘定科目（交通費/食費/消耗品費/接待費/通信費/その他のいずれか）",
  "memo": "備考（任意）",
  "registration_number_raw": "インボイス登録番号（Tから始まる番号）のT以降の数字部分。この行にその列がある場合のみ記載し、推測はしないこと。ない場合は空文字",
  "rate_breakdown_amount": 数値（税率ごとの合計金額の列がこの行にある場合のみ記載し、推測はしないこと。ない場合は0）
}

CSVの1行（列名: 値）:
${rowText}`,
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    return JSON.parse(jsonMatch[0]) as ClassifiedExpense
  } catch {
    return null
  }
}
