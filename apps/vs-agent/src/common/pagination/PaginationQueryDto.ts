import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

export const PAGE_LIMIT_MIN = 1
export const PAGE_LIMIT_DEFAULT = 100
export const PAGE_LIMIT_MAX = 500

/**
 * Pagination parameters of a collection method. A method with filters extends this class, and
 * must put those filters in the page scope.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    minimum: PAGE_LIMIT_MIN,
    maximum: PAGE_LIMIT_MAX,
    default: PAGE_LIMIT_DEFAULT,
    description: 'Number of records in one page.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(PAGE_LIMIT_MIN)
  @Max(PAGE_LIMIT_MAX)
  limit?: number

  @ApiPropertyOptional({ description: 'Opaque cursor returned by the previous call.' })
  @IsOptional()
  @IsString()
  cursor?: string
}
