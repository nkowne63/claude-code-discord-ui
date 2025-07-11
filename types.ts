// Common types and interfaces shared across the application

// Discord-agnostic types for use by modules
export interface EmbedData {
  color?: number;
  title?: string;
  description?: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: boolean;
}

export interface ComponentData {
  type: 'button';
  customId: string;
  label: string;
  style: 'primary' | 'secondary' | 'success' | 'danger' | 'link';
}

export interface MessageContent {
  content?: string;
  embeds?: EmbedData[];
  components?: Array<{ type: 'actionRow'; components: ComponentData[] }>;
}

export interface InteractionContext {
  deferReply(): Promise<void>;
  editReply(content: MessageContent): Promise<void>;
  followUp(content: MessageContent & { ephemeral?: boolean }): Promise<void>;
  reply(content: MessageContent & { ephemeral?: boolean }): Promise<void>;
  update(content: MessageContent): Promise<void>;
  
  // Command option getters
  getString(name: string, required?: boolean): string | null;
  getInteger(name: string, required?: boolean): number | null;
}

export interface BotConfig {
  discordToken: string;
  applicationId: string;
  workDir: string;
  repoName: string;
  branchName: string;
  categoryName?: string;
  defaultMentionUserId?: string;
}

export interface ClaudeResponse {
  response: string;
  sessionId?: string;
  cost?: number;
  duration?: number;
  modelUsed?: string;
}

export interface ClaudeMessage {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'system' | 'other';
  content: string;
  metadata?: any;
}

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
}

export interface ShellProcess {
  command: string;
  startTime: Date;
  child: any;
  stdin?: WritableStreamDefaultWriter;
}

export interface CommandHandlers {
  onClaude: (ctx: InteractionContext, prompt: string, sessionId?: string) => Promise<ClaudeResponse>;
  onContinue: (ctx: InteractionContext, prompt?: string) => Promise<ClaudeResponse>;
  onClaudeCancel: (ctx: InteractionContext) => Promise<boolean>;
  onGit: (ctx: InteractionContext, command: string) => Promise<string>;
  onWorktree: (ctx: InteractionContext, branch: string, ref?: string) => Promise<{ result: string; fullPath: string; baseDir: string }>;
  onWorktreeList: (ctx: InteractionContext) => Promise<{ result: string; baseDir: string }>;
  onWorktreeRemove: (ctx: InteractionContext, branch: string) => Promise<{ result: string; fullPath: string; baseDir: string }>;
  onShell: (ctx: InteractionContext, command: string, input?: string) => Promise<{
    processId: number;
    onOutput: (callback: (output: string) => void) => void;
    onComplete: (callback: (code: number, output: string) => void) => void;
    onError: (callback: (error: Error) => void) => void;
  }>;
  onShellInput: (ctx: InteractionContext, processId: number, text: string) => Promise<{ success: boolean; process?: ShellProcess }>;
  onShellList: (ctx: InteractionContext) => Map<number, ShellProcess>;
  onShellKill: (ctx: InteractionContext, processId: number) => Promise<{ success: boolean; process?: ShellProcess }>;
  onStatus: (ctx: InteractionContext) => Promise<{
    claudeStatus: string;
    gitStatus: string;
    gitBranch: string;
    gitRemote: string;
    runningProcessCount: number;
  }>;
  onSettings: (ctx: InteractionContext, action: string, value?: string) => {
    success: boolean;
    mentionEnabled?: boolean;
    mentionUserId?: string | null;
    message?: string;
  };
  onShutdown: (ctx: InteractionContext) => Promise<void>;
  onWorktreeBot?: (ctx: InteractionContext, fullPath: string, branch: string) => Promise<void>;
}

// Bot settings interface
export interface BotSettings {
  mentionEnabled: boolean;
  mentionUserId: string | null;
}