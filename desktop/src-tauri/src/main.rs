// ============================================================
// QuickDrop 桌面客户端 — Tauri 主入口
// ============================================================

#![windows_subsystem = "windows"]
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    quickdrop_desktop_lib::run();
}
