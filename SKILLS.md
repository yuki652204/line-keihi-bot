# LINE経費管理Bot 開発ナレッジ

## システム概要
- URL: https://line-keihi-bot.vercel.app
- GitHub: https://github.com/yuki652204/line-keihi-bot
- LINE Bot: @154drhwm

## 技術スタック
- Next.js 14 App Router / TypeScript
- LINE Messaging API
- Claude API (claude-sonnet) - Vision・テキスト処理
- Supabase (PostgreSQL + RLS)
- Vercel

## 重要な実装ポイント

### LINE Webhook
- 署名検証は必須（x-line-signature）
- replyTokenは1回しか使えない
- 画像・CSV処理はwaitUntil()で非同期化
- Vercel maxDuration = 60 を設定

### Claude API
- 画像はbase64でAPIに渡す
- LINEの画像URLは期限付き → 即座に取得が必要
- プロンプトで勘定科目を明示すると精度が上がる

### Supabase
- RLSを必ず有効化
- JWT カスタムクレームに line_user_id を含める
- service_role_key はサーバーサイドのみ

### LINEの注意点
- 日付のハイフン（2026-06-01）はリンク認識される
  → スラッシュ（2026/06/01）に変換
- LINEアプリ内ブラウザはCSVダウンロード非対応
  → テキスト形式で返信する
- 自動応答をOFFにしないとWebhookと競合する
- Messaging APIはOA Managerで有効化が必要

### リッチメニュー
- scripts/create-richmenu.ts で再作成可能
- npx tsx scripts/create-richmenu.ts
- 画像はsharpで自動生成

### セキュリティ
- JWT + RLS の二重防御
- SUPABASE_JWT_SECRET はVercel環境変数に設定
- .env.local は .gitignore で除外済み

## コマンド一覧
- 今月・先月・〇月の経費まとめて
- 今年・全期間の経費まとめて
- 2025年12月の経費まとめて（年月指定）
- 今月・先月・〇月の経費をCSVで
- プライバシーポリシー
- データを削除して → 削除を確認

## 今後の拡張候補
- freee / マネーフォワード API連携
- 収入登録・損益計算（P/L）
- Webダッシュボード
- 商用化（LINEライトプラン以上）

## デプロイ手順
1. コード修正
2. npx vercel --prod
3. 環境変数変更時は Vercel Dashboard で設定
