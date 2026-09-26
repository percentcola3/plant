import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** 合并 Tailwind class（clsx 条件拼接 + tailwind-merge 去重冲突） */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
