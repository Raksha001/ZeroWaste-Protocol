/**
 * IntentParser.ts — Groq LLaMA 3.3 natural language intent parsing
 *
 * Allows users to interact with ZeroWaste Protocol in natural language
 * instead of requiring exact URL pastes. The LLM understands conversational
 * payment requests and routes them to the correct bot handler.
 *
 * Examples of supported natural language:
 *   "hey can you pay for this? http://localhost:3001/premium-article"
 *   "i want to buy access to this article [URL]"
 *   "sweep my tokens and pay: [URL]"
 *   "how much dust do I have?"
 *   "what's my wallet address?"
 *   "help me"
 */
import Groq from "groq-sdk";

export type IntentType =
  | "pay_url"       // User wants to pay for a paywalled URL
  | "check_dust"    // User wants to see their dust tokens
  | "check_wallet"  // User wants their wallet address
  | "help"          // User needs guidance
  | "unknown";      // Can't determine intent

export interface ParsedIntent {
  type: IntentType;
  url?: string;           // Extracted URL for pay_url intents
  confidence: number;     // 0.0 - 1.0
  friendlyAck?: string;   // Optional LLM-generated acknowledgement (1 short sentence)
}

const SYSTEM_PROMPT = `You are an intent parser for ZeroWaste Protocol, a Telegram bot that pays x402 paywalls by converting dust tokens to USDT on X Layer blockchain.

Extract the user's intent from their message and return ONLY valid JSON with this exact schema:
{
  "type": "pay_url" | "check_dust" | "check_wallet" | "help" | "unknown",
  "url": "<extracted URL string or null>",
  "confidence": <float 0.0-1.0>,
  "friendlyAck": "<one short sentence acknowledging what you understood, or null>"
}

Intent types:
- "pay_url": User wants to pay for a URL/paywall/article/content. Extract the URL if present.
- "check_dust": User asks about their dust tokens, balance, wallet contents, or "how much do I have".
- "check_wallet": User wants their wallet address or deposit address.
- "help": User is confused, asks how it works, or needs instructions.
- "unknown": None of the above clearly applies.

Rules:
- If a URL is present in the message, type is almost certainly "pay_url".
- Extract URLs exactly as-is (including localhost URLs for testing).
- friendlyAck should be concise (max 10 words) and sound natural.
- If type is "unknown" and no URL found, set confidence below 0.5.
- Return ONLY the JSON object. No markdown, no explanation.`;

export class IntentParser {
  private static client: Groq | null = null;

  private static getClient(): Groq | null {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return null;
    }
    if (!IntentParser.client) {
      IntentParser.client = new Groq({ apiKey });
    }
    return IntentParser.client;
  }

  /**
   * Parse a user's natural language message into a structured intent.
   * Falls back to regex-based URL detection if Groq is unavailable.
   */
  static async parse(message: string): Promise<ParsedIntent> {
    const client = IntentParser.getClient();

    // Fallback: regex-based detection if Groq not configured
    if (!client) {
      return IntentParser.regexFallback(message);
    }

    try {
      const completion = await client.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: message },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,      // Low temperature for consistent intent extraction
        max_tokens: 200,
      });

      const raw = completion.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(raw);

      // Validate and normalise the response
      const intent: ParsedIntent = {
        type: (["pay_url", "check_dust", "check_wallet", "help", "unknown"].includes(parsed.type)
          ? parsed.type
          : "unknown") as IntentType,
        url: parsed.url || undefined,
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
        friendlyAck: parsed.friendlyAck || undefined,
      };

      console.log(`[IntentParser] "${message.slice(0, 50)}..." → ${intent.type} (${(intent.confidence * 100).toFixed(0)}%) ${intent.url ? `[URL: ${intent.url.slice(0, 40)}]` : ""}`);
      return intent;
    } catch (err: any) {
      console.warn(`[IntentParser] Groq parse error: ${err.message} — using regex fallback`);
      return IntentParser.regexFallback(message);
    }
  }

  /**
   * Regex-based fallback when Groq is unavailable.
   * Detects URLs and simple keyword commands.
   */
  private static regexFallback(message: string): ParsedIntent {
    const urlMatch = message.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      return { type: "pay_url", url: urlMatch[0], confidence: 0.9 };
    }

    const lower = message.toLowerCase();
    if (/\b(dust|token|balance|how much|what.*(have|wallet))\b/.test(lower)) {
      return { type: "check_dust", confidence: 0.7 };
    }
    if (/\b(wallet|address|deposit)\b/.test(lower)) {
      return { type: "check_wallet", confidence: 0.7 };
    }
    if (/\b(help|how|start|what is|explain)\b/.test(lower)) {
      return { type: "help", confidence: 0.6 };
    }

    return { type: "unknown", confidence: 0.2 };
  }

  /**
   * Quick check: is Groq configured and ready?
   */
  static isConfigured(): boolean {
    return !!process.env.GROQ_API_KEY;
  }
}
