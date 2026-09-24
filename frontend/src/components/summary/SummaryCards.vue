<script setup lang="ts">
// 五張摘要卡：專案總時長、整體進度、任務狀態、Issue 統計、預算 vs. 支出。
// legacy 對照：模板 :298-385，數值 :3522-3633。
import { computed } from 'vue'
import { DELAYED, ISSUE_LEVEL, ISSUE_STATUS, TASK_STATUS } from '@/constants/dashboard'
import { budgetRatio, budgetRemaining, gaugeAngle, isOverBudget } from '@/lib/budget'
import { dayIndex, isoFromIndex } from '@/lib/date'
import { fmtMoney, fmtMoneyShort } from '@/lib/format'
import { isLate, isLateIssue } from '@/lib/schedule'
import { useBudgetStore } from '@/stores/budget'
import { useClockStore } from '@/stores/clock'
import { useIssueStore } from '@/stores/issue'
import { useTaskStore } from '@/stores/task'
import type { IssueLevel, IssueStatus, TaskStatus } from '@/types/models'

const clock = useClockStore()
const budgetStore = useBudgetStore()
const taskStore = useTaskStore()
const issueStore = useIssueStore()

const tasks = computed(() => taskStore.tasks)
const issues = computed(() => issueStore.issues)
const total = computed(() => tasks.value.length)

// ── 卡 1：專案總時長 ───────────────────────────────────────────────────────
const totalDays = computed(() => taskStore.range.max - taskStore.range.min + 1)
const rangeLabel = computed(
  () => `${isoFromIndex(taskStore.range.min)} ~ ${isoFromIndex(taskStore.range.max)}`,
)

// ── 卡 2：整體進度（實際 = 已完成數；理論 = end 已過今天的數）legacy :3604-3620 ──
const doneTasks = computed(() => tasks.value.filter((t) => t.status === 'done').length)
const planDone = computed(
  () => tasks.value.filter((t) => dayIndex(t.end) <= clock.todayIdx).length,
)
const actualPct = computed(() => (total.value ? Math.round((doneTasks.value / total.value) * 100) : 0))
const planPct = computed(() => (total.value ? Math.round((planDone.value / total.value) * 100) : 0))
const gap = computed(() => actualPct.value - planPct.value)
const gapLabel = computed(() => {
  if (!total.value) return ''
  if (gap.value === 0) return '與時程相符'
  return gap.value > 0 ? `超前 ${gap.value}%` : `落後 ${-gap.value}%`
})
/** 落後紅、超前綠、相符灰；legacy 是比未四捨五入的比例（:3615）。 */
const gapTone = computed(() => {
  if (!total.value) return 'flat'
  const a = doneTasks.value / total.value
  const p = planDone.value / total.value
  return a < p ? 'behind' : a > p ? 'ahead' : 'flat'
})

// ── 卡 3：任務狀態 ────────────────────────────────────────────────────────
const statusRows = computed(() =>
  (['todo', 'doing', 'paused', 'done'] as TaskStatus[]).map((k) => {
    const count = tasks.value.filter((t) => t.status === k).length
    const pct = total.value ? (count / total.value) * 100 : 0
    return {
      k,
      label: TASK_STATUS[k].label,
      color: TASK_STATUS[k].dot,
      count,
      pct: +pct.toFixed(2),
      pctLabel: `${Math.round(pct)}%`,
    }
  }),
)
const delayedCount = computed(() => tasks.value.filter((t) => isLate(t, clock.todayIdx)).length)

// ── 卡 4：Issue 統計 ──────────────────────────────────────────────────────
const levelRows = computed(() =>
  (['A', 'B', 'C', 'D'] as IssueLevel[]).map((k) => ({
    k,
    label: ISSUE_LEVEL[k].label,
    text: ISSUE_LEVEL[k].text,
    count: issues.value.filter((x) => x.level === k).length,
  })),
)
const issueStatusRows = computed(() =>
  (['open', 'doing', 'paused', 'closed'] as IssueStatus[]).map((k) => ({
    k,
    label: ISSUE_STATUS[k].label,
    // 圓點色在 constants 的 ISSUE_STATUS.dot（legacy :3632；review m2）
    color: ISSUE_STATUS[k].dot,
    count: issues.value.filter((x) => x.status === k).length,
  })),
)
const delayedIssues = computed(() => issues.value.filter((i) => isLateIssue(i, clock.todayIdx)).length)

// ── 卡 5：預算 vs. 支出（半圓儀表；演算法在 lib/budget）───────────────────
const budget = computed(() => budgetStore.budget)
const remaining = computed(() => budgetRemaining(budget.value))
const overBudget = computed(() => isOverBudget(budget.value))
const ratio = computed(() => budgetRatio(budget.value))
const needleAngle = computed(() => gaugeAngle(ratio.value))
</script>

<template>
  <div class="cards">
    <!-- 1. 專案總時長 -->
    <div class="card" data-testid="summary-duration">
      <div class="card-title">專案總時長</div>
      <div class="hero">{{ totalDays }} <span class="hero-unit">天</span></div>
      <div class="range">{{ rangeLabel }}</div>
    </div>

    <!-- 2. 整體進度 -->
    <div class="card" data-testid="summary-progress">
      <div class="card-head">
        <span class="card-title">整體進度</span>
        <span class="gap" :class="gapTone">{{ gapLabel }}</span>
      </div>
      <div class="hero hero-done">{{ actualPct }}%</div>
      <div class="bars">
        <div>
          <div class="bar-head">
            <span class="bar-label">實際進度</span>
            <span class="bar-frac">{{ doneTasks }} / {{ total }}</span>
            <span class="bar-pct actual">{{ actualPct }}%</span>
          </div>
          <div class="track track-actual">
            <div class="fill fill-actual" :style="{ width: `${actualPct}%` }"></div>
          </div>
        </div>
        <div>
          <div class="bar-head">
            <span class="bar-label">理論進度</span>
            <span class="bar-frac">{{ planDone }} / {{ total }}</span>
            <span class="bar-pct plan">{{ planPct }}%</span>
          </div>
          <div class="track track-plan">
            <div class="fill fill-plan" :style="{ width: `${planPct}%` }"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 3. 任務狀態 -->
    <div class="card card-tight" data-testid="summary-tasks">
      <div class="stat-head">
        <span class="card-title">任務狀態</span>
        <span class="stat-total">{{ total }}</span>
        <span class="stat-unit">項</span>
      </div>
      <div class="stack">
        <div
          v-for="s in statusRows"
          :key="s.k"
          class="stack-seg"
          :style="{ width: `${s.pct}%`, background: s.color }"
        ></div>
      </div>
      <div class="legend">
        <div v-for="s in statusRows" :key="s.k" class="legend-row">
          <span class="dot" :style="{ background: s.color }"></span>
          <span class="legend-label">{{ s.label }}</span>
          <span class="legend-pct">{{ s.pctLabel }}</span>
          <span class="legend-count">{{ s.count }}</span>
        </div>
        <div class="legend-row late">
          <span class="dot dot-late"></span>
          <span class="legend-label">{{ DELAYED.label }}</span>
          <span class="legend-count">{{ delayedCount }}</span>
        </div>
      </div>
    </div>

    <!-- 4. Issue 統計 -->
    <div class="card card-tight" data-testid="summary-issues">
      <div class="stat-head">
        <span class="card-title">Issue 統計</span>
        <span class="stat-total">{{ issues.length }}</span>
        <span class="stat-unit">筆</span>
      </div>
      <div class="issue-cols">
        <div class="issue-col">
          <div class="overline">等級</div>
          <div class="legend">
            <div v-for="c in levelRows" :key="c.k" class="legend-row" :title="c.label">
              <span class="cls-label" :style="{ color: c.text }">{{ c.label }}</span>
              <span class="legend-count">{{ c.count }}</span>
            </div>
          </div>
        </div>
        <div class="issue-col">
          <div class="overline">處理狀態</div>
          <div class="legend">
            <div v-for="c in issueStatusRows" :key="c.k" class="legend-row">
              <span class="dot" :style="{ background: c.color }"></span>
              <span class="legend-label">{{ c.label }}</span>
              <span class="legend-count">{{ c.count }}</span>
            </div>
            <div class="legend-row late">
              <span class="dot dot-late"></span>
              <span class="legend-label">{{ DELAYED.label }}</span>
              <span class="legend-count">{{ delayedIssues }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 5. 預算 vs. 支出 -->
    <div class="card card-tight" data-testid="summary-budget">
      <div class="card-title budget-title">Budget vs. Actual</div>
      <div class="budget-body">
        <svg class="gauge" viewBox="0 0 120 70" role="img" aria-label="預算使用率">
          <path class="gauge-track" d="M 12 60 A 48 48 0 0 1 108 60" pathLength="100" />
          <path
            class="gauge-fill"
            :class="{ over: overBudget }"
            d="M 12 60 A 48 48 0 0 1 108 60"
            pathLength="100"
            :stroke-dasharray="`${ratio * 100} 100`"
          />
          <g class="needle" :style="{ transform: `rotate(${needleAngle}deg)` }">
            <line x1="60" y1="60" x2="60" y2="22" />
          </g>
          <circle class="hub" cx="60" cy="60" r="4" />
        </svg>
        <div class="budget-legend">
          <div class="legend-row">
            <span class="legend-label">Total:</span>
            <span class="legend-count budget-num" :title="fmtMoney(budget.total)">{{ fmtMoneyShort(budget.total) }}</span>
          </div>
          <div class="legend-row">
            <span class="legend-label">Actual:</span>
            <span class="legend-count budget-num" :title="fmtMoney(budget.actual)">{{ fmtMoneyShort(budget.actual) }}</span>
          </div>
          <div class="legend-row" :class="{ late: overBudget }">
            <span class="legend-label">{{ overBudget ? 'Over:' : 'Remaining:' }}</span>
            <span class="legend-count budget-num" :title="fmtMoney(remaining)">{{ fmtMoneyShort(remaining) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cards {
  display: grid;
  align-items: stretch;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--gap-boards);
}

.card {
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  border-radius: var(--r-panel);
  padding: var(--pad-card);
  display: flex;
  flex-direction: column;
}

/* 後兩張卡不用 flex column（legacy :329 / :352 也沒有） */
.card-tight {
  display: block;
}

.card-head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-3);
}

.card-title {
  font-size: var(--fs-control);
  color: var(--text-muted);
  font-weight: var(--fw-medium);
}

.hero {
  font-size: var(--fs-hero);
  font-weight: var(--fw-bold);
  color: var(--text-1);
  line-height: var(--kpi-hero-lh);
}

.hero-done {
  color: var(--st-done);
}

.hero-unit {
  font-size: var(--fs-panel);
  font-weight: var(--fw-medium);
  color: var(--text-muted);
}

.range {
  font-size: var(--fs-meta);
  color: var(--text-muted);
  font-family: var(--font-mono);
  margin-top: auto;
}

.gap {
  font-size: var(--fs-pill);
  font-weight: var(--fw-bold);
  font-family: var(--font-mono);
  margin-left: auto;
}

.gap.behind {
  color: var(--danger-text);
}

.gap.ahead {
  color: var(--success-text);
}

.gap.flat {
  color: var(--text-muted);
}

.bars {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin-top: auto;
}

.bar-head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-3);
  margin-bottom: var(--sp-2);
}

.bar-label {
  font-size: var(--fs-pill);
  color: var(--text-3);
}

.bar-frac {
  font-size: var(--fs-caption);
  color: var(--text-muted);
  font-family: var(--font-mono);
  margin-left: auto;
}

.bar-pct {
  font-size: var(--fs-pill);
  font-weight: var(--fw-bold);
  font-family: var(--font-mono);
}

.bar-pct.actual {
  color: var(--success-text);
}

.bar-pct.plan {
  color: var(--text-3);
}

.track {
  height: var(--sp-3);
  border-radius: var(--r-4);
  overflow: hidden;
}

.track-actual {
  background: var(--success-track);
}

.track-plan {
  background: var(--border-1);
}

.fill {
  height: var(--sp-3);
  transition: width var(--t-progress) var(--ease);
}

.fill-actual {
  background: var(--success);
}

.fill-plan {
  background: var(--text-muted);
}

.stat-head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-3);
  margin-bottom: 9px;
}

.stat-total {
  font-size: var(--fs-panel);
  font-weight: var(--fw-bold);
  color: var(--text-1);
  font-family: var(--font-mono);
  margin-left: auto;
}

.stat-unit {
  font-size: var(--fs-pill);
  color: var(--text-muted);
}

.stack {
  display: flex;
  height: var(--sp-4);
  border-radius: var(--r-4);
  overflow: hidden;
  background: var(--surface-3);
  margin-bottom: var(--sp-5);
}

.stack-seg {
  transition: width var(--t-progress) var(--ease);
}

.legend {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.legend-row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-width: 0;
}

.dot {
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  border-radius: 50%;
}

.dot-late {
  background: var(--today);
}

.legend-label {
  font-size: var(--fs-pill);
  color: var(--text-3);
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.legend-pct {
  font-size: var(--fs-caption);
  color: var(--text-muted);
  font-family: var(--font-mono);
  flex: 0 0 auto;
}

.legend-count {
  font-size: var(--fs-meta);
  font-weight: var(--fw-bold);
  color: var(--text-1);
  font-family: var(--font-mono);
  flex: 0 0 auto;
  min-width: 18px;
  text-align: right;
}

/* 「已延遲」在虛線分隔之後，整列轉紅（legacy :345 / :376） */
.legend-row.late {
  margin-top: var(--sp-2);
  padding-top: var(--sp-3);
  border-top: 1px dashed var(--border-1);
}

.legend-row.late .legend-label {
  color: var(--danger);
  font-weight: 600;
}

.legend-row.late .legend-count {
  color: var(--danger);
}

.issue-cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
  gap: var(--sp-5) var(--sp-6);
}

.issue-col {
  min-width: 0;
}

.overline {
  font-size: var(--fs-caption);
  font-weight: var(--fw-bold);
  color: var(--text-muted);
  letter-spacing: 0.06em;
  margin-bottom: var(--r-badge);
}

.cls-label {
  font-size: var(--fs-caption);
  font-weight: var(--fw-bold);
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.budget-title {
  margin-bottom: var(--sp-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 儀表在上、金額在下：金額位數再多也只往下長，不會把卡片撐寬 */
.budget-body {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--sp-3);
  min-width: 0;
}

.gauge {
  width: 100%;
  max-width: 200px;
  align-self: center;
}

.gauge-track,
.gauge-fill {
  fill: none;
  stroke-width: 16;
}

.gauge-track {
  stroke: var(--surface-3);
}

.gauge-fill {
  stroke: var(--accent);
  transition: stroke-dasharray var(--t-progress) var(--ease);
}

.gauge-fill.over {
  stroke: var(--danger);
}

.needle {
  transform-origin: 60px 60px;
  transition: transform var(--t-progress) var(--ease);
}

.needle line {
  stroke: var(--text-3);
  stroke-width: 2.5;
  stroke-linecap: round;
}

.hub {
  fill: var(--text-3);
}

.budget-legend {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.budget-legend .legend-label {
  flex: 0 0 auto;
}

/* 標籤靠左、金額靠右；真的塞不下時才用「…」截斷（完整金額在 title） */
.budget-num {
  flex: 1 1 auto;
  min-width: 0;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
