# SS_schedule (Snap Shot to Schedule)

スクリーンショット / 貼付テキストから AI（Gemini）が日時・タイトル・場所・URL を抽出し、
確認・編集後に Google カレンダーへ 1 タップで登録する個人用 PWA。

> 対象ユーザー: 自分 1 人（シングルユーザー前提）
> 言語 / TZ: 日本語固定 / JST 固定
> プラットフォーム: PC + iPhone（PWA）

スクリーンショットは SS-013（実機検証フェーズ）で `docs/images/` に追加予定。

詳細な設計判断・規約は [`CLAUDE.md`](./CLAUDE.md) 参照。

---

## Stack

| カテゴリ | 採用技術 |
| --- | --- |
| Framework | Next.js 16.2.x (App Router) + TypeScript 5 |
| UI | Tailwind v4 + shadcn/ui (base-nova) |
| Auth | Auth.js v5 (next-auth@5.0.0-beta.x) + Google Provider |
| AI | `@google/genai`（Gemini 2.5 Flash） |
| Calendar | `googleapis`（Calendar API v3） |
| Test | Vitest 4 + Playwright 1.59 |
| Runtime / Pkg | bun 1.3.x |
| Deploy | Vercel |

---

## Local Development

### 必要なもの

- [bun](https://bun.sh/) 1.3 以上
- Node.js 20 以上（型/ツール用）
- Google アカウント（OAuth + Gemini API 用）

### 起動手順

```bash
bun install
cp .env.local.example .env.local   # 値はあとで埋める（Setup 1〜3 参照）
bun dev
```

開発サーバは `http://localhost:3000` で起動する。

---

## Setup 1: Gemini API キー取得

1. [Google AI Studio](https://aistudio.google.com/) にアクセスし、Google アカウントでログイン。
2. 左メニュー「Get API key」→「Create API key in new project」を選択。
   （AI Studio の UI 文言は変わる可能性があるので雰囲気で読む）
3. 発行されたキーを `.env.local` の `GEMINI_API_KEY=` に貼り付ける。

```env
GEMINI_API_KEY=AIzaSy...your_key...
```

**メモ**:

- 環境変数名は **`GEMINI_API_KEY`** 固定。`@google/genai` SDK が `new GoogleGenAI()`（引数なし）で
  この名前を自動読込する慣例に従っている。`GOOGLE_GENAI_API_KEY` 等にリネームしない。
- 利用モデルは `gemini-2.5-flash`。無料枠には RPM（requests per minute）/ TPD（tokens per day）の
  上限があり、超過すると 429 が返る。最新値は [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) を都度参照。
- 個人用途（月 100〜300 件想定）なら無料枠で十分なはず。429 が頻出するようなら有料化を検討する。

---

## Setup 2: Google Cloud Console で OAuth クライアント作成

### 2-1. プロジェクト作成

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス。
2. 上部のプロジェクトセレクタから「新しいプロジェクト」を作成（例: `ss-schedule`）。

### 2-2. OAuth 同意画面

1. 「APIとサービス」→「OAuth 同意画面」を開く。
2. **User Type**: 外部 を選択。
3. アプリ名・サポートメール等を入力（自分のメールで OK）。
4. **公開ステータス**: 「テスト中」のままで運用する（個人利用のため）。
5. **テストユーザー**に自分の Google アカウントのメールアドレスを必ず追加する。

### 2-3. Calendar API 有効化

1. 「APIとサービス」→「ライブラリ」を開く。
2. `Google Calendar API` を検索して「有効にする」。

### 2-4. OAuth クライアント ID 作成

1. 「APIとサービス」→「認証情報」→「認証情報を作成」→「OAuth クライアント ID」。
2. アプリケーションの種類: **ウェブアプリケーション**。
3. **承認済みのリダイレクト URI** に以下を追加:
   - 開発用: `http://localhost:3000/api/auth/callback/google`
   - 本番用: `https://<your-vercel-domain>/api/auth/callback/google`
     （Vercel デプロイ後の URL がわかってから追加でも可）
4. 発行された **クライアント ID / クライアントシークレット** を `.env.local` に設定。

```env
AUTH_GOOGLE_ID=xxxxx.apps.googleusercontent.com
AUTH_GOOGLE_SECRET=GOCSPX-xxxxxxxxxxxx
```

### 2-5. OAuth scope（参考）

本アプリがリクエストする scope は最小限:

- `https://www.googleapis.com/auth/calendar.events`（イベント追加用）
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`（カレンダー一覧取得用）

`calendar.readonly` のような広い scope は **使わない**。

---

## Setup 3: Auth Secret 生成

Auth.js が JWT を暗号化するための共通鍵を生成する。

```bash
openssl rand -base64 32
```

出力された文字列を `.env.local` の `AUTH_SECRET=` に設定する。

```env
AUTH_SECRET=AbCdEf1234.../base64...
AUTH_URL=http://localhost:3000
```

`AUTH_URL` はローカル開発では `http://localhost:3000` を明示する。
本番（Vercel）では **Production / Preview / Development すべてに明示する**のが安全側のデフォルト。
詳細は Setup 4 の環境変数表と補足を参照。

---

## Setup 4: Vercel デプロイ

CLI（推奨）と Dashboard の 2 経路を用意している。どちらでも環境変数の登録先（Production / Preview / Development の 3 環境すべて）は同じ。

### CLI でデプロイする場合（推奨）

```bash
# 1. Vercel CLI をインストール（未インストール時）
npm i -g vercel  # または bun add -g vercel

# 2. ログイン
vercel login

# 3. プロジェクトをリンク（初回のみ。対話的）
vercel link
# → ? Set up "~/claude code/SS_schedule"? [Y/n] y
# → ? Which scope? <自分のアカウント>
# → ? Link to existing project? [y/N] n
# → ? What's your project's name? ss-schedule
# → ? In which directory is your code located? ./

# 4. 環境変数を一括登録
cp .env.vercel.template .env.vercel.local
# .env.vercel.local の値を実値に書き換え（このファイルは .gitignored）
bash scripts/vercel-env-setup.sh

# 5. 本番デプロイ
vercel deploy --prod
# → 完了後、Vercel が割り当てた URL を確認

# 6. AUTH_URL を確定値で更新（初回デプロイ後）
# .env.vercel.local の AUTH_URL に上記 URL を書き、再度:
bash scripts/vercel-env-setup.sh
vercel deploy --prod
```

`scripts/vercel-env-setup.sh` は `.env.vercel.local` を読み、各 KEY を
`vercel env rm` → `vercel env add` の順で 3 環境すべてに上書き登録する
（Vercel CLI に bulk-import コマンドが無いため）。

### Dashboard でデプロイする場合

1. このリポジトリを GitHub に push。
2. [Vercel](https://vercel.com/) で「Add New… → Project」→ GitHub リポジトリを Import。
3. Framework Preset は `Next.js` が自動選択される。そのまま Deploy。
4. デプロイ後、**Settings → Environment Variables** で下表の変数を
   Production / Preview / Development それぞれに設定する
   （`.env.vercel.template` を「Import .env File」で読み込み、各値を埋めるのが速い）。
5. 確定した本番 URL（例: `https://ss-schedule.vercel.app`）を
   Google Cloud Console の OAuth クライアントの「承認済みリダイレクト URI」に
   `https://ss-schedule.vercel.app/api/auth/callback/google` として追加。

### 環境変数一覧

> **補足**: 表の `local` 列はローカル `.env.local` の値、`production` 列は Vercel の Production / Preview / Development すべてに同じ値を設定する。

| 変数 | 必須 | local | production | 説明 |
| --- | --- | --- | --- | --- |
| `GEMINI_API_KEY` | 必須 | 必要 | 必要 | Gemini API キー（`@google/genai` SDK 自動読込） |
| `AUTH_GOOGLE_ID` | 必須 | 必要 | 必要 | Google OAuth クライアント ID |
| `AUTH_GOOGLE_SECRET` | 必須 | 必要 | 必要 | Google OAuth クライアントシークレット |
| `AUTH_SECRET` | 必須 | 必要 | 必要 | Auth.js JWT 暗号化キー（`openssl rand -base64 32`） |
| `AUTH_URL` | 必須 | `http://localhost:3000` | `https://<vercel-domain>` | Auth.js のベース URL |

**`AUTH_URL` の補足**: ローカル開発では `http://localhost:3000` を `.env.local` に明示する。Vercel では **Production / Preview / Development すべてに明示**（いずれも Production URL = `https://<vercel-domain>` を設定）するのを安全側のデフォルトとする。Preview 環境で `VERCEL_URL` がプレビュー固有 URL（例: `<branch>-<hash>.vercel.app`）を指すと OAuth callback と不一致になり redirect_uri_mismatch / ループが起きる既知挙動を避けるため。

> セキュリティ上の注意: `GEMINI_API_KEY` 等のシークレットはサーバ側のみで参照する。
> `NEXT_PUBLIC_*` プレフィックスを付けない、`session` callback でクライアントに返さない、
> といった既存実装の方針を維持すること。

---

## Testing

### Unit / Component（Vitest）

```bash
bun run test          # 一回だけ実行
bun run test:watch    # ウォッチモード
```

### E2E（Playwright）

```bash
bunx playwright test
# または
bun run e2e
```

### E2E 実行時の運用 tip（重要）

`bun dev` を別ターミナルで立ち上げたまま `bunx playwright test` を実行すると、
Playwright の `webServer.reuseExistingServer` が既存サーバを再利用する。
このとき既存サーバには `E2E_AUTH_BYPASS=1` が **効かない** ので、
`/api/auth/providers` に credentials provider が出てこず、
sign-in が CSRF / 405 で失敗する。

具体的な失敗メッセージ:

```text
E2E precheck failed: /api/auth/providers does not include 'credentials'
```

（`e2e/helpers/auth.ts` の precheck で投げられる）

**対処**:

- 確実な方法: `bun dev` を一度停止してから `bunx playwright test` を実行する
  （Playwright が自身で `E2E_AUTH_BYPASS=1` 付きの dev サーバを起動する）
- もしくは `CI=1 bunx playwright test` で `reuseExistingServer` を強制無効化する

---

## Chrome 拡張（unpacked）

サイドパネル拡張として、表示中タブの選択範囲スクショまたは文章入力から予定を解析できます。

```bash
npm run extension:build
```

Chrome の `chrome://extensions` で「デベロッパー モード」を有効化し、
`extension/dist` を「パッケージ化されていない拡張機能」として読み込む。

初回利用:

1. 拡張アイコンを押してサイドパネルを開く
2. 「Webでログインして接続」を押す
3. 本番 Web で Google ログイン済み状態にする
4. 「拡張機能に接続」を押す
5. サイドパネルに戻り、「スクショ」または「文章入力」を使う

### 権限

実際に `extension/public/manifest.json` に記載している権限は以下のとおり。

- `permissions`: `sidePanel`, `activeTab`, `scripting`, `storage`, `tabs`
- `host_permissions`: `<all_urls>`
- `externally_connectable.matches`: `https://ss-schedule.vercel.app/*` のみ
  （Web 側からの `SS_SCHEDULE_CONNECT` メッセージはこのオリジンに限定）

`host_permissions: <all_urls>` は **ブラウザで開いた Gmail / Web ページ上の選択範囲を
スクショするため** に必要。Gmail を含む任意のページでユーザーが「スクショ」ボタンを
押したときに、`chrome.scripting.executeScript` で範囲選択 UI（`range-selector.js`）を
注入する用途で使っている。

実際に注入されるのはユーザーが拡張アイコンから明示的に操作したタイミングだけで、
バックグラウンドで全タブを監視する処理は実装していない（`service-worker.ts` 参照）。
`chrome://` や Chrome Web Store など content script を注入できないページでは利用できない。

> **シングルユーザー前提の割り切り**: 本拡張は自分専用にローカルで unpacked 読み込みする
> 想定で、Chrome Web Store への公開は行わない。`<all_urls>` の権限スコープは Web Store
> 配布時には審査・利用範囲の説明が必要になるが、個人利用ではトレードオフとして許容している。

---

## Troubleshooting

### サインイン関連

- `Access blocked: <app> has not completed verification`
  → OAuth 同意画面が「テスト中」かつ自分のメールが **テストユーザー未登録**。
  Cloud Console の「OAuth 同意画面 → テストユーザー」に追加する。
- **テスト中モードの refresh_token が 7 日で失効する**（2026-05 時点の Google 仕様）
  → 失効したら一度サインアウトして再ログインすると新しい refresh_token が発行される。
  本アプリは `prompt: "consent"` を付けて毎回同意画面を出し、refresh_token を確実に取得する設計。
  「毎回同意画面が出るのは仕様」なので心配しない。
- **redirect_uri_mismatch**
  → Cloud Console の「承認済みリダイレクト URI」と実際のアクセス URL の不一致。
  `http://localhost:3000/api/auth/callback/google` および本番 URL の両方が登録されているか確認。
- **iPhone PWA で OAuth リダイレクトループが起きる**
  → 「ホーム画面に追加」した standalone モードの PWA から OAuth サインインする場合、
  Safari が Cookie を別 storage に保持するため redirect ループする既知挙動がある（2026-05 時点）。
  対処: (a) `AUTH_URL` を Vercel 側で明示的に Production / Preview / Development すべてに設定する。
  (b) それでも再現するなら、初回サインインだけは Safari ブラウザで実施し、その後 PWA を起動する。
  (c) `next-auth` の `useSecureCookies: true`（HTTPS のみ送信）が有効か確認。

### Calendar API 関連

- **403 / "Calendar API has not been used …"**
  → Cloud Console で Calendar API を有効化していない。Setup 2-3 を再確認。
- **insert で 401 / token expired**
  → refresh_token 失効（テストモード 7 日問題）。再サインインする。

### Gemini API 関連

- **429 RESOURCE_EXHAUSTED**
  → 無料枠の RPM/TPD を超過。少し時間を置く、もしくはモデル/有料化を検討。
- **400 INVALID_ARGUMENT**
  → 画像サイズ / MIME type / プロンプト構造の問題。`/api/extract` 側の入力検証ログを確認。

### 環境変数

- **"AUTH_SECRET is required"**
  → `.env.local` または Vercel 環境変数に `AUTH_SECRET` が未設定。
- **`GEMINI_API_KEY` を `GOOGLE_GENAI_API_KEY` 等にリネームしない**
  → `@google/genai` SDK の自動読込慣例から外れて読まれなくなる。

---

## License / 注意事項

個人用プロジェクト。外部公開・配布は想定していない。
API キーやクライアントシークレットを誤ってコミットしないこと（`.env.local` は gitignore 済み）。
