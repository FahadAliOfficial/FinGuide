import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MessageContent } from './MessageContent.js';

describe('MessageContent', () => {
  it('renders assistant Markdown with semantic lists and emphasis', () => {
    render(
      <MessageContent
        role="ASSISTANT"
        content={'1. **Compound Interest**: Calculate future value.\n\n2. **Loan Payments**: Calculate monthly payments.'}
      />
    );

    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('list')).toHaveLength(1);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Compound Interest')).toHaveProperty('tagName', 'STRONG');
    expect(screen.getByText('Loan Payments')).toHaveProperty('tagName', 'STRONG');
  });

  it('keeps user content as literal text instead of Markdown', () => {
    render(<MessageContent role="USER" content="**Do not format this**" />);
    expect(screen.getByText('**Do not format this**')).toBeInTheDocument();
    expect(screen.queryByText('Do not format this')).not.toBeInTheDocument();
  });
});
