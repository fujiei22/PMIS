<script setup lang="ts">
import { onMounted } from 'vue'
import { loadProject } from '@/api/project'
import { useTaskStore } from '@/stores/task'

// 資料只從這裡進來一次：api → taskStore.load() 再分給其他 store。
const taskStore = useTaskStore()

onMounted(async () => {
  taskStore.load(await loadProject())
})
</script>

<template>
  <h1>Dashboard</h1>
  <span data-testid="task-count">{{ taskStore.tasks.length }}</span>
</template>
