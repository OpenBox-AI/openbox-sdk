import React from 'react';

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
  return h('div', { className: 'flex items-start gap-3' }, [
    h(
      'div',
      {
        key: 'mark',
        className:
          'relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white text-xs font-semibold text-[#1F7FD8] ring-1 ring-[var(--obx-accent,#3B9AF5)]/20',
      },
      busy
        ? '...'
        : logoSrc
          ? h('img', { src: logoSrc, alt: '', className: 'h-8 w-8' })
          : 'OB',
    ),
    h('div', { key: 'copy', className: 'min-w-0 flex-1' }, [
      h(
        'div',
        {
          key: 'brand-row',
          className: 'flex flex-wrap items-center justify-between gap-2',
        },
        [
          h(
            'div',
            {
              key: 'brand',
              className:
                'text-[11px] font-semibold text-[var(--obx-accent,#3B9AF5)]',
            },
            'OpenBox',
          ),
          h(
            'span',
            {
              key: 'badge',
              className: `shrink-0 rounded-full border px-2 py-0.5 text-xs ${badgeClassName}`,
            },
            badge,
          ),
        ],
      ),
      h(
        'h3',
        {
          key: 'title',
          className:
            'mt-1 text-sm font-semibold leading-5 text-[var(--foreground)]',
        },
        title,
      ),
      h(
        'p',
        {
          key: 'reason',
          className: 'mt-1 text-sm leading-5 text-[var(--muted-foreground)]',
        },
        reason,
      ),
    ]),
  ]);
}

const h = React.createElement;
