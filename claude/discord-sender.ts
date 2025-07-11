import { splitText } from "../discord/utils.ts";
import type { ClaudeMessage } from "./types.ts";
import type { MessageContent, EmbedData } from "../discord/types.ts";

// Discord sender interface for dependency injection
export interface DiscordSender {
  sendMessage(content: MessageContent): Promise<void>;
}

// Create sendClaudeMessages function with dependency injection
export function createClaudeSender(sender: DiscordSender) {
  return async function sendClaudeMessages(messages: ClaudeMessage[]) {
  for (const msg of messages) {
    switch (msg.type) {
      case 'text': {
        const chunks = splitText(msg.content, 4000);
        for (let i = 0; i < chunks.length; i++) {
          await sender.sendMessage({
            embeds: [{
              color: 0x00ff00,
              title: chunks.length > 1 ? `Assistant (${i + 1}/${chunks.length})` : 'Assistant',
              description: chunks[i],
              timestamp: true
            }]
          });
        }
        break;
      }
      
      case 'tool_use': {
        if (msg.metadata?.name === 'TodoWrite') {
          const todos = msg.metadata?.input?.todos || [];
          const statusEmojis: Record<string, string> = {
            pending: '⏳',
            in_progress: '🔄',
            completed: '✅'
          };
          const priorityEmojis: Record<string, string> = {
            high: '🔴',
            medium: '🟡',
            low: '🟢'
          };
          
          let todoList = '';
          if (todos.length === 0) {
            todoList = 'タスクリストが空です';
          } else {
            for (const todo of todos) {
              const statusEmoji = statusEmojis[todo.status] || '❓';
              const priorityEmoji = priorityEmojis[todo.priority] || '⚪';
              todoList += `${statusEmoji} ${priorityEmoji} **${todo.content}**\n`;
            }
          }
          
          await sender.sendMessage({
            embeds: [{
              color: 0x9932cc,
              title: '📝 Todo List Updated',
              description: todoList,
              fields: [{ name: 'Tool ID', value: `\`${msg.metadata.id}\``, inline: true }],
              footer: { text: '⏳ Pending | 🔄 In Progress | ✅ Completed | 🔴 High | 🟡 Medium | 🟢 Low' },
              timestamp: true
            }]
          });
        } else {
          const inputStr = JSON.stringify(msg.metadata?.input || {}, null, 2);
          // Account for the code block markers when calculating max length
          const maxContentLength = 4096 - "```json\n\n```".length - 50; // 50 chars safety margin
          const truncatedInput = inputStr.length > maxContentLength 
            ? inputStr.substring(0, maxContentLength - 3) + '...' 
            : inputStr;
          
          await sender.sendMessage({
            embeds: [{
              color: 0x0099ff,
              title: `🔧 Tool Use: ${msg.metadata?.name || 'Unknown'}`,
              description: `\`\`\`json\n${truncatedInput}\n\`\`\``,
              fields: [{ name: 'Tool ID', value: `\`${msg.metadata?.id || 'Unknown'}\``, inline: true }],
              timestamp: true
            }]
          });
        }
        break;
      }
      
      case 'tool_result': {
        // Account for code block markers when splitting
        const maxChunkLength = 4096 - "```\n\n```".length - 50; // 50 chars safety margin
        const chunks = splitText(msg.content, maxChunkLength);
        for (let i = 0; i < chunks.length; i++) {
          await sender.sendMessage({
            embeds: [{
              color: 0x00ffff,
              title: chunks.length > 1 ? `🔧 Tool Result (${i + 1}/${chunks.length})` : '🔧 Tool Result',
              description: `\`\`\`\n${chunks[i]}\n\`\`\``,
              timestamp: true
            }]
          });
        }
        break;
      }
      
      case 'thinking': {
        const chunks = splitText(msg.content, 4000);
        for (let i = 0; i < chunks.length; i++) {
          await sender.sendMessage({
            embeds: [{
              color: 0x9b59b6,
              title: chunks.length > 1 ? `💭 Thinking (${i + 1}/${chunks.length})` : '💭 Thinking',
              description: chunks[i],
              timestamp: true
            }]
          });
        }
        break;
      }
      
      case 'system': {
        const embedData: EmbedData = {
          color: 0xaaaaaa,
          title: `⚙️ System: ${msg.metadata?.subtype || 'info'}`,
          timestamp: true,
          fields: []
        };
        
        if (msg.metadata?.cwd) {
          embedData.fields!.push({ name: 'Working Directory', value: `\`${msg.metadata.cwd}\``, inline: false });
        }
        if (msg.metadata?.session_id) {
          embedData.fields!.push({ name: 'Session ID', value: `\`${msg.metadata.session_id}\``, inline: false });
        }
        if (msg.metadata?.model) {
          embedData.fields!.push({ name: 'Model', value: msg.metadata.model, inline: true });
        }
        if (msg.metadata?.total_cost_usd !== undefined) {
          embedData.fields!.push({ name: 'Cost', value: `$${msg.metadata.total_cost_usd.toFixed(4)}`, inline: true });
        }
        if (msg.metadata?.duration_ms !== undefined) {
          embedData.fields!.push({ name: 'Duration', value: `${(msg.metadata.duration_ms / 1000).toFixed(2)}s`, inline: true });
        }
        
        // Special handling for shutdown
        if (msg.metadata?.subtype === 'shutdown') {
          embedData.color = 0xff0000;
          embedData.title = '🛑 シャットダウン';
          embedData.description = `シグナル ${msg.metadata.signal} によりボットが停止しました`;
          embedData.fields = [
            { name: 'カテゴリー', value: msg.metadata.categoryName, inline: true },
            { name: 'リポジトリ', value: msg.metadata.repoName, inline: true },
            { name: 'ブランチ', value: msg.metadata.branchName, inline: true }
          ];
        }
        
        await sender.sendMessage({ embeds: [embedData] });
        break;
      }
      
      case 'other': {
        const jsonStr = JSON.stringify(msg.metadata || msg.content, null, 2);
        // Account for code block markers when splitting
        const maxChunkLength = 4096 - "```json\n\n```".length - 50; // 50 chars safety margin
        const chunks = splitText(jsonStr, maxChunkLength);
        for (let i = 0; i < chunks.length; i++) {
          await sender.sendMessage({
            embeds: [{
              color: 0xffaa00,
              title: chunks.length > 1 ? `Other Content (${i + 1}/${chunks.length})` : 'Other Content',
              description: `\`\`\`json\n${chunks[i]}\n\`\`\``,
              timestamp: true
            }]
          });
        }
        break;
      }
    }
  }
  };
}