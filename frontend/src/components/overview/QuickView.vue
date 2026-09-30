<script setup lang="ts">
// 專案速覽的內容：進度與任務數、時程、風險項目、成員與近期任務四組；withHead 時加上專案與 PM 標頭（卡片抽屜與時間軸用）。
// 標頭不放收合鈕：再點一次卡片 / 時間軸列就收起，右端只留「進入」。
// 展開收合的外殼（grid-rows 過渡、延遲卸載）由使用端包，本元件只負責內容。
import { computed } from 'vue'
import Avatar from '@/components/common/Avatar.vue'
import EnterLink from '@/components/overview/EnterLink.vue'
import PlanActualBar from '@/components/overview/PlanActualBar.vue'
import ProjectBadge from '@/components/overview/ProjectBadge.vue'
import { ISSUE_LEVEL } from '@/constants/dashboard'
import { BADGE_CLASS } from '@/constants/overview'
import { dueSoon, gapTone, type ProjectRow } from '@/lib/portfolio'
import { useClockStore } from '@/stores/clock'
import { usePortfolioStore } from '@/stores/portfolio'
import type { IssueLevel } from '@/types/models'

const props = defineProps<{
  row: ProjectRow
  /** 加上來源專案與 PM 的標頭；時間軸的速覽離卡片很遠，要標明是哪個專案。 */
  withHead?: boolean
}>()

const clock = useClockStore()
const portfolio = usePortfolioStore()

const p = computed(() => props.row.p)
const d = computed(() => props.row.d)

const pm = computed(() => portfolio.byId(p.value.pmId))


const LEVELS: readonly IssueLevel[] = ['A', 'B', 'C', 'D']
/** 只列有未結 Issue 的等級；全為 0 時整列換成空值文案。 */
const levels = computed(() =>
  LEVELS.filter((lv) => p.value.openIssues[lv] > 0).map((lv) => ({
    lv,
    n: p.value.openIssues[lv],
  })),
)

/** 風險數字的色調跟著專案的需注意程度走；數字為 0 時不上色。 */
const riskTone = computed(() =>
  d.value.alert === 'late' ? 'danger' : d.value.alert === 'watch' ? 'warn' : '',
)
const toneIf = (n: number): string => (n > 0 ? riskTone.value : '')

const members = computed(() => p.value.memberIds.map((id) => ({ id, m: portfolio.byId(id) })))

const upcoming = computed(() =>
  p.value.upcoming.map((u, i) => ({
    // 同名同日的任務理論上可能重複，key 加上位置
    key: `${i}-${u.name}`,
    name: u.name,
    date: u.due.slice(5),
    soon: dueSoon(u.due, clock.todayIso),
    who: portfolio.byId(u.memberId),
  })),
)
</script>

<template>
  <div class="quick-view" :class="{ 'with-head': withHead }">
    <div v-if="withHead" class="qv-head">
      <h4 class="qv-name">{{ p.name }}</h4>
      <ProjectBadge :kind="d.badge" />
      <span class="qv-pm">
        <Avatar :member="pm" :size="22" />{{ pm?.name ?? '?' }}<span class="qv-pm-role">PM</span>
      </span>
      <span class="spacer"></span>
      <EnterLink :id="p.id" :name="p.name" variant="head" />
    </div>

    <div class="quick">
      <div class="qb">
        <div class="qb-title">進度與任務數</div>
        <PlanActualBar :actual="d.actualPct" :planned="d.plannedPct" :tone="BADGE_CLASS[d.badge]" />
        <div class="progress-foot">
          <span class="bar-frac mono">{{ p.taskDone }} / {{ p.taskTotal }}</span>
          <span class="gap-note" :class="gapTone(d.gap)">{{ d.gap > 0 ? `落後 ${d.gap}%` : '進度正常' }}</span>
        </div>
        <ul class="counts">
          <li><i class="dot dot-done"></i>完成<b>{{ p.taskCounts.done }}</b></li>
          <li><i class="dot dot-doing"></i>進行中<b>{{ p.taskCounts.doing }}</b></li>
          <li><i class="dot dot-paused"></i>暫停<b>{{ p.taskCounts.paused }}</b></li>
          <li><i class="dot dot-todo"></i>待辦<b>{{ p.taskCounts.todo }}</b></li>
        </ul>
      </div>

      <div class="qb">
        <div class="qb-title">時程</div>
        <div class="range"><span>{{ p.startDate }}</span><span class="range-arrow">→</span><span>{{ p.dueDate }}</span></div>
        <div class="track time-track">
          <div class="fill fill-time" :style="{ width: d.timePct + '%' }"></div>
        </div>
        <dl class="kv">
          <div><dt>總天數</dt><dd>{{ d.totalDays }}<span class="unit">天</span></dd></div>
          <div><dt>已過</dt><dd>{{ d.elapsedDays }}<span class="unit">天</span></dd></div>
          <div><dt>剩餘</dt><dd>{{ d.remainingDays }}<span class="unit">天</span></dd></div>
        </dl>
      </div>

      <div class="qb">
        <div class="qb-title">風險項目</div>
        <dl class="kv kv-2">
          <div>
            <dt>已延遲任務</dt>
            <dd :class="toneIf(p.delayedTasks)">{{ p.delayedTasks }}<span class="unit">項</span></dd>
          </div>
          <div>
            <dt>未結 Issue</dt>
            <dd :class="toneIf(d.openIssueTotal)">{{ d.openIssueTotal }}<span class="unit">件</span></dd>
          </div>
        </dl>
        <div v-if="levels.length" class="levels">
          <span v-for="l in levels" :key="l.lv" class="lv" :class="'lv-' + l.lv.toLowerCase()">
            {{ ISSUE_LEVEL[l.lv].label }}<b>{{ l.n }}</b>
          </span>
        </div>
        <p v-else class="empty">無未結 Issue</p>
        <div class="closed-note">已結 {{ p.closedIssues }} 件</div>
      </div>

      <div class="qb">
        <div class="qb-title">成員與近期任務</div>
        <div v-if="members.length" class="members">
          <Avatar v-for="x in members" :key="x.id" :member="x.m" :size="22" :ring="2" :overlap="6" />
        </div>
        <p v-else class="empty">尚未指派成員</p>
        <ul v-if="upcoming.length" class="tasks">
          <li v-for="u in upcoming" :key="u.key">
            <span class="task-name">{{ u.name }}</span>
            <span class="task-date" :class="{ 'due-soon': u.soon }">{{ u.date }}</span>
            <span class="task-who"><Avatar :member="u.who" :size="18" />{{ u.who?.name ?? '?' }}</span>
          </li>
        </ul>
        <p v-else class="empty">沒有近期到期任務</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

/*
 * ── 標頭：底色與分隔線用使用端給的 PM 色（--pm-*），沒給時退回中性色 ──
 * 右端的「進入」入口塊要整個標頭高，所以右側不留內距；高 48px（觸控 44 以上）。
 */
.qv-head {
  display: flex;
  align-items: center;
  gap: var(--sp-5);
  min-height: calc(var(--ctrl-h) + 2 * var(--sp-4));
  padding: 0 0 0 var(--sp-7);
  background: var(--pm-sel, var(--surface-2));
  border-bottom: 1px solid var(--pm-soft, var(--border-1));
}

.qv-name {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-panel);
  font-weight: var(--fw-bold);
  color: var(--text-1);
}

.qv-pm {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-3);
  flex: 0 0 auto;
  padding-left: var(--sp-5);
  border-left: 1px solid var(--pm-soft, var(--border-1));
  font-size: var(--fs-14);
  color: var(--text-2);
  white-space: nowrap;
}

.qv-pm-role {
  font-size: var(--fs-date);
  color: var(--text-3);
}

.spacer {
  flex: 1;
}

/* ── 四組內容：卡片內 2×2，時間軸（withHead）4 欄橫排；依速覽本身的寬度（不是視窗）收欄 ── */
.quick-view {
  container-type: inline-size;
}

.quick {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-6);
  padding-top: var(--sp-7);
  border-top: 1px solid var(--border-1);
}

.with-head .quick {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  padding: var(--sp-6) var(--sp-7) var(--sp-7);
  border-top: 0;
}

/* 平板直向：時間軸速覽 4 欄擠不下（日期、單位、任務名都會斷），改 2×2 */
@container (max-width: 900px) {
  .with-head .quick {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

/* 平板直向的專案卡：一格只剩 150px 左右，改單欄 */
@container (max-width: 400px) {
  .quick {
    grid-template-columns: minmax(0, 1fr);
  }
}

.qb {
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
  min-width: 0;
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  border-radius: var(--r-card);
  padding: var(--sp-6) var(--sp-7);
}

.qb-title {
  font-size: var(--fs-date);
  font-weight: var(--fw-bold);
  color: var(--text-muted);
  letter-spacing: var(--tracking-overline);
}

/* 速覽 1：實際 / 理論合一進度條（PlanActualBar）+ 四種狀態數 */
.progress-foot {
  display: flex;
  align-items: baseline;
  font-size: var(--fs-meta);
}

.bar-frac {
  color: var(--text-muted);
}

.progress-foot .gap-note {
  margin-left: auto;
}

.track {
  height: var(--sp-3);
  border-radius: var(--r-4);
  background: var(--border-1);
  overflow: hidden;
}

/* 背景重載後寬度跟著動（A30） */
.fill {
  height: 100%;
  border-radius: inherit;
  transition: width var(--t-progress) var(--ease);
}

.fill-time {
  background: var(--text-muted);
}

.gap-note {
  font-size: var(--fs-meta);
  font-weight: var(--fw-bold);
}

.gap-note.behind {
  color: var(--danger-text);
}

.gap-note.warn {
  color: var(--ist-paused-fg);
}

.gap-note.flat {
  color: var(--text-muted);
}

.counts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-3) var(--sp-8);
  list-style: none;
  margin: 0;
  padding: 0;
}

.counts li {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-meta);
  color: var(--text-3);
  white-space: nowrap;
}

.counts b {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-14);
  color: var(--text-1);
  margin-left: auto;
}

.dot {
  width: var(--r-badge);
  height: var(--r-badge);
  flex: 0 0 var(--r-badge);
  border-radius: 50%;
}

.dot-done {
  background: var(--st-done-dot);
}

.dot-doing {
  background: var(--st-doing-dot);
}

.dot-paused {
  background: var(--st-paused-dot);
}

.dot-todo {
  background: var(--st-todo-dot);
}

/* 速覽 2：時程 */
.range {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-3);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-14);
  color: var(--text-2);
}

/* 日期本身不斷行（連字號會被當斷點），放不下時只在箭頭處換行 */
.range > span {
  white-space: nowrap;
}

.range-arrow {
  color: var(--text-placeholder);
}

.kv {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--sp-4);
  margin: 0;
}

.kv > div {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.kv dt {
  font-size: var(--fs-meta);
  color: var(--text-muted);
}

.kv dd {
  margin: 0;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-dialog);
  font-weight: var(--fw-medium);
  color: var(--text-1);
  line-height: var(--lh-tight);
}

.kv dd .unit {
  font-family: var(--font-sans);
  font-size: var(--fs-meta);
  font-weight: var(--fw-regular);
  color: var(--text-muted);
  padding-left: var(--sp-1);
}

.kv dd.danger {
  color: var(--danger-text);
}

.kv dd.warn {
  color: var(--ist-paused-fg);
}

.kv-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

/* 速覽 3：風險項目 */
.levels {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-3);
}

.lv {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-1) var(--sp-4);
  border-radius: var(--r-badge);
  background: var(--surface-3);
  font-size: var(--fs-meta);
  font-weight: var(--fw-bold);
}

.lv b {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-14);
  color: var(--text-1);
}

.lv-a {
  color: var(--cls-a-text);
}

.lv-b {
  color: var(--cls-b-text);
}

.lv-c {
  color: var(--cls-c-text);
}

.lv-d {
  color: var(--cls-d-text);
}

.closed-note {
  font-size: var(--fs-meta);
  color: var(--text-muted);
  margin-top: auto;
}

/* 速覽 4：成員 + 近期到期任務 */
.members {
  display: flex;
  align-items: center;
  padding-right: var(--sp-3);
}

.tasks {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  list-style: none;
  margin: 0;
  padding: 0;
}

.tasks li {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  padding: var(--sp-3) 0;
  border-top: 1px solid var(--border-hair);
  font-size: var(--fs-14);
  color: var(--text-1);
}

.task-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-date {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-meta);
  color: var(--text-muted);
  flex: 0 0 auto;
}

.task-date.due-soon {
  color: var(--danger-text);
  font-weight: var(--fw-medium);
}

.task-who {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  flex: 0 0 auto;
  font-size: var(--fs-meta);
  color: var(--text-3);
}

.empty {
  margin: 0;
  font-size: var(--fs-meta);
  color: var(--text-muted);
}
</style>
