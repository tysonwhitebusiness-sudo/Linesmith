/**
 * DeepSeek chat completions — thin wrapper, OpenAI-schema-compatible REST
 * API reached via plain `fetch` rather than the `openai` npm package (no
 * other convenience of that package — streaming, the Assistants API, etc.
 * — is used here, so it isn't worth the added dependency for one call
 * shape). Mirrors `screenshotImport.ts`'s structured-output discipline:
 * the caller gets back parsed, typed JSON, never free-form prose the UI
 * would have to parse itself.
 */

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

export interface DeepSeekUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface DeepSeekJsonResult<T> {
  data: T;
  usage: DeepSeekUsage;
}

/**
 * Calls DeepSeek in JSON mode. `systemPrompt` must itself instruct the
 * model to respond with JSON matching the desired shape — DeepSeek's
 * `response_format: { type: 'json_object' }` (unlike Anthropic's
 * `json_schema` output_config) only guarantees well-formed JSON, not a
 * specific schema, so the shape has to be spelled out in the prompt and
 * the result parsed defensively by the caller.
 */
export async function deepseekJson<T>(systemPrompt: string, userPrompt: string): Promise<DeepSeekJsonResult<T>> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is not set. Add it to .env.local to use the AI health summary.');
  }

  const res = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`DeepSeek request failed: HTTP ${res.status} ${bodyText.slice(0, 300)}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('DeepSeek returned no content.');
  }

  let data: T;
  try {
    data = JSON.parse(content) as T;
  } catch {
    throw new Error('DeepSeek response was not valid JSON.');
  }

  const usage = json.usage ?? {};
  return {
    data,
    usage: {
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      totalTokens: usage.total_tokens ?? 0,
    },
  };
}
