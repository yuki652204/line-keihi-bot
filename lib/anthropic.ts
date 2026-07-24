import Anthropic from '@anthropic-ai/sdk'

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

export async function classifyCsvExpenses(csvContent: string): Promise<ClassifiedExpense[]> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `以下のCSVデータを経費として分類してください。
各行を解析し、以下のJSON配列形式で返してください（他のテキストは含めないこと）:
[
  {
    "date": "YYYY-MM-DD形式の日付",
    "amount": 数値,
    "vendor": "取引先名",
    "category": "勘定科目（交通費/食費/消耗品費/接待費/通信費/その他のいずれか）",
    "memo": "備考（任意）",
    "registration_number_raw": "インボイス登録番号（Tから始まる番号）のT以降の数字部分。CSVにその列がある場合のみ記載し、推測はしないこと。ない場合は空文字",
    "rate_breakdown_amount": 数値（税率ごとの合計金額の列がCSVにある場合のみ記載し、推測はしないこと。ない場合は0）
  }
]

CSVデータ:
${csvContent}`,
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []
    return JSON.parse(jsonMatch[0]) as ClassifiedExpense[]
  } catch {
    return []
  }
}
