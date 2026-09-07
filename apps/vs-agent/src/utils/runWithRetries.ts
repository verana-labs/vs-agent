export interface RunWithRetriesOptions {
  run: () => Promise<void>
  intervalMs: number
  maxAttempts?: number
  onError: (error: Error, attempt: number) => void
  onSuccess?: () => void
  onExhausted?: (error: Error) => void
}

export async function runWithRetries({
  run,
  intervalMs,
  maxAttempts,
  onError,
  onSuccess,
  onExhausted,
}: RunWithRetriesOptions): Promise<void> {
  let attempt = 0

  const attemptOnce = async (): Promise<boolean> => {
    attempt++
    try {
      await run()
      onSuccess?.()
      return true
    } catch (error) {
      onError(error as Error, attempt)
      if (maxAttempts !== undefined && attempt >= maxAttempts) {
        onExhausted?.(error as Error)
        return true
      }
      return false
    }
  }

  if (await attemptOnce()) return

  const retry = setInterval(async () => {
    if (await attemptOnce()) clearInterval(retry)
  }, intervalMs)
  retry.unref()
}
