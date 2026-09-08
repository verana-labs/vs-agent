import { ActionMenuFormInputType } from '@credo-ts/action-menu'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator'

export class ActionMenuFormParameterDto {
  @ApiProperty({ description: 'Name of the parameter', example: 'email' })
  @IsString()
  @IsNotEmpty()
  name!: string

  @ApiProperty({ description: 'Title of the parameter', example: 'Email address' })
  @IsString()
  @IsNotEmpty()
  title!: string

  @ApiProperty({ description: 'Text that describes the parameter' })
  @IsString()
  description!: string

  @ApiPropertyOptional({ description: 'Value the peer starts from' })
  @IsOptional()
  @IsString()
  default?: string

  @ApiPropertyOptional({ description: 'The peer must fill the parameter', default: false })
  @IsOptional()
  @IsBoolean()
  required?: boolean

  @ApiPropertyOptional({ enum: ActionMenuFormInputType, description: 'Kind of input' })
  @IsOptional()
  @IsEnum(ActionMenuFormInputType)
  type?: ActionMenuFormInputType
}

export class ActionMenuFormDto {
  @ApiProperty({ description: 'Text that describes the form' })
  @IsString()
  description!: string

  @ApiProperty({ description: 'Label of the submit control', example: 'Send' })
  @IsString()
  @IsNotEmpty()
  submitLabel!: string

  @ApiProperty({ type: [ActionMenuFormParameterDto], description: 'The parameters the peer fills' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ActionMenuFormParameterDto)
  params!: ActionMenuFormParameterDto[]
}

export class ActionMenuOptionDto {
  @ApiProperty({ description: 'Name of the option, reported back when the peer performs it' })
  @IsString()
  @IsNotEmpty()
  name!: string

  @ApiProperty({ description: 'Title of the option' })
  @IsString()
  @IsNotEmpty()
  title!: string

  @ApiProperty({ description: 'Text that describes the option' })
  @IsString()
  description!: string

  @ApiPropertyOptional({ description: 'The option is displayed but cannot be performed', default: false })
  @IsOptional()
  @IsBoolean()
  disabled?: boolean

  @ApiPropertyOptional({ type: ActionMenuFormDto, description: 'Form the peer fills before it performs' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ActionMenuFormDto)
  form?: ActionMenuFormDto
}

export class ActionMenuDto {
  @ApiProperty({ description: 'Title of the menu' })
  @IsString()
  @IsNotEmpty()
  title!: string

  @ApiProperty({ description: 'Text that describes the menu' })
  @IsString()
  description!: string

  @ApiProperty({ type: [ActionMenuOptionDto], description: 'The options of the menu' })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ActionMenuOptionDto)
  options!: ActionMenuOptionDto[]
}

export class SendMenuBodyDto {
  @ApiProperty({ description: 'Connection to send the menu on', example: 'conn-1234-5678' })
  @IsString()
  @IsNotEmpty()
  connectionId!: string

  @ApiProperty({ type: ActionMenuDto, description: 'The menu to send' })
  @ValidateNested()
  @Type(() => ActionMenuDto)
  menu!: ActionMenuDto
}
