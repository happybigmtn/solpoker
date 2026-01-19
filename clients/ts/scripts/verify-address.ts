import { getBase58Decoder } from "@solana/kit";

// From pinocchio
const pinocchioBytes = new Uint8Array([
    6, 167, 213, 23, 25, 47, 10, 175, 198, 242, 101, 227, 251, 119, 204, 122, 218, 130, 197, 41,
    208, 190, 59, 19, 110, 45, 0, 85, 32, 0, 0, 0,
]);

const decoder = getBase58Decoder();
const pinocchioAddress = decoder.decode(pinocchioBytes);
console.log("Pinocchio SLOTHASHES_ID:", pinocchioAddress);
console.log("Expected:", "SysvarS1otHashes111111111111111111111111111");
console.log("Match:", pinocchioAddress === "SysvarS1otHashes111111111111111111111111111");
