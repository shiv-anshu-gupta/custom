//! Tauri commands for the SV Publisher

use crate::ffi;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

// ============================================================================
// GLOBAL STATE (simple, like Node.js singleton)
// ============================================================================

lazy_static::lazy_static! {
    static ref CONFIG: Mutex<SvConfig> = Mutex::new(SvConfig::default());
    static ref CHANNELS: Mutex<Vec<Channel>> = Mutex::new(Vec::new());
    static ref CURRENT_INTERFACE: Mutex<Option<String>> = Mutex::new(None);
}

static IS_PUBLISHING: AtomicBool = AtomicBool::new(false);
static PACKETS_SENT: AtomicU64 = AtomicU64::new(0);
static BYTES_SENT: AtomicU64 = AtomicU64::new(0);
static ERRORS: AtomicU64 = AtomicU64::new(0);

// ============================================================================
// DATA STRUCTURES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInterface {
    pub name: String,
    pub description: String,
    pub mac: String,
}

/// Channel with equation from frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub channel_type: String,
    pub equation: String,
    pub is_base: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SvConfig {
    pub sv_id: String,
    pub app_id: u16,
    pub conf_rev: u32,
    pub smp_synch: u8,
    pub sample_rate: u64,
    pub frequency: u32,
    pub src_mac: [u8; 6],
    pub dst_mac: [u8; 6],
    pub vlan_id: u16,
    pub vlan_priority: u8,
    #[serde(default = "default_no_asdu")]
    pub no_asdu: u8,
    #[serde(default = "default_channel_count")]
    pub channel_count: u8,  // Dynamic channel count (1-20)
}

fn default_no_asdu() -> u8 { 1 }
fn default_channel_count() -> u8 { 8 }

impl Default for SvConfig {
    fn default() -> Self {
        Self {
            sv_id: "MU01".to_string(),
            app_id: 0x4000,
            conf_rev: 1,
            smp_synch: 2,
            sample_rate: 4800,
            frequency: 60,
            src_mac: [0x00, 0x00, 0x00, 0x00, 0x00, 0x01],
            dst_mac: [0x01, 0x0C, 0xCD, 0x04, 0x00, 0x00],
            vlan_id: 0,
            vlan_priority: 4,
            no_asdu: 1,
            channel_count: 8,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsResponse {
    pub packets_sent: u64,
    pub packets_failed: u64,
    pub bytes_sent: u64,
    pub current_bps: f64,
    pub current_pps: f64,
    pub peak_bps: f64,
    pub peak_pps: f64,
    pub rate_formatted: String,
    pub current_mbps: f64,
    pub peak_mbps: f64,
    pub duration_ms: u64,
    pub duration_sec: f64,
    pub avg_packet_size: f64,
    pub smp_cnt: u64,
    pub configured_rate: u64,
    pub session_active: bool,
    pub is_publishing: bool,       // Backend-controlled publishing state
    pub duration_complete: bool,   // True when duration elapsed (backend stopped publishing)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishStatus {
    pub is_publishing: bool,
    pub packets_sent: u64,
    pub errors: u64,
    pub interface: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialState {
    pub config: SvConfig,
    pub is_publishing: bool,
    pub interface_open: bool,
    pub current_interface: Option<String>,
    pub native_available: bool,
}

// ============================================================================
// INTERFACE COMMANDS
// ============================================================================

#[tauri::command]
pub fn get_interfaces() -> Result<Vec<NetworkInterface>, String> {
    match ffi::list_interfaces() {
        Ok(interfaces) => {
            eprintln!("[commands] get_interfaces: found {} interfaces", interfaces.len());
            Ok(interfaces)
        }
        Err(e) => {
            eprintln!("[commands] get_interfaces error: {}", e);
            Err(e)
        }
    }
}

#[tauri::command]
pub fn open_interface(name: String) -> Result<(), String> {
    eprintln!("[commands] open_interface: {}", name);
    ffi::open_interface(&name)?;
    *CURRENT_INTERFACE.lock().unwrap() = Some(name);
    Ok(())
}

#[tauri::command]
pub fn close_interface() -> Result<(), String> {
    eprintln!("[commands] close_interface");
    ffi::close_interface();
    *CURRENT_INTERFACE.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
pub fn is_interface_open() -> bool {
    ffi::is_open()
}

// ============================================================================
// PUBLISHING COMMANDS
// ============================================================================

/// Duration mode settings from frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DurationSettings {
    pub duration_seconds: u32,
    pub repeat_enabled: bool,
    pub repeat_infinite: bool,
    pub repeat_count: u32,
}

#[tauri::command]
pub fn set_duration_mode(settings: DurationSettings) -> Result<(), String> {
    eprintln!("[commands] set_duration_mode: duration={}s, repeat={}, infinite={}, count={}",
        settings.duration_seconds, settings.repeat_enabled, 
        settings.repeat_infinite, settings.repeat_count);
    
    ffi::set_duration_mode(
        settings.duration_seconds,
        settings.repeat_enabled,
        settings.repeat_infinite,
        settings.repeat_count,
    )
}

#[tauri::command]
pub fn get_remaining_seconds() -> u32 {
    ffi::get_remaining_seconds()
}

#[tauri::command]
pub fn get_current_repeat_cycle() -> u32 {
    ffi::get_current_repeat_cycle()
}

#[tauri::command]
pub fn is_duration_complete() -> bool {
    ffi::is_duration_complete()
}

#[tauri::command]
pub fn start_publishing() -> Result<(), String> {
    eprintln!("[commands] start_publishing");
    
    // Check if interface is actually open (check C++ state)
    if !ffi::is_open() {
        return Err("No interface open. Please select and open a network interface first.".to_string());
    }
    
    let config = CONFIG.lock().unwrap().clone();
    
    // Configure native publisher
    ffi::publisher_configure(
        &config.sv_id,
        config.app_id,
        config.conf_rev,
        config.smp_synch,
        &config.src_mac,
        &config.dst_mac,
        config.vlan_priority as i32,
        config.vlan_id as i32,
        config.sample_rate,
        config.frequency as f64,
        325.0,  // voltage amplitude
        100.0,  // current amplitude
        config.no_asdu,
        config.channel_count,
    )?;
    
    // Start native publisher
    ffi::publisher_start()?;
    
    IS_PUBLISHING.store(true, Ordering::SeqCst);
    PACKETS_SENT.store(0, Ordering::SeqCst);
    BYTES_SENT.store(0, Ordering::SeqCst);
    ERRORS.store(0, Ordering::SeqCst);
    
    eprintln!("[commands] publisher started: rate={} Hz, channels={}", config.sample_rate, config.channel_count);
    Ok(())
}

#[tauri::command]
pub fn stop_publishing() -> Result<(), String> {
    eprintln!("[commands] stop_publishing");
    let _ = ffi::publisher_stop();
    IS_PUBLISHING.store(false, Ordering::SeqCst);
    Ok(())
}

/// Set send mode: 0=auto, 1=sendqueue (batch), 2=sendpacket (immediate), 3=USB-optimized
#[tauri::command]
pub fn set_send_mode(mode: i32) -> Result<(), String> {
    let mode_name = match mode {
        0 => "AUTO",
        1 => "SendQueue (batch)",
        2 => "SendPacket (immediate)",
        3 => "USB-Optimized (spin+gap)",
        _ => "UNKNOWN",
    };
    eprintln!("[commands] set_send_mode: {} ({})", mode_name, mode);
    ffi::set_send_mode(mode)
}

/// Get current send mode
#[tauri::command]
pub fn get_send_mode() -> i32 {
    ffi::get_send_mode()
}

#[tauri::command]
pub fn get_publish_status() -> PublishStatus {
    // Check BOTH single-publisher AND multi-publisher running state
    let single_running = ffi::publisher_is_running();
    let multi_running = ffi::mp_is_running();
    let is_publishing = single_running || multi_running;
    
    // Sync the Rust atomic with C++ state (for consistency)
    if !is_publishing {
        IS_PUBLISHING.store(false, Ordering::SeqCst);
    }
    
    PublishStatus {
        is_publishing,
        packets_sent: PACKETS_SENT.load(Ordering::Relaxed),
        errors: ERRORS.load(Ordering::Relaxed),
        interface: CURRENT_INTERFACE.lock().unwrap().clone(),
    }
}

// ============================================================================
// STATISTICS COMMANDS
// ============================================================================

#[tauri::command]
pub fn get_stats() -> StatsResponse {
    let config = CONFIG.lock().unwrap();
    let sample_rate = config.sample_rate;
    drop(config);
    
    // ALWAYS update rates before getting stats (like Node.js sv.updateStats())
    ffi::stats_update_rates();
    
    let native_stats = ffi::stats_get();
    let duration_ms = ffi::stats_get_duration_ms();
    let duration_sec = duration_ms as f64 / 1000.0;
    let rate_formatted = ffi::stats_format_rate(native_stats.current_bps);
    
    // Get backend-controlled states (check BOTH single and multi-publisher)
    let is_publishing = ffi::publisher_is_running() || ffi::mp_is_running();
    let duration_complete = ffi::is_duration_complete() || ffi::mp_is_duration_complete();
    
    // Reduced logging - only log important state changes
    // (remove spam, keep important events)
    
    StatsResponse {
        packets_sent: native_stats.packets_sent,
        packets_failed: native_stats.packets_failed,
        bytes_sent: native_stats.bytes_sent,
        current_bps: native_stats.current_bps,
        current_pps: native_stats.current_pps,
        peak_bps: native_stats.peak_bps,
        peak_pps: native_stats.peak_pps,
        rate_formatted,
        current_mbps: native_stats.current_bps / 1_000_000.0,
        peak_mbps: native_stats.peak_bps / 1_000_000.0,
        duration_ms,
        duration_sec,
        avg_packet_size: native_stats.avg_packet_size,
        smp_cnt: native_stats.packets_sent % (sample_rate as u64),
        configured_rate: sample_rate,
        session_active: native_stats.session_active != 0,
        is_publishing,
        duration_complete,
    }
}

#[tauri::command]
pub fn reset_stats() -> Result<(), String> {
    eprintln!("[commands] reset_stats");
    ffi::stats_reset();
    PACKETS_SENT.store(0, Ordering::SeqCst);
    BYTES_SENT.store(0, Ordering::SeqCst);
    ERRORS.store(0, Ordering::SeqCst);
    Ok(())
}

// ============================================================================
// CONFIG COMMANDS
// ============================================================================

#[tauri::command]
pub fn get_config() -> SvConfig {
    CONFIG.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_config(config: SvConfig) -> Result<(), String> {
    eprintln!("[commands] set_config: svID={}, appID={:#X}, rate={}, noASDU={}, channels={}", 
        config.sv_id, config.app_id, config.sample_rate, config.no_asdu, config.channel_count);
    *CONFIG.lock().unwrap() = config;
    Ok(())
}

#[tauri::command]
pub fn get_initial_state() -> InitialState {
    let config = CONFIG.lock().unwrap().clone();
    let interface = CURRENT_INTERFACE.lock().unwrap().clone();
    
    InitialState {
        config,
        is_publishing: IS_PUBLISHING.load(Ordering::Relaxed) || ffi::publisher_is_running() || ffi::mp_is_running(),
        interface_open: ffi::is_open(),
        current_interface: interface,
        native_available: ffi::is_native_available(),
    }
}

#[tauri::command]
pub fn is_native_available() -> bool {
    ffi::is_native_available()
}

// ============================================================================
// CHANNEL COMMANDS
// ============================================================================

#[tauri::command]
pub fn get_channels() -> Vec<Channel> {
    CHANNELS.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_channels(channels: Vec<Channel>) -> Result<(), String> {
    let count = channels.len();
    eprintln!("[commands] set_channels: {} channels received", count);
    
    // Store channels
    *CHANNELS.lock().unwrap() = channels.clone();
    
    // Pass equations to C++ via FFI
    // Format: "id1:equation1|id2:equation2|..."
    let equations_str: String = channels.iter()
        .map(|ch| format!("{}:{}", ch.id, ch.equation))
        .collect::<Vec<_>>()
        .join("|");
    
    ffi::set_equations(&equations_str)?;
    
    Ok(())
}

// ============================================================================
// FRAME INSPECTION COMMANDS (for FrameViewer)
// ============================================================================

/// Response structure for sample frame data
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleFrameResponse {
    pub frame_bytes: Vec<u8>,
    pub frame_size: usize,
    pub smp_cnt: u32,
}

/// Get a sample SV frame with the given sample count
/// Returns the actual encoded frame bytes for display in FrameViewer
#[tauri::command]
pub fn get_sample_frame(smp_cnt: u32) -> Result<SampleFrameResponse, String> {
    match ffi::get_sample_frame(smp_cnt) {
        Ok(bytes) => {
            let size = bytes.len();
            Ok(SampleFrameResponse {
                frame_bytes: bytes,
                frame_size: size,
                smp_cnt,
            })
        }
        Err(e) => Err(format!("Failed to get sample frame: {}", e))
    }
}

/// Response structure for channel values
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelValuesResponse {
    pub values: Vec<i32>,      // Dynamic channel values
    pub channel_count: usize,  // Actual channel count
    pub smp_cnt: u32,
}

/// Get current channel values from the running publisher
#[tauri::command]
pub fn get_current_channel_values() -> Result<ChannelValuesResponse, String> {
    match ffi::get_current_channel_values() {
        Ok((values, count)) => {
            let smp_cnt = ffi::get_current_smp_cnt();
            Ok(ChannelValuesResponse { 
                values, 
                channel_count: count,
                smp_cnt 
            })
        }
        Err(e) => Err(format!("Failed to get channel values: {}", e))
    }
}

/// Get current sample count
#[tauri::command]
pub fn get_current_smp_cnt() -> u32 {
    ffi::get_current_smp_cnt()
}

// ============================================================================
// MULTI-PUBLISHER COMMANDS
// ============================================================================

/// Publisher info returned to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublisherInfo {
    pub id: u32,
    pub sv_id: String,
    pub app_id: u16,
    pub sample_rate: u64,
    pub channel_count: u8,
}

/// Config for a single publisher from frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MpPublisherConfig {
    pub sv_id: String,
    pub app_id: u16,
    pub conf_rev: u32,
    pub smp_synch: u8,
    pub sample_rate: u64,
    pub frequency: u32,
    pub src_mac: [u8; 6],
    pub dst_mac: [u8; 6],
    pub vlan_id: u16,
    pub vlan_priority: u8,
    #[serde(default = "default_no_asdu")]
    pub no_asdu: u8,
    #[serde(default = "default_channel_count")]
    pub channel_count: u8,
    pub channels: Vec<Channel>,
}

/// Add a new publisher instance
#[tauri::command]
pub fn mp_add_publisher() -> u32 {
    let id = ffi::mp_add_publisher();
    eprintln!("[commands] mp_add_publisher: id={}", id);
    id
}

/// Remove a publisher
#[tauri::command]
pub fn mp_remove_publisher(id: u32) -> Result<(), String> {
    eprintln!("[commands] mp_remove_publisher: id={}", id);
    ffi::mp_remove_publisher(id)
}

/// Remove ALL publishers (reset for new session)
#[tauri::command]
pub fn mp_remove_all_publishers() -> Result<(), String> {
    eprintln!("[commands] mp_remove_all_publishers");
    ffi::mp_remove_all_publishers()
}

/// Get publisher count
#[tauri::command]
pub fn mp_get_publisher_count() -> u32 {
    ffi::mp_get_publisher_count()
}

/// Configure a specific publisher and set its equations
#[tauri::command]
pub fn mp_configure_publisher(id: u32, config: MpPublisherConfig) -> Result<(), String> {
    eprintln!("[commands] mp_configure_publisher: id={}, svID={}, appID={:#06X}, rate={}, channels={}",
        id, config.sv_id, config.app_id, config.sample_rate, config.channel_count);

    // Configure publisher
    ffi::mp_configure_publisher(
        id,
        &config.sv_id,
        config.app_id,
        config.conf_rev,
        config.smp_synch,
        &config.src_mac,
        &config.dst_mac,
        config.vlan_priority as i32,
        config.vlan_id as i32,
        config.sample_rate,
        config.frequency as f64,
        325.0,
        100.0,
        config.no_asdu,
        config.channel_count,
    )?;

    // Set equations if channels provided
    if !config.channels.is_empty() {
        let equations_str: String = config.channels.iter()
            .map(|ch| format!("{}:{}", ch.id, ch.equation))
            .collect::<Vec<_>>()
            .join("|");
        ffi::mp_set_publisher_equations(id, &equations_str)?;
    }

    Ok(())
}

/// Start all publishers
#[tauri::command]
pub fn mp_start_all() -> Result<(), String> {
    eprintln!("[commands] mp_start_all");
    ffi::mp_start_all()
}

/// Stop all publishers
#[tauri::command]
pub fn mp_stop_all() -> Result<(), String> {
    eprintln!("[commands] mp_stop_all");
    ffi::mp_stop_all()
}

/// Full reset: stop + clear ALL backend state (publishers, buffers, stats, settings)
#[tauri::command]
pub fn mp_reset_all() -> Result<(), String> {
    eprintln!("[commands] mp_reset_all");
    // Reset Rust-side state too
    IS_PUBLISHING.store(false, Ordering::SeqCst);
    PACKETS_SENT.store(0, Ordering::SeqCst);
    BYTES_SENT.store(0, Ordering::SeqCst);
    ERRORS.store(0, Ordering::SeqCst);
    ffi::mp_reset_all()
}

/// Check if multi-publisher is running
#[tauri::command]
pub fn mp_is_running() -> bool {
    ffi::mp_is_running()
}

/// Set send mode for multi-publisher
#[tauri::command]
pub fn mp_set_send_mode(mode: i32) -> Result<(), String> {
    ffi::mp_set_send_mode(mode)
}

/// Set duration for multi-publisher
#[tauri::command]
pub fn mp_set_duration(seconds: u32, repeat: bool, infinite: bool, count: u32) -> Result<(), String> {
    ffi::mp_set_duration(seconds, repeat, infinite, count)
}

/// Get multi-publisher stats (reuses existing stats since writer uses same stats module)
#[tauri::command]
pub fn mp_get_stats() -> StatsResponse {
    // Reuse existing get_stats — the SvController writer thread uses the same
    // npcap_stats_record_packet() calls, so stats are shared
    get_stats()
}

// ============================================================================
// USB FRAME PADDING COMMANDS
// ============================================================================

/// Set USB frame padding size in bytes (single-publisher)
#[tauri::command]
pub fn set_usb_pad_size(bytes: i32) {
    ffi::set_usb_pad_size(bytes);
}

/// Get USB frame padding size (single-publisher)
#[tauri::command]
pub fn get_usb_pad_size() -> i32 {
    ffi::get_usb_pad_size()
}

/// Set USB frame padding size (multi-publisher)
#[tauri::command]
pub fn mp_set_usb_pad_size(bytes: i32) {
    ffi::mp_set_usb_pad_size(bytes);
}

/// Get USB frame padding size (multi-publisher)
#[tauri::command]
pub fn mp_get_usb_pad_size() -> i32 {
    ffi::mp_get_usb_pad_size()
}

// ============================================================================
// USB MIN INTER-PACKET GAP COMMANDS
// ============================================================================

/// Set USB min inter-packet gap in microseconds (single-publisher)
#[tauri::command]
pub fn set_usb_min_gap_us(us: i32) {
    ffi::set_usb_min_gap_us(us);
}

/// Get USB min inter-packet gap (single-publisher)
#[tauri::command]
pub fn get_usb_min_gap_us() -> i32 {
    ffi::get_usb_min_gap_us()
}

/// Set USB min inter-packet gap (multi-publisher)
#[tauri::command]
pub fn mp_set_usb_min_gap_us(us: i32) {
    ffi::mp_set_usb_min_gap_us(us);
}

/// Get USB min inter-packet gap (multi-publisher)
#[tauri::command]
pub fn mp_get_usb_min_gap_us() -> i32 {
    ffi::mp_get_usb_min_gap_us()
}

