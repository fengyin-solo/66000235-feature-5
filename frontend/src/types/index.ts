export interface ECGLead {
  leadName: string;
  samplingRate: number;
  duration: number;
  samples: number[];
  rPeaks: RPeak[];
}

export interface RPeak {
  index: number;
  time: number;
  amplitude: number;
}

export interface HRVData {
  heartRate: number;
  sdnn: number;
  rmssd: number;
  pnn50: number;
  nnIntervals: number[];
}

export interface ArrhythmiaEvent {
  eventType: 'normal' | 'tachycardia' | 'bradycardia' | 'st_elevation' | 'atrial_fibrillation' | 'premature_ventricular_contraction';
  confidence: number;
  description: string;
  timestamp: number;
}

export interface ECGAnalysisResponse {
  lead: ECGLead;
  hrv: HRVData;
  arrhythmiaEvents: ArrhythmiaEvent[];
  rhythmDiagnosis: string;
  scenario: Scenario;
  scenarioLabel: string;
}

export interface ECGAnalysisRequest {
  leadName: string;
  duration: number;
  samplingRate: number;
  heartRate: number;
  scenario: Scenario;
}

/** 后端 /ecg/analyze 原始响应（snake_case） */
export interface ECGBackendResponse {
  lead: {
    lead_name: string;
    sampling_rate: number;
    duration: number;
    samples: number[];
    r_peaks: { index: number; time: number; amplitude: number }[];
  };
  hrv: {
    heart_rate: number;
    sdnn: number;
    rmssd: number;
    pnn50: number;
    nn_intervals: number[];
  };
  arrhythmia_events: {
    event_type: ArrhythmiaEvent['eventType'];
    confidence: number;
    description: string;
    timestamp: number;
  }[];
  rhythm_diagnosis: string;
  scenario?: Scenario;
  scenario_label?: string;
}

/** 采集场景：静息 / 运动，两套判定口径 */
export type Scenario = 'rest' | 'exercise';

export const SCENARIO_LABELS: Record<Scenario, string> = {
  rest: '静息',
  exercise: '运动',
};

export interface RhythmCriteria {
  /** 场景中文名 */
  label: string;
  /** 心率严格高于该值判心动过速，等于不判 */
  tachycardiaMinHr: number;
  /** 心率严格低于该值判心动过缓，等于不判 */
  bradycardiaMaxHr: number;
  /** RR 间期变异系数 (CV) 严格大于该值判心律不规则 */
  irregularCv: number;
}

/**
 * 各采集场景的判定口径，与后端 thresholds.py 保持一致。
 * 边界值属于正常区间，严格越过才判异常，因此不会两边都判。
 */
export const RHYTHM_CRITERIA: Record<Scenario, RhythmCriteria> = {
  rest: {
    label: '静息',
    tachycardiaMinHr: 100,
    bradycardiaMaxHr: 60,
    irregularCv: 0.15,
  },
  exercise: {
    label: '运动',
    tachycardiaMinHr: 150,
    bradycardiaMaxHr: 50,
    irregularCv: 0.2,
  },
};

export const LEAD_NAMES: string[] = [
  'I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'
];
