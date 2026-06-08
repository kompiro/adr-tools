# Node 非依存の standalone バイナリ配布

- **日付**: 2026-06-08
- **Issue**: なし
- **ステータス**: ドラフト
- **関連**: tpl-tools 側の同名 Design Doc（同一パターンを共有）

## 背景・課題

`@kompiro/adr-tools` は現状 GitHub Packages (`npm.pkg.github.com`) の npm パッケージとして配布しており、`adr` コマンドの bin は `#!/usr/bin/env node` で Node ランタイムに依存している。

利用したい環境がすべて Node を持つわけではない:

- **他プロジェクト / 他人への配布** — Node ツールチェーンを前提にできない
- **Go 開発などの devcontainer** — Node を入れていない開発環境でも `adr` / `tpl` を使いたい

Node や node_modules のセットアップなしに `adr` コマンドを実行できる配布手段が欲しい。

## 制約・前提

- 本ツールは **ファイル I/O (`node:fs` / `node:path` / `node:url`) と `js-yaml` のみ**に依存する小さな純 CLI（~1,755 LOC）。ネイティブアドオン・ネットワーク・子プロセスは使わない
- TypeScript / ESM (`type: module`)。エントリは `src/cli/index.ts`、`.ts` 拡張子付き import を使用
- 既存の npm 配布は **継続する**（Node ユーザーの体験を壊さない）。バイナリ配布はあくまで追加
- CLI の検証ロジックは `adr.config.json` の `$schema`（`./node_modules/...` を指す）には依存しない。node_modules が無くても検証は動く
- 配布先は linux / macOS / Windows、x64 / arm64 を想定

## 検討した選択肢

### 案1: Bun `bun build --compile`（本命）

`bun build src/cli/index.ts --compile --target=<t> --outfile <name>` で Bun ランタイムを同梱した単一実行ファイルを生成する。

- メリット
  - `node:fs/path/url` をネイティブ対応、`js-yaml` も自動バンドル。1 コマンドで完結
  - `--target=bun-{linux,darwin,windows}-{x64,arm64}` でクロスコンパイル可（1 ホストから全プラットフォーム）
  - `.ts` 拡張子 import をそのまま解決でき、既存ソース構成に手を入れずに済む
  - **検証済み**: 本リポジトリのソースを native / `bun-linux-arm64` にコンパイルし、実 ADR セットに対し `Validated 68 ADR(s)` を Node 無しで確認
- デメリット
  - バイナリが **~90MB**（Bun ランタイム同梱が下限。アプリが小さいため `--minify --bytecode` でも変わらない）

### 案2: Deno `deno compile`

`deno compile --allow-read --allow-write src/cli/index.ts`。

- メリット: `node:` 指定子・npm 依存対応、クロスコンパイル可。権限フラグをバイナリに焼き込める
- デメリット: バイナリ ~80MB。権限モデルの作り込みが追加で必要。Bun 比で本ツールに対する優位が薄い

### 案3: Node SEA (Single Executable Applications)

公式の単一実行ファイル機能。

- メリット: 公式ランタイムを使う
- デメリット: ESM → 単一 CJS 化 → blob 生成 → postject 注入 → codesign と多段で複雑。各プラットフォームの `node` バイナリを別途用意する必要があり、クロスコンパイルも非自明。実験的

### 案4: Go / Rust への書き直し

- メリット: 数 MB の完全静的バイナリ、ランタイム不要
- デメリット: ~1,755 LOC の全面移植。TS で活発に保守している現状から見て労力に見合わない

## 比較

| 観点 | 案1 Bun | 案2 Deno | 案3 Node SEA | 案4 Go/Rust |
|---|---|---|---|---|
| 実装コスト | 低（1 コマンド） | 低〜中 | 高（多段） | 最高（全面移植） |
| クロスコンパイル | ◎ | ◎ | △ | ◎ |
| `node:` API 対応 | ◎ | ○ | ◎ | N/A |
| バイナリサイズ | ~90MB | ~80MB | ~80MB+ | 数MB |
| ソース改変 | ほぼ不要 | 小 | 中 | 全面 |
| 検証済み | ✅ | – | – | – |

サイズ以外で Bun が劣る点がなく、実機検証も済んでいるため案1 を採る。サイズは GitHub Releases 配布では金銭コストにならず、DL 帯域は devcontainer のレイヤキャッシュで吸収できる。

## 現時点の方針

**案1 Bun `--compile`** を採用し、既存 npm 配布に **追加**する形で standalone バイナリを提供する。

### ビルド

`package.json` にビルドスクリプトを追加し、エントリ `src/cli/index.ts` を以下 5 ターゲットへコンパイルする。

| target | 成果物名 |
|---|---|
| `bun-linux-x64` | `adr-linux-x64` |
| `bun-linux-arm64` | `adr-linux-arm64` |
| `bun-darwin-x64` | `adr-darwin-x64` |
| `bun-darwin-arm64` | `adr-darwin-arm64` |
| `bun-windows-x64` | `adr-windows-x64.exe` |

`config.schema.json` / `init.template.json` の同梱方針は要検討（下記）。

### リリースパイプライン

GitHub Actions をタグ push (`v*`) で発火させ、`oven-sh/setup-bun` で Bun を固定バージョン導入 → 5 ターゲットをビルド → SHA256 チェックサム生成 → `gh release` にアセットアップロード。既存の npm publish ワークフローと並走させる。

### 利用側の入手経路

- **install スクリプト**（本命）: `curl -fsSL https://raw.githubusercontent.com/kompiro/adr-tools/main/install.sh | sh`
  - `uname` で OS/arch を判定 → 最新 Release（または `ADR_VERSION` 指定）から該当アセットを DL → SHA256 検証 → `~/.local/bin/adr` に配置・`chmod +x`
- **devcontainer**: `Dockerfile` に install スクリプトの `RUN` を 1 行、または devcontainer feature として宣言的に導入
- **Homebrew tap**（任意・後追い）: `kompiro/tap` に formula

### 留意点

- **`$schema` 解決**: node_modules の無い配布先ではエディタ補完が効かない。CLI 検証自体は影響を受けない。配布先向けには schema を Release アセットまたは raw URL で公開し、`$schema` をその URL に差し替える運用を案内する
- **Windows**: コード署名なしだと SmartScreen 警告。当面許容、必要になれば署名を検討
- **再現性**: `setup-bun` で Bun バージョンを固定する

### 利用者リポジトリ（hato 等）への影響

hato は Node プロジェクトのため変更不要（`pnpm adr:validate` のまま）。本バイナリ配布は Node 非依存環境向けの追加であり、既存利用者の pre-push / CI には影響しない。

## 未解決の問い

- `config.schema.json` / `init.template.json` をバイナリへどう同梱するか（`Bun.embeddedFiles` で焼き込む / `init` 実行時に Release から取得 / 別ファイルとして併配布）
- install スクリプトのインストール先デフォルト（`~/.local/bin` か `/usr/local/bin` か、PATH 追加の案内をどこまでやるか）
- devcontainer feature まで用意するか、Dockerfile の 1 行案内に留めるか
