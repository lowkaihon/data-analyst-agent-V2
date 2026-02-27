import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Dispatch, SetStateAction } from 'react'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function toggleSetItem<T>(
  setter: Dispatch<SetStateAction<Set<T>>>,
  key: T
) {
  setter((prev) => {
    const newSet = new Set(prev)
    if (newSet.has(key)) {
      newSet.delete(key)
    } else {
      newSet.add(key)
    }
    return newSet
  })
}

export function getRunColumns(run: { columns?: string[] | null; sample?: any[] | null }): string[] {
  if (run.columns && run.columns.length > 0) return run.columns
  if (run.sample && run.sample.length > 0) return Object.keys(run.sample[0])
  return []
}

export async function togglePin<T extends { id: string; pinned: boolean }>(
  runId: string,
  currentPinned: boolean,
  setter: Dispatch<SetStateAction<T[]>>
) {
  try {
    await fetch(`/api/runs/${runId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !currentPinned }),
    })
    setter((prev) => prev.map((item) => (item.id === runId ? { ...item, pinned: !currentPinned } : item)))
  } catch (err) {
    console.error("Failed to toggle pin:", err)
  }
}
