import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

/**
 * Real-time chat translation, gated to SaaS Pro subscribers and triggered
 * only for country-mismatched (BR<->US) matches — same-language matches skip
 * translation entirely to save API calls.
 */
@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);
  private readonly provider: string;
  private readonly openai?: OpenAI;

  constructor(private readonly config: ConfigService) {
    this.provider = this.config.get('TRANSLATION_PROVIDER') ?? 'none';
    if (this.provider === 'openai') {
      this.openai = new OpenAI({ apiKey: this.config.get('OPENAI_API_KEY') });
    }
  }

  /** ISO-3166 country -> chat language. Extend as new markets onboard. */
  static languageForCountry(country: string): string {
    return country === 'BR' ? 'pt' : 'en';
  }

  async translate(text: string, sourceLang: string, targetLang: string): Promise<string | null> {
    if (sourceLang === targetLang) return null;

    try {
      if (this.provider === 'openai' && this.openai) {
        return this.translateWithOpenAI(text, sourceLang, targetLang);
      }
      if (this.provider === 'deepl') {
        return this.translateWithDeepL(text, sourceLang, targetLang);
      }
      return null;
    } catch (err) {
      this.logger.warn(`Translation failed (${sourceLang}->${targetLang}): ${(err as Error).message}`);
      return null;
    }
  }

  private async translateWithOpenAI(text: string, sourceLang: string, targetLang: string): Promise<string> {
    const completion = await this.openai!.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `Translate the user's message from ${sourceLang} to ${targetLang}. Reply with only the translated text, no quotes, no commentary.`,
        },
        { role: 'user', content: text },
      ],
    });
    return completion.choices[0]?.message?.content?.trim() ?? text;
  }

  private async translateWithDeepL(text: string, sourceLang: string, targetLang: string): Promise<string> {
    const apiKey = this.config.get('DEEPL_API_KEY');
    const response = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        text,
        source_lang: sourceLang.toUpperCase(),
        target_lang: targetLang.toUpperCase(),
      }),
    });
    const data = (await response.json()) as { translations?: { text: string }[] };
    return data.translations?.[0]?.text ?? text;
  }
}
