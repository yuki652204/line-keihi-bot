import { describe, test, expect } from 'vitest'
import { judgeInvoice } from '../supabase'

describe('judgeInvoice', () => {
  // ── 1. 登録番号あり + 税率別金額あり → 自動判定確定 ──
  test('登録番号あり・税率別金額あり → 自動判定確定', () => {
    const result = judgeInvoice({
      amount: 5000,
      category: 'その他',
      registration_number_raw: '1234567890123',
      registration_number: '1234567890123',
      rate_breakdown_amount: 5000,
    })
    expect(result.status).toBe('自動判定確定')
    expect(result.reason_code).toBeNull()
  })

  // ── 2. 登録番号あり + 税率別金額なし → EXC_RATE_MISSING ──
  test('登録番号あり・税率別金額なし → EXC_RATE_MISSING（要確認）', () => {
    const result = judgeInvoice({
      amount: 5000,
      category: 'その他',
      registration_number_raw: '1234567890123',
      registration_number: '1234567890123',
      rate_breakdown_amount: null,
    })
    expect(result.status).toBe('要確認')
    expect(result.reason_code).toBe('EXC_RATE_MISSING')
  })

  // ── 3. 登録番号なし + 交通費 + 3万円未満 → EXC_TRANSIT ──
  test('登録番号なし・交通費・29,999円 → EXC_TRANSIT（適格扱い）', () => {
    const result = judgeInvoice({
      amount: 29999,
      category: '交通費',
      registration_number_raw: null,
      registration_number: null,
      rate_breakdown_amount: null,
    })
    expect(result.status).toBe('適格扱い')
    expect(result.reason_code).toBe('EXC_TRANSIT')
  })

  // ── 4. 境界値：3万円ちょうど（3万円未満ではないので特例の対象外になるはず） ──
  test('登録番号なし・交通費・30,000円ちょうど → 特例の境界値', () => {
    const result = judgeInvoice({
      amount: 30000,
      category: '交通費',
      registration_number_raw: null,
      registration_number: null,
      rate_breakdown_amount: null,
    })
    // 30,000円は「3万円未満」に含まれないため、EXC_TRANSITにはならないはず。
    // amount >= 10000なのでEXC_NO_NUMBER_HIGHになることを期待。
    expect(result.reason_code).toBe('EXC_NO_NUMBER_HIGH')
  })

  // ── 5. 境界値：3万円を1円だけ超えた場合 ──
  test('登録番号なし・交通費・30,001円 → EXC_NO_NUMBER_HIGH', () => {
    const result = judgeInvoice({
      amount: 30001,
      category: '交通費',
      registration_number_raw: null,
      registration_number: null,
      rate_breakdown_amount: null,
    })
    expect(result.reason_code).toBe('EXC_NO_NUMBER_HIGH')
  })

  // ── 6. 登録番号なし + 交通費以外 + 1万円未満 → 自動判定確定？(EXC_NO_NUMBER_HIGHの閾値未満) ──
  test('登録番号なし・その他・9,999円 → 閾値未満のためEXC_NO_NUMBER_HIGHにならない', () => {
    const result = judgeInvoice({
      amount: 9999,
      category: 'その他',
      registration_number_raw: null,
      registration_number: null,
      rate_breakdown_amount: null,
    })
    expect(result.reason_code).not.toBe('EXC_NO_NUMBER_HIGH')
  })

  // ── 7. 境界値：1万円ちょうど ──
  test('登録番号なし・その他・10,000円ちょうど → EXC_NO_NUMBER_HIGH', () => {
    const result = judgeInvoice({
      amount: 10000,
      category: 'その他',
      registration_number_raw: null,
      registration_number: null,
      rate_breakdown_amount: null,
    })
    expect(result.status).toBe('要確認')
    expect(result.reason_code).toBe('EXC_NO_NUMBER_HIGH')
  })

  // ── 8. 登録番号の桁数不一致（12桁） ──
  test('登録番号12桁（不足） → EXC_OCR_MISREAD', () => {
    const result = judgeInvoice({
      amount: 5000,
      category: 'その他',
      registration_number_raw: '123456789012', // 13文字未満
      registration_number: null,
      rate_breakdown_amount: 5000,
    })
    expect(result.status).toBe('要確認')
    expect(result.reason_code).toBe('EXC_OCR_MISREAD')
  })

  // ── 9. 登録番号の桁数不一致（14桁） ──
  test('登録番号14桁（過剰） → EXC_OCR_MISREAD', () => {
    const result = judgeInvoice({
      amount: 5000,
      category: 'その他',
      registration_number_raw: '12345678901234', // 13文字超
      registration_number: null,
      rate_breakdown_amount: 5000,
    })
    expect(result.status).toBe('要確認')
    expect(result.reason_code).toBe('EXC_OCR_MISREAD')
  })

  // ── 10. 登録番号なし・交通費・9,999円（EXC_TRANSITの範囲内かつ閾値未満の重複ケース）──
  test('登録番号なし・交通費・9,999円 → EXC_TRANSIT優先', () => {
    const result = judgeInvoice({
      amount: 9999,
      category: '交通費',
      registration_number_raw: null,
      registration_number: null,
      rate_breakdown_amount: null,
    })
    expect(result.reason_code).toBe('EXC_TRANSIT')
  })
})
