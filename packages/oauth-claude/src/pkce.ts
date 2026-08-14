import { createHash, randomBytes } from 'node:crypto'

export function createPkcePair(): { verifier: string; challenge: string; state: string } {
  const verifier = base64Url(randomBytes(32))
  const challenge = base64Url(createHash('sha256').update(verifier).digest())
  const state = base64Url(randomBytes(16))
  return { verifier, challenge, state }
}

function base64Url(value: Buffer | string): string {
  const buffer = typeof value === 'string' ? Buffer.from(value) : value
  return buffer.toString('base64url')
}
