//! SV Publisher - Tauri Application
//! 
//! IEC 61850 Sampled Values Publisher with native C++ backend

#![allow(non_snake_case)]
#![allow(dead_code)]

mod ffi;
mod commands;

/// Initialize Npcap DLL path on Windows
fn init_npcap_path() {
    #[cfg(target_os = "windows")]
    {
        use std::env;
        if let Ok(current_path) = env::var("PATH") {
            let npcap_path = r"C:\Windows\System32\Npcap";
            if !current_path.contains(npcap_path) {
                env::set_var("PATH", format!("{};{}", npcap_path, current_path));
                println!("[init] Added Npcap to PATH: {}", npcap_path);
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize Npcap DLL path before anything else
    init_npcap_path();
    
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            // Interface commands
            commands::get_interfaces,
            commands::open_interface,
            commands::close_interface,
            commands::is_interface_open,
            // Publishing commands
            commands::start_publishing,
            commands::stop_publishing,
            commands::get_publish_status,
            commands::set_send_mode,
            commands::get_send_mode,
            // Duration/Repeat commands (BACKEND CONTROLLED!)
            commands::set_duration_mode,
            commands::get_remaining_seconds,
            commands::get_current_repeat_cycle,
            commands::is_duration_complete,
            // Statistics commands
            commands::get_stats,
            commands::reset_stats,
            // Config commands
            commands::get_config,
            commands::set_config,
            commands::get_initial_state,
            commands::is_native_available,
            // Channel commands
            commands::get_channels,
            commands::set_channels,
            // Frame inspection commands (for FrameViewer)
            commands::get_sample_frame,
            commands::get_current_channel_values,
            commands::get_current_smp_cnt,
            // Multi-publisher commands
            commands::mp_add_publisher,
            commands::mp_remove_publisher,
            commands::mp_remove_all_publishers,
            commands::mp_get_publisher_count,
            commands::mp_configure_publisher,
            commands::mp_start_all,
            commands::mp_stop_all,
            commands::mp_reset_all,
            commands::mp_is_running,
            commands::mp_set_send_mode,
            commands::mp_set_duration,
            commands::mp_get_stats,
            // USB frame padding
            commands::set_usb_pad_size,
            commands::get_usb_pad_size,
            commands::mp_set_usb_pad_size,
            commands::mp_get_usb_pad_size,
            // USB min inter-packet gap
            commands::set_usb_min_gap_us,
            commands::get_usb_min_gap_us,
            commands::mp_set_usb_min_gap_us,
            commands::mp_get_usb_min_gap_us,
        ])
        .setup(|_app| {
            println!("╔════════════════════════════════════════════════════════════╗");
            println!("║         SV PUBLISHER (Tauri + Rust + C++)                  ║");
            println!("╠════════════════════════════════════════════════════════════╣");
            println!("║  🚀 Application initialized                                ║");
            println!("║  📦 Native module: Loaded via FFI                          ║");
            println!("╚════════════════════════════════════════════════════════════╝");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
