<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { loadProject } from '@/api/project'
import type { Task } from '@/types/models'

// S1 只驗資料能載進來；S2 起改由 taskStore 持有。
const tasks = ref<Task[]>([])

onMounted(async () => {
  const data = await loadProject()
  tasks.value = data.tasks
})
</script>

<template>
  <h1>Dashboard</h1>
  <span data-testid="task-count">{{ tasks.length }}</span>
</template>
