<script setup lang="ts">
// 留言頁籤：倒序的留言串（含附件縮圖）＋ 底部草稿區（拖檔、貼圖、選檔、Enter 送出）。
// legacy 對照：模板 :1161-1228，commentRows :3871-3888、draft :3932-3962。
import { computed, ref } from 'vue'
import Avatar from '@/components/common/Avatar.vue'
import { fileKind, isImage } from '@/lib/file'
import { fileSize } from '@/lib/format'
import { useCommentStore } from '@/stores/comment'
import { useMemberStore } from '@/stores/member'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{ targetId: string; targetKind: 'task' | 'issue' }>()

const ui = useUiStore()
const comment = useCommentStore()
const memberStore = useMemberStore()

const rows = computed(() => comment.forTarget(props.targetId))
/** 拖檔經過時整塊底色轉藍。legacy `dropOver` :3932 */
const dropOver = ref(false)
const canSend = computed(() => !!comment.draft.trim() || comment.draftFiles.length > 0)

/** 'YYYY-MM-DDTHH:mm' → 'YYYY/MM/DD HH:mm'。legacy `when` :3875 */
function whenOf(at: string): string {
  return at.replace('T', ' ').replace(/-/g, '/')
}

function send(): void {
  comment.send(props.targetId, props.targetKind)
}

/** Enter 送出、Shift+Enter 換行。legacy `onDraftKey` :3941 */
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

/** 貼上剪貼簿裡的圖片就當附件。legacy `onDraftPaste` :3944 */
function onPaste(e: ClipboardEvent): void {
  const items = Array.from(e.clipboardData?.items ?? [])
  const imgs = items
    .filter((it) => it.kind === 'file' && (it.type || '').startsWith('image'))
    .map((it) => it.getAsFile())
    .filter((f): f is File => !!f)
  if (imgs.length) {
    e.preventDefault()
    comment.addDraftFiles(imgs)
  }
}

function onDrop(e: DragEvent): void {
  dropOver.value = false
  const files = e.dataTransfer?.files
  if (files?.length) comment.addDraftFiles(files)
}

/** 選完檔要把 input 清空，不然同一個檔選第二次不會觸發 change。legacy :3958 */
function onPick(e: Event): void {
  const input = e.target as HTMLInputElement
  if (input.files?.length) comment.addDraftFiles(input.files)
  input.value = ''
}

function openLightbox(name: string, size: number, url: string): void {
  ui.lightbox = { url, name, size: fileSize(size) }
}
</script>

<template>
  <div class="comments-tab">
    <div class="comment-list">
      <div v-for="c in rows" :key="c.id" class="comment-row">
        <Avatar :member="memberStore.byId(c.memberId)" :size="30" />
        <div class="bubble">
          <div class="bubble-head">
            <div class="comment-author">{{ memberStore.byId(c.memberId)?.name ?? '成員' }}</div>
            <div class="comment-when">{{ whenOf(c.at) }}</div>
            <div class="head-gap"></div>
            <div class="comment-del" role="button" title="刪除留言" @click="comment.remove(c.id)">
              ✕
            </div>
          </div>
          <div class="comment-text">{{ c.text }}</div>
          <div v-if="c.files.length" class="attachments">
            <template v-for="(f, i) in c.files" :key="i">
              <div
                v-if="isImage(f.name) && f.url"
                class="thumb"
                :title="f.name"
                role="button"
                @click="openLightbox(f.name, f.size, f.url!)"
              >
                <img :src="f.url" :alt="f.name" />
                <div class="thumb-caption">
                  <span class="thumb-name">{{ f.name }}</span>
                  <span class="thumb-size">{{ fileSize(f.size) }}</span>
                </div>
              </div>
              <div v-else class="attach-chip">
                <span class="attach-glyph" :style="{ color: fileKind(f.name).tint }">
                  {{ fileKind(f.name).glyph }}
                </span>
                <span class="attach-name">{{ f.name }}</span>
                <span class="attach-size">{{ fileSize(f.size) }}</span>
              </div>
            </template>
          </div>
        </div>
      </div>

      <div v-if="!rows.length" class="empty">此篩選條件下沒有留言</div>
    </div>

    <div
      class="draft-zone"
      :class="{ over: dropOver }"
      @dragover.prevent="dropOver = true"
      @dragleave.prevent="dropOver = false"
      @drop.prevent="onDrop"
    >
      <div v-if="comment.draftFiles.length" class="draft-files">
        <div v-for="(f, i) in comment.draftFiles" :key="i" class="draft-chip">
          <img v-if="f.url" class="draft-thumb" :src="f.url" :alt="f.name" />
          <span class="draft-name">{{ f.name }}</span>
          <span class="draft-size">{{ fileSize(f.size) }}</span>
          <span class="draft-x" role="button" @click="comment.removeDraft(i)">✕</span>
        </div>
      </div>

      <textarea
        v-model="comment.draft"
        class="draft-input"
        rows="2"
        placeholder="留言、貼上圖片，或把檔案拖進來（Enter 送出、Shift+Enter 換行）"
        @keydown="onKey"
        @paste="onPaste"
      ></textarea>

      <div class="draft-actions">
        <label class="attach-btn">
          <span class="attach-icon">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.1"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 16V4"></path>
              <path d="M7 9l5-5 5 5"></path>
              <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"></path>
            </svg>
          </span>
          <span>附件</span>
          <input type="file" multiple hidden @change="onPick" />
        </label>
        <div class="actions-gap"></div>
        <div class="send-btn" :class="{ on: canSend }" role="button" @click="send()">送出</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.comments-tab {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.comment-list {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--sp-7) var(--sp-8);
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
}

.comment-row {
  display: flex;
  gap: var(--sp-5);
}

.bubble {
  flex: 1;
  min-width: 0;
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  border-radius: var(--r-card);
  padding: var(--sp-5) var(--sp-6);
}

.bubble-head {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  margin-bottom: var(--sp-2);
}

.comment-author {
  font-size: 12.7px;
  font-weight: var(--fw-bold);
  color: var(--text-1);
}

.comment-when {
  font-size: var(--fs-pill);
  color: var(--text-placeholder);
  font-family: var(--font-mono);
}

.head-gap {
  flex: 1;
}

.comment-del {
  font-size: var(--fs-caption);
  color: var(--glyph-disabled);
  cursor: pointer;
  padding: 1px var(--sp-2);
  border-radius: var(--r-badge);
}

.comment-del:hover {
  color: var(--danger);
  background: var(--danger-bg);
}

.comment-text {
  font-size: 13.2px;
  color: var(--text-2);
  line-height: var(--lh-loose);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.attachments {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-3);
  margin-top: var(--sp-4);
}

.thumb {
  position: relative;
  width: 186px;
  height: 132px;
  border: 1px solid var(--border-1);
  border-radius: var(--r-card-sm);
  overflow: hidden;
  background: var(--surface-3);
  cursor: zoom-in;
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.thumb-caption {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: var(--sp-1) 7px;
  background: var(--scrim-caption);
  color: var(--surface-1);
  font-size: var(--fs-caption);
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}

.thumb-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thumb-size {
  font-family: var(--font-mono);
  opacity: 0.8;
}

.attach-chip {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-4);
  border: 1px solid var(--border-1);
  border-radius: var(--r-input);
  background: var(--surface-2);
  max-width: 100%;
}

.attach-glyph {
  font-size: var(--fs-date);
}

.attach-name {
  font-size: var(--fs-date);
  color: var(--text-2);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attach-size {
  font-size: var(--fs-caption);
  color: var(--text-placeholder);
  font-family: var(--font-mono);
  flex: 0 0 auto;
}

.empty {
  padding: 30px 0;
  text-align: center;
  font-size: 12.7px;
  color: var(--text-placeholder);
}

/* ---------- 草稿區 ---------- */

.draft-zone {
  border-top: 1px solid var(--border-1);
  background: var(--surface-1);
  padding: var(--sp-5) var(--sp-7);
  transition: background 0.15s ease;
}

.draft-zone.over {
  background: var(--accent-tint-1);
}

.draft-files {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-3);
  margin-bottom: var(--sp-4);
}

.draft-chip {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-1) var(--sp-2) var(--sp-1) var(--r-badge);
  border: 1px solid var(--accent-tint-3);
  border-radius: var(--r-input);
  background: var(--accent-tint-1);
  max-width: 100%;
}

.draft-thumb {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  border-radius: var(--r-badge);
  object-fit: cover;
  display: block;
}

.draft-name {
  font-size: var(--fs-pill);
  color: var(--accent-hover);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.draft-size {
  font-size: var(--fs-micro);
  color: var(--accent-soft);
  font-family: var(--font-mono);
}

.draft-x {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: var(--accent-tint-2);
  color: var(--accent-hover);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-9);
  cursor: pointer;
}

.draft-x:hover {
  background: var(--accent);
  color: var(--surface-1);
}

.draft-input {
  width: 100%;
  padding: var(--sp-4) var(--sp-5);
  font-size: 13.2px;
  line-height: 1.6;
  color: var(--text-1);
  border: 1px solid var(--border-1);
  border-radius: var(--r-card-sm);
  resize: none;
  font-family: inherit;
  background: var(--surface-2);
}

/* 留言框 focus 沿用 legacy 的淺藍框（:1218） */
.draft-input:focus {
  background: var(--surface-1);
  border-color: var(--focus-soft);
  outline: none;
}

.draft-actions {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  margin-top: var(--sp-4);
}

.attach-btn {
  display: flex;
  align-items: center;
  gap: var(--r-badge);
  font-size: var(--fs-meta);
  color: var(--text-3);
  cursor: pointer;
  padding: var(--r-badge) var(--sp-5);
  border: 1px solid var(--border-1);
  border-radius: var(--r-input);
  background: var(--surface-1);
}

.attach-btn:hover {
  border-color: var(--text-placeholder);
  color: var(--text-1);
}

.attach-icon {
  display: inline-flex;
  align-items: center;
  color: var(--text-placeholder);
}

.actions-gap {
  flex: 1;
}

.send-btn {
  padding: var(--sp-3) var(--sp-8);
  font-size: 12.7px;
  font-weight: var(--fw-bold);
  border-radius: var(--r-input);
  background: var(--border-1);
  color: var(--text-placeholder);
  cursor: default;
}

.send-btn.on {
  background: var(--accent);
  color: var(--surface-1);
  cursor: pointer;
}
</style>
