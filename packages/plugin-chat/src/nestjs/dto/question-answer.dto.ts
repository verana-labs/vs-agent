import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayNotEmpty, IsArray, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator'

export class ValidResponseDto {
  @ApiProperty({ description: 'An answer the peer can select', example: 'Yes' })
  @IsString()
  @IsNotEmpty()
  text!: string
}

export class SendQuestionBodyDto {
  @ApiProperty({ description: 'Connection to send the question on', example: 'conn-1234-5678' })
  @IsString()
  @IsNotEmpty()
  connectionId!: string

  @ApiProperty({ description: 'Text of the question', example: 'Do you accept the terms?' })
  @IsString()
  @IsNotEmpty()
  question!: string

  @ApiProperty({ type: [ValidResponseDto], description: 'The answers the peer can select' })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ValidResponseDto)
  validResponses!: ValidResponseDto[]

  @ApiPropertyOptional({ description: 'Additional text for the question' })
  @IsOptional()
  @IsString()
  detail?: string
}
