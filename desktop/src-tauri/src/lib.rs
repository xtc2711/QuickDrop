// ============================================================
// QuickDrop 桌面客户端 — Tauri 库入口
// 负责: 窗口管理、系统托盘、文件操作、WebRTC 辅助
// ============================================================

use tauri::Manager;

/// 应用初始化
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // 获取主窗口
            let window = app.get_webview_window("main").unwrap();

            // 开发环境打开 DevTools
            #[cfg(debug_assertions)]
            {
                window.open_devtools();
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 QuickDrop 桌面客户端失败");
}
