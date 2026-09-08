import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, IsUrl, ValidateNested } from 'class-validator'

export class ProfilePictureDto {
  @ApiPropertyOptional({ description: 'Media type of the content', example: 'image/png' })
  @IsOptional()
  @IsString()
  mimeType?: string

  @ApiPropertyOptional({ description: 'URLs the content can be fetched from', type: [String] })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  links?: string[]

  @ApiPropertyOptional({ description: 'The content, base64 encoded' })
  @IsOptional()
  @IsString()
  base64?: string
}

export class UserProfileDto {
  @ApiPropertyOptional({ description: 'Name to display', example: 'Acme Support' })
  @IsOptional()
  @IsString()
  displayName?: string

  @ApiPropertyOptional({ type: ProfilePictureDto, description: 'Picture to display' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProfilePictureDto)
  displayPicture?: ProfilePictureDto

  @ApiPropertyOptional({ type: ProfilePictureDto, description: 'Icon to display' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProfilePictureDto)
  displayIcon?: ProfilePictureDto

  @ApiPropertyOptional({ description: 'Text that describes the profile' })
  @IsOptional()
  @IsString()
  description?: string

  @ApiPropertyOptional({ description: 'Preferred language, as a BCP 47 tag', example: 'en' })
  @IsOptional()
  @IsString()
  preferredLanguage?: string
}

export class SendProfileBodyDto {
  @ApiProperty({ description: 'Connection to send the profile on', example: 'conn-1234-5678' })
  @IsString()
  @IsNotEmpty()
  connectionId!: string

  @ApiPropertyOptional({ type: UserProfileDto, description: 'Profile to send, the stored one when absent' })
  @IsOptional()
  @ValidateNested()
  @Type(() => UserProfileDto)
  profile?: UserProfileDto

  @ApiPropertyOptional({ description: 'Ask the peer to answer with its own profile', default: false })
  @IsOptional()
  @IsBoolean()
  sendBackYours?: boolean

  @ApiPropertyOptional({ description: 'Thread of the message this profile answers' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  threadId?: string
}

export class RequestProfileBodyDto {
  @ApiProperty({ description: 'Connection to send the request on', example: 'conn-1234-5678' })
  @IsString()
  @IsNotEmpty()
  connectionId!: string

  @ApiPropertyOptional({ description: 'Profile fields of interest, every field when absent', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  query?: string[]
}
