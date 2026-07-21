import { SetMetadata } from '@nestjs/common'

export const ACCESS_MODE_KEY = 'adminAccessMode'

export type AdminAccessMode = 'PUBLIC' | 'INTERNAL' | 'CORPORATION'

export interface AccessModeMetadata {
  mode: AdminAccessMode
  msgTypes?: string[]
}

export const AccessMode = (mode: AdminAccessMode, msgTypes?: string[]) =>
  SetMetadata(ACCESS_MODE_KEY, { mode, msgTypes } satisfies AccessModeMetadata)
