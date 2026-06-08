# LINE 経費管理Bot

> AI搭載の経費管理LINEボット。領収書を写真で送るだけで自動登録。

**English summary below** ↓

---

## 概要

LINE上でレシート画像を送ると、Claude AIが経費情報（日付・金額・取引先・勘定科目）を自動抽出してSupabaseに保存します。月次集計・年次集計のテキスト返信や明細リスト出力にも対応し、会計ソフトへの転記作業を大幅に削減します。

## Overview (English)

A LINE chatbot that automates expense tracking using AI. Send a receipt photo and Claude AI automatically extracts the date, amount, vendor, and account category, saving it to Supabase. Supports monthly/yearly summaries and formatted expense lists.

---

## 機能一覧

| 操作 | 方法 | 説明 |
|------|------|------|
| 経費登録 | レシート画像を送信 | Claude Vision で自動抽出・重複防止 |
| 一括登録 | CSVファイルを送信 | Claude APIで各行を勘定科目分類 |
| 月次集計 | 「今月の経費まとめて」 | 明細＋科目別合計をテキスト返信 |
| 先月集計 | 「先月の経費まとめて」 | 前月データを集計 |
| 月指定集計 | 「5月の経費まとめて」 | 任意の月を指定 |
| 明細リスト | 「今月の経費をCSVで」 | リスト形式で返信（Excelへ貼り付け可） |
| 年次集計 | 「今年の経費合計」 | 月別内訳＋年間合計 |
| 使い方 | 「使い方」 | 操作ガイドを返信 |

### リッチメニュー（6ボタン）

```
┌──────────────────┬──────────────────┐
│ 📊 今月の経費      │ 📅 先月の経費      │
│    まとめて        │    まとめて        │
├──────────────────┼──────────────────┤
│ 📄 今月の経費      │ 📋 先月の経費      │
│    をCSVで         │    をCSVで         │
├──────────────────┼──────────────────┤
│ 📖 使い方          │ 💹 今年の          │
│                   │    経費合計         │
└──────────────────┴──────────────────┘
```

---

## 技術スタック

| カテゴリ | 技術 |
|---------|------|
| Framework | Next.js 16 (App Router, TypeScript) |
| Hosting | Vercel (Serverless Functions) |
| Database | Supabase (PostgreSQL) |
| AI | Anthropic Claude API (claude-sonnet-4-6) |
| Messaging | LINE Messaging API |
| 画像生成 | Sharp (SVG→PNG) |

---

## Architecture

### インフラ構成

```
LINEユーザー
    ↓ Webhook（HMAC-SHA256署名検証）
Vercel / Next.js（line-keihi-bot.vercel.app）
├── ① LINE署名検証
├── ② メッセージ種別判定（画像/CSV/テキスト）
├── ③ ユーザーごとJWT生成
└── ④ waitUntil()で非同期処理
    ├── Claude API（claude-sonnet）
    │   ├── 画像 → 経費情報抽出
    │   └── CSV → 勘定科目自動分類
    └── Supabase（PostgreSQL）
        ├── RLSでユーザーデータ完全分離
        └── keihi_expensesテーブル
```

### セキュリティ三重防御

| レイヤー | 技術 | 内容 |
|---|---|---|
| ① | LINE署名検証 | HMAC-SHA256でなりすまし防止 |
| ② | JWT認証 | ユーザーごとのトークン発行 |
| ③ | Supabase RLS | DBレベルでデータ完全分離 |

### CI/CD

GitHub（yuki652204/line-keihi-bot）→ Vercel自動デプロイ

---

## データベーススキーマ

```sql
create table keihi_expenses (
  id           uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  date         date not null,
  amount       integer not null,
  vendor       text not null,
  category     text not null,
  memo         text,
  created_at   timestamptz default now()
);
```

---

## 環境変数

`.env.local` に以下を設定してください。

```env
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
ANTHROPIC_API_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

---

## セットアップ

### 1. リポジトリをクローン

```bash
git clone https://github.com/yuki652204/line-keihi-bot.git
cd line-keihi-bot
npm install
```

### 2. 環境変数を設定

`.env.local` を作成して上記の環境変数を記入。

### 3. Supabaseでテーブルを作成

Supabase SQL Editor で `supabase/schema.sql` を実行。

### 4. Vercelにデプロイ

```bash
npx vercel --prod
```

Vercelダッシュボードまたは CLI で環境変数を設定。

### 5. LINE Webhookを設定

LINE Developers Console でWebhook URLを設定:

```
https://<your-vercel-domain>/api/webhook
```

### 6. リッチメニューを作成

```bash
npx tsx scripts/create-richmenu.ts
```

---

## コマンド一覧

```bash
# 開発サーバー起動
npm run dev

# 本番デプロイ
npx vercel --prod

# リッチメニュー再作成
npx tsx scripts/create-richmenu.ts

# 型チェック
npx tsc --noEmit
```

---

## ディレクトリ構成

```
line-keihi-bot/
├── app/
│   └── api/
│       └── webhook/
│           └── route.ts      # LINE Webhook エンドポイント
├── lib/
│   ├── anthropic.ts          # Claude API（画像解析・CSV分類）
│   ├── line.ts               # 署名検証・メッセージ送受信
│   └── supabase.ts           # DB操作（登録・集計）
├── scripts/
│   ├── create-richmenu.ts    # リッチメニュー作成スクリプト
│   └── tsconfig.json
├── supabase/
│   └── schema.sql            # テーブル定義
└── .env.local                # 環境変数（gitignore済み）
```

---

## スクリーンショット

| 領収書登録 | 月次集計 | リッチメニュー |
|-----------|---------|--------------|
| (screenshot) | (screenshot) | (screenshot) |

---

## ライセンス

MIT
