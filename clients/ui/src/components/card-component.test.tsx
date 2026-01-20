/**
 * Tests for Card React component rendering.
 *
 * AC-CI6.1: Cards render with correct suit and rank based on card index.
 * AC-CI6.2: Unrevealed cards display a card back.
 * AC-PQ.CI3: Card rendering is visually clean and suit colors are distinct.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardSlot, getCardDisplay } from './card';

describe('Card component (AC-CI6.1, AC-CI6.2, AC-PQ.CI3)', () => {
  describe('AC-CI6.1: renders correct suit and rank', () => {
    it('renders Ace of Spades for index 51', () => {
      render(<Card index={51} />);

      expect(screen.getByText('A')).toBeInTheDocument();
      expect(screen.getByText('♠')).toBeInTheDocument();
      expect(screen.getByLabelText('A of ♠')).toBeInTheDocument();
    });

    it('renders 2 of Clubs for index 0', () => {
      render(<Card index={0} />);

      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('♣')).toBeInTheDocument();
      expect(screen.getByLabelText('2 of ♣')).toBeInTheDocument();
    });

    it('renders Ten of Diamonds for index 33', () => {
      render(<Card index={33} />);

      expect(screen.getByText('T')).toBeInTheDocument();
      expect(screen.getByText('♦')).toBeInTheDocument();
    });

    it('renders King of Hearts for index 46', () => {
      render(<Card index={46} />);

      expect(screen.getByText('K')).toBeInTheDocument();
      expect(screen.getByText('♥')).toBeInTheDocument();
    });
  });

  describe('AC-CI6.2: unrevealed cards display card back', () => {
    it('shows card back when faceDown is true', () => {
      render(<Card index={51} faceDown />);

      expect(screen.getByLabelText('Face-down card')).toBeInTheDocument();
      // Should NOT show the rank/suit
      expect(screen.queryByText('A')).not.toBeInTheDocument();
      expect(screen.queryByText('♠')).not.toBeInTheDocument();
    });

    it('shows card back when index is null', () => {
      render(<Card index={null} />);

      expect(screen.getByLabelText('Face-down card')).toBeInTheDocument();
    });

    it('shows card back when index is undefined', () => {
      render(<Card />);

      expect(screen.getByLabelText('Face-down card')).toBeInTheDocument();
    });

    it('shows card back for invalid index < 0', () => {
      render(<Card index={-1} />);

      expect(screen.getByLabelText('Face-down card')).toBeInTheDocument();
    });

    it('shows card back for invalid index > 51', () => {
      render(<Card index={52} />);

      expect(screen.getByLabelText('Face-down card')).toBeInTheDocument();
    });
  });

  describe('AC-PQ.CI3: suit colors are distinct', () => {
    it('renders red color for Diamonds', () => {
      const { container } = render(<Card index={1} />); // 2♦

      // Card should have red text
      const card = container.firstChild as HTMLElement;
      expect(card.className).toContain('text-red');
    });

    it('renders red color for Hearts', () => {
      const { container } = render(<Card index={2} />); // 2♥

      const card = container.firstChild as HTMLElement;
      expect(card.className).toContain('text-red');
    });

    it('renders black color for Clubs', () => {
      const { container } = render(<Card index={0} />); // 2♣

      const card = container.firstChild as HTMLElement;
      expect(card.className).toContain('text-zinc');
    });

    it('renders black color for Spades', () => {
      const { container } = render(<Card index={3} />); // 2♠

      const card = container.firstChild as HTMLElement;
      expect(card.className).toContain('text-zinc');
    });
  });

  describe('size variants', () => {
    it('renders small size card', () => {
      const { container } = render(<Card index={0} size="sm" />);

      const card = container.firstChild as HTMLElement;
      expect(card.className).toContain('h-10');
      expect(card.className).toContain('w-7');
    });

    it('renders medium size card (default)', () => {
      const { container } = render(<Card index={0} />);

      const card = container.firstChild as HTMLElement;
      expect(card.className).toContain('h-14');
      expect(card.className).toContain('w-10');
    });

    it('renders large size card', () => {
      const { container } = render(<Card index={0} size="lg" />);

      const card = container.firstChild as HTMLElement;
      expect(card.className).toContain('h-20');
      expect(card.className).toContain('w-14');
    });
  });

  describe('CardSlot component', () => {
    it('renders empty card slot', () => {
      render(<CardSlot />);

      expect(screen.getByLabelText('Empty card slot')).toBeInTheDocument();
    });

    it('renders empty slot with size variants', () => {
      const { container } = render(<CardSlot size="lg" />);

      const slot = container.firstChild as HTMLElement;
      expect(slot.className).toContain('h-20');
      expect(slot.className).toContain('w-14');
    });
  });
});
