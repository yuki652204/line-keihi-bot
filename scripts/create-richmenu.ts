import * as path from 'path'
import * as dotenv from 'dotenv'
import sharp from 'sharp'

dotenv.config({ path: path.join(__dirname, '..', '.env.local') })

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN
if (!TOKEN) throw new Error('LINE_CHANNEL_ACCESS_TOKEN が .env.local に見つかりません')

const W = 2500
const H = 1686
const COLS = 2
const ROWS = 3
const CW = W / COLS  // 1250
const CH = H / ROWS  // 562

const buttons = [
  { label: '今月の経費まとめて', icon: '📊', color: '#1E7A7A', action: '今月の経費まとめて' },
  { label: '先月の経費まとめて', icon: '📅', color: '#15696A', action: '先月の経費まとめて' },
  { label: '今月の経費をCSVで', icon: '📄', color: '#C97A0A', action: '今月の経費をCSVで' },
  { label: '先月の経費をCSVで', icon: '📋', color: '#B06A08', action: '先月の経費をCSVで' },
  { label: '使い方',            icon: '📖', color: '#4A5568', action: '使い方'            },
  { label: '今年の経費まとめて', icon: '💹', color: '#5B21B6', action: '今年の経費まとめて' },
]

function buildSvg(): string {
  const cells = buttons.map((btn, i) => {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    const x = col * CW
    const y = row * CH
    const cx = x + CW / 2
    const cy = y + CH / 2
    return `
      <rect x="${x}" y="${y}" width="${CW}" height="${CH}" fill="${btn.color}"/>
      <text x="${cx}" y="${cy - 80}"
        font-family="Hiragino Sans, Hiragino Kaku Gothic ProN, Yu Gothic UI, Meiryo, sans-serif"
        font-size="150" text-anchor="middle" dominant-baseline="middle" fill="white">${btn.icon}</text>
      <text x="${cx}" y="${cy + 110}"
        font-family="Hiragino Sans, Hiragino Kaku Gothic ProN, Yu Gothic UI, Meiryo, sans-serif"
        font-size="88" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="white">${btn.label}</text>`
  }).join('')

  const dividers = [
    `<line x1="${CW}"   y1="0" x2="${CW}"   y2="${H}" stroke="white" stroke-width="6" stroke-opacity="0.35"/>`,
    `<line x1="0" y1="${CH}"   x2="${W}" y2="${CH}"   stroke="white" stroke-width="6" stroke-opacity="0.35"/>`,
    `<line x1="0" y1="${CH*2}" x2="${W}" y2="${CH*2}" stroke="white" stroke-width="6" stroke-opacity="0.35"/>`,
  ].join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${cells}${dividers}</svg>`
}

async function lineApi(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) throw new Error(`LINE API ${res.status}: ${JSON.stringify(data)}`)
  return data
}

async function main() {
  // 1. PNG生成
  console.log('1. SVGからPNG画像を生成中...')
  const svg = buildSvg()
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  console.log(`   完了: ${(png.length / 1024).toFixed(1)} KB`)

  // 2. リッチメニュー作成
  console.log('2. リッチメニューを作成中...')
  const { richMenuId } = await lineApi('https://api.line.me/v2/bot/richmenu', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      size: { width: W, height: H },
      selected: true,
      name: '経費管理メニュー',
      chatBarText: '経費メニュー',
      areas: buttons.map((btn, i) => ({
        bounds: { x: (i % COLS) * CW, y: Math.floor(i / COLS) * CH, width: CW, height: CH },
        action: { type: 'message', text: btn.action },
      })),
    }),
  }) as { richMenuId: string }
  console.log(`   作成完了: ${richMenuId}`)

  // 3. 画像アップロード
  console.log('3. 画像をアップロード中...')
  await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'image/png' },
    body: png as unknown as BodyInit,
  })
  console.log('   完了')

  // 4. デフォルトメニューに設定
  console.log('4. デフォルトメニューに設定中...')
  await lineApi(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, { method: 'POST' })
  console.log('   完了')

  console.log(`\n✅ リッチメニューの設定が完了しました`)
  console.log(`   Rich Menu ID: ${richMenuId}`)
}

main().catch((err) => { console.error('❌', err.message); process.exit(1) })
