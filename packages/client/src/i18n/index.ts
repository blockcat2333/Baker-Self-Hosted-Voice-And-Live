import i18next from 'i18next';
import type { InitOptions, i18n as I18nInstance } from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import { LANGUAGE_STORAGE_KEY, resources } from './resources';

const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';

export const i18n: I18nInstance = i18next.createInstance();

i18n.use(initReactI18next);

if (isBrowser) {
  i18n.use(LanguageDetector);
}

type BakerInitOptions = InitOptions & {
  detection: {
    order: Array<'localStorage' | 'navigator'>;
    lookupLocalStorage: string;
    caches: Array<'localStorage'>;
  };
  react: {
    useSuspense: boolean;
  };
};

const initOptions: BakerInitOptions = {
  debug: false,
  fallbackLng: 'en',
  initAsync: false,
  interpolation: { escapeValue: false },
  load: 'languageOnly',
  resources,
  supportedLngs: Object.keys(resources),
  react: { useSuspense: false },
  detection: {
    order: ['localStorage', 'navigator'],
    lookupLocalStorage: LANGUAGE_STORAGE_KEY,
    caches: ['localStorage'],
  },
};

void i18n.init(initOptions);
