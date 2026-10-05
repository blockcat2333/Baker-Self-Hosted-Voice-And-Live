import { useEffect, useState } from 'react';
import { i18n } from '@baker/client';
import { hasNewWebBuild, webRefreshUrl } from './web-update';

export function WebUpdateNotice() {
  const [reason, setReason] = useState<'update' | 'load-error' | null>(null);
  const [language, setLanguage] = useState(i18n.resolvedLanguage ?? navigator.language);
  useEffect(() => {
    const changed = () => setLanguage(i18n.resolvedLanguage ?? navigator.language);
    i18n.on('languageChanged', changed);
    return () => { i18n.off('languageChanged', changed); };
  }, []);
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let active = true;
    let checking = false;
    const check = async () => {
      if (checking || document.visibilityState === 'hidden') return;
      checking = true;
      const url = new URL(`${import.meta.env.BASE_URL}web-build.json`, location.origin);
      url.searchParams.set('check', String(Date.now()));
      const changed = await hasNewWebBuild(import.meta.env.BAKER_WEB_BUILD_ID, url.href);
      checking = false;
      if (active && changed) setReason('update');
    };
    const onLoadError = (event: Event) => {
      event.preventDefault();
      setReason('load-error');
    };
    const timer = setInterval(() => { void check(); }, 60000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('vite:preloadError', onLoadError);
    void check();
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('vite:preloadError', onLoadError);
    };
  }, []);

  if (!reason) return null;
  const chinese = language.toLowerCase().startsWith('zh');
  const message = chinese
    ? (reason === 'update' ? '网页已更新。刷新后使用新版；刷新会中断当前语音或直播。' : '网页资源加载失败。请检查网络后刷新；刷新会中断当前语音或直播。')
    : (reason === 'update' ? 'A web update is available. Refreshing ends active voice and streams.' : 'A web resource failed to load. Check your connection and refresh; this ends active voice and streams.');
  return (
    <div role="status" style={{ position: 'fixed', bottom: 16, left: 16, right: 16, zIndex: 10000,
      background: '#292b30', color: '#fff', border: '1px solid #8b7948', borderRadius: 8,
      padding: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <span style={{ flex: 1 }}>{message}</span>
      <button type="button" onClick={() => location.replace(webRefreshUrl(location.href))}>
        {chinese ? '刷新网页' : 'Refresh page'}
      </button>
    </div>
  );
}
