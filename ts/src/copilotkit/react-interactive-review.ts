import React, { useRef, useState } from 'react';
import {
  defaultChoiceOptions,
  verdictStyles,
} from './react-defaults.js';
import { OpenBoxHeader } from './react-renderer-header.js';
import type { OpenBoxInteractiveReviewProps } from './react-renderer-types.js';
import {
  buttonClass,
  rendererStyle,
  resolveTheme,
  useOpenBoxRendererStyles,
} from './react-utils.js';

export function OpenBoxInteractiveReview({
  status,
  respond,
  mode,
  title,
  request,
  action,
  destination,
  fields,
  manualInput,
  sensitivity,
  handoffTemplate,
  template,
  choiceOptions,
  manualTemplates,
  logoSrc,
  theme,
}: OpenBoxInteractiveReviewProps) {
  useOpenBoxRendererStyles();
  const resolvedTheme = resolveTheme(theme, logoSrc);
  const safeMode = mode === 'manual' ? 'manual' : 'choice';
  const options = choiceOptions?.length ? choiceOptions : defaultChoiceOptions;
  const templates = manualTemplates?.length ? manualTemplates : [];
  const safeRequest =
    request?.trim() ||
    (safeMode === 'choice'
      ? 'Prepare a governed external handoff.'
      : 'Draft a governed manual request.');
  const safeAction =
    action ||
    (safeMode === 'choice' ? 'review_data_handoff' : 'submit_manual_request');
  const safeTitle =
    title ||
    (safeMode === 'choice' ? 'OpenBox Input Review' : 'OpenBox Manual Review');
  const initialOption =
    options.find((option) => option.id === handoffTemplate) ??
    options.find((option) =>
      fields?.every((field) => option.fields.includes(field)),
    ) ??
    options[0];
  const initialTemplate =
    templates.find(
      (item) => item.id === template || item.sensitivity === sensitivity,
    ) ?? templates[0];
  const [selectedOptionId, setSelectedOptionId] = useState(initialOption.id);
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    initialTemplate?.id ?? '',
  );
  const [text, setText] = useState(
    manualInput?.trim() || initialTemplate?.draft || '',
  );
  const [submitted, setSubmitted] = useState(false);
  const respondedRef = useRef(false);
  const selectedOption =
    options.find((option) => option.id === selectedOptionId) ?? initialOption;
  const selectedTemplate =
    templates.find((item) => item.id === selectedTemplateId) ?? initialTemplate;

  const submit = () => {
    if (!respond || submitted || respondedRef.current) return;
    const payload =
      safeMode === 'choice'
        ? {
            action: safeAction,
            request: safeRequest,
            destination: selectedOption.destination,
            fields: selectedOption.fields,
            audience: selectedOption.audience,
            sensitivity: selectedOption.sensitivity,
            handoffTemplate: selectedOption.id,
            nextTool: 'openbox_governed_action',
            mustCallOpenBoxGovernedAction: true,
            submittedAt: new Date().toISOString(),
          }
        : {
            action: safeAction,
            request: safeRequest,
            destination: selectedTemplate?.destination ?? destination,
            manualInput: text,
            sensitivity: selectedTemplate?.sensitivity ?? sensitivity,
            ...(selectedTemplate?.id ? { template: selectedTemplate.id } : {}),
            nextTool: 'openbox_governed_action',
            mustCallOpenBoxGovernedAction: true,
            submittedAt: new Date().toISOString(),
          };
    setSubmitted(true);
    respondedRef.current = true;
    void respond(JSON.stringify(payload));
  };

  if (submitted) {
    return h(
      'section',
      {
        className:
          'my-3 w-full max-w-xl overflow-hidden rounded-lg border border-[var(--obx-accent,#3B9AF5)]/20 bg-[var(--background)] shadow-sm',
        style: rendererStyle(resolvedTheme),
      },
      [
        h('div', { key: 'head', className: 'p-4' }, [
          h(OpenBoxHeader, {
            key: 'header',
            logoSrc: resolvedTheme.logoSrc,
            title: 'Input Sent For Governance',
            badge: 'Submitted',
            badgeClassName: verdictStyles.allow.badge,
            reason:
              'CopilotKit captured the final input. OpenBox will evaluate it before the action executes.',
          }),
        ]),
      ],
    );
  }

  return h(
    'section',
    {
      className:
        'my-3 w-full max-w-xl overflow-hidden rounded-lg border border-[var(--obx-accent,#3B9AF5)]/20 bg-[var(--background)] shadow-sm',
      style: rendererStyle(resolvedTheme),
    },
    [
      h('div', { key: 'head', className: 'p-4 pb-3' }, [
        h(OpenBoxHeader, {
          key: 'header',
          logoSrc: resolvedTheme.logoSrc,
          title: safeTitle,
          badge: safeMode === 'choice' ? 'Choices' : 'Manual Input',
          badgeClassName:
            safeMode === 'choice'
              ? verdictStyles.reviewing.badge
              : verdictStyles.allow.badge,
          reason:
            safeMode === 'choice'
              ? 'Choose the input package. OpenBox evaluates the final selection.'
              : 'Edit the draft. OpenBox evaluates the final submission.',
          busy: status === 'inProgress',
        }),
      ]),
      h('div', { key: 'body', className: 'space-y-3 px-4 pb-4 pt-0' }, [
        h(
          'div',
          {
            key: 'request',
            className:
              'rounded-md border border-[var(--border)] bg-[var(--secondary)] px-3 py-2.5',
          },
          [
            h(
              'div',
              {
                key: 'label',
                className:
                  'text-[11px] font-semibold uppercase text-[var(--muted-foreground)]',
              },
              'Request',
            ),
            h(
              'p',
              {
                key: 'text',
                className: 'mt-1 text-sm leading-5 text-[var(--foreground)]',
              },
              safeRequest,
            ),
          ],
        ),
        safeMode === 'choice'
          ? h(
              'div',
              { key: 'choices', className: 'grid gap-2' },
              options.map((option) =>
                h(
                  'button',
                  {
                    key: option.id,
                    type: 'button',
                    className:
                      option.id === selectedOptionId
                        ? 'w-full rounded-md border border-[var(--obx-accent,#3B9AF5)]/45 bg-[var(--obx-accent,#3B9AF5)]/8 px-3 py-3 text-left'
                        : 'w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-3 text-left hover:border-[var(--obx-accent,#3B9AF5)]/30',
                    onClick: () => setSelectedOptionId(option.id),
                  },
                  [
                    h(
                      'div',
                      {
                        key: 'row',
                        className: 'flex items-center justify-between gap-2',
                      },
                      [
                        h(
                          'div',
                          {
                            key: 'title',
                            className:
                              'text-sm font-medium text-[var(--foreground)]',
                          },
                          option.title,
                        ),
                        h(
                          'span',
                          {
                            key: 'badge',
                            className:
                              'shrink-0 rounded-full border border-[var(--obx-accent,#3B9AF5)]/25 px-2 py-0.5 text-[10px] text-[#1F7FD8]',
                          },
                          option.sensitivity || 'review',
                        ),
                      ],
                    ),
                    h(
                      'p',
                      {
                        key: 'desc',
                        className:
                          'mt-1 text-xs leading-5 text-[var(--muted-foreground)]',
                      },
                      option.description,
                    ),
                    h(
                      'div',
                      {
                        key: 'fields',
                        className: 'mt-2 flex flex-wrap gap-1.5',
                      },
                      option.fields.map((field) =>
                        h(
                          'span',
                          {
                            key: field,
                            className:
                              'rounded-sm bg-[var(--secondary)] px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)]',
                          },
                          field.replace(/_/g, ' '),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            )
          : h('div', { key: 'manual', className: 'grid gap-3' }, [
              templates.length > 0
                ? h(
                    'div',
                    { key: 'templates', className: 'grid gap-2' },
                    templates.map((item) =>
                      h(
                        'button',
                        {
                          key: item.id,
                          type: 'button',
                          className:
                            item.id === selectedTemplateId
                              ? 'w-full rounded-md border border-[var(--obx-accent,#3B9AF5)]/45 bg-[var(--obx-accent,#3B9AF5)]/8 px-3 py-3 text-left'
                              : 'w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-3 text-left hover:border-[var(--obx-accent,#3B9AF5)]/30',
                          onClick: () => {
                            setSelectedTemplateId(item.id);
                            setText(item.draft);
                          },
                        },
                        [
                          h(
                            'div',
                            {
                              key: 'row',
                              className: 'flex items-center justify-between gap-2',
                            },
                            [
                              h(
                                'div',
                                {
                                  key: 'title',
                                  className:
                                    'text-sm font-medium text-[var(--foreground)]',
                                },
                                item.title,
                              ),
                              h(
                                'span',
                                {
                                  key: 'badge',
                                  className:
                                    'shrink-0 rounded-full border border-[var(--obx-accent,#3B9AF5)]/25 px-2 py-0.5 text-[10px] text-[#1F7FD8]',
                                },
                                item.label || item.sensitivity || 'option',
                              ),
                            ],
                          ),
                          h(
                            'p',
                            {
                              key: 'desc',
                              className:
                                'mt-1 text-xs leading-5 text-[var(--muted-foreground)]',
                            },
                            item.description,
                          ),
                        ],
                      ),
                    ),
                  )
                : null,
              h('textarea', {
                key: 'textarea',
                className:
                  'min-h-28 w-full resize-none rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--obx-accent,#3B9AF5)]',
                placeholder: 'Enter the final text for OpenBox review.',
                value: text,
                onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setText(event.target.value),
              }),
            ]),
      ]),
      h(
        'div',
        {
          key: 'footer',
          className: 'border-t border-[var(--border)] px-4 py-3',
        },
        [
          h(
            'button',
            {
              key: 'submit',
              type: 'button',
              className: buttonClass('primary'),
              disabled: !respond || submitted,
              onClick: submit,
            },
            'Submit for Review',
          ),
        ],
      ),
    ],
  );
}

const h = React.createElement;
