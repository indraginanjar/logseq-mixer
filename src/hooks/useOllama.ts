import { useState, useCallback } from 'react';
import { ChatGPTAnswer } from '../components/ChatGPTAnswerList';

export const useLiteLLM = () => {
  const [answers, setAnswers] = useState<ChatGPTAnswer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const askLiteLLM = useCallback(async (prompt: string,selectedModel: string,apiKey: string) => {
    setLoading(true);
    setError(null);

    // Retrieve settings values from Logseq

    try {
      const response = await fetch('http://127.0.0.1:4000/chat/completions', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}` // Use API key from settings
        },
        body: JSON.stringify({
          model: selectedModel, // Use the model from settings
          messages: [{ role: 'user', content: prompt }],
          "api_key":apiKey
          
        }),
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();
      setAnswers(prev => [{
        id: crypto.randomUUID(),
        content: data.choices[0]?.message?.content || 'No response',
        timestamp: new Date().toISOString(),
      }, ...prev]);

    } catch (err) {
      console.error('LiteLLM request failed:', err);
      setError('Failed to get response. Make sure LiteLLM is running!');
    } finally {
      setLoading(false);
    }
  }, []);

  return { answers, loading, error, askLiteLLM };
};
