<template>
  <div class="flex h-screen bg-gray-950 text-white overflow-hidden">
    <!-- Sidebar -->
    <aside class="w-72 bg-gray-900/80 border-r border-gray-800 flex flex-col p-4 overflow-y-auto shrink-0">
      <!-- Logo -->
      <div class="mb-6">
        <h1 class="text-xl font-bold text-emerald-400 flex items-center gap-2">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
          ECG 监测系统
        </h1>
        <p class="text-xs text-gray-500 mt-1">心电实时监测与心律失常检测</p>
      </div>

      <!-- Lead Selector -->
      <div class="mb-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-2">导联选择</h3>
        <div class="grid grid-cols-3 gap-1.5">
          <button
            v-for="lead in leadNames"
            :key="lead"
            @click="store.selectLead(lead)"
            :class="[
              'px-2 py-1.5 rounded text-xs font-medium transition-all',
              store.selectedLead === lead
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600 hover:text-gray-300',
            ]"
          >
            {{ lead }}
          </button>
        </div>
      </div>

      <!-- Scenario Selector -->
      <div class="mb-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-2">采集场景</h3>
        <div class="grid grid-cols-2 gap-1.5">
          <button
            v-for="opt in scenarioOptions"
            :key="opt.value"
            @click="store.setScenario(opt.value)"
            :class="[
              'px-2 py-1.5 rounded text-xs font-medium transition-all',
              store.scenario === opt.value
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50'
                : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600 hover:text-gray-300',
            ]"
          >
            {{ opt.label }}
          </button>
        </div>
        <p class="text-xs text-gray-500 mt-1">
          判定口径: 过速&gt;{{ store.currentCriteria.tachycardiaHr }} / 过缓&lt;{{ store.currentCriteria.bradycardiaHr }} BPM
        </p>
      </div>

      <!-- Heart Rate Control -->
      <div class="mb-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-2">
          模拟心率: <span class="text-emerald-400">{{ store.heartRate }} BPM</span>
        </h3>
        <input
          type="range"
          min="30"
          max="180"
          :value="store.heartRate"
          @input="store.setHeartRate(Number(($event.target as HTMLInputElement).value))"
          class="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
        />
        <div class="flex justify-between text-xs text-gray-500 mt-1">
          <span>30</span>
          <span>180</span>
        </div>
      </div>

      <!-- Duration Control -->
      <div class="mb-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-2">
          记录时长: <span class="text-cyan-400">{{ store.duration }}s</span>
        </h3>
        <input
          type="range"
          min="5"
          max="30"
          step="5"
          v-model.number="store.duration"
          class="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
        />
      </div>

      <!-- Backend Toggle -->
      <div class="mb-5">
        <label class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            v-model="store.useBackend"
            class="w-4 h-4 rounded accent-emerald-500"
          />
          使用后端 API
        </label>
        <p class="text-xs text-gray-500 mt-1 ml-6">连接 FastAPI 后端分析服务</p>
      </div>

      <!-- Control Buttons -->
      <div class="space-y-2 mt-auto">
        <button
          @click="store.startMonitoring"
          :disabled="store.isMonitoring"
          :class="[
            'w-full py-2.5 rounded-lg font-medium text-sm transition-all',
            store.isMonitoring
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20',
          ]"
        >
          {{ store.isMonitoring ? '监测中...' : '开始监测' }}
        </button>
        <button
          @click="store.stopMonitoring"
          :disabled="!store.isMonitoring"
          :class="[
            'w-full py-2.5 rounded-lg font-medium text-sm transition-all',
            !store.isMonitoring
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
              : 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20',
          ]"
        >
          停止监测
        </button>
        <button
          @click="store.analyzeECG()"
          class="w-full py-2.5 rounded-lg font-medium text-sm bg-cyan-600 hover:bg-cyan-500 text-white transition-all shadow-lg shadow-cyan-600/20"
        >
          单次分析
        </button>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 overflow-y-auto p-5 space-y-4">
      <!-- Status Bar -->
      <div class="flex items-center justify-between bg-gray-900/60 rounded-lg px-4 py-2.5 border border-gray-800">
        <div class="flex items-center gap-3">
          <div
            :class="[
              'w-2.5 h-2.5 rounded-full',
              store.isMonitoring ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600',
            ]"
          />
          <span class="text-sm text-gray-300">
            {{ store.isMonitoring ? '实时监测中' : '待机状态' }}
          </span>
          <span class="text-xs text-gray-500">|</span>
          <span class="text-sm text-gray-400">
            导联: <span class="text-emerald-400 font-medium">{{ store.selectedLead }}</span>
          </span>
          <span class="text-xs text-gray-500">|</span>
          <span class="text-sm text-gray-400">
            场景: <span class="text-cyan-400 font-medium">{{ store.currentCriteria.label }}</span>
          </span>
        </div>
        <div class="text-sm text-gray-400">
          诊断: <span class="text-cyan-300">{{ store.rhythmDiagnosis || '等待分析...' }}</span>
        </div>
      </div>

      <!-- Loading Indicator -->
      <div v-if="store.isLoading" class="flex items-center justify-center py-8">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
        <span class="ml-3 text-gray-400">正在分析心电信号...</span>
      </div>

      <!-- ECG Waveform -->
      <ECGWaveform
        v-if="store.ecgData"
        :samples="store.ecgData.samples"
        :r-peaks="store.ecgData.rPeaks"
        :lead-name="store.ecgData.leadName"
        :sampling-rate="store.ecgData.samplingRate"
        :duration="store.ecgData.duration"
        :scroll-offset="store.scrollOffset"
      />
      <div v-else class="bg-gray-900/40 rounded-lg border border-gray-800 p-8 text-center">
        <p class="text-gray-500 text-lg">点击"开始监测"或"单次分析"生成心电信号</p>
      </div>

      <!-- Bottom Section: HRV + Arrhythmia -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <!-- HRV Analysis -->
        <HRVAnalysis :hrv-data="store.hrvData" />

        <!-- Arrhythmia Alerts -->
        <div class="arrhythmia-panel bg-gray-900/60 rounded-lg border border-gray-800 p-4">
          <h3 class="text-lg font-semibold text-red-400 mb-3">心律失常检测</h3>
          <div v-if="store.arrhythmiaEvents.length === 0" class="text-gray-500 text-sm py-4 text-center">
            尚未检测到心律失常事件
          </div>
          <div v-else class="space-y-2">
            <div
              v-for="(event, idx) in store.arrhythmiaEvents"
              :key="idx"
              :class="[
                'p-3 rounded-lg border text-sm',
                event.eventType === 'normal'
                  ? 'bg-emerald-900/20 border-emerald-700/30 text-emerald-300'
                  : event.eventType === 'tachycardia'
                  ? 'bg-red-900/20 border-red-700/30 text-red-300'
                  : event.eventType === 'bradycardia'
                  ? 'bg-yellow-900/20 border-yellow-700/30 text-yellow-300'
                  : event.eventType === 'st_elevation'
                  ? 'bg-orange-900/20 border-orange-700/30 text-orange-300'
                  : 'bg-purple-900/20 border-purple-700/30 text-purple-300',
              ]"
            >
              <div class="flex items-center justify-between">
                <span class="font-medium">{{ getEventLabel(event.eventType) }}</span>
                <span class="text-xs opacity-70">
                  置信度: {{ (event.confidence * 100).toFixed(0) }}%
                </span>
              </div>
              <p class="mt-1 text-xs opacity-80">{{ event.description }}</p>
              <p class="mt-1 text-xs opacity-50">
                时间: {{ event.timestamp.toFixed(2) }}s
              </p>
            </div>
          </div>

          <!-- Rhythm Summary -->
          <div v-if="store.hrvData" class="mt-4 pt-3 border-t border-gray-700/50">
            <h4 class="text-xs font-semibold text-gray-400 mb-2">分析摘要</h4>
            <div class="grid grid-cols-2 gap-2 text-xs">
              <div class="text-gray-500">
                R 峰值数: <span class="text-gray-300">{{ store.ecgData?.rPeaks.length ?? 0 }}</span>
              </div>
              <div class="text-gray-500">
                平均 RR: <span class="text-gray-300">{{ avgRR }} ms</span>
              </div>
              <div class="text-gray-500">
                采样点数: <span class="text-gray-300">{{ store.ecgData?.samples.length ?? 0 }}</span>
              </div>
              <div class="text-gray-500">
                采样率: <span class="text-gray-300">{{ store.samplingRate }} Hz</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useECGStore } from './store/ecg';
import ECGWaveform from './components/ECGWaveform.vue';
import HRVAnalysis from './components/HRVAnalysis.vue';
import { LEAD_NAMES } from './types';
import type { Scenario } from './types';

const store = useECGStore();
const leadNames = LEAD_NAMES;

const scenarioOptions: { value: Scenario; label: string }[] = [
  { value: 'rest', label: '静息' },
  { value: 'exercise', label: '运动' },
];

const avgRR = computed(() => {
  if (!store.hrvData || store.hrvData.nnIntervals.length === 0) return '--';
  const avg = store.hrvData.nnIntervals.reduce((a, b) => a + b, 0) / store.hrvData.nnIntervals.length;
  return avg.toFixed(1);
});

function getEventLabel(type: string): string {
  const labels: Record<string, string> = {
    normal: '正常窦性心律',
    tachycardia: '心动过速',
    bradycardia: '心动过缓',
    st_elevation: 'ST 段抬高',
    atrial_fibrillation: '房颤',
    premature_ventricular_contraction: '室性早搏',
  };
  return labels[type] || type;
}

onMounted(() => {
  // Auto-start monitoring on mount
  store.analyzeECG();
});

onUnmounted(() => {
  store.stopMonitoring();
});
</script>

<style scoped>
input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  height: 14px;
  width: 14px;
  border-radius: 50%;
  cursor: pointer;
}
</style>
