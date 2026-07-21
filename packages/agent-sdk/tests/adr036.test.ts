import { makeSignDoc, rawSecp256k1PubkeyToRawAddress, serializeSignDoc } from '@cosmjs/amino'
import { Secp256k1, sha256 } from '@cosmjs/crypto'
import { toBase64, toBech32, toUtf8 } from '@cosmjs/encoding'
import { describe, expect, it } from 'vitest'

import { verifyAdr036Signature } from '../src/auth/adr036'

async function makeSigner() {
  const keypair = await Secp256k1.makeKeypair(sha256(toUtf8('adr036-test-seed')))
  const pubkey = Secp256k1.compressPubkey(keypair.pubkey)
  const signer = toBech32('verana', rawSecp256k1PubkeyToRawAddress(pubkey))
  const sign = async (data: string): Promise<string> => {
    const signDoc = makeSignDoc(
      [{ type: 'sign/MsgSignData', value: { signer, data: toBase64(toUtf8(data)) } }],
      { gas: '0', amount: [] },
      '',
      '',
      0,
      0,
    )
    const signature = await Secp256k1.createSignature(sha256(serializeSignDoc(signDoc)), keypair.privkey)
    return toBase64(signature.toFixedLength().slice(0, 64))
  }
  return { signer, pubKey: toBase64(pubkey), sign }
}

describe('verifyAdr036Signature', () => {
  it('accepts a valid signature and rejects tampered data and a wrong signer', async () => {
    const { signer, pubKey, sign } = await makeSigner()
    const signature = await sign('challenge-1')

    await expect(verifyAdr036Signature({ signer, pubKey, signature, data: 'challenge-1' })).resolves.toBe(
      true,
    )
    await expect(verifyAdr036Signature({ signer, pubKey, signature, data: 'challenge-2' })).resolves.toBe(
      false,
    )
    await expect(
      verifyAdr036Signature({ signer: 'verana1attacker', pubKey, signature, data: 'challenge-1' }),
    ).resolves.toBe(false)
  })
})
