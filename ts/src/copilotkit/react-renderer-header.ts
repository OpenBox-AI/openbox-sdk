import React, { useEffect, useState } from 'react';

export function OpenBoxHeader({
  title,
  badge,
  badgeClassName,
  reason,
  busy,
  logoSrc,
}: {
  title: string;
  badge: string;
  badgeClassName: string;
  reason: string;
  busy?: boolean;
  logoSrc?: string;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => {
    setLogoFailed(false);
  }, [logoSrc]);
  const showLogo = Boolean(logoSrc && !logoFailed);

  return h('div', { className: 'obx-renderer-header' }, [
    h(
      'div',
      {
        key: 'mark',
        className: showLogo
          ? 'obx-renderer-mark obx-renderer-mark--image'
          : 'obx-renderer-mark obx-renderer-mark--text',
      },
      showLogo
        ? h('img', {
            src: logoSrc,
            alt: '',
            onError: () => setLogoFailed(true),
          })
        : busy
          ? '...'
          : 'OB',
    ),
    h('div', { key: 'copy', className: 'min-w-0 flex-1' }, [
      h(
        'div',
        {
          key: 'brand-row',
          className: 'obx-renderer-brand-row',
        },
        [
          h(
            'div',
            {
              key: 'brand',
              className: 'obx-renderer-brand',
            },
            'OpenBox',
          ),
          h(
            'span',
            {
              key: 'badge',
              className: `obx-renderer-badge ${badgeClassName}`,
            },
            badge,
          ),
        ],
      ),
      h(
        'h3',
        {
          key: 'title',
          className: 'obx-renderer-title',
        },
        title,
      ),
      h(
        'p',
        {
          key: 'reason',
          className: 'obx-renderer-reason',
        },
        reason,
      ),
    ]),
  ]);
}

const h = React.createElement;
