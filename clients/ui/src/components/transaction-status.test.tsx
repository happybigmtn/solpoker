/**
 * Transaction status prompt coverage for wallet UX.
 *
 * AC-UI7.2: Pending prompts include human-readable action labels.
 * AC-UI7.4: Retry CTA is present on retryable failures.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TransactionStatus } from './transaction-status';

describe('TransactionStatus wallet UX', () => {
  it('shows label in pending prompt (AC-UI7.2)', () => {
    render(
      <TransactionStatus
        state="pending"
        label="Join table with 10 CRISPS buy-in"
      />
    );

    expect(screen.getByText('Submitting: Join table with 10 CRISPS buy-in')).toBeInTheDocument();
  });

  it('renders retry CTA for retryable failures (AC-UI7.4)', () => {
    const onRetry = vi.fn();
    render(
      <TransactionStatus
        state="failed"
        error="timeout"
        isRetryable={true}
        onRetry={onRetry}
      />
    );

    const retryButton = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
