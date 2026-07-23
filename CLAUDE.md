テーブル設計：invoice_deduction_rates（控除率マスタ、日付範囲付き）、invoice_judgments（reason_code / comment カラム含む）
理由コード5種：EXC_TRANSIT / EXC_OCR_MISREAD / EXC_NO_NUMBER_HIGH / EXC_RATE_MISSING / EXC_UNVERIFIED_NUMBER
判定ロジックの疑似コード：上記の judgeInvoice 関数
既存の環境：line-keihi-bot（~/git/line-keihi-bot、Supabase zlibswsootxmzqbnxvzi）への追加実装であること
