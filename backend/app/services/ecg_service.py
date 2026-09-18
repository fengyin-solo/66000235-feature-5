import hashlib

import numpy as np
from scipy import signal
from typing import List, Tuple, Dict, Any, Optional
import math

from app.services.thresholds import get_thresholds, get_scenario_label


def analysis_seed(
    lead_name: str,
    duration: float,
    sampling_rate: int,
    heart_rate: float,
    scenario: str,
) -> int:
    """
    由分析请求参数派生确定性随机种子。

    同一段数据（导联 / 时长 / 采样率 / 心率 / 场景完全相同）重复提交时
    派生出相同种子，因此生成的信号与最终结论与第一次保持一致。
    """
    raw = f"{lead_name}|{duration}|{sampling_rate}|{heart_rate}|{scenario}"
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return int(digest[:16], 16)


def gaussian(x: np.ndarray, amplitude: float, center: float, width: float) -> np.ndarray:
    """Generate a Gaussian function for ECG wave simulation."""
    return amplitude * np.exp(-((x - center) ** 2) / (2 * width ** 2))


def generate_pqrst_cycle(
    t: np.ndarray,
    heart_rate: float = 72.0,
    lead_config: Dict[str, float] = None,
) -> np.ndarray:
    """
    Generate a single PQRST cycle using Gaussian functions for each wave component.
    
    Each wave (P, Q, R, S, T) is modeled as a Gaussian with specific amplitude,
    center position, and width to simulate realistic ECG morphology.
    """
    if lead_config is None:
        lead_config = {
            "p_amplitude": 0.15,
            "q_amplitude": -0.1,
            "r_amplitude": 1.0,
            "s_amplitude": -0.2,
            "t_amplitude": 0.3,
            "st_elevation": 0.0,
        }

    cycle_duration = 60.0 / heart_rate
    t_normalized = t / cycle_duration

    # P wave: atrial depolarization (starts at ~0ms, peaks at ~80ms)
    p_wave = gaussian(t_normalized, lead_config["p_amplitude"], 0.12, 0.035)

    # Q wave: initial ventricular depolarization (~160ms)
    q_wave = gaussian(t_normalized, lead_config["q_amplitude"], 0.22, 0.012)

    # R wave: main ventricular depolarization (~200ms, tallest peak)
    r_wave = gaussian(t_normalized, lead_config["r_amplitude"], 0.26, 0.012)

    # S wave: late ventricular depolarization (~240ms)
    s_wave = gaussian(t_normalized, lead_config["s_amplitude"], 0.30, 0.015)

    # T wave: ventricular repolarization (~360ms, broader)
    t_wave = gaussian(t_normalized, lead_config["t_amplitude"], 0.48, 0.055)

    # ST segment elevation (if any)
    st_segment = lead_config.get("st_elevation", 0.0) * np.where(
        (t_normalized > 0.32) & (t_normalized < 0.42), 1.0, 0.0
    )

    return p_wave + q_wave + r_wave + s_wave + t_wave + st_segment


def get_lead_config(lead_name: str) -> Dict[str, float]:
    """Get lead-specific configuration for realistic 12-lead ECG simulation."""
    configs = {
        "I": {"p_amplitude": 0.12, "q_amplitude": -0.05, "r_amplitude": 0.8, "s_amplitude": -0.1, "t_amplitude": 0.25, "st_elevation": 0.0},
        "II": {"p_amplitude": 0.15, "q_amplitude": -0.1, "r_amplitude": 1.2, "s_amplitude": -0.2, "t_amplitude": 0.3, "st_elevation": 0.0},
        "III": {"p_amplitude": 0.10, "q_amplitude": -0.08, "r_amplitude": 0.9, "s_amplitude": -0.15, "t_amplitude": 0.2, "st_elevation": 0.0},
        "aVR": {"p_amplitude": -0.10, "q_amplitude": 0.05, "r_amplitude": -0.8, "s_amplitude": 0.1, "t_amplitude": -0.2, "st_elevation": 0.0},
        "aVL": {"p_amplitude": 0.10, "q_amplitude": -0.03, "r_amplitude": 0.6, "s_amplitude": -0.05, "t_amplitude": 0.2, "st_elevation": 0.0},
        "aVF": {"p_amplitude": 0.13, "q_amplitude": -0.09, "r_amplitude": 1.0, "s_amplitude": -0.18, "t_amplitude": 0.28, "st_elevation": 0.0},
        "V1": {"p_amplitude": 0.08, "q_amplitude": 0.0, "r_amplitude": 0.3, "s_amplitude": -0.8, "t_amplitude": 0.15, "st_elevation": 0.0},
        "V2": {"p_amplitude": 0.10, "q_amplitude": -0.02, "r_amplitude": 0.6, "s_amplitude": -0.6, "t_amplitude": 0.25, "st_elevation": 0.0},
        "V3": {"p_amplitude": 0.10, "q_amplitude": -0.05, "r_amplitude": 0.9, "s_amplitude": -0.4, "t_amplitude": 0.3, "st_elevation": 0.0},
        "V4": {"p_amplitude": 0.12, "q_amplitude": -0.08, "r_amplitude": 1.3, "s_amplitude": -0.25, "t_amplitude": 0.35, "st_elevation": 0.0},
        "V5": {"p_amplitude": 0.12, "q_amplitude": -0.1, "r_amplitude": 1.1, "s_amplitude": -0.15, "t_amplitude": 0.3, "st_elevation": 0.0},
        "V6": {"p_amplitude": 0.10, "q_amplitude": -0.08, "r_amplitude": 0.9, "s_amplitude": -0.1, "t_amplitude": 0.25, "st_elevation": 0.0},
    }
    return configs.get(lead_name, configs["II"])


def generate_ecg_signal(
    lead_name: str = "II",
    duration: float = 10.0,
    sampling_rate: int = 500,
    heart_rate: float = 72.0,
    noise_level: float = 0.02,
    include_arrhythmia: bool = False,
    scenario: str = "rest",
    seed: Optional[int] = None,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Generate a realistic ECG signal for a specified lead.

    Args:
        lead_name: ECG lead name (I, II, III, aVR, aVL, aVF, V1-V6)
        duration: Signal duration in seconds
        sampling_rate: Sampling rate in Hz
        heart_rate: Heart rate in BPM
        noise_level: Baseline noise amplitude
        include_arrhythmia: Whether to simulate arrhythmia events
        scenario: 采集场景 (rest/exercise)，参与随机种子派生
        seed: 随机种子；不传时按请求参数派生，保证同参数重复提交结果一致

    Returns:
        Tuple of (time_array, ecg_signal)
    """
    if seed is None:
        seed = analysis_seed(lead_name, duration, sampling_rate, heart_rate, scenario)
    rng = np.random.default_rng(seed)

    total_samples = int(duration * sampling_rate)
    t = np.linspace(0, duration, total_samples)
    ecg = np.zeros(total_samples)

    lead_config = get_lead_config(lead_name)
    cycle_duration = 60.0 / heart_rate

    # Generate consecutive PQRST cycles
    beat_count = 0
    for start_time in np.arange(0, duration, cycle_duration):
        end_time = min(start_time + cycle_duration, duration)
        mask = (t >= start_time) & (t < end_time)
        if not np.any(mask):
            continue

        t_cycle = t[mask] - start_time

        # Add slight HRV variation to each beat
        hrv_factor = 1.0 + rng.normal(0, 0.02)
        modified_hr = heart_rate * hrv_factor
        cycle_config = lead_config.copy()

        # Simulate arrhythmia if requested
        if include_arrhythmia and beat_count > 2:
            if rng.random() < 0.1:  # 10% chance of PVC
                cycle_config["r_amplitude"] *= 1.8
                cycle_config["t_amplitude"] *= -0.5
                cycle_config["q_amplitude"] *= 0.5

        ecg[mask] += generate_pqrst_cycle(t_cycle, modified_hr, cycle_config)
        beat_count += 1

    # Add baseline wander (low-frequency noise ~0.15 Hz)
    baseline_wander = 0.03 * np.sin(2 * np.pi * 0.15 * t)

    # Add high-frequency noise (muscle artifact)
    noise = noise_level * rng.standard_normal(total_samples)

    ecg = ecg + baseline_wander + noise

    return t, ecg


def pan_tompkins_r_peak_detection(
    ecg_signal: np.ndarray, sampling_rate: int = 500
) -> List[Dict[str, Any]]:
    """
    Simplified Pan-Tompkins algorithm for R-peak detection.
    
    Steps:
    1. Bandpass filter (5-15 Hz)
    2. Differentiation
    3. Squaring
    4. Moving window integration
    5. Adaptive thresholding for peak detection
    """
    # Step 1: Bandpass filter (5-15 Hz) to isolate QRS complex
    nyquist = sampling_rate / 2
    low = 5.0 / nyquist
    high = 15.0 / nyquist
    b, a = signal.butter(2, [low, high], btype="band")
    filtered = signal.filtfilt(b, a, ecg_signal)

    # Step 2: Differentiation - highlights QRS slopes
    diff_signal = np.diff(filtered)

    # Step 3: Squaring - emphasizes large differences
    squared = diff_signal ** 2

    # Step 4: Moving window integration (150ms window)
    window_size = int(0.15 * sampling_rate)
    kernel = np.ones(window_size) / window_size
    integrated = np.convolve(squared, kernel, mode="same")

    # Step 5: Adaptive threshold peak detection
    threshold = np.mean(integrated) + 0.5 * np.std(integrated)
    min_distance = int(0.2 * sampling_rate)  # Minimum 200ms between peaks

    r_peaks = []
    above_threshold = integrated > threshold
    last_peak = -min_distance

    for i in range(1, len(integrated) - 1):
        if above_threshold[i] and i - last_peak >= min_distance:
            # Find the actual peak in the original signal within a window
            search_start = max(0, i - window_size // 2)
            search_end = min(len(ecg_signal), i + window_size // 2)
            local_peak = search_start + np.argmax(ecg_signal[search_start:search_end])

            if local_peak not in [rp["index"] for rp in r_peaks]:
                r_peaks.append({
                    "index": int(local_peak),
                    "time": float(local_peak / sampling_rate),
                    "amplitude": float(ecg_signal[local_peak]),
                })
                last_peak = i

    return r_peaks


def calculate_hrv(r_peaks: List[Dict[str, Any]], sampling_rate: int = 500) -> Dict[str, Any]:
    """
    Calculate Heart Rate Variability (HRV) metrics from R-peak positions.
    
    Metrics:
    - Heart Rate (BPM)
    - SDNN: Standard deviation of NN intervals
    - RMSSD: Root mean square of successive differences
    - pNN50: Percentage of successive differences > 50ms
    """
    if len(r_peaks) < 3:
        return {
            "heart_rate": 0.0,
            "sdnn": 0.0,
            "rmssd": 0.0,
            "pnn50": 0.0,
            "nn_intervals": [],
        }

    # Calculate RR intervals in milliseconds
    rr_intervals = []
    for i in range(1, len(r_peaks)):
        rr = (r_peaks[i]["index"] - r_peaks[i - 1]["index"]) / sampling_rate * 1000
        rr_intervals.append(rr)

    rr_array = np.array(rr_intervals)

    # Heart rate from mean RR interval
    mean_rr = np.mean(rr_array)
    heart_rate = 60000.0 / mean_rr if mean_rr > 0 else 0.0

    # SDNN: Standard deviation of all NN intervals
    sdnn = float(np.std(rr_array))

    # RMSSD: Root mean square of successive differences
    successive_diffs = np.diff(rr_array)
    rmssd = float(np.sqrt(np.mean(successive_diffs ** 2))) if len(successive_diffs) > 0 else 0.0

    # pNN50: Percentage of successive differences > 50ms
    if len(successive_diffs) > 0:
        nn50_count = np.sum(np.abs(successive_diffs) > 50)
        pnn50 = float(nn50_count / len(successive_diffs) * 100)
    else:
        pnn50 = 0.0

    return {
        "heart_rate": round(heart_rate, 1),
        "sdnn": round(sdnn, 2),
        "rmssd": round(rmssd, 2),
        "pnn50": round(pnn50, 2),
        "nn_intervals": [round(float(x), 2) for x in rr_intervals],
    }


def detect_arrhythmia(
    r_peaks: List[Dict[str, Any]],
    hrv: Dict[str, Any],
    ecg_signal: np.ndarray,
    sampling_rate: int = 500,
    scenario: str = "rest",
) -> List[Dict[str, Any]]:
    """
    Detect arrhythmia events based on R-peaks, HRV metrics, and signal morphology.

    判定口径随采集场景 (rest 静息 / exercise 运动) 切换，阈值边界本身属于
    正常区间（严格 > / < 才判异常），因此边界心率不会同时判为过速与过缓。

    Detects:
    - Tachycardia: HR 严格高于场景心动过速上限
    - Bradycardia: HR 严格低于场景心动过缓下限
    - ST-segment elevation: potential myocardial infarction
    - Irregular rhythm patterns: RR 间期变异系数严格高于场景阈值
    """
    thresholds = get_thresholds(scenario)
    label = thresholds["label"]
    tachy_limit = thresholds["tachycardia_min_hr"]
    brady_limit = thresholds["bradycardia_max_hr"]
    irregular_cv_limit = thresholds["irregular_cv"]

    events = []
    heart_rate = hrv["heart_rate"]

    # Tachycardia detection（心率等于上限不判，留在正常区间）
    if heart_rate > tachy_limit:
        events.append({
            "event_type": "tachycardia",
            "confidence": min(1.0, (heart_rate - tachy_limit) / 50 + 0.6),
            "description": (
                f"[{label}口径] 心率过快 ({heart_rate:.0f} BPM > {tachy_limit:.0f})，"
                f"检测到心动过速"
            ),
            "timestamp": r_peaks[0]["time"] if r_peaks else 0.0,
        })

    # Bradycardia detection（心率等于下限不判，留在正常区间；与过速严格互斥）
    if 0 < heart_rate < brady_limit:
        events.append({
            "event_type": "bradycardia",
            "confidence": min(1.0, (brady_limit - heart_rate) / 30 + 0.6),
            "description": (
                f"[{label}口径] 心率过慢 ({heart_rate:.0f} BPM < {brady_limit:.0f})，"
                f"检测到心动过缓"
            ),
            "timestamp": r_peaks[0]["time"] if r_peaks else 0.0,
        })

    # ST-segment elevation detection（与场景口径无关，始终保留）
    if len(r_peaks) > 0:
        st_elevation_count = 0
        for rp in r_peaks:
            idx = rp["index"]
            # ST segment: ~80-120ms after R-peak
            st_start = idx + int(0.08 * sampling_rate)
            st_end = idx + int(0.12 * sampling_rate)
            if st_end < len(ecg_signal):
                st_level = np.mean(ecg_signal[st_start:st_end])
                baseline = np.mean(ecg_signal[max(0, idx - int(0.2 * sampling_rate)):idx])
                elevation = st_level - baseline
                if elevation > 0.1:  # > 0.1 mV elevation
                    st_elevation_count += 1

        if st_elevation_count > len(r_peaks) * 0.5:
            events.append({
                "event_type": "st_elevation",
                "confidence": min(1.0, st_elevation_count / max(1, len(r_peaks))),
                "description": f"[{label}口径] 检测到 ST 段抬高，可能提示心肌梗死",
                "timestamp": r_peaks[0]["time"],
            })

    # Irregular rhythm detection (high SDNN relative to mean)
    if len(hrv.get("nn_intervals", [])) > 3:
        nn_array = np.array(hrv["nn_intervals"])
        cv = np.std(nn_array) / np.mean(nn_array) if np.mean(nn_array) > 0 else 0
        if cv > irregular_cv_limit:
            events.append({
                "event_type": "atrial_fibrillation",
                "confidence": min(1.0, cv * 2),
                "description": (
                    f"[{label}口径] RR 间期不规则 (CV {cv:.2f} > {irregular_cv_limit:.2f})，"
                    f"可能提示房颤"
                ),
                "timestamp": r_peaks[0]["time"] if r_peaks else 0.0,
            })

    # Normal rhythm
    if not events:
        events.append({
            "event_type": "normal",
            "confidence": 1.0,
            "description": f"[{label}口径] 正常窦性心律",
            "timestamp": r_peaks[0]["time"] if r_peaks else 0.0,
        })

    return events


def get_rhythm_diagnosis(
    arrhythmia_events: List[Dict[str, Any]],
    hrv: Dict[str, Any],
    scenario: str = "rest",
) -> str:
    """Generate overall rhythm diagnosis based on detected events and HRV.

    结论统一以本次实际使用的场景口径（[静息口径] / [运动口径]）开头，
    明确这一次按哪一套上下限判定。
    """
    label = get_scenario_label(scenario)
    prefix = f"[{label}口径] "
    event_types = [e["event_type"] for e in arrhythmia_events]

    if "st_elevation" in event_types:
        return prefix + "ST 段抬高 - 建议立即就医检查"
    elif "tachycardia" in event_types and "atrial_fibrillation" in event_types:
        return prefix + "快速房颤 - 建议进一步心脏评估"
    elif "tachycardia" in event_types:
        return prefix + "窦性心动过速 - 请结合临床症状判断"
    elif "bradycardia" in event_types:
        return prefix + "窦性心动过缓 - 建议关注心率变化"
    elif "atrial_fibrillation" in event_types:
        return prefix + "心律不规则 - 疑似房颤，建议 Holter 监测"
    else:
        hr = hrv.get("heart_rate", 0)
        sdnn = hrv.get("sdnn", 0)
        return prefix + f"正常窦性心律 | HR: {hr:.0f} BPM | SDNN: {sdnn:.1f} ms"
