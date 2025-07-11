import { query as claudeQuery, type SDKMessage } from "npm:@anthropic-ai/claude-code@latest";

// セッションIDをクリーンアップ（余計な文字を除去）
export function cleanSessionId(sessionId: string): string {
  return sessionId
    .trim()                           // 前後の空白を除去
    .replace(/^`+|`+$/g, '')         // 前後のバッククォートを除去
    .replace(/^```\n?|\n?```$/g, '') // コードブロックマークを除去
    .replace(/[\r\n]/g, '')          // 改行文字を除去
    .trim();                         // 再度前後の空白を除去
}

// Claude Code SDKのquery関数をラップ
export async function sendToClaudeCode(
  workDir: string,
  prompt: string,
  controller: AbortController,
  sessionId?: string,
  onChunk?: (text: string) => void,
  // deno-lint-ignore no-explicit-any
  onStreamJson?: (json: any) => void,
  continueMode?: boolean
): Promise<{
  response: string;
  sessionId?: string;
  cost?: number;
  duration?: number;
  modelUsed?: string;
}> {
  const messages: SDKMessage[] = [];
  let fullResponse = "";
  let resultSessionId: string | undefined;
  let modelUsed = "Default";
  
  // セッションIDをクリーンアップ
  const cleanedSessionId = sessionId ? cleanSessionId(sessionId) : undefined;
  
  // 包括的なエラーハンドリングでラップ
  const executeWithErrorHandling = async (useRetryModel = false) => {
    try {
      const queryOptions = {
        prompt,
        abortController: controller,
        options: {
          cwd: workDir,
          permissionMode: "bypassPermissions" as const,
          verbose: true,
          outputFormat: "stream-json",
          ...(continueMode && { continue: true }),
          ...(cleanedSessionId && !continueMode && { resume: cleanedSessionId }),
          ...(useRetryModel && { model: "claude-sonnet-4-20250514" }),
        },
      };
      
      console.log(`Claude Code: ${useRetryModel ? 'Sonnet 4で' : 'デフォルトモデルで'}実行中...`);
      if (continueMode) {
        console.log(`Continue mode: Reading latest conversation in directory`);
      } else if (cleanedSessionId) {
        console.log(`Session resuming with ID: ${cleanedSessionId}`);
      }
      
      const iterator = claudeQuery(queryOptions);
      const currentMessages: SDKMessage[] = [];
      let currentResponse = "";
      let currentSessionId: string | undefined;
      
      for await (const message of iterator) {
        // AbortSignalをチェックしてループを停止
        if (controller.signal.aborted) {
          console.log(`Claude Code${useRetryModel ? ' (Retry)' : ''}: Abort signal detected, stopping iteration`);
          break;
        }
        
        currentMessages.push(message);
        
        // JSONストリームの場合、専用のコールバックを呼び出し
        if (onStreamJson) {
          onStreamJson(message);
        }
        
        // テキストメッセージの場合、チャンクを送信
        // JSONストリーム出力の場合は、onStreamJsonで処理するのでスキップ
        if (message.type === 'assistant' && message.message.content && !onStreamJson) {
          const textContent = message.message.content
            // deno-lint-ignore no-explicit-any
            .filter((c: any) => c.type === 'text')
            // deno-lint-ignore no-explicit-any
            .map((c: any) => c.text)
            .join('');
          
          if (textContent && onChunk) {
            onChunk(textContent);
          }
          currentResponse = textContent;
        }
        
        // セッション情報を保存
        if ('session_id' in message && message.session_id) {
          currentSessionId = message.session_id;
        }
      }
      
      return {
        messages: currentMessages,
        response: currentResponse,
        sessionId: currentSessionId,
        aborted: controller.signal.aborted
      };
    // deno-lint-ignore no-explicit-any
    } catch (error: any) {
      // プロセス終了コード143 (SIGTERM) やAbortErrorを適切にハンドル
      if (error.name === 'AbortError' || 
          controller.signal.aborted || 
          (error.message && error.message.includes('exited with code 143'))) {
        console.log(`Claude Code${useRetryModel ? ' (Retry)' : ''}: Process terminated by abort signal`);
        return {
          messages: [],
          response: "",
          sessionId: undefined,
          aborted: true
        };
      }
      throw error;
    }
  };
  
  // まず通常のモデルで試行
  try {
    const result = await executeWithErrorHandling(false);
    
    if (result.aborted) {
      return { response: "リクエストがキャンセルされました", modelUsed };
    }
    
    messages.push(...result.messages);
    fullResponse = result.response;
    resultSessionId = result.sessionId;
    
    // 最後のメッセージから情報を取得
    const lastMessage = messages[messages.length - 1];
    
    return {
      response: fullResponse || "応答がありません",
      sessionId: resultSessionId,
      cost: 'total_cost_usd' in lastMessage ? lastMessage.total_cost_usd : undefined,
      duration: 'duration_ms' in lastMessage ? lastMessage.duration_ms : undefined,
      modelUsed
    };
  // deno-lint-ignore no-explicit-any
  } catch (error: any) {
    // exit code 1エラーの場合、Sonnet 4でリトライ
    if (error.message && (error.message.includes('exit code 1') || error.message.includes('exited with code 1'))) {
      console.log("Rate limit detected, retrying with Sonnet 4...");
      modelUsed = "Claude Sonnet 4";
      
      try {
        const retryResult = await executeWithErrorHandling(true);
        
        if (retryResult.aborted) {
          return { response: "リクエストがキャンセルされました", modelUsed };
        }
        
        // 最後のメッセージから情報を取得
        const lastRetryMessage = retryResult.messages[retryResult.messages.length - 1];
        
        return {
          response: retryResult.response || "応答がありません",
          sessionId: retryResult.sessionId,
          cost: 'total_cost_usd' in lastRetryMessage ? lastRetryMessage.total_cost_usd : undefined,
          duration: 'duration_ms' in lastRetryMessage ? lastRetryMessage.duration_ms : undefined,
          modelUsed
        };
      // deno-lint-ignore no-explicit-any
      } catch (retryError: any) {
        // Sonnet 4でも失敗した場合
        if (retryError.name === 'AbortError' || 
            controller.signal.aborted || 
            (retryError.message && retryError.message.includes('exited with code 143'))) {
          return { response: "リクエストがキャンセルされました", modelUsed };
        }
        
        retryError.message += '\n\n⚠️ デフォルトモデルとSonnet 4の両方でエラーが発生しました。しばらく時間を置いてから再度お試しください。';
        throw retryError;
      }
    }
    
    throw error;
  }
}