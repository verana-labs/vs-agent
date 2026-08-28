import { Type } from '@nestjs/common'
import { ApiProperty } from '@nestjs/swagger'

import { Page } from './paginate'

const models = new Map<Type<unknown>, Type<Page<unknown>>>()

/**
 * Makes the OpenAPI model of a page of `ItemDto`. Swagger reads a schema off a class, so a
 * generic `Page<T>` needs one cached class for each record type.
 */
export function PageDto<T>(ItemDto: Type<T>): Type<Page<T>> {
  const known = models.get(ItemDto as Type<unknown>)
  if (known) return known as Type<Page<T>>

  class GeneratedPageDto {
    @ApiProperty({ type: [ItemDto], description: 'The records of this page.' })
    public items!: T[]

    @ApiProperty({
      type: String,
      nullable: true,
      description: 'Cursor of the next page. The agent sets it to null on the last page.',
    })
    public nextCursor!: string | null
  }

  // Swagger names each schema after its class, and every generated class shares one source name.
  Object.defineProperty(GeneratedPageDto, 'name', {
    value: `${ItemDto.name.replace(/Dto$/, '')}PageDto`,
  })

  models.set(ItemDto as Type<unknown>, GeneratedPageDto as Type<Page<unknown>>)
  return GeneratedPageDto as Type<Page<T>>
}
