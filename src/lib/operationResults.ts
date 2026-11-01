export const isFailedResult = (item: { status: string }) => item.status === 'error' || item.status === 'partial'

export function failureReasonLabel(item: { status: string; message?: string }): string | undefined {
  if (item.status === 'error' && /\b(permission denied|does not have permission|access (?:is )?denied|Android denies INTERNAL_DELETE_CACHE_FILES|EACCES|EPERM)\b/i.test(item.message || '')) return "Access denied"
  return undefined
}

// Keep the original order within each group and never mutate the operation history.
export function prioritizeFailedResults<T extends { status: string }>(items: readonly T[], onlyFailed = false): T[] {
  const failed = items.filter(isFailedResult)
  return onlyFailed ? failed : [...failed, ...items.filter(item => !isFailedResult(item))]
}
