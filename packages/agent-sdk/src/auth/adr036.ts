import { makeSignDoc, rawSecp256k1PubkeyToRawAddress, serializeSignDoc } from '@cosmjs/amino'
import { Secp256k1, Secp256k1Signature, sha256 } from '@cosmjs/crypto'
import { fromBase64, toBase64, toBech32, toUtf8 } from '@cosmjs/encoding'

import { VERANA_BECH32_PREFIX } from '../blockchain/types'

export interface Adr036Signature {
  signer: string
  pubKey: string
  signature: string
  data: string
}

export async function verifyAdr036Signature(input: Adr036Signature): Promise<boolean> {
  try {
    const pubkey = fromBase64(input.pubKey)
    if (toBech32(VERANA_BECH32_PREFIX, rawSecp256k1PubkeyToRawAddress(pubkey)) !== input.signer) {
      return false
    }
    const signDoc = makeSignDoc(
      [{ type: 'sign/MsgSignData', value: { signer: input.signer, data: toBase64(toUtf8(input.data)) } }],
      { gas: '0', amount: [] },
      '',
      '',
      0,
      0,
    )
    const digest = sha256(serializeSignDoc(signDoc))
    return await Secp256k1.verifySignature(
      Secp256k1Signature.fromFixedLength(fromBase64(input.signature)),
      digest,
      pubkey,
    )
  } catch {
    return false
  }
}
