import { generateSigningKeypair } from "../domain/signing.js";

// Prints a fresh Ed25519 keypair. Put the private PEM in LICENSE_SIGNING_KEY on
// the server; ship the public PEM to clients as `publicKeyPem`.
const { privatePem, publicPem } = generateSigningKeypair();
console.log("# LICENSE_SIGNING_KEY (private — server only, keep secret):");
console.log(privatePem);
console.log("# Public key (give to clients as publicKeyPem):");
console.log(publicPem);
