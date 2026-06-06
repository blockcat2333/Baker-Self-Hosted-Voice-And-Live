import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import '../../i18n';
import { useGatewayStore } from '../gateway/gateway-store';
import { useMusicStore } from '../music/music-store';
import { PresenceBar } from './PresenceBar';
import { SidebarMusicError } from './SidebarMusicError';
import {
  clearSidebarMusicError,
  scheduleSidebarMusicErrorClear,
} from './sidebar-music-error-utils';

describe('SidebarMusicError', () => {
  beforeEach(() => {
    useMusicStore.setState({ error: null });
    useGatewayStore.setState({
      presenceMap: {
        'online-user': {
          connectionCount: 1,
          status: 'online',
          username: 'saygoodbye233',
        },
      },
    });
  });

  afterEach(() => {
    useMusicStore.setState({ error: null });
    useGatewayStore.setState({ presenceMap: {} });
  });

  it('renders the music error above the online presence section', () => {
    useMusicStore.setState({ error: 'Music capture failed.' });

    const markup = renderToStaticMarkup(
      createElement(
        'div',
        null,
        createElement(SidebarMusicError),
        createElement(PresenceBar),
      ),
    );

    expect(markup).toContain('Music capture failed.');
    expect(markup.indexOf('Music capture failed.')).toBeLessThan(markup.indexOf('saygoodbye233'));
  });

  it('clears the current music error when dismissed', () => {
    useMusicStore.setState({ error: 'Failed to start music share.' });

    clearSidebarMusicError('Failed to start music share.');

    expect(useMusicStore.getState().error).toBeNull();
  });

  it('auto-clears only the unchanged current music error', () => {
    useMusicStore.setState({ error: 'First music error.' });
    const scheduledHandlers: Array<() => void> = [];

    scheduleSidebarMusicErrorClear('First music error.', (handler) => {
      if (typeof handler === 'function') {
        scheduledHandlers.push(handler as () => void);
      }
      return 1;
    });
    useMusicStore.setState({ error: 'Second music error.' });
    scheduledHandlers[0]?.();

    expect(useMusicStore.getState().error).toBe('Second music error.');
  });
});
