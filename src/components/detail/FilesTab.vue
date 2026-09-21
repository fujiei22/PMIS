<script setup lang="ts">
// 檔案頁籤：把留言裡的附件攤平成圖示磚或清單，支援全選、多選下載與點圖開 Lightbox。
// legacy 對照：模板 :1230-1287，fileRows :3889-3921。
import { computed } from 'vue'
import { fileKind, isImage } from '@/lib/file'
import { fileSize } from '@/lib/format'
import { useCommentStore, type CommentFile } from '@/stores/comment'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{ targetId: string }>()

const ui = useUiStore()
const comment = useCommentStore()

const files = computed(() => comment.filesForTarget(props.targetId))
const selected = computed(() => comment.fileSel)
const allOn = computed(() => files.value.length > 0 && selected.value.length === files.value.length)

/** 全選框的字：全選 ✓、部分 –、都沒選就空白。legacy `allFilesMark` :3908 */
const allMark = computed(() => (allOn.value ? '✓' : selected.value.length ? '–' : ''))
const selLabel = computed(() =>
  selected.value.length
    ? `已選 ${selected.value.length} / ${files.value.length}`
    : `共 ${files.value.length} 個檔案`,
)

function isOn(id: string): boolean {
  return selected.value.includes(id)
}

function toggle(id: string): void {
  comment.fileSel = isOn(id) ? selected.value.filter((x) => x !== id) : selected.value.concat([id])
}

/** 全選 / 全不選。legacy `toggleAllFiles` :3911 */
function toggleAll(): void {
  comment.fileSel = selected.value.length === files.value.length ? [] : files.value.map((f) => f.id)
}

/**
 * 下載一個檔：有 blob url 就直接下，mocks 的附件沒有內容，補一份說明用的文字 blob。
 * legacy `downloadFile` :2174
 */
function download(f: CommentFile): void {
  const a = document.createElement('a')
  a.download = f.name
  if (f.url) {
    a.href = f.url
    a.click()
    return
  }
  const blob = new Blob([`(demo) ${f.name} — ${f.size} bytes`], { type: 'text/plain' })
  a.href = URL.createObjectURL(blob)
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

/** 依序下載選取的檔，間隔 220ms 免得瀏覽器擋掉連續下載。legacy :3918 */
function downloadSelected(): void {
  if (!selected.value.length) return
  files.value
    .filter((f) => isOn(f.id))
    .forEach((f, i) => setTimeout(() => download(f), i * 220))
}

function openLightbox(f: CommentFile): void {
  ui.lightbox = { url: f.url ?? '', name: f.name, size: fileSize(f.size) }
}

/** 上傳日期顯示成 'YYYY/MM/DD'。legacy `date` :3893 */
function dateOf(at: string): string {
  return at.replace(/-/g, '/')
}
</script>

<template>
  <div class="files-tab">
    <div class="file-bar">
      <div class="file-select-all" role="button" @click="toggleAll()">
        <span class="checkbox" :class="{ on: selected.length > 0 }">{{ allMark }}</span>
        <span>全選</span>
      </div>
      <div class="file-sel-label">{{ selLabel }}</div>
      <div class="bar-gap"></div>
      <div
        class="download-selected"
        :class="{ on: selected.length > 0 }"
        role="button"
        @click="downloadSelected()"
      >
        <span class="dl-glyph">⤓</span><span>下載所選</span>
      </div>
    </div>

    <div class="file-body">
      <div v-if="comment.fileView === 'icon'" class="file-grid">
        <div v-for="f in files" :key="f.id" class="file-tile" :class="{ on: isOn(f.id) }">
          <div
            class="tile-check checkbox"
            :class="{ on: isOn(f.id) }"
            role="button"
            @click.stop="toggle(f.id)"
          >
            {{ isOn(f.id) ? '✓' : '' }}
          </div>
          <div class="tile-dl" role="button" title="下載" @click.stop="download(f)">⤓</div>
          <div
            v-if="isImage(f.name) && f.url"
            class="tile-thumb"
            role="button"
            @click="openLightbox(f)"
          >
            <img :src="f.url" :alt="f.name" />
          </div>
          <div
            v-else
            class="tile-glyph"
            :style="{ background: fileKind(f.name).bg, color: fileKind(f.name).tint }"
          >
            {{ fileKind(f.name).glyph }}
          </div>
          <div class="tile-name" :title="f.name">{{ f.name }}</div>
          <div class="tile-size">{{ fileSize(f.size) }}</div>
          <div class="tile-date">{{ dateOf(f.at) }}</div>
        </div>
      </div>

      <div v-else class="file-table">
        <div class="table-head">
          <div></div>
          <div>檔名</div>
          <div>上傳日期</div>
          <div class="right">大小</div>
          <div></div>
        </div>
        <div v-for="f in files" :key="f.id" class="file-row" :class="{ on: isOn(f.id) }">
          <div class="checkbox" :class="{ on: isOn(f.id) }" role="button" @click.stop="toggle(f.id)">
            {{ isOn(f.id) ? '✓' : '' }}
          </div>
          <div class="row-name">
            <span class="row-glyph" :style="{ color: fileKind(f.name).tint }">
              {{ fileKind(f.name).glyph }}
            </span>
            <span :title="f.name">{{ f.name }}</span>
          </div>
          <div class="row-date">{{ dateOf(f.at) }}</div>
          <div class="row-size">{{ fileSize(f.size) }}</div>
          <div class="row-dl" role="button" title="下載" @click.stop="download(f)">⤓</div>
        </div>
      </div>

      <div v-if="!files.length" class="empty">此篩選條件下沒有檔案</div>
    </div>
  </div>
</template>

<style scoped>
.files-tab {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.file-bar {
  display: flex;
  align-items: center;
  gap: var(--sp-5);
  padding: 9px var(--sp-8);
  border-bottom: 1px solid var(--border-1);
  background: var(--surface-1);
}

.file-select-all {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: var(--fs-meta);
  color: var(--text-3);
  cursor: pointer;
}

.checkbox {
  width: 15px;
  height: 15px;
  flex: 0 0 15px;
  border-radius: var(--sp-2);
  border: 1px solid var(--border-control);
  background: var(--surface-1);
  color: var(--surface-1);
  font-size: var(--fs-micro);
  line-height: 13px;
  text-align: center;
  cursor: pointer;
}

.checkbox.on {
  border-color: var(--accent);
  background: var(--accent);
}

.file-sel-label {
  font-size: var(--fs-date);
  color: var(--text-placeholder);
  font-family: var(--font-mono);
}

.bar-gap {
  flex: 1;
}

.download-selected {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--r-badge) var(--sp-6);
  font-size: var(--fs-meta);
  font-weight: var(--fw-bold);
  border-radius: var(--r-input);
  background: var(--border-1);
  color: var(--text-placeholder);
  cursor: default;
}

.download-selected.on {
  background: var(--accent);
  color: var(--surface-1);
  cursor: pointer;
}

.dl-glyph {
  font-size: var(--fs-caption);
}

.file-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--sp-7) var(--sp-8);
}

/* ---------- 圖示檢視 ---------- */

.file-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(122px, 1fr));
  gap: var(--sp-5);
}

.file-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-6) var(--sp-4);
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  border-radius: var(--r-card);
}

.file-tile.on {
  background: color-mix(in srgb, var(--accent) 6%, transparent);
  border-color: var(--accent);
}

.file-tile:hover {
  border-color: var(--accent-tint-3);
}

.tile-check {
  position: absolute;
  left: var(--sp-3);
  top: var(--sp-3);
  z-index: 2;
  width: 17px;
  height: 17px;
  flex: 0 0 17px;
  border-radius: var(--r-badge);
  font-size: var(--fs-caption);
  line-height: 15px;
  box-shadow: var(--shadow-checkbox);
}

.tile-dl {
  position: absolute;
  right: var(--sp-3);
  top: var(--sp-3);
  z-index: 2;
  width: 19px;
  height: 19px;
  border-radius: var(--r-6);
  background: var(--scrim-on-bar);
  border: 1px solid var(--border-1);
  color: var(--text-3);
  font-size: var(--fs-caption);
  line-height: 17px;
  text-align: center;
  cursor: pointer;
}

.tile-dl:hover {
  background: var(--accent);
  color: var(--surface-1);
  border-color: var(--accent);
}

.tile-thumb {
  width: 100%;
  height: 78px;
  border-radius: var(--r-card-sm);
  overflow: hidden;
  background: var(--surface-3);
  cursor: zoom-in;
}

.tile-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.tile-glyph {
  width: 46px;
  height: 46px;
  border-radius: var(--r-card);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-19);
}

.tile-name {
  font-size: var(--fs-date);
  color: var(--text-2);
  text-align: center;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tile-size {
  font-size: var(--fs-caption);
  color: var(--text-placeholder);
  font-family: var(--font-mono);
}

.tile-date {
  font-size: var(--fs-caption);
  color: var(--text-muted);
  font-family: var(--font-mono);
}

/* ---------- 清單檢視 ---------- */

.file-table {
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  border-radius: var(--r-card);
  overflow: hidden;
}

.table-head,
.file-row {
  display: grid;
  grid-template-columns: 22px minmax(140px, 2fr) 96px 66px 28px;
  gap: var(--sp-4);
  padding: var(--sp-4) var(--sp-6);
  align-items: center;
}

.table-head {
  background: var(--surface-2);
  border-bottom: 1px solid var(--border-1);
  font-size: var(--fs-pill);
  color: var(--text-muted);
  font-weight: var(--fw-bold);
}

.file-row {
  border-bottom: 1px solid var(--border-hair);
  font-size: var(--fs-meta);
  color: var(--text-2);
  background: transparent;
}

.file-row.on {
  background: color-mix(in srgb, var(--accent) 5%, transparent);
}

.file-row .checkbox {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  line-height: 14px;
}

.row-name {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.row-name span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-glyph {
  font-size: var(--fs-date);
  flex: 0 0 auto;
}

.row-date,
.row-size {
  font-size: var(--fs-date);
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.row-size,
.right {
  text-align: right;
}

.row-dl {
  width: 24px;
  height: 22px;
  border-radius: var(--r-6);
  border: 1px solid var(--border-1);
  color: var(--text-3);
  font-size: var(--fs-caption);
  line-height: 20px;
  text-align: center;
  cursor: pointer;
}

.row-dl:hover {
  background: var(--accent);
  color: var(--surface-1);
  border-color: var(--accent);
}

.empty {
  padding: 34px 0;
  text-align: center;
  font-size: 12.7px;
  color: var(--text-placeholder);
}
</style>
