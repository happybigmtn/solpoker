import { createSolanaRpc } from '@solana/kit';
import { deriveTablePda } from './dist/pda.js';
import { TABLE_SIZE } from './dist/constants.js';

const POKER_PROGRAM_ID = '3oG9MCSnE7UJDQKzEoJdmHrZ3qA7Y5ADdWbYqH1KpxLv';

const rpc = createSolanaRpc('https://api.devnet.solana.com');

async function main() {
  // Fetch table accounts
  const response = await rpc.getProgramAccounts(POKER_PROGRAM_ID, {
    encoding: 'base64',
    filters: [{ dataSize: BigInt(TABLE_SIZE) }]
  }).send();

  console.log('Found', response.length, 'table accounts\n');

  const targetId = 1768850505602n;

  for (const account of response) {
    const address = account.pubkey;
    const data = account.account.data;
    const [base64Data] = data;
    const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

    // tableId is at offset 8, 8 bytes little-endian
    const view = new DataView(bytes.buffer);
    const tableId = view.getBigUint64(8, true);

    if (tableId === targetId) {
      console.log('=== Found table with ID', tableId.toString(), '===');
      console.log('Actual address:', address);

      const [derivedPda] = await deriveTablePda(POKER_PROGRAM_ID, tableId);
      console.log('Derived PDA:', derivedPda);
      console.log('Match:', address === derivedPda);
    }
  }

  // Also show first 3 tables for comparison
  console.log('\n=== First 3 tables for comparison ===');
  for (let i = 0; i < Math.min(3, response.length); i++) {
    const account = response[i];
    const address = account.pubkey;
    const data = account.account.data;
    const [base64Data] = data;
    const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const tableId = view.getBigUint64(8, true);

    const [derivedPda] = await deriveTablePda(POKER_PROGRAM_ID, tableId);
    console.log(`Table #${tableId}: actual=${address}, derived=${derivedPda}, match=${address === derivedPda}`);
  }
}

main().catch(console.error);
