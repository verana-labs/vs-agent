import { IsNotEmpty, IsObject, IsString } from 'class-validator'

export class CreateOpenId4VcOfferDto {
  @IsString()
  @IsNotEmpty()
  credentialConfigurationId!: string

  @IsObject()
  claims!: Record<string, unknown>
}
