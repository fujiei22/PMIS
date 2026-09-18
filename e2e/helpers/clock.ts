import type { Page } from '@playwright/test'

/** 全部 e2e 共用的固定時間，與 legacy 對照時兩邊都要套。 */
export const FIXED_NOW = new Date('2026-09-18T10:00:00')

/**
 * 把頁面時鐘固定在 FIXED_NOW。
 * 必須在 page.goto() 之前呼叫，否則頁面初次算出的「今天」會是真實日期。
 */
export async function setFixedTime(page: Page): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW)
}
