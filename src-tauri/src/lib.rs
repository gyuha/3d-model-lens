mod settings;

use serde::{Deserialize, Serialize};
use settings::SettingsStore;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Listener, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

/// 이 앱이 여는 포맷. 프론트의 `SUPPORTED_EXTENSIONS` 와 같은 목록이며, 두 곳이 어긋나면
/// 셸은 여는데 뷰어가 거부하는 상태가 된다 (ADR 260822-115455).
const SUPPORTED: [&str; 3] = ["gltf", "glb", "stl"];

/// **`setup()` 보다 먼저 도착한 열기 요청.**
///
/// macOS 는 앱이 파일과 함께 실행되면 `application:openURLs:` 를 아주 이른 시점에 부른다 —
/// `manage()` 가 아직 실행되지 않은 때다. 거기서 앱 상태를 건드리면
/// `state() called before manage()` 로 **패닉하고 프로세스가 죽는다**(실측: Finder 더블클릭이
/// 그대로 이 경로였다). 그래서 그 시점에는 경로만 여기 담아 두고, `setup()` 이 꺼내 간다.
static PENDING_OPEN: OnceLock<Mutex<Vec<PathBuf>>> = OnceLock::new();

fn pending_open() -> &'static Mutex<Vec<PathBuf>> {
    PENDING_OPEN.get_or_init(|| Mutex::new(Vec::new()))
}

/// 한 [[뷰어 세션]] 이 들고 있는 것. 메뉴 체크 표시가 활성 창을 따라가려면 필요하다.
#[derive(Default, Clone)]
struct ViewerState {
    model: Option<PathBuf>,
    measure: bool,
    inspector: bool,
    panel: bool,
}

struct AppState {
    settings: SettingsStore,
    viewers: Mutex<HashMap<String, ViewerState>>,
    /// 메뉴의 체크 항목 — 활성 창의 상태를 비춘다.
    menu_items: Mutex<Option<MenuToggles>>,
}

#[derive(Clone)]
struct MenuToggles {
    measure: CheckMenuItem<tauri::Wry>,
    inspector: CheckMenuItem<tauri::Wry>,
    panel: CheckMenuItem<tauri::Wry>,
}

/// 뷰어가 호스트로 보내는 메시지. `src/messages.ts` 의 `WebviewToHost` 와 같은 형태다.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum WebviewToHost {
    Ready,
    InspectorState { visible: bool },
    InspectorFailed { message: String },
    MeasureModeState { active: bool },
    PanelState { visible: bool },
    UnitChanged { unit: String },
    OpenRequested,
    BackgroundChanged { background: String },
    GridChanged { grid: bool },
    DecimalsChanged { decimals: u8 },
    InspectorOnStartChanged { value: bool },
}

/// 호스트가 뷰어로 보내는 메시지. `src/messages.ts` 의 `HostToWebview` 와 같다.
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
enum HostToWebview {
    SetInspector { visible: bool },
    SetMeasureMode { active: bool },
    SetPanelVisible { visible: bool },
    SetBackground { background: String },
    SetGrid { grid: bool },
    SetDecimals { decimals: u8 },
    SetCameraPose { target: String },
}

/// 카메라 목적지 — 숫자키와 같은 목록이다. 프론트의 `cameraShortcuts.ts` 표와 **순서·이름이
/// 같아야** 하며, 그쪽이 실제 자세를 계산한다. 여기서는 메뉴 라벨과 키 표기만 안다.
const CAMERA_TARGETS: [(&str, &str, &str); 7] = [
    ("HOME", "기본 위치", "0"),
    ("TOP", "Top", "1"),
    ("FRONT", "Front", "2"),
    ("RIGHT", "Right", "3"),
    ("BACK", "Back", "4"),
    ("LEFT", "Left", "5"),
    ("BOTTOM", "Bottom", "6"),
];

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .on_menu_event(|app, event| handle_menu(app, event.id().as_ref()))
        .setup(|app| {
            let config_path = app
                .path()
                .app_config_dir()
                .map(|dir| dir.join("settings.json"))
                .unwrap_or_else(|_| PathBuf::from("model-lens-settings.json"));
            app.manage(AppState {
                settings: SettingsStore::load(config_path),
                viewers: Mutex::new(HashMap::new()),
                menu_items: Mutex::new(None),
            });

            build_menu(app.handle())?;
            listen_to_viewers(app.handle());

            // OS 가 setup 보다 먼저 건네준 파일들을 여기서 거둔다.
            let queued: Vec<PathBuf> = pending_open()
                .lock()
                .map(|mut v| v.drain(..).collect())
                .unwrap_or_default();

            let mut models = first_model_argument().into_iter().chain(queued).peekable();
            match models.next() {
                Some(first) => {
                    open_window(app.handle(), Some(&first))?;
                    // 한 번에 여러 파일을 열었다면 나머지는 각각 새 창이다.
                    for extra in models {
                        open_window(app.handle(), Some(&extra))?;
                    }
                }
                None => open_window(app.handle(), None)?,
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("3D Model Lens 를 시작하지 못했습니다")
        .run(|app, event| {
            // Finder 에서 파일을 더블클릭하면 여기로 온다. **앱이 이미 떠 있으면 새 창**이다 —
            // 보고 있던 모델을 말없이 덮어쓰면 그건 파일을 여는 것이 아니라 잃는 것이다.
            // (같은 창에서 바꾸는 경로는 ⌘O 와 드롭이며, 그쪽은 사용자가 그 창을 지목한 것이다.)
            if let tauri::RunEvent::Opened { urls } = event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        open_from_os(app, &path);
                    }
                }
            }
        });
}

// ─────────────────────────────────────────────────────────────── 파일이 들어오는 경로

/// CLI 인자에서 첫 모델 파일을 고른다. `--flag` 와 지원하지 않는 확장자는 건너뛴다.
fn first_model_argument() -> Option<PathBuf> {
    std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .map(PathBuf::from)
        .find(|path| is_supported(path) && path.is_file())
        .and_then(|path| std::fs::canonicalize(path).ok())
}

fn is_supported(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| SUPPORTED.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// 열기 대화상자. 지원 포맷으로 필터를 건다.
fn choose_file(app: &AppHandle, target: Option<String>) {
    let app = app.clone();
    app.clone()
        .dialog()
        .file()
        .add_filter("3D 모델", &SUPPORTED)
        .pick_file(move |picked| {
            if let Some(path) = picked.and_then(|p| p.into_path().ok()) {
                load_into(&app, &path, target);
            }
        });
}

/// 모델을 창에 싣는다. `target` 이 있으면 그 창을 대신하고, 없으면 새 창이다.
///
/// **창을 다시 만드는 방식이다.** [[뷰어 세션]] 의 경계가 "다른 파일을 열 때"이므로
/// (ADR 260829-143640a) 측정·카메라·씬이 전부 정리돼야 하는데, 창을 새로 만들면 그것이
/// 공짜로 보장된다 — WebGL 컨텍스트와 Babylon 씬이 창과 함께 사라지기 때문이다.
fn load_into(app: &AppHandle, path: &Path, target: Option<String>) {
    let path = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    if !is_supported(&path) || !path.is_file() {
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        app.dialog()
            .message(format!(
                "지원하지 않는 파일입니다: {name}\n\n열 수 있는 형식: .gltf · .glb · .stl"
            ))
            .title("3D Model Lens")
            .blocking_show();
        return;
    }

    let state = app.state::<AppState>();
    state.settings.update(|s| s.remember_recent(&path));

    let geometry = target.as_ref().and_then(|label| {
        app.get_webview_window(label)
            .and_then(|w| w.outer_position().ok().zip(w.inner_size().ok()))
    });
    if let Some(label) = target {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
        state.viewers.lock().expect("뷰어 잠금").remove(&label);
    }
    let _ = open_window_at(app, Some(&path), geometry);
    let _ = rebuild_menu(app);
}

/// OS 가 건네준 파일을 연다.
///
/// 창이 하나도 없으면 그 파일로 첫 창을 만들고(앱이 그 파일 때문에 실행된 경우), 이미 떠
/// 있으면 **새 창**을 연다. 어느 쪽이든 열려 있던 모델을 덮어쓰지 않는다.
fn open_from_os(app: &AppHandle, path: &Path) {
    // 아직 `manage()` 전이면 상태를 건드릴 수 없다 — 담아 두고 `setup()` 에 맡긴다.
    if app.try_state::<AppState>().is_none() {
        if let Ok(mut queue) = pending_open().lock() {
            queue.push(path.to_path_buf());
        }
        return;
    }

    // 빈 창만 떠 있다면 그 창을 대신한다 — 빈 창을 남겨 둘 이유가 없다.
    let empty = app
        .state::<AppState>()
        .viewers
        .lock()
        .ok()
        .and_then(|viewers| {
            viewers
                .iter()
                .find(|(_, viewer)| viewer.model.is_none())
                .map(|(label, _)| label.clone())
        });
    load_into(app, path, empty);
}

// ─────────────────────────────────────────────────────────────── 창

fn open_window(app: &AppHandle, model: Option<&Path>) -> tauri::Result<()> {
    open_window_at(app, model, None)
}

fn open_window_at(
    app: &AppHandle,
    model: Option<&Path>,
    geometry: Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)>,
) -> tauri::Result<()> {
    let state = app.state::<AppState>();

    // 모델이 있으면 **그 파일의 디렉터리만** asset scope 에 넣는다. 원본 확장의
    // `localResourceRoots` 와 같은 범위이며, `../textures/` 참조가 실패하는 것도 같다
    // (ADR 260822-115455a).
    if let Some(dir) = model.and_then(|p| p.parent()) {
        let _ = app.asset_protocol_scope().allow_directory(dir, false);
    }

    let label = next_label(app);
    // 모델이 없는 창은 빈 창 문서를 연다 — 뷰어(Babylon)를 아예 만들지 않는다.
    let document = if model.is_some() { "index.html" } else { "empty.html" };
    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(document.into()))
        .title(window_title(model))
        .min_inner_size(480.0, 360.0)
        .initialization_script(&boot_script(app, model));

    builder = match geometry {
        Some((position, size)) => builder
            .position(position.x as f64, position.y as f64)
            .inner_size(size.width as f64, size.height as f64),
        None => builder.inner_size(1100.0, 760.0),
    };

    let window = builder.build()?;

    // 디버그 빌드에서는 개발자 도구를 함께 연다 — Babylon 은 기능이 죽어도 예외를 던지지
    // 않으므로(ADR 260822-162443) 콘솔이 없으면 "빈 화면"과 "기능 없음"을 구별할 수 없다.
    #[cfg(debug_assertions)]
    window.open_devtools();

    // 창에 파일을 떨구면 그 창에서 연다 — 빈 창이든 모델이 열린 창이든 같다.
    let drop_app = app.clone();
    let drop_label = label.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
            if let Some(path) = paths.iter().find(|p| is_supported(p)) {
                load_into(&drop_app, path, Some(drop_label.clone()));
            } else if let Some(path) = paths.first() {
                load_into(&drop_app, path, Some(drop_label.clone()));
            }
        }
    });

    state.viewers.lock().expect("뷰어 잠금").insert(
        label,
        ViewerState {
            model: model.map(Path::to_path_buf),
            panel: true,
            ..ViewerState::default()
        },
    );
    Ok(())
}

fn next_label(app: &AppHandle) -> String {
    let mut n = 1;
    while app.get_webview_window(&format!("viewer-{n}")).is_some() {
        n += 1;
    }
    format!("viewer-{n}")
}

fn window_title(model: Option<&Path>) -> String {
    match model.and_then(|p| p.file_name()).and_then(|n| n.to_str()) {
        Some(name) => format!("{name} — 3D Model Lens"),
        None => "3D Model Lens".to_string(),
    }
}

/// 뷰어가 부팅 시점에 동기적으로 읽는 설정을 주입한다.
///
/// IPC 왕복이 아니라 주입인 이유: 뷰어의 부트 경로가 동기이고(원본에서는 HTML 의 `data-config`
/// 속성이 그 자리였다), 기다리게 바꾸면 이식 범위가 뷰어 안쪽까지 번진다.
///
/// 경로는 URL 로 바꾸지 않고 **경로 그대로** 넘긴다 — asset URL 형식은 플랫폼마다 다르고
/// (`asset://` vs `http://asset.localhost`) 그 변환은 프론트의 `convertFileSrc` 가 안다.
fn boot_script(app: &AppHandle, model: Option<&Path>) -> String {
    let settings = app.state::<AppState>().settings.get();
    let unit = model
        .map(|p| settings.unit_for(p))
        .unwrap_or_else(|| settings.unit.clone());
    let config = serde_json::json!({
        "modelPath": model.map(|p| p.to_string_lossy().to_string()),
        "fileName": model.and_then(|p| p.file_name()).map(|n| n.to_string_lossy().to_string()),
        "background": settings.background,
        "unitSetting": unit,
        "decimals": settings.decimals,
        "grid": settings.grid,
        "inspectorOnStart": settings.inspector_on_start,
    });
    format!("window.__MODEL_LENS_CONFIG__ = {config};")
}

// ─────────────────────────────────────────────────────────────── 메뉴 명령

/// 지금 조작 대상인 창. 초점이 있는 창이고, 없으면 아무 창이나 하나다.
fn active_label(app: &AppHandle) -> Option<String> {
    app.webview_windows()
        .iter()
        .find(|(_, w)| w.is_focused().unwrap_or(false))
        .map(|(label, _)| label.clone())
        .or_else(|| app.webview_windows().keys().next().cloned())
}

fn send(app: &AppHandle, label: &str, message: HostToWebview) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.emit("host-to-viewer", message);
    }
}

/// 네이티브 메뉴를 만든다.
///
/// 원본 확장의 세 명령(측정 모드 · Inspector · [[뷰어 패널]])이 여기로 옮겨 왔다. 특히 패널
/// 토글은 **뷰어 밖에 있어야 한다** — 패널을 통째로 숨겼을 때 되살릴 경로가 웹뷰 안에 있으면
/// 모델만 보고 싶을 때도 무언가가 계속 떠 있게 된다(원본 `togglePanel` 의 주석).
fn build_menu(app: &AppHandle) -> tauri::Result<()> {
    let settings = app.state::<AppState>().settings.get();

    let open = MenuItem::with_id(app, "open", "Open…", true, Some("CmdOrCtrl+O"))?;
    let new_window = MenuItem::with_id(app, "new-window", "New Window", true, Some("CmdOrCtrl+N"))?;

    let mut recent_items: Vec<MenuItem<tauri::Wry>> = Vec::new();
    for (index, path) in settings.recent_files.iter().enumerate() {
        let label = Path::new(path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());
        recent_items.push(MenuItem::with_id(
            app,
            format!("recent-{index}"),
            format!("{label}   —   {path}"),
            true,
            None::<&str>,
        )?);
    }
    let recent_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = recent_items
        .iter()
        .map(|i| i as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
        .collect();
    let recent = if recent_refs.is_empty() {
        let empty = MenuItem::with_id(app, "recent-none", "(없음)", false, None::<&str>)?;
        Submenu::with_items(app, "Open Recent", true, &[&empty])?
    } else {
        Submenu::with_items(app, "Open Recent", true, &recent_refs)?
    };

    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &open,
            &recent,
            &PredefinedMenuItem::separator(app)?,
            &new_window,
            &PredefinedMenuItem::close_window(app, Some("Close"))?,
        ],
    )?;

    let current = active_label(app)
        .and_then(|label| app.state::<AppState>().viewers.lock().ok()?.get(&label).cloned())
        .unwrap_or_default();

    let measure = CheckMenuItem::with_id(
        app, "toggle-measure", "Measure Mode", true, current.measure, Some("CmdOrCtrl+M"),
    )?;
    let inspector = CheckMenuItem::with_id(
        app, "toggle-inspector", "Inspector", true, current.inspector, Some("CmdOrCtrl+I"),
    )?;
    let panel = CheckMenuItem::with_id(
        app, "toggle-panel", "Viewer Panel", true, current.panel, Some("CmdOrCtrl+B"),
    )?;
    // 카메라 목적지 — **accelerator 를 등록하지 않는다.** 등록하면 메뉴가 웹뷰보다 먼저 키를
    // 가로채 `Decimals` 입력칸에 숫자를 칠 수 없게 된다. 숫자는 라벨에 표기만 하고, 실제
    // 키 처리는 웹뷰가 한다(거기서만 "입력칸에 포커스가 있으면 무시"를 판단할 수 있다).
    let mut pose_items: Vec<MenuItem<tauri::Wry>> = Vec::new();
    for (target, label, key) in CAMERA_TARGETS {
        pose_items.push(MenuItem::with_id(
            app,
            format!("pose-{target}"),
            format!("{label}   {key}"),
            true,
            None::<&str>,
        )?);
    }
    let pose_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = pose_items
        .iter()
        .map(|i| i as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
        .collect();
    let camera = Submenu::with_items(app, "Camera", true, &pose_refs)?;

    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &measure,
            &inspector,
            &panel,
            &PredefinedMenuItem::separator(app)?,
            &camera,
        ],
    )?;

    // macOS 는 첫 번째 서브메뉴를 앱 메뉴로 쓴다 — 종료·숨기기가 여기 없으면 ⌘Q 가 사라진다.
    let app_menu = Submenu::with_items(
        app,
        "3D Model Lens",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let menu = Menu::with_items(app, &[&app_menu, &file, &view])?;
    app.set_menu(menu)?;

    *app.state::<AppState>().menu_items.lock().expect("메뉴 잠금") =
        Some(MenuToggles { measure, inspector, panel });
    Ok(())
}

/// 최근 파일 목록이 바뀌면 메뉴를 다시 만든다 — 항목이 동적이라 그 방법뿐이다.
fn rebuild_menu(app: &AppHandle) -> tauri::Result<()> {
    build_menu(app)
}

/// 메뉴 체크 표시를 창의 실제 상태에 맞춘다.
///
/// 원본은 제목 표시줄 · 명령 팔레트 · 패널 체크박스 **세 경로**를 동기화했다. 여기서는
/// 메뉴와 패널 **두 경로**이고, 어긋나면 다음 토글의 방향이 뒤집힌다는 함정은 그대로다.
fn sync_menu(app: &AppHandle, state: &ViewerState) {
    if let Some(items) = app.state::<AppState>().menu_items.lock().expect("메뉴 잠금").as_ref() {
        let _ = items.measure.set_checked(state.measure);
        let _ = items.inspector.set_checked(state.inspector);
        let _ = items.panel.set_checked(state.panel);
    }
}

pub fn handle_menu(app: &AppHandle, id: &str) {
    let Some(label) = active_label(app) else { return };
    let state = app.state::<AppState>();
    let current = {
        let viewers = state.viewers.lock().expect("뷰어 잠금");
        viewers.get(&label).cloned().unwrap_or_default()
    };

    match id {
        "open" => choose_file(app, Some(label)),
        "new-window" => {
            let _ = open_window(app, None);
        }
        "toggle-measure" => send(app, &label, HostToWebview::SetMeasureMode { active: !current.measure }),
        "toggle-inspector" => send(app, &label, HostToWebview::SetInspector { visible: !current.inspector }),
        "toggle-panel" => send(app, &label, HostToWebview::SetPanelVisible { visible: !current.panel }),
        other if other.starts_with("pose-") => {
            let target = other.trim_start_matches("pose-").to_string();
            send(app, &label, HostToWebview::SetCameraPose { target });
        }
        other => {
            if let Some(index) = other.strip_prefix("recent-").and_then(|n| n.parse::<usize>().ok()) {
                let settings = app.state::<AppState>().settings.get();
                if let Some(path) = settings.recent_files.get(index).cloned() {
                    let candidate = PathBuf::from(&path);
                    if candidate.is_file() {
                        load_into(app, &candidate, Some(label));
                    } else {
                        // 사라진 파일은 알리고 목록에서 지운다 — 다음에 또 보이면 안 된다.
                        app.state::<AppState>().settings.update(|s| s.forget_recent(&path));
                        let _ = rebuild_menu(app);
                        app.dialog()
                            .message(format!("파일을 찾을 수 없습니다:\n{path}"))
                            .title("3D Model Lens")
                            .blocking_show();
                    }
                }
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────── 뷰어가 보내오는 것

fn listen_to_viewers(app: &AppHandle) {
    let handle = app.clone();
    app.listen_any("viewer-to-host", move |event| {
        let Ok(message) = serde_json::from_str::<WebviewToHost>(event.payload()) else {
            return;
        };
        let Some(label) = active_label(&handle) else { return };
        let state = handle.state::<AppState>();

        let updated = {
            let mut viewers = state.viewers.lock().expect("뷰어 잠금");
            let viewer = viewers.entry(label.clone()).or_default();
            match &message {
                WebviewToHost::MeasureModeState { active } => viewer.measure = *active,
                WebviewToHost::InspectorState { visible } => viewer.inspector = *visible,
                WebviewToHost::InspectorFailed { .. } => viewer.inspector = false,
                WebviewToHost::PanelState { visible } => viewer.panel = *visible,
                _ => {}
            }
            viewer.clone()
        };
        sync_menu(&handle, &updated);

        match message {
            // 단위는 **파일별로** 기억한다 — STL 은 포맷에 단위가 없어 매번 다시 고르게 된다
            // (ADR 260822-115455c).
            WebviewToHost::UnitChanged { unit } => {
                if let Some(path) = updated.model.clone() {
                    state.settings.update(|s| s.remember_unit(&path, &unit));
                }
            }
            // 배경 · 그리드 · 자릿수는 사람 단위로 정해지는 표시 취향이므로 전역 설정이고,
            // 열려 있는 **모든 창**에 곧바로 퍼진다.
            WebviewToHost::BackgroundChanged { background } => {
                state.settings.update(|s| s.background = background.clone());
                broadcast(&handle, HostToWebview::SetBackground { background });
            }
            WebviewToHost::GridChanged { grid } => {
                state.settings.update(|s| s.grid = grid);
                broadcast(&handle, HostToWebview::SetGrid { grid });
            }
            WebviewToHost::DecimalsChanged { decimals } => {
                state.settings.update(|s| s.decimals = decimals);
                broadcast(&handle, HostToWebview::SetDecimals { decimals });
            }
            WebviewToHost::InspectorOnStartChanged { value } => {
                state.settings.update(|s| s.inspector_on_start = value);
            }
            // 빈 창의 `Open…` — 대화상자는 호스트만 띄울 수 있다.
            WebviewToHost::OpenRequested => choose_file(&handle, Some(label)),
            WebviewToHost::InspectorFailed { message } => {
                handle
                    .dialog()
                    .message(format!("Inspector 를 열 수 없습니다:\n{message}"))
                    .title("3D Model Lens")
                    .blocking_show();
            }
            _ => {}
        }
    });
}

fn broadcast(app: &AppHandle, message: HostToWebview) {
    for window in app.webview_windows().values() {
        let _ = window.emit("host-to-viewer", message.clone());
    }
}
