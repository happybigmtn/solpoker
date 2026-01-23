export type PlayerActionLabel = 'fold' | 'check' | 'call' | 'raise' | 'shove';
export type TableActionLabel = 'join' | 'leave';

const numberFormatter = new Intl.NumberFormat('en-US', {
  style: 'decimal',
  maximumFractionDigits: 0,
});

export function formatChips(value?: bigint | number): string {
  if (value === undefined || value === null) return '0';
  const num = typeof value === 'bigint' ? Number(value) : value;
  return numberFormatter.format(num);
}

export function getPlayerActionLabel(action: PlayerActionLabel, amount?: bigint): string {
  switch (action) {
    case 'fold':
      return 'Fold hand';
    case 'check':
      return 'Check';
    case 'call':
      return `Call ${formatChips(amount ?? 0n)} CRISPS`;
    case 'raise':
      return `Raise to ${formatChips(amount ?? 0n)} CRISPS`;
    case 'shove':
      return `All-in: ${formatChips(amount ?? 0n)} CRISPS`;
    default:
      return 'Action';
  }
}

export function getTableActionLabel(action: TableActionLabel, amount?: bigint): string {
  switch (action) {
    case 'join':
      return `Join table with ${formatChips(amount ?? 0n)} CRISPS buy-in`;
    case 'leave':
      return amount ? `Leave table, receive ${formatChips(amount)} CRISPS` : 'Leave table';
    default:
      return 'Table action';
  }
}
