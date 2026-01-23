/**
 * Tests for Card React component rendering.
 *
 * AC-UI2.1: Cards support face-up/face-down/revealed/folded/winning states.
 * AC-UI2.2: Cards render with correct suit and rank based on card index.
 * AC-UI2.3: Card back pattern avoids moire and remains legible at small sizes.
 * AC-UI2.4: Suits are distinguishable without color using labels/symbols.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardSlot, getCardDisplay } from './card';

describe('Card component (AC-UI2.1 to AC-UI2.4)', () => {
  describe('AC-UI2.2: renders correct suit and rank', () => {
    it('renders Ace of Spades for index 51', () => {
      render(<Card index={51} />);

      expect(screen.getByText('A')).toBeInTheDocument();
      expect(screen.getByText('♠')).toBeInTheDocument();
      expect(screen.getByLabelText('Ace of Spades')).toBeInTheDocument();
    });

    it('renders 2 of Clubs for index 0', () => {
      render(<Card index={0} />);

      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('♣')).toBeInTheDocument();
      expect(screen.getByLabelText('Two of Clubs')).toBeInTheDocument();
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

  describe('AC-UI2.1: card back states', () => {
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

    it('shows folded card state with folded label', () => {
      render(<Card index={12} state="folded" />);

      const foldedCard = screen.getByLabelText('Folded card');
      expect(foldedCard).toBeInTheDocument();
      expect(foldedCard).toHaveAttribute('data-state', 'folded');
    });

    it('uses patterned back with repeating gradient', () => {
      const { container } = render(<Card faceDown />);
      const back = container.querySelector('.card-back');
      expect(back).toBeTruthy();
      expect(back?.getAttribute('style') ?? '').toContain('repeating-linear-gradient');
    });
  });

  describe('AC-UI2.4: suit distinctions', () => {
    it('renders red color for Diamonds', () => {
      const { container } = render(<Card index={1} />); // 2♦

      // Card should have red text
      const card = container.firstChild as HTMLElement;
      expect(card.className).toContain('accent-crimson');
    });

    it('renders red color for Hearts', () => {
      const { container } = render(<Card index={2} />); // 2♥

      const card = container.firstChild as HTMLElement;
      expect(card.className).toContain('accent-crimson');
    });

    it('renders black color for Clubs', () => {
      const { container } = render(<Card index={0} />); // 2♣

      const card = container.firstChild as HTMLElement;
      expect(card.className).toContain('accent-ink');
    });

    it('renders black color for Spades', () => {
      const { container } = render(<Card index={3} />); // 2♠

      const card = container.firstChild as HTMLElement;
      expect(card.className).toContain('accent-ink');
    });

    it('adds descriptive aria-label with suit name', () => {
      render(<Card index={3} />);
      expect(screen.getByLabelText('Two of Spades')).toBeInTheDocument();
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

  describe('AC-UI2.1: winning state', () => {
    it('marks card as winning with data-state', () => {
      render(<Card index={8} state="winning" />);
      const card = screen.getByLabelText('Four of Clubs');
      expect(card).toHaveAttribute('data-state', 'winning');
    });

    it('applies flip animation class for revealed state', () => {
      render(<Card index={8} state="revealed" />);
      const card = screen.getByLabelText('Four of Clubs');
      expect(card.className).toContain('card-flip');
    });
  });
});
