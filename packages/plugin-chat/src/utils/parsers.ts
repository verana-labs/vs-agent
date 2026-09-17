import { PictureData } from '@2060.io/credo-ts-didcomm-user-profile'

export function createDataUrl(pictureData: PictureData): string | undefined {
  if (pictureData.base64 && pictureData.mimeType) {
    return `data:${pictureData.mimeType};base64,${pictureData.base64}`
  } else if (pictureData.links && pictureData.links.length > 0) {
    return pictureData.links[0]
  }
}
