import { createKeyPairSignerFromBytes, address, createSolanaRpc, createTransactionMessage, pipe, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstruction, signTransactionMessageWithSigners, getBase64EncodedWireTransaction, getProgramDerivedAddress } from '@solana/kit';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const POKER_PROGRAM_ID = address('CNLMFh8DNRLyrx5x1ecrspTHpa3nTzMaophZxxUjgKMi');
const CRISPS_MINT = address('7HK33BUJivS2nSsJjZwgpBDQRrSY59WeCYmSQQtJqW3B');
const TOKEN_2022_PROGRAM_ID = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const SYSTEM_PROGRAM_ID = address('11111111111111111111111111111111');

async function deriveTablePda(programId, tableId) {
  const idBytes = new ArrayBuffer(8);
  new DataView(idBytes).setBigUint64(0, tableId, true);
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode('table'), new Uint8Array(idBytes)],
  });
}

async function deriveVaultPda(programId, tableId) {
  const idBytes = new ArrayBuffer(8);
  new DataView(idBytes).setBigUint64(0, tableId, true);
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode('vault'), new Uint8Array(idBytes)],
  });
}

function buildCreateTableData(args) {
  const data = new Uint8Array(32);
  const view = new DataView(data.buffer);
  data[0] = 1; // CREATE_TABLE discriminator
  view.setBigUint64(8, args.tableId, true);
  view.setBigUint64(16, args.smallBlind, true);
  view.setBigUint64(24, args.bigBlind, true);
  return data;
}

async function main() {
  const keypairPath = join(homedir(), '.config', 'solana', 'id.json');
  const secretKey = JSON.parse(readFileSync(keypairPath, 'utf-8'));
  const signer = await createKeyPairSignerFromBytes(new Uint8Array(secretKey));
  console.log('Signer:', signer.address);
  
  const rpc = createSolanaRpc('https://api.devnet.solana.com');
  
  const tableId = BigInt(Date.now());
  console.log('Table ID:', tableId.toString());
  
  const [tableAddress] = await deriveTablePda(POKER_PROGRAM_ID, tableId);
  const [vaultAddress] = await deriveVaultPda(POKER_PROGRAM_ID, tableId);
  const [configAddress] = await getProgramDerivedAddress({
    programAddress: POKER_PROGRAM_ID,
    seeds: [new TextEncoder().encode('config')],
  });
  
  console.log('Table PDA:', tableAddress);
  console.log('Vault PDA:', vaultAddress);
  console.log('Config PDA:', configAddress);
  
  const data = buildCreateTableData({
    tableId,
    smallBlind: BigInt(1_000_000_000),
    bigBlind: BigInt(2_000_000_000),
  });
  
  const accounts = [
    { address: tableAddress, role: 1 },      // writable
    { address: vaultAddress, role: 1 },      // writable
    { address: signer.address, role: 3 },    // writable_signer
    { address: configAddress, role: 0 },     // readonly
    { address: CRISPS_MINT, role: 0 },       // readonly
    { address: TOKEN_2022_PROGRAM_ID, role: 0 },
    { address: SYSTEM_PROGRAM_ID, role: 0 },
  ];
  
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstruction({
      programAddress: POKER_PROGRAM_ID,
      accounts,
      data,
    }, m)
  );
  
  const signedTx = await signTransactionMessageWithSigners(message);
  const encodedTx = getBase64EncodedWireTransaction(signedTx);
  
  console.log('Sending transaction...');
  try {
    const sig = await rpc.sendTransaction(encodedTx, { encoding: 'base64', skipPreflight: false }).send();
    console.log('Signature:', sig);
    
    await new Promise(r => setTimeout(r, 5000));
    const status = await rpc.getSignatureStatuses([sig]).send();
    console.log('Status:', JSON.stringify(status.value[0], null, 2));
    console.log('Table created successfully at:', tableAddress);
  } catch (err) {
    console.error('Error:', err.message);
    if (err.context?.logs) {
      console.log('Logs:', err.context.logs.join('\n'));
    }
  }
}

main();
