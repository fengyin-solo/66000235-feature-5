from fastapi import APIRouter, Query
from typing import List

from app.models.schemas import (
    LeadName,
    ECGLead,
    ECGAnalysisRequest,
    ECGAnalysisResponse,
    RPeak,
    HRVMetrics,
    ArrhythmiaEvent,
    ArrhythmiaType,
)
from app.services.ecg_service import (
    generate_ecg_signal,
    pan_tompkins_r_peak_detection,
    calculate_hrv,
    detect_arrhythmia,
    get_rhythm_diagnosis,
)
from app.services.thresholds import get_scenario_label

router = APIRouter()


@router.get("/leads", response_model=List[str])
async def get_available_leads():
    """Get list of available ECG leads."""
    return [lead.value for lead in LeadName]


@router.post("/analyze", response_model=ECGAnalysisResponse)
async def analyze_ecg(request: ECGAnalysisRequest):
    """
    Generate and analyze ECG signal for a specified lead.
    
    Performs:
    1. PQRST waveform generation
    2. Pan-Tompkins R-peak detection
    3. HRV metrics calculation
    4. Arrhythmia detection and classification
    """
    # 本次判定实际使用的场景口径
    scenario = request.scenario.value

    # Generate ECG signal（种子按请求参数派生，同参数重复提交结果一致）
    time_array, ecg_signal = generate_ecg_signal(
        lead_name=request.lead_name.value,
        duration=request.duration,
        sampling_rate=request.sampling_rate,
        heart_rate=request.heart_rate,
        scenario=scenario,
    )

    # Detect R-peaks using Pan-Tompkins algorithm
    r_peaks_raw = pan_tompkins_r_peak_detection(ecg_signal, request.sampling_rate)
    r_peaks = [
        RPeak(index=rp["index"], time=rp["time"], amplitude=rp["amplitude"])
        for rp in r_peaks_raw
    ]

    # Calculate HRV metrics
    hrv_raw = calculate_hrv(r_peaks_raw, request.sampling_rate)
    hrv = HRVMetrics(**hrv_raw)

    # Detect arrhythmia events（按所选场景口径执行）
    arrhythmia_raw = detect_arrhythmia(
        r_peaks_raw, hrv_raw, ecg_signal, request.sampling_rate, scenario
    )
    arrhythmia_events = []
    for evt in arrhythmia_raw:
        arrhythmia_events.append(
            ArrhythmiaEvent(
                event_type=ArrhythmiaType(evt["event_type"]),
                confidence=evt["confidence"],
                description=evt["description"],
                timestamp=evt["timestamp"],
            )
        )

    # Generate rhythm diagnosis
    diagnosis = get_rhythm_diagnosis(arrhythmia_raw, hrv_raw, scenario)

    # Build lead data
    lead = ECGLead(
        lead_name=request.lead_name,
        sampling_rate=request.sampling_rate,
        duration=request.duration,
        samples=[round(float(s), 4) for s in ecg_signal],
        r_peaks=r_peaks,
    )

    return ECGAnalysisResponse(
        lead=lead,
        hrv=hrv,
        arrhythmia_events=arrhythmia_events,
        rhythm_diagnosis=diagnosis,
        scenario=request.scenario,
        scenario_label=get_scenario_label(scenario),
    )
