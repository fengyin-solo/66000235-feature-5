"""
采集场景判定口径配置。

心动过速 / 心动过缓 / 心律不规则三类判定按采集场景使用不同上下限：
- 静息 (rest)：沿用既有固定口径
- 运动 (exercise)：使用运动负荷下的口径

边界约定：上下限本身属于正常区间，只有严格越过阈值才判异常，
因此落在阈值边界上的心率既不判过速也不判过缓，不会两边都判。
"""
from typing import Dict


# 场景标识 -> 中文名称
SCENARIO_LABELS: Dict[str, str] = {
    "rest": "静息",
    "exercise": "运动",
}

# 各场景下的判定口径
SCENARIO_THRESHOLDS: Dict[str, Dict[str, float]] = {
    "rest": {
        "label": "静息",
        # 心率严格高于该值判心动过速，等于不判
        "tachycardia_min_hr": 100.0,
        # 心率严格低于该值判心动过缓，等于不判
        "bradycardia_max_hr": 60.0,
        # RR 间期变异系数 (CV) 严格大于该值判心律不规则
        "irregular_cv": 0.15,
    },
    "exercise": {
        "label": "运动",
        "tachycardia_min_hr": 150.0,
        "bradycardia_max_hr": 50.0,
        "irregular_cv": 0.20,
    },
}

DEFAULT_SCENARIO = "rest"


def get_thresholds(scenario: str) -> Dict[str, float]:
    """按采集场景返回对应判定口径，未知场景回退到静息口径。"""
    return SCENARIO_THRESHOLDS.get(scenario, SCENARIO_THRESHOLDS[DEFAULT_SCENARIO])


def get_scenario_label(scenario: str) -> str:
    """返回场景中文名，未知场景回退到静息。"""
    return SCENARIO_LABELS.get(scenario, SCENARIO_LABELS[DEFAULT_SCENARIO])
