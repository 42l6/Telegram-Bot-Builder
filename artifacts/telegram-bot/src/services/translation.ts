import { Language } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

type Translations = Record<string, string>;

const translations: Record<Language, Translations> = {
  en: {},
  ar: {},
};

function loadTranslations(): void {
  const localesDir = path.join(process.cwd(), 'locales');
  for (const lang of ['en', 'ar'] as Language[]) {
    const filePath = path.join(localesDir, `${lang}.json`);
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      translations[lang] = JSON.parse(raw) as Translations;
    }
  }
}

loadTranslations();

export function translate(
  lang: Language,
  key: string,
  params?: Record<string, string | number>
): string {
  const dict = translations[lang] ?? translations['en'];
  let text = dict[key] ?? translations['en'][key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }

  return text;
}

export function t(lang: Language) {
  return (key: string, params?: Record<string, string | number>) =>
    translate(lang, key, params);
}
