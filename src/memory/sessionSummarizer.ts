import { queryLiteLLM, type ChatMessage } from 'LLMManager';

export async function summarizeSession(messages: Array<{ role: string; content: string }>, settings: any): Promise<string | null> {
  try {
    const conversation = messages.map(m => `${m.role}: ${m.content}`).join('\n');
    const llmMessages: ChatMessage[] = [
      {
        role: 'system',
        content: 'Summarize the following conversation into key facts, user preferences, and decisions as bullet points. If the conversation is trivial or contains nothing worth remembering, respond with exactly: NOTHING_TO_REMEMBER',
      },
      { role: 'user', content: conversation },
    ];
    const result = await queryLiteLLM(llmMessages, settings.selectedModel, settings.apiKey, settings.LiteLLMLink);
    const response = result.choices?.[0]?.message?.content?.trim() ?? '';
    if (response === 'NOTHING_TO_REMEMBER') return null;
    return response || null;
  } catch {
    return null;
  }
}
