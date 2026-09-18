import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  ECGLead,
  HRVData,
  RPeak,
  ArrhythmiaEvent,
  ECGBackendResponse,
  Scenario,
} from '../types';
import { RHYTHM_CRITERIA } from '../types';

// Gaussian function for PQRST wave simulation
function gaussian(x: number, amplitude: number, center: number, width: number): number {
  return amplitude * Math.exp(-((x - center) ** 2) / (2 * width ** 2));
}

/**
 * 由分析参数派生稳定的 32 位哈希种子 (FNV-1a)。
 * 同一段数据（导联 / 时长 / 采样率 / 心率 / 场景相同）重复提交时
 * 派生出相同种子，保证生成的信号与结论和第一次一致。
 */
function hashSeed(raw: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 确定性伪随机数发生器 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Lead-specific PQRST configuration
interface LeadConfig {
  pAmplitude: number;
  qAmplitude: number;
  rAmplitude: number;
  sAmplitude: number;
  tAmplitude: number;
  stElevation: number;
}

const LEAD_CONFIGS: Record<string, LeadConfig> = {
  'I': { pAmplitude: 0.12, qAmplitude: -0.05, rAmplitude: 0.8, sAmplitude: -0.1, tAmplitude: 0.25, stElevation: 0.0 },
  'II': { pAmplitude: 0.15, qAmplitude: -0.1, rAmplitude: 1.2, sAmplitude: -0.2, tAmplitude: 0.3, stElevation: 0.0 },
  'III': { pAmplitude: 0.10, qAmplitude: -0.08, rAmplitude: 0.9, sAmplitude: -0.15, tAmplitude: 0.2, stElevation: 0.0 },
  'aVR': { pAmplitude: -0.10, qAmplitude: 0.05, rAmplitude: -0.8, sAmplitude: 0.1, tAmplitude: -0.2, stElevation: 0.0 },
  'aVL': { pAmplitude: 0.10, qAmplitude: -0.03, rAmplitude: 0.6, sAmplitude: -0.05, tAmplitude: 0.2, stElevation: 0.0 },
  'aVF': { pAmplitude: 0.13, qAmplitude: -0.09, rAmplitude: 1.0, sAmplitude: -0.18, tAmplitude: 0.28, stElevation: 0.0 },
  'V1': { pAmplitude: 0.08, qAmplitude: 0.0, rAmplitude: 0.3, sAmplitude: -0.8, tAmplitude: 0.15, stElevation: 0.0 },
  'V2': { pAmplitude: 0.10, qAmplitude: -0.02, rAmplitude: 0.6, sAmplitude: -0.6, tAmplitude: 0.25, stElevation: 0.0 },
  'V3': { pAmplitude: 0.10, qAmplitude: -0.05, rAmplitude: 0.9, sAmplitude: -0.4, tAmplitude: 0.3, stElevation: 0.0 },
  'V4': { pAmplitude: 0.12, qAmplitude: -0.08, rAmplitude: 1.3, sAmplitude: -0.25, tAmplitude: 0.35, stElevation: 0.0 },
  'V5': { pAmplitude: 0.12, qAmplitude: -0.1, rAmplitude: 1.1, sAmplitude: -0.15, tAmplitude: 0.3, stElevation: 0.0 },
  'V6': { pAmplitude: 0.10, qAmplitude: -0.08, rAmplitude: 0.9, sAmplitude: -0.1, tAmplitude: 0.25, stElevation: 0.0 },
};

// Generate a single PQRST cycle at normalized time t (0 to 1)
function generatePQRSTCycle(tNorm: number, config: LeadConfig): number {
  const p = gaussian(tNorm, config.pAmplitude, 0.12, 0.035);
  const q = gaussian(tNorm, config.qAmplitude, 0.22, 0.012);
  const r = gaussian(tNorm, config.rAmplitude, 0.26, 0.012);
  const s = gaussian(tNorm, config.sAmplitude, 0.30, 0.015);
  const tWave = gaussian(tNorm, config.tAmplitude, 0.48, 0.055);
  const st = (tNorm > 0.32 && tNorm < 0.42) ? config.stElevation : 0.0;
  return p + q + r + s + tWave + st;
}

export const useECGStore = defineStore('ecg', () => {
  // State
  const selectedLead = ref<string>('II');
  const heartRate = ref<number>(72);
  const samplingRate = ref<number>(500);
  const duration = ref<number>(10);
  const isMonitoring = ref<boolean>(false);
  const ecgData = ref<ECGLead | null>(null);
  const hrvData = ref<HRVData | null>(null);
  const arrhythmiaEvents = ref<ArrhythmiaEvent[]>([]);
  const rhythmDiagnosis = ref<string>('');
  const isLoading = ref<boolean>(false);
  const useBackend = ref<boolean>(false);
  const backendUrl = ref<string>('http://localhost:8000');
  // 采集场景：决定本次判定使用静息还是运动口径
  const scenario = ref<Scenario>('rest');

  let animationTimer: ReturnType<typeof setInterval> | null = null;
  let scrollOffset = ref<number>(0);

  // Getters
  const currentSamples = computed(() => ecgData.value?.samples ?? []);
  const currentRPeaks = computed(() => ecgData.value?.rPeaks ?? []);
  const currentHeartRate = computed(() => hrvData.value?.heartRate ?? heartRate.value);

  // Actions

  /**
   * Generate realistic 12-lead ECG waveform data with PQRST morphology
   */
  function generateECGWaveform(): ECGLead {
    const totalSamples = Math.floor(duration.value * samplingRate.value);
    const samples: number[] = new Array(totalSamples);
    const config = LEAD_CONFIGS[selectedLead.value] || LEAD_CONFIGS['II'];
    const cycleDuration = 60.0 / heartRate.value;
    const samplesPerCycle = Math.floor(cycleDuration * samplingRate.value);

    // 种子随全部分析参数（含场景）派生，同参数重复提交结果一致
    const rng = mulberry32(
      hashSeed(
        `${selectedLead.value}|${duration.value}|${samplingRate.value}|${heartRate.value}|${scenario.value}`
      )
    );

    for (let i = 0; i < totalSamples; i++) {
      const time = i / samplingRate.value;
      const cyclePosition = (time % cycleDuration) / cycleDuration;

      // Add slight HRV variation per beat
      const beatIndex = Math.floor(time / cycleDuration);
      const hrvFactor = 1.0 + Math.sin(beatIndex * 0.7) * 0.02;

      samples[i] = generatePQRSTCycle(cyclePosition, config) * hrvFactor;

      // Add baseline wander
      samples[i] += 0.03 * Math.sin(2 * Math.PI * 0.15 * time);
      // Add small noise（确定性随机源）
      samples[i] += (rng() - 0.5) * 0.02;
    }

    return {
      leadName: selectedLead.value,
      samplingRate: samplingRate.value,
      duration: duration.value,
      samples,
      rPeaks: [],
    };
  }

  /**
   * Pan-Tompkins R-peak detection algorithm
   * Simplified implementation: bandpass -> differentiate -> square -> integrate -> threshold
   */
  function detectRPeaks(samples: number[], sr: number): RPeak[] {
    const rPeaks: RPeak[] = [];
    const minDistance = Math.floor(0.2 * sr); // 200ms minimum between peaks

    // Simple moving average for baseline
    const windowSize = Math.floor(0.15 * sr);
    const threshold = samples.reduce((a, b) => a + b, 0) / samples.length;
    const stdDev = Math.sqrt(
      samples.reduce((sum, s) => sum + (s - threshold) ** 2, 0) / samples.length
    );
    const detectionThreshold = threshold + 0.5 * stdDev;

    let lastPeakIndex = -minDistance;

    for (let i = 1; i < samples.length - 1; i++) {
      if (
        samples[i] > detectionThreshold &&
        samples[i] > samples[i - 1] &&
        samples[i] > samples[i + 1] &&
        i - lastPeakIndex >= minDistance
      ) {
        // Find local maximum in a small window
        let maxVal = samples[i];
        let maxIdx = i;
        const searchRadius = Math.floor(0.01 * sr);
        for (let j = Math.max(0, i - searchRadius); j < Math.min(samples.length, i + searchRadius); j++) {
          if (samples[j] > maxVal) {
            maxVal = samples[j];
            maxIdx = j;
          }
        }

        rPeaks.push({
          index: maxIdx,
          time: maxIdx / sr,
          amplitude: maxVal,
        });
        lastPeakIndex = i;
      }
    }

    return rPeaks;
  }

  /**
   * Calculate HRV metrics from R-peak positions
   * SDNN, RMSSD, pNN50
   */
  function calculateHRV(rPeaks: RPeak[], sr: number): HRVData {
    if (rPeaks.length < 3) {
      return { heartRate: heartRate.value, sdnn: 0, rmssd: 0, pnn50: 0, nnIntervals: [] };
    }

    const nnIntervals: number[] = [];
    for (let i = 1; i < rPeaks.length; i++) {
      const rr = ((rPeaks[i].index - rPeaks[i - 1].index) / sr) * 1000;
      nnIntervals.push(rr);
    }

    const meanRR = nnIntervals.reduce((a, b) => a + b, 0) / nnIntervals.length;
    const hr = meanRR > 0 ? 60000 / meanRR : 0;

    // SDNN
    const variance = nnIntervals.reduce((sum, x) => sum + (x - meanRR) ** 2, 0) / nnIntervals.length;
    const sdnn = Math.sqrt(variance);

    // RMSSD
    let sumSquaredDiffs = 0;
    for (let i = 1; i < nnIntervals.length; i++) {
      sumSquaredDiffs += (nnIntervals[i] - nnIntervals[i - 1]) ** 2;
    }
    const rmssd = Math.sqrt(sumSquaredDiffs / (nnIntervals.length - 1));

    // pNN50
    let nn50Count = 0;
    for (let i = 1; i < nnIntervals.length; i++) {
      if (Math.abs(nnIntervals[i] - nnIntervals[i - 1]) > 50) {
        nn50Count++;
      }
    }
    const pnn50 = (nn50Count / (nnIntervals.length - 1)) * 100;

    return {
      heartRate: Math.round(hr * 10) / 10,
      sdnn: Math.round(sdnn * 100) / 100,
      rmssd: Math.round(rmssd * 100) / 100,
      pnn50: Math.round(pnn50 * 100) / 100,
      nnIntervals,
    };
  }

  /**
   * Arrhythmia detection：按所选采集场景口径判定
   * - 心动过速 / 心动过缓：严格越过场景上下限，边界值留在正常区间，不会两边都判
   * - 心律不规则（疑似房颤）：RR 间期变异系数严格超过场景阈值
   * - ST 段抬高：与场景无关，始终保留
   */
  function detectArrhythmias(
    hrv: HRVData,
    rPeaks: RPeak[],
    samples: number[],
    sr: number,
    currentScenario: Scenario
  ): ArrhythmiaEvent[] {
    const events: ArrhythmiaEvent[] = [];
    const hr = hrv.heartRate;
    const criteria = RHYTHM_CRITERIA[currentScenario];
    const tag = `[${criteria.label}口径]`;

    // 心率等于上限不判，留在正常区间
    if (hr > criteria.tachycardiaMinHr) {
      events.push({
        eventType: 'tachycardia',
        confidence: Math.min(1.0, (hr - criteria.tachycardiaMinHr) / 50 + 0.6),
        description:
          `${tag} 心率过快 (${hr.toFixed(0)} BPM > ${criteria.tachycardiaMinHr})，检测到心动过速`,
        timestamp: rPeaks[0]?.time ?? 0,
      });
    }

    // 心率等于下限不判；与过速分支严格互斥
    if (hr > 0 && hr < criteria.bradycardiaMaxHr) {
      events.push({
        eventType: 'bradycardia',
        confidence: Math.min(1.0, (criteria.bradycardiaMaxHr - hr) / 30 + 0.6),
        description:
          `${tag} 心率过慢 (${hr.toFixed(0)} BPM < ${criteria.bradycardiaMaxHr})，检测到心动过缓`,
        timestamp: rPeaks[0]?.time ?? 0,
      });
    }

    // ST-segment elevation detection
    let stElevationCount = 0;
    for (const rp of rPeaks) {
      const stStart = rp.index + Math.floor(0.08 * sr);
      const stEnd = rp.index + Math.floor(0.12 * sr);
      if (stEnd < samples.length) {
        const stLevel = samples.slice(stStart, stEnd).reduce((a, b) => a + b, 0) / (stEnd - stStart);
        const blStart = Math.max(0, rp.index - Math.floor(0.2 * sr));
        const baseline = samples.slice(blStart, rp.index).reduce((a, b) => a + b, 0) / (rp.index - blStart);
        if (stLevel - baseline > 0.1) {
          stElevationCount++;
        }
      }
    }
    if (stElevationCount > rPeaks.length * 0.5) {
      events.push({
        eventType: 'st_elevation',
        confidence: Math.min(1.0, stElevationCount / Math.max(1, rPeaks.length)),
        description: `${tag} 检测到 ST 段抬高，可能提示心肌梗死`,
        timestamp: rPeaks[0]?.time ?? 0,
      });
    }

    // Irregular rhythm detection（RR 间期变异系数）
    if (hrv.nnIntervals.length > 3) {
      const mean = hrv.nnIntervals.reduce((a, b) => a + b, 0) / hrv.nnIntervals.length;
      const variance =
        hrv.nnIntervals.reduce((sum, x) => sum + (x - mean) ** 2, 0) / hrv.nnIntervals.length;
      const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
      if (cv > criteria.irregularCv) {
        events.push({
          eventType: 'atrial_fibrillation',
          confidence: Math.min(1.0, cv * 2),
          description:
            `${tag} RR 间期不规则 (CV ${cv.toFixed(2)} > ${criteria.irregularCv.toFixed(2)})，可能提示房颤`,
          timestamp: rPeaks[0]?.time ?? 0,
        });
      }
    }

    if (events.length === 0) {
      events.push({
        eventType: 'normal',
        confidence: 1.0,
        description: `${tag} 正常窦性心律`,
        timestamp: rPeaks[0]?.time ?? 0,
      });
    }

    return events;
  }

  /**
   * 生成整体心律诊断结论，结论统一以本次使用的场景口径开头，
   * 与后端 get_rhythm_diagnosis 保持一致。
   */
  function buildRhythmDiagnosis(
    events: ArrhythmiaEvent[],
    hrv: HRVData,
    currentScenario: Scenario
  ): string {
    const tag = `[${RHYTHM_CRITERIA[currentScenario].label}口径] `;
    const types = events.map((e) => e.eventType);

    if (types.includes('st_elevation')) return tag + 'ST 段抬高 - 建议立即就医检查';
    if (types.includes('tachycardia') && types.includes('atrial_fibrillation')) {
      return tag + '快速房颤 - 建议进一步心脏评估';
    }
    if (types.includes('tachycardia')) return tag + '窦性心动过速 - 请结合临床症状判断';
    if (types.includes('bradycardia')) return tag + '窦性心动过缓 - 建议关注心率变化';
    if (types.includes('atrial_fibrillation')) return tag + '心律不规则 - 疑似房颤，建议 Holter 监测';
    return tag + `正常窦性心律 | HR: ${hrv.heartRate.toFixed(0)} BPM | SDNN: ${hrv.sdnn.toFixed(1)} ms`;
  }

  /**
   * Run full ECG analysis (frontend simulation)
   */
  async function analyzeECG() {
    isLoading.value = true;

    if (useBackend.value) {
      // Use backend API
      try {
        const response = await fetch(`${backendUrl.value}/ecg/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lead_name: selectedLead.value,
            duration: duration.value,
            sampling_rate: samplingRate.value,
            heart_rate: heartRate.value,
            scenario: scenario.value,
          }),
        });
        const data: ECGBackendResponse = await response.json();
        ecgData.value = {
          leadName: data.lead.lead_name,
          samplingRate: data.lead.sampling_rate,
          duration: data.lead.duration,
          samples: data.lead.samples,
          rPeaks: data.lead.r_peaks.map((rp: any) => ({
            index: rp.index,
            time: rp.time,
            amplitude: rp.amplitude,
          })),
        };
        hrvData.value = {
          heartRate: data.hrv.heart_rate,
          sdnn: data.hrv.sdnn,
          rmssd: data.hrv.rmssd,
          pnn50: data.hrv.pnn50,
          nnIntervals: data.hrv.nn_intervals,
        };
        arrhythmiaEvents.value = data.arrhythmia_events.map((evt: any) => ({
          eventType: evt.event_type,
          confidence: evt.confidence,
          description: evt.description,
          timestamp: evt.timestamp,
        }));
        rhythmDiagnosis.value = data.rhythm_diagnosis;
        // 以后端实际使用的场景口径为准（旧后端缺字段时保留本地选择）
        if (data.scenario) {
          scenario.value = data.scenario;
        }
      } catch (error) {
        console.error('Backend API error:', error);
        // Fallback to frontend simulation
        runFrontendAnalysis();
      }
    } else {
      runFrontendAnalysis();
    }

    isLoading.value = false;
  }

  function runFrontendAnalysis() {
    const lead = generateECGWaveform();
    const peaks = detectRPeaks(lead.samples, lead.samplingRate);
    lead.rPeaks = peaks;
    ecgData.value = lead;

    const hrv = calculateHRV(peaks, lead.samplingRate);
    hrvData.value = hrv;

    const events = detectArrhythmias(hrv, peaks, lead.samples, lead.samplingRate, scenario.value);
    arrhythmiaEvents.value = events;

    rhythmDiagnosis.value = buildRhythmDiagnosis(events, hrv, scenario.value);
  }

  /**
   * Start real-time monitoring simulation
   */
  function startMonitoring() {
    isMonitoring.value = true;
    analyzeECG();
    animationTimer = setInterval(() => {
      scrollOffset.value += 5;
      // Regenerate data every full cycle
      if (scrollOffset.value >= currentSamples.value.length) {
        scrollOffset.value = 0;
        analyzeECG();
      }
    }, 50);
  }

  /**
   * Stop monitoring
   */
  function stopMonitoring() {
    isMonitoring.value = false;
    if (animationTimer) {
      clearInterval(animationTimer);
      animationTimer = null;
    }
  }

  /**
   * Select a different ECG lead
   */
  function selectLead(lead: string) {
    selectedLead.value = lead;
    if (isMonitoring.value) {
      analyzeECG();
    }
  }

  /**
   * Update heart rate setting
   */
  function setHeartRate(hr: number) {
    heartRate.value = hr;
    if (isMonitoring.value) {
      analyzeECG();
    }
  }

  /**
   * 切换采集场景（静息 / 运动），后续判定按对应口径执行
   */
  function setScenario(next: Scenario) {
    if (next === scenario.value) return;
    scenario.value = next;
    if (isMonitoring.value) {
      analyzeECG();
    }
  }

  return {
    // State
    selectedLead,
    heartRate,
    samplingRate,
    duration,
    isMonitoring,
    ecgData,
    hrvData,
    arrhythmiaEvents,
    rhythmDiagnosis,
    isLoading,
    useBackend,
    backendUrl,
    scrollOffset,
    scenario,
    // Getters
    currentSamples,
    currentRPeaks,
    currentHeartRate,
    // Actions
    analyzeECG,
    startMonitoring,
    stopMonitoring,
    selectLead,
    setHeartRate,
    setScenario,
    generateECGWaveform,
    detectRPeaks,
    calculateHRV,
    detectArrhythmias,
    buildRhythmDiagnosis,
  };
});
