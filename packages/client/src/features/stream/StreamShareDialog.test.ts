import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import '../../i18n';
import { useGatewayStore } from '../gateway/gateway-store';
import { StreamShareDialog } from './StreamShareDialog';
import { useStreamStore } from './stream-store';

const channelId = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
  useGatewayStore.setState({ status: 'disconnected' });
  useStreamStore.getState().reset();
});

describe('StreamShareDialog', () => {
  it('stays mounted whenever the explicit open state is true without depending on voice state', () => {
    useGatewayStore.setState({ status: 'ready' });

    const markup = renderToStaticMarkup(createElement(StreamShareDialog, {
      channelId,
      isOpen: true,
      onClose: () => {},
    }));

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('stream-share-dialog-title');
    expect(markup).toContain('stream-action-btn--primary');
  });

  it('renders nothing only when explicitly closed and shows a reason when the gateway is unavailable', () => {
    useGatewayStore.setState({ status: 'disconnected' });

    expect(renderToStaticMarkup(createElement(StreamShareDialog, {
      channelId,
      isOpen: false,
      onClose: () => {},
    }))).toBe('');

    const openMarkup = renderToStaticMarkup(createElement(StreamShareDialog, {
      channelId,
      isOpen: true,
      onClose: () => {},
    }));
    expect(openMarkup).toContain('role="alert"');
    expect(openMarkup).toContain('disabled=""');
  });
});
