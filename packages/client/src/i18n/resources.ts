import { en } from './en';
import { zh } from './zh';

export const LANGUAGE_STORAGE_KEY = 'baker_language';

export const resources = {
  en: { translation: en },
  zh: { translation: zh },
} as const;

export type SupportedLanguage = keyof typeof resources;

