/**
 * Tests for error decoding utilities.
 *
 * AC-CI4.1: Program error codes decoded to messages.
 * AC-CI4.2: Program errors decoded from transaction logs.
 * AC-CI4.3: Network errors trigger retry UI.
 * AC-CI4.4: Simulation errors surfaced.
 */

import { describe, it, expect } from 'vitest';
import {
  POKER_ERROR_CODES,
  ENTROPY_ERROR_CODES,
  POKER_ERROR_MESSAGES,
  ENTROPY_ERROR_MESSAGES,
  parseCustomErrorCode,
  isProgramInvoked,
  decodeProgramError,
  isNetworkError,
  isSimulationError,
  isUserRejection,
  formatTransactionError,
} from './errors.js';

describe('error code constants', () => {
  it('poker error codes match Rust enum values', () => {
    // Verify key error codes match robopoker-poker/src/error.rs
    expect(POKER_ERROR_CODES.InvalidInstruction).toBe(0);
    expect(POKER_ERROR_CODES.TableFull).toBe(6);
    expect(POKER_ERROR_CODES.NotYourTurn).toBe(20);
    expect(POKER_ERROR_CODES.RaiseTooSmall).toBe(24);
    expect(POKER_ERROR_CODES.AccountNotWritable).toBe(45);
  });

  it('entropy error codes match Rust enum values', () => {
    // Verify key error codes match robopoker-entropy/src/error.rs
    expect(ENTROPY_ERROR_CODES.InvalidInstruction).toBe(0);
    expect(ENTROPY_ERROR_CODES.ProviderMismatch).toBe(3);
    expect(ENTROPY_ERROR_CODES.RevealWindowExpired).toBe(6);
    expect(ENTROPY_ERROR_CODES.AccountNotWritable).toBe(17);
  });

  it('all poker error codes have user-friendly messages', () => {
    for (const [name, code] of Object.entries(POKER_ERROR_CODES)) {
      expect(POKER_ERROR_MESSAGES[code], `Missing message for ${name}`).toBeDefined();
    }
  });

  it('all entropy error codes have user-friendly messages', () => {
    for (const [name, code] of Object.entries(ENTROPY_ERROR_CODES)) {
      expect(ENTROPY_ERROR_MESSAGES[code], `Missing message for ${name}`).toBeDefined();
    }
  });
});

describe('parseCustomErrorCode', () => {
  it('parses hex format: "custom program error: 0x15"', () => {
    expect(parseCustomErrorCode('custom program error: 0x15')).toBe(21);
    expect(parseCustomErrorCode('custom program error: 0x0')).toBe(0);
    expect(parseCustomErrorCode('custom program error: 0x2d')).toBe(45);
  });

  it('parses decimal Custom() format', () => {
    expect(parseCustomErrorCode('Custom(21)')).toBe(21);
    expect(parseCustomErrorCode('Custom(0)')).toBe(0);
    expect(parseCustomErrorCode('Custom( 45 )')).toBe(45);
  });

  it('parses "Error Code:" format', () => {
    expect(parseCustomErrorCode('Error Code: 21')).toBe(21);
    expect(parseCustomErrorCode('Error Code:0')).toBe(0);
  });

  it('returns undefined for non-matching strings', () => {
    expect(parseCustomErrorCode('some random error')).toBeUndefined();
    expect(parseCustomErrorCode('insufficient funds')).toBeUndefined();
  });

  it('is case insensitive', () => {
    expect(parseCustomErrorCode('CUSTOM PROGRAM ERROR: 0X15')).toBe(21);
    expect(parseCustomErrorCode('CUSTOM(21)')).toBe(21);
  });
});

describe('isProgramInvoked', () => {
  it('returns true when program invoke is in logs', () => {
    const logs = [
      'Program 11111111111111111111111111111111 invoke [1]',
      'Program PokerProg111111111111111111111111111 invoke [2]',
      'Program PokerProg111111111111111111111111111 success',
    ];
    expect(isProgramInvoked(logs, 'PokerProg111111111111111111111111111')).toBe(true);
  });

  it('returns false when program is not invoked', () => {
    const logs = [
      'Program 11111111111111111111111111111111 invoke [1]',
      'Program 11111111111111111111111111111111 success',
    ];
    expect(isProgramInvoked(logs, 'PokerProg111111111111111111111111111')).toBe(false);
  });

  it('returns false for empty logs', () => {
    expect(isProgramInvoked([], 'PokerProg111111111111111111111111111')).toBe(false);
  });
});

describe('decodeProgramError', () => {
  it('decodes poker error with known code', () => {
    const error = new Error('Transaction failed: custom program error: 0x14');
    const result = decodeProgramError(error);

    expect(result).toBeDefined();
    expect(result!.code).toBe(20); // NotYourTurn
    expect(result!.message).toBe("It's not your turn to act.");
    expect(result!.program).toBe('poker');
  });

  it('decodes entropy error with known code when program is identified', () => {
    const error = 'Transaction failed: Custom(6)';
    const logs = ['Program EntropyProg invoke [1]'];
    const result = decodeProgramError(error, logs, 'PokerProg', 'EntropyProg');

    expect(result).toBeDefined();
    expect(result!.code).toBe(6); // RevealWindowExpired
    expect(result!.message).toBe('Entropy reveal window expired.');
    expect(result!.program).toBe('entropy');
  });

  it('uses logs to determine program attribution', () => {
    const error = new Error('custom program error: 0x3');
    const logs = [
      'Program PokerProg invoke [1]',
      'Program log: Error',
    ];
    const result = decodeProgramError(error, logs, 'PokerProg', 'EntropyProg');

    expect(result!.program).toBe('poker');
    expect(result!.message).toBe('Missing signature. Please approve the transaction in your wallet.');
  });

  it('extracts error code from logs if not in message', () => {
    const error = new Error('Transaction simulation failed');
    const logs = [
      'Program log: custom program error: 0x6',
    ];
    const result = decodeProgramError(error, logs);

    expect(result).toBeDefined();
    expect(result!.code).toBe(6);
  });

  it('returns undefined for non-program errors', () => {
    const error = new Error('Network timeout');
    const result = decodeProgramError(error);

    expect(result).toBeUndefined();
  });

  it('handles unknown error codes gracefully', () => {
    const error = new Error('custom program error: 0xFF');
    const result = decodeProgramError(error);

    expect(result).toBeDefined();
    expect(result!.code).toBe(255);
    expect(result!.message).toContain('error 255');
  });
});

describe('isNetworkError', () => {
  it('identifies network-related errors', () => {
    expect(isNetworkError('Network request failed')).toBe(true);
    expect(isNetworkError('Connection timeout')).toBe(true);
    expect(isNetworkError('ECONNREFUSED')).toBe(true);
    expect(isNetworkError('fetch failed')).toBe(true);
    expect(isNetworkError('socket error')).toBe(true);
    expect(isNetworkError('503 Service Unavailable')).toBe(true);
    expect(isNetworkError('Bad Gateway 502')).toBe(true);
  });

  it('does not identify non-network errors', () => {
    expect(isNetworkError('Insufficient funds')).toBe(false);
    expect(isNetworkError('User rejected')).toBe(false);
    expect(isNetworkError('custom program error: 0x14')).toBe(false);
  });

  it('handles Error objects', () => {
    expect(isNetworkError(new Error('Connection refused'))).toBe(true);
    expect(isNetworkError(new Error('Invalid signature'))).toBe(false);
  });
});

describe('isSimulationError', () => {
  it('identifies simulation errors', () => {
    expect(isSimulationError('Transaction simulation failed')).toBe(true);
    expect(isSimulationError('Preflight check failed')).toBe(true);
    expect(isSimulationError('simulate transaction error')).toBe(true);
  });

  it('does not identify non-simulation errors', () => {
    expect(isSimulationError('Transaction failed')).toBe(false);
    expect(isSimulationError('Network error')).toBe(false);
  });
});

describe('isUserRejection', () => {
  it('identifies user rejection errors', () => {
    expect(isUserRejection('User rejected the request')).toBe(true);
    expect(isUserRejection('Transaction was cancelled by user')).toBe(true);
    expect(isUserRejection('User denied transaction')).toBe(true);
  });

  it('does not identify non-rejection errors', () => {
    expect(isUserRejection('Transaction failed')).toBe(false);
    expect(isUserRejection('Network error')).toBe(false);
  });
});

describe('formatTransactionError (AC-CI4.1, AC-PQ.CI2)', () => {
  it('formats user rejection with friendly message', () => {
    const message = formatTransactionError('User rejected the request');
    expect(message).toBe('You cancelled the transaction. Please approve it in your wallet to continue.');
  });

  it('formats network error with retry suggestion', () => {
    const message = formatTransactionError('Connection timeout');
    expect(message).toBe('Network error. Please check your connection and try again.');
  });

  it('formats simulation error with guidance', () => {
    const message = formatTransactionError('Transaction simulation failed');
    expect(message).toBe('Transaction simulation failed. Please check your balance and try again.');
  });

  it('decodes and formats program errors', () => {
    const message = formatTransactionError('custom program error: 0x14');
    expect(message).toBe("It's not your turn to act.");
  });

  it('formats insufficient funds error', () => {
    const message = formatTransactionError('Insufficient funds for transaction');
    expect(message).toContain("don't have enough SOL");
  });

  it('formats blockhash expired error', () => {
    const message = formatTransactionError('Blockhash not found');
    expect(message).toBe('The transaction expired. Please try again.');
  });

  it('returns generic message for unknown errors', () => {
    const message = formatTransactionError('Something completely unexpected');
    expect(message).toBe('Transaction failed. Please try again.');
  });

  it('all messages suggest a next action (AC-PQ.CI2)', () => {
    // Test common error types that have explicit action suggestions
    const errors = [
      'User rejected',
      'Connection timeout',
      'Insufficient funds',
      'Blockhash not found',
      'random error',
    ];

    for (const error of errors) {
      const message = formatTransactionError(error);
      // Messages should suggest action: contain words like "please", "try", "check", "add", "approve"
      const hasActionWord = /please|try|check|add|approve|connect|refresh/i.test(message);
      expect(hasActionWord, `Message "${message}" should suggest a next action`).toBe(true);
    }
  });
});

describe('message quality (AC-PQ.CI2)', () => {
  it('poker error messages are user-friendly and actionable', () => {
    // Check a sample of important poker errors
    expect(POKER_ERROR_MESSAGES[POKER_ERROR_CODES.NotYourTurn]).toBe("It's not your turn to act.");
    expect(POKER_ERROR_MESSAGES[POKER_ERROR_CODES.TableFull]).toContain('full');
    expect(POKER_ERROR_MESSAGES[POKER_ERROR_CODES.InsufficientBalance]).toContain('Add more');
    expect(POKER_ERROR_MESSAGES[POKER_ERROR_CODES.CannotCheckWhenBet]).toContain('call, raise, or fold');
  });

  it('error messages do not expose internal details', () => {
    // Messages should not contain technical jargon
    for (const message of Object.values(POKER_ERROR_MESSAGES)) {
      expect(message.toLowerCase()).not.toContain('panic');
      expect(message.toLowerCase()).not.toContain('unwrap');
      expect(message.toLowerCase()).not.toContain('borsh');
      expect(message.toLowerCase()).not.toContain('stack trace');
    }
  });
});
