export interface ECGLead {
  leadName: string;
  samplingRate: number;
  duration: number;
  samples: number[];
  rPeaks: RPeak[];
}

export type Scenario = 'rest' | 'exercise';

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

// Backend API payload (snake_case, mirrors the FastAPI response model)
export interface ECGAnalysisResponse {
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
    event_type: string;
    confidence: number;
    description: string;
    timestamp: number;
  }[];
  rhythm_diagnosis: string;
  scenario: Scenario;
}

export interface ECGAnalysisRequest {
  leadName: string;
  duration: number;
  samplingRate: number;
  heartRate: number;
  scenario: Scenario;
}

export const LEAD_NAMES: string[] = [
  'I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'
];
