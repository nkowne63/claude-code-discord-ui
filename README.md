# Claude Code Discord Bot (Bypass Mode)

既存のGitリポジトリで直接起動し、現在のブランチに対応したDiscordチャンネルでClaude Codeと対話できるボットです。

⚠️ **重要**: このボットはClaude Codeを「dangerouslySkipPermissions: true」のbypass modeで実行します。
通常の確認プロンプトを省略して自動実行するため、本番環境での使用は十分注意してください。

## 使い方

```bash
# 直接実行
cd /path/to/your/repo
export DISCORD_TOKEN="your-token"
export APPLICATION_ID="your-app-id"
./claude-code-discord-bot.ts --category myproject --user-id 123456789012345678

# Gist等から直接実行
cd /path/to/your/repo
export DISCORD_TOKEN="your-token"
export APPLICATION_ID="your-app-id"
deno run --allow-all https://gist.githubusercontent.com/YOUR_USERNAME/YOUR_GIST_ID/raw/claude-code-discord-bot.ts --category myproject --user-id 123456789012345678

# または一行で
DISCORD_TOKEN="token" APPLICATION_ID="id" deno run --allow-all https://gist.githubusercontent.com/YOUR_USERNAME/YOUR_GIST_ID/raw/claude-code-discord-bot.ts --category myproject --user-id 123456789012345678
```

## 必要な環境変数
- DISCORD_TOKEN: Discord Bot Token
- APPLICATION_ID: Discord Application ID
- CATEGORY_NAME: カテゴリー名（省略時はコマンドライン引数、それも省略時はリポジトリ名を使用）
- DEFAULT_MENTION_USER_ID: デフォルトメンション対象のユーザーID（省略時はコマンドライン引数を使用）

## 必要なボット権限（Permissions）
以下の権限をOAuth2 URL Generatorで選択してください：

### 必須権限
- View Channels - チャンネルを表示
- Send Messages - メッセージを送信
- Embed Links - リンクを埋め込む
- Attach Files - ファイルを添付
- Use Slash Commands - スラッシュコマンドを使用
- Manage Channels - チャンネルを管理（チャンネル作成に必要）
- Manage Roles - ロールを管理（カテゴリー作成に必要）

### OAuth2 URL生成時の設定
1. Scopes: bot, applications.commands
2. Bot Permissions: 上記の権限を全て選択
3. 生成されたURLは以下のような形式になります：
   https://discord.com/api/oauth2/authorize?client_id=YOUR_APP_ID&permissions=CALCULATED_PERMISSIONS&scope=bot%20applications.commands

## 前提条件
- Deno (最新版)
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)
- Claude Maxアカウントでログイン済み (`claude login`)
- 既存のGitリポジトリ

## 利用可能なコマンド

### `/claude <prompt> [session_id]`
Claude Codeにメッセージを送信し、AI支援を受けます。リアルタイムでストリーミング応答が表示されます。
- `prompt`: Claude Codeに送信するプロンプト（必須）
- `session_id`: 継続するセッションID（オプション）

### `/continue [prompt]`
現在のディレクトリの最新の会話を読み込んでClaude Codeとの対話を継続します。
- `prompt`: Claude Codeに送信するプロンプト（オプション、未指定時は「続きをお願いします」）

### `/claude-cancel`
現在実行中のClaude Codeコマンドをキャンセルします。長時間実行されているタスクを中止したい場合に使用します。

### `/git <command>`
Gitコマンドを実行します。リポジトリの状態管理に使用します。
- `command`: 実行するGitコマンド（例：`status`, `log --oneline`, `diff`）

### `/shell <command> [input]`
シェルコマンドを実行します。対話的なコマンドにも対応しており、実行後に標準入力を送信できます。
- `command`: 実行するシェルコマンド（必須）
- `input`: 初期標準入力（オプション）

### `/shell-input <id> <text>`
実行中のシェルプロセスに標準入力を送信します。対話的なコマンド（vim、nano、python REPL等）で使用します。
- `id`: プロセスID（`/shell-list`で確認）
- `text`: 送信するテキスト

### `/shell-list`
現在実行中のシェルプロセスをリスト表示します。各プロセスのID、コマンド、実行時間が表示されます。

### `/shell-kill <id>`
実行中のシェルプロセスを強制終了します。
- `id`: 停止するプロセスのID

### `/worktree <branch> [ref]`
Git worktreeを作成し、新しいブランチ用のボットプロセスを自動起動します。
- `branch`: 作成するworktreeのブランチ名（必須）
- `ref`: 参照するコミット/ブランチ（デフォルト：ブランチ名）

### `/worktree-list`
現在のGit worktreeの一覧を表示します。各worktreeのパス、ブランチ、コミットハッシュが表示されます。

### `/worktree-remove <branch>`
Git worktreeを削除します。
- `branch`: 削除するworktreeのブランチ名

### `/status`
ボットとリポジトリの現在の状態を表示します。Claude Code、Git状態、実行中プロセス数等が確認できます。

### `/pwd`
現在の作業ディレクトリとリポジトリ情報を表示します。

### `/settings <action> [value]`
ボットの設定を管理します。
- `mention-on <user_id>`: Claude Code完了時のメンション機能をオンにし、対象ユーザーを設定
- `mention-off`: メンション機能をオフにする
- `show`: 現在の設定を表示

### `/shutdown`
ボットを安全にシャットダウンします。実行中のプロセスも全て終了されます。

## 対話的コマンドの使用例

```
/shell terraform apply

# プロセスリストを確認（例：ID 1でterraformが実行中）
/shell-list

/shell-input 1 yes

```

## モジュールとして使用

```typescript
import { createClaudeCodeBot, getGitInfo } from "./claude-code-discord-bot.ts";

const gitInfo = await getGitInfo();
const bot = await createClaudeCodeBot({
  discordToken: "your-token",
  applicationId: "your-app-id",
  workDir: Deno.cwd(),
  repoName: gitInfo.repo,
  branchName: gitInfo.branch,
  categoryName: "my-category",
});
```