//! 앱 설정과 파일별 기억.
//!
//! 원본 확장에서는 이 자리를 VS Code 가 맡았다 — 전역 설정은 `settings.json`, 파일별 단위는
//! 워크스페이스 상태였다. 데스크톱 앱에는 그런 것이 없으므로 직접 둔다.
//!
//! 저장 형식은 **사람이 읽을 수 있는 JSON** 이다. 설정을 손으로 고치는 것은 정당한 경로이고,
//! 그래서 읽은 값은 언제나 검증한다(원본이 `readGridSetting` 에서 하던 판단과 같다).

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 파일별 단위 기억의 상한. 원본에서는 워크스페이스 단위로 격리돼 자연히 한계가 있었지만
/// 앱 전역 저장소는 그렇지 않아 무한정 쌓인다 — 가장 오래 안 쓴 것부터 버린다.
const UNIT_MEMORY_LIMIT: usize = 200;
/// 최근 파일 목록의 길이.
const RECENT_LIMIT: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// 뷰어 배경 모드 — `theme`(앱 테마를 따름) · `light` · `dark`.
    pub background: String,
    /// 바닥 그리드 표시 여부.
    pub grid: bool,
    /// 모델을 열 때 Inspector 를 함께 열지.
    pub inspector_on_start: bool,
    /// 치수·측정의 **초기** 단위. 파일별 선택이 있으면 그쪽이 이긴다.
    pub unit: String,
    /// 표시 소수 자릿수 (0–10).
    pub decimals: u8,
    /// 파일별 단위 선택. 최근 것이 뒤로 가는 LRU 이며 `UNIT_MEMORY_LIMIT` 에서 잘린다.
    pub unit_memory: VecDeque<(String, String)>,
    /// 최근 연 파일. 최신이 앞이다.
    pub recent_files: VecDeque<String>,
    /// 표시 보조 — 3축 조명. 형태를 읽기 위한 것이며 기본은 꺼짐이다.
    pub axis_lighting: bool,
    /// 표시 보조 — 크리스 모서리.
    pub edges: bool,
    /// 표시 보조 — 법선 컬러링.
    pub normal_colors: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            background: "theme".into(),
            grid: true,
            inspector_on_start: false,
            unit: "auto".into(),
            decimals: 3,
            unit_memory: VecDeque::new(),
            recent_files: VecDeque::new(),
            // 표시 보조는 셋 다 기본 꺼짐이다 — 아무것도 건드리지 않은 첫 화면은 그대로다
            // (ADR 260830-123628 이 그 대가를 함께 적어 뒀다).
            axis_lighting: false,
            edges: false,
            normal_colors: false,
        }
    }
}

const BACKGROUND_MODES: [&str; 3] = ["theme", "light", "dark"];
const UNIT_SETTINGS: [&str; 5] = ["auto", "mm", "cm", "m", "in"];

impl Settings {
    /// 손으로 고친 설정 파일에서 온 값을 제자리로 되돌린다.
    ///
    /// 알 수 없는 값은 **기본값으로 떨어뜨린다** — 원본 `readGridSetting` 의 주석이 말하듯,
    /// 예측 가능한 동작은 그것뿐이다.
    fn sanitize(&mut self) {
        if !BACKGROUND_MODES.contains(&self.background.as_str()) {
            self.background = "theme".into();
        }
        if !UNIT_SETTINGS.contains(&self.unit.as_str()) {
            self.unit = "auto".into();
        }
        self.decimals = self.decimals.min(10);
        self.unit_memory
            .retain(|(_, unit)| UNIT_SETTINGS.contains(&unit.as_str()) && unit != "auto");
        while self.unit_memory.len() > UNIT_MEMORY_LIMIT {
            self.unit_memory.pop_front();
        }
        while self.recent_files.len() > RECENT_LIMIT {
            self.recent_files.pop_back();
        }
    }

    /// 이 파일에 쓸 초기 단위. 우선순위: 파일별 기억 → 전역 설정 → `auto`.
    pub fn unit_for(&self, path: &Path) -> String {
        let key = path.to_string_lossy();
        self.unit_memory
            .iter()
            .rev()
            .find(|(p, _)| *p == key)
            .map(|(_, u)| u.clone())
            .unwrap_or_else(|| self.unit.clone())
    }

    /// 파일별 단위를 기억한다. `auto` 는 "기억하지 않음"과 같으므로 지운다.
    pub fn remember_unit(&mut self, path: &Path, unit: &str) {
        let key = path.to_string_lossy().to_string();
        self.unit_memory.retain(|(p, _)| *p != key);
        if unit != "auto" && UNIT_SETTINGS.contains(&unit) {
            self.unit_memory.push_back((key, unit.to_string()));
        }
        while self.unit_memory.len() > UNIT_MEMORY_LIMIT {
            self.unit_memory.pop_front();
        }
    }

    pub fn remember_recent(&mut self, path: &Path) {
        let key = path.to_string_lossy().to_string();
        self.recent_files.retain(|p| *p != key);
        self.recent_files.push_front(key);
        while self.recent_files.len() > RECENT_LIMIT {
            self.recent_files.pop_back();
        }
    }

    pub fn forget_recent(&mut self, path: &str) {
        self.recent_files.retain(|p| p != path);
    }

    /// 표시 보조 하나를 켜고 끈다. 키는 프론트의 `SHADING_AID_KEYS` 와 같은 이름이다 —
    /// 어긋나면 패널에서 켠 것이 저장되지 않는다.
    pub fn set_shading_aid(&mut self, aid: &str, on: bool) {
        match aid {
            "axisLighting" => self.axis_lighting = on,
            "edges" => self.edges = on,
            "normalColors" => self.normal_colors = on,
            _ => {}
        }
    }
}

/// 설정 파일 하나를 소유한다. 쓰기는 즉시 디스크로 내려간다 — 설정 변경은 드물고,
/// 앱이 갑자기 죽어도 잃을 것이 없어야 한다.
pub struct SettingsStore {
    path: PathBuf,
    inner: Mutex<Settings>,
}

impl SettingsStore {
    pub fn load(path: PathBuf) -> Self {
        let mut settings = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<Settings>(&text).ok())
            .unwrap_or_default();
        settings.sanitize();
        Self {
            path,
            inner: Mutex::new(settings),
        }
    }

    pub fn get(&self) -> Settings {
        self.inner.lock().expect("설정 잠금").clone()
    }

    /// 설정을 고치고 곧바로 저장한다. 저장 실패는 조용히 넘긴다 — 디스크에 쓰지 못했다고
    /// 뷰어를 멈출 이유는 없고, 다음 변경에서 다시 시도된다.
    pub fn update(&self, edit: impl FnOnce(&mut Settings)) -> Settings {
        let mut guard = self.inner.lock().expect("설정 잠금");
        edit(&mut guard);
        guard.sanitize();
        let snapshot = guard.clone();
        drop(guard);
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(text) = serde_json::to_string_pretty(&snapshot) {
            let _ = std::fs::write(&self.path, text);
        }
        snapshot
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Settings {
        Settings::default()
    }

    #[test]
    fn 손으로_고친_값은_기본값으로_떨어진다() {
        let mut s = sample();
        s.background = "chartreuse".into();
        s.unit = "furlong".into();
        s.decimals = 99;
        s.sanitize();
        assert_eq!(s.background, "theme");
        assert_eq!(s.unit, "auto");
        assert_eq!(s.decimals, 10);
    }

    #[test]
    fn 단위는_파일별_기억이_전역_설정을_이긴다() {
        let mut s = sample();
        s.unit = "m".into();
        let path = PathBuf::from("/models/bracket.stl");
        assert_eq!(s.unit_for(&path), "m", "기억이 없으면 전역 설정");
        s.remember_unit(&path, "mm");
        assert_eq!(s.unit_for(&path), "mm", "기억이 있으면 그쪽이 이긴다");
        assert_eq!(
            s.unit_for(&PathBuf::from("/models/other.glb")),
            "m",
            "다른 파일은 영향받지 않는다"
        );
    }

    #[test]
    fn auto_는_기억하지_않는다() {
        // `auto` 를 기억하는 것은 "기억 없음"과 같은 뜻이므로 항목을 지운다.
        let mut s = sample();
        let path = PathBuf::from("/a.stl");
        s.remember_unit(&path, "mm");
        s.remember_unit(&path, "auto");
        assert!(s.unit_memory.is_empty());
    }

    #[test]
    fn 단위_기억은_상한에서_가장_오래된_것부터_버린다() {
        let mut s = sample();
        for i in 0..(UNIT_MEMORY_LIMIT + 5) {
            s.remember_unit(&PathBuf::from(format!("/m/{i}.stl")), "mm");
        }
        assert_eq!(s.unit_memory.len(), UNIT_MEMORY_LIMIT);
        assert_eq!(s.unit_for(&PathBuf::from("/m/0.stl")), "auto", "가장 오래된 것이 밀려났다");
        let last = UNIT_MEMORY_LIMIT + 4;
        assert_eq!(s.unit_for(&PathBuf::from(format!("/m/{last}.stl"))), "mm");
    }

    #[test]
    fn 같은_파일을_다시_고르면_중복되지_않고_최신이_된다() {
        let mut s = sample();
        let path = PathBuf::from("/a.stl");
        s.remember_unit(&path, "mm");
        s.remember_unit(&path, "cm");
        assert_eq!(s.unit_memory.len(), 1);
        assert_eq!(s.unit_for(&path), "cm");
    }

    #[test]
    fn 최근_파일은_최신이_앞이고_중복이_없다() {
        let mut s = sample();
        s.remember_recent(&PathBuf::from("/a.glb"));
        s.remember_recent(&PathBuf::from("/b.glb"));
        s.remember_recent(&PathBuf::from("/a.glb"));
        assert_eq!(s.recent_files, vec!["/a.glb", "/b.glb"]);
    }

    #[test]
    fn 최근_파일은_상한에서_잘린다() {
        let mut s = sample();
        for i in 0..(RECENT_LIMIT + 3) {
            s.remember_recent(&PathBuf::from(format!("/{i}.glb")));
        }
        assert_eq!(s.recent_files.len(), RECENT_LIMIT);
    }

    #[test]
    fn 사라진_파일은_목록에서_지운다() {
        let mut s = sample();
        s.remember_recent(&PathBuf::from("/gone.glb"));
        s.forget_recent("/gone.glb");
        assert!(s.recent_files.is_empty());
    }
}
