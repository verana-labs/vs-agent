import type { Kms } from '@credo-ts/core'

import { X509Certificate } from '@credo-ts/core'
import {
  BasicConstraintsExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  SubjectAlternativeNameExtension,
  X509CertificateGenerator,
} from '@peculiar/x509'
import { webcrypto } from 'node:crypto'

const VALID_FROM = new Date('2025-01-01T00:00:00.000Z')
const VALID_UNTIL = new Date('2035-01-01T00:00:00.000Z')

export const ROOT_PRIVATE_JWK: Kms.KmsJwkPrivateEc = {
  kty: 'EC',
  crv: 'P-256',
  x: 'Z4uHH8qrHJDhfZGdIwwGSp0KpQYekjdXh5ifvkB_xP4',
  y: '3A_FefIX6E6prfytxSdzZGwbxmFn8V-q1kigxNHgXg0',
  d: 'bv3pn_ZCsLqfYtyQctdiPsZwylTjJOsRGPTEvbRhaM8',
  alg: 'ES256',
  kid: 'fixture-root',
}

export const INTERMEDIATE_PRIVATE_JWK: Kms.KmsJwkPrivateEc = {
  kty: 'EC',
  crv: 'P-256',
  x: 'gw0BI9URVjtWJPEV_dXoQFjn1scvgaFWkKRB9bAsqEk',
  y: 'ArSkTsB6K2VOJx4tL088qLKFaQk-ovQSAR5Jd_cGPHM',
  d: 'm-ONbHbIaR_YtiS-D4-Al857I_mmsLDM3qSX68pnXHU',
  alg: 'ES256',
  kid: 'fixture-intermediate',
}

export const LEAF_PRIVATE_JWK: Kms.KmsJwkPrivateEc = {
  kty: 'EC',
  crv: 'P-256',
  x: '3weMwhLkLVczrH3StYKUFVvZ6BH0w0zPGKqxGP_WPdw',
  y: 'R9VJEWYekB_dXU9nZJV3qKSGp140dfY-0pz3VvzjkIg',
  d: 'viGiN9hbNaX51-GT4kj0ckKm5KDZgfAtdZQLPoGLf9E',
  alg: 'ES256',
  kid: 'fixture-leaf',
}

export const OTHER_PRIVATE_JWK: Kms.KmsJwkPrivateEc = {
  kty: 'EC',
  crv: 'P-256',
  x: 'HgM27wLnv9ggeQnhrn8-7orAf1alKndf5hY9snHFVug',
  y: 'AZpF7IR9cPBlVs2xAYfcnES1TeWUILsYsIwjHkmFVK8',
  d: 'OV8joKI1eVbk_KmXwcM1GedKw3al22Uec8ICqEmk52E',
  alg: 'ES256',
  kid: 'fixture-other',
}

interface CertificateFixtures {
  root: X509Certificate
  intermediate: X509Certificate
  expiredIntermediate: X509Certificate
  notYetValidIntermediate: X509Certificate
  leaf: X509Certificate
  expiredLeaf: X509Certificate
  leafWithoutUriSan: X509Certificate
  leafWithNonDidUriSan: X509Certificate
  leafWithMalformedDidUriSan: X509Certificate
  attacker: X509Certificate
  expiredAttacker: X509Certificate
}

export async function createCertificateFixtures(): Promise<CertificateFixtures> {
  const [rootKeys, intermediateKeys, leafKeys, otherKeys] = await Promise.all([
    importKeyPair(ROOT_PRIVATE_JWK),
    importKeyPair(INTERMEDIATE_PRIVATE_JWK),
    importKeyPair(LEAF_PRIVATE_JWK),
    importKeyPair(OTHER_PRIVATE_JWK),
  ])

  const root = await X509CertificateGenerator.createSelfSigned(
    {
      serialNumber: '01',
      name: 'CN=Fixture Root',
      keys: rootKeys,
      notBefore: VALID_FROM,
      notAfter: VALID_UNTIL,
      extensions: [
        new BasicConstraintsExtension(true, 1, true),
        new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
      ],
    },
    webcrypto,
  )
  const createIntermediate = async (serialNumber: string, notBefore: Date, notAfter: Date) =>
    await X509CertificateGenerator.create(
      {
        serialNumber,
        issuer: root.subject,
        subject: 'CN=Fixture Intermediate',
        publicKey: intermediateKeys.publicKey,
        signingKey: rootKeys.privateKey,
        notBefore,
        notAfter,
        extensions: [
          new BasicConstraintsExtension(true, 0, true),
          new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
        ],
      },
      webcrypto,
    )
  const [intermediate, expiredIntermediate, notYetValidIntermediate] = await Promise.all([
    createIntermediate('02', VALID_FROM, VALID_UNTIL),
    createIntermediate('09', new Date('2019-01-01T00:00:00.000Z'), new Date('2020-01-01T00:00:00.000Z')),
    createIntermediate('0A', new Date('2040-01-01T00:00:00.000Z'), new Date('2041-01-01T00:00:00.000Z')),
  ])

  const createLeaf = async ({
    serialNumber,
    notBefore = VALID_FROM,
    notAfter = VALID_UNTIL,
    subjectAlternativeNames,
  }: {
    serialNumber: string
    notBefore?: Date
    notAfter?: Date
    subjectAlternativeNames: Array<{ type: 'dns' | 'url'; value: string }>
  }) =>
    await X509CertificateGenerator.create(
      {
        serialNumber,
        issuer: intermediate.subject,
        subject: 'CN=Fixture Leaf',
        publicKey: leafKeys.publicKey,
        signingKey: intermediateKeys.privateKey,
        notBefore,
        notAfter,
        extensions: [
          new BasicConstraintsExtension(false, undefined, true),
          new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
          new SubjectAlternativeNameExtension(subjectAlternativeNames),
        ],
      },
      webcrypto,
    )
  const createOtherSelfSigned = async (serialNumber: string, notBefore: Date, notAfter: Date) =>
    await X509CertificateGenerator.createSelfSigned(
      {
        serialNumber,
        name: 'CN=Attacker',
        keys: otherKeys,
        notBefore,
        notAfter,
        extensions: [
          new BasicConstraintsExtension(false, undefined, true),
          new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
          new SubjectAlternativeNameExtension([
            { type: 'url', value: 'did:web:attacker.example' },
            { type: 'dns', value: 'attacker.example' },
          ]),
        ],
      },
      webcrypto,
    )

  const [
    leaf,
    expiredLeaf,
    leafWithoutUriSan,
    leafWithNonDidUriSan,
    leafWithMalformedDidUriSan,
    attacker,
    expiredAttacker,
  ] = await Promise.all([
    createLeaf({
      serialNumber: '03',
      subjectAlternativeNames: [
        { type: 'url', value: 'did:web:issuer.example' },
        { type: 'dns', value: 'issuer.example' },
      ],
    }),
    createLeaf({
      serialNumber: '04',
      notBefore: new Date('2019-01-01T00:00:00.000Z'),
      notAfter: new Date('2020-01-01T00:00:00.000Z'),
      subjectAlternativeNames: [{ type: 'url', value: 'did:web:expired.example' }],
    }),
    createLeaf({
      serialNumber: '05',
      subjectAlternativeNames: [{ type: 'dns', value: 'issuer.example' }],
    }),
    createLeaf({
      serialNumber: '06',
      subjectAlternativeNames: [{ type: 'url', value: 'https://issuer.example' }],
    }),
    createLeaf({
      serialNumber: '08',
      subjectAlternativeNames: [{ type: 'url', value: 'did:' }],
    }),
    createOtherSelfSigned('07', VALID_FROM, VALID_UNTIL),
    createOtherSelfSigned('0B', new Date('2019-01-01T00:00:00.000Z'), new Date('2020-01-01T00:00:00.000Z')),
  ])

  return {
    root: fromPeculiar(root),
    intermediate: fromPeculiar(intermediate),
    expiredIntermediate: fromPeculiar(expiredIntermediate),
    notYetValidIntermediate: fromPeculiar(notYetValidIntermediate),
    leaf: fromPeculiar(leaf),
    expiredLeaf: fromPeculiar(expiredLeaf),
    leafWithoutUriSan: fromPeculiar(leafWithoutUriSan),
    leafWithNonDidUriSan: fromPeculiar(leafWithNonDidUriSan),
    leafWithMalformedDidUriSan: fromPeculiar(leafWithMalformedDidUriSan),
    attacker: fromPeculiar(attacker),
    expiredAttacker: fromPeculiar(expiredAttacker),
  }
}

async function importKeyPair(privateJwk: Kms.KmsJwkPrivateEc): Promise<webcrypto.CryptoKeyPair> {
  const algorithm = { name: 'ECDSA', namedCurve: 'P-256' }
  const privateKey = await webcrypto.subtle.importKey('jwk', privateJwk, algorithm, true, ['sign'])
  const publicKey = await webcrypto.subtle.importKey(
    'jwk',
    { kty: privateJwk.kty, crv: privateJwk.crv, x: privateJwk.x, y: privateJwk.y },
    algorithm,
    true,
    ['verify'],
  )

  return { privateKey, publicKey }
}

function fromPeculiar(certificate: { rawData: ArrayBuffer }): X509Certificate {
  return X509Certificate.fromRawCertificate(new Uint8Array(certificate.rawData))
}
