import {
  CredentialSchema,
  CredentialSchemaDto,
  Participant,
  ParticipantDto,
  ParticipantRole,
  ValidationState,
} from './types'

const ROLE: Record<string, number> = {
  [ParticipantRole.Issuer]: 1,
  [ParticipantRole.Verifier]: 2,
  [ParticipantRole.IssuerGrantor]: 3,
  [ParticipantRole.VerifierGrantor]: 4,
  [ParticipantRole.Ecosystem]: 5,
  [ParticipantRole.Holder]: 6,
}

const OP_STATE: Record<string, ValidationState> = {
  PENDING: ValidationState.PENDING,
  VALIDATED: ValidationState.VALIDATED,
  TERMINATED: ValidationState.TERMINATED,
}

const ONBOARDING_MODE: Record<string, number> = {
  OPEN: 1,
  ECOSYSTEM_ONBOARDING_PROCESS: 2,
  GRANTOR_ONBOARDING_PROCESS: 3,
}

const date = (v: string | null | undefined): Date | undefined => (v ? new Date(v) : undefined)

export function toParticipant(dto: ParticipantDto): Participant {
  return {
    id: dto.id,
    schemaId: dto.schema_id,
    role: ROLE[dto.role] ?? 0,
    did: dto.did ?? '',
    corporation: '',
    validatorParticipantId: dto.validator_participant_id ?? 0,
    opState: dto.op_state ? (OP_STATE[dto.op_state] ?? ValidationState.UNSPECIFIED) : undefined,
    opSummaryDigest: dto.op_summary_digest ?? '',
    revoked: date(dto.revoked),
    slashed: date(dto.slashed),
  }
}

export function toCredentialSchema(dto: CredentialSchemaDto): CredentialSchema {
  return {
    id: dto.id,
    ecosystemId: dto.ecosystem_id,
    jsonSchema: dto.json_schema,
    digestAlgorithm: dto.digest_algorithm,
    issuerOnboardingMode: ONBOARDING_MODE[dto.issuer_onboarding_mode ?? ''] ?? 0,
    verifierOnboardingMode: ONBOARDING_MODE[dto.verifier_onboarding_mode ?? ''] ?? 0,
    holderOnboardingMode: 0,
    archived: date(dto.archived),
  }
}
