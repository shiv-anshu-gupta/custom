//! FFI bindings to the C++ native library

use std::ffi::{c_char, c_int, CStr, CString};

// ============================================================================
// C STRUCT DEFINITIONS
// ============================================================================

/// Network interface information
#[repr(C)]
#[derive(Debug, Clone)]
pub struct NpcapInterface {
    pub name: [c_char; 256],
    pub description: [c_char; 256],
    pub mac: [u8; 6],
    pub has_mac: c_int,
}

impl Default for NpcapInterface {
    fn default() -> Self {
        Self {
            name: [0; 256],
            description: [0; 256],
            mac: [0; 6],
            has_mac: 0,
        }
    }
}

/// Transmission statistics - must match C++ TransmitStats exactly
#[repr(C)]
#[derive(Debug, Clone, Default)]
pub struct TransmitStats {
    pub packets_sent: u64,
    pub packets_failed: u64,
    pub packets_queued: u64,
    pub bytes_sent: u64,
    pub bytes_queued: u64,
    pub rate_bytes_sent: u64,
    pub rate_packets_sent: u64,
    pub rate_window_start_ms: u64,
    pub current_bps: f64,
    pub current_pps: f64,
    pub peak_bps: f64,
    pub peak_pps: f64,
    pub session_start_ms: u64,
    pub session_end_ms: u64,       // Track when session ended
    pub last_packet_ms: u64,
    pub avg_packet_size: f64,
    pub avg_interval_us: f64,
    pub last_interval_us: u64,
    pub session_active: c_int,
}

// ============================================================================
// EXTERN C DECLARATIONS
// ============================================================================

#[link(name = "sv_native")]
extern "C" {
    // Error handling
    pub fn sv_get_last_error() -> *const c_char;

    // Network interface functions
    pub fn npcap_list_interfaces(interfaces: *mut NpcapInterface, max_count: c_int) -> c_int;
    pub fn npcap_get_last_error() -> *const c_char;
    pub fn npcap_open(device_name: *const c_char) -> c_int;
    pub fn npcap_close();
    pub fn npcap_is_open() -> c_int;

    // Statistics functions
    pub fn npcap_stats_reset();
    pub fn npcap_stats_session_start();
    pub fn npcap_stats_session_end();
    pub fn npcap_stats_update_rates();
    pub fn npcap_stats_get(stats: *mut TransmitStats);
    pub fn npcap_stats_get_duration_ms() -> u64;
    pub fn npcap_stats_format_rate(bps: f64, buf: *mut c_char, buflen: usize);

    // Publisher functions
    pub fn npcap_publisher_configure(
        svID: *const c_char,
        appID: u16,
        confRev: u32,
        smpSynch: u8,
        srcMAC: *const u8,
        dstMAC: *const u8,
        vlanPriority: c_int,
        vlanID: c_int,
        sampleRate: u64,
        frequency: f64,
        voltageAmplitude: f64,
        currentAmplitude: f64,
        asduCount: u8,
        channelCount: u8,
    ) -> c_int;
    pub fn npcap_publisher_start() -> c_int;
    pub fn npcap_publisher_stop() -> c_int;
    pub fn npcap_publisher_is_running() -> c_int;
    
    // Send mode functions
    pub fn npcap_set_send_mode(mode: c_int) -> c_int;
    pub fn npcap_get_send_mode() -> c_int;

    // USB frame padding (single-publisher)
    pub fn npcap_set_usb_pad_size(bytes: c_int);
    pub fn npcap_get_usb_pad_size() -> c_int;

    // USB min inter-packet gap (single-publisher)
    pub fn npcap_set_usb_min_gap_us(us: c_int);
    pub fn npcap_get_usb_min_gap_us() -> c_int;
    
    // Duration and Repeat mode functions (BACKEND CONTROLLED!)
    pub fn npcap_set_duration_mode(
        duration_seconds: u32,
        repeat_enabled: c_int,
        repeat_infinite: c_int,
        repeat_count: u32,
    ) -> c_int;
    pub fn npcap_get_current_repeat_cycle() -> u32;
    pub fn npcap_is_duration_complete() -> c_int;
    pub fn npcap_get_remaining_seconds() -> u32;
    
    // Equation/Channel functions
    pub fn npcap_set_equations(equations: *const c_char) -> c_int;
    
    // Frame inspection functions (for FrameViewer)
    pub fn npcap_get_sample_frame(
        out_buffer: *mut u8,
        buffer_size: usize,
        out_frame_size: *mut usize,
        smp_cnt: u32,
    ) -> c_int;
    pub fn npcap_get_current_channel_values(out_values: *mut i32) -> c_int;
    pub fn npcap_get_current_smp_cnt() -> u32;

    // ========================================================================
    // MULTI-PUBLISHER API (sv_mp_* functions from sv_controller.cc)
    // ========================================================================

    // Publisher management
    pub fn sv_mp_add_publisher() -> u32;
    pub fn sv_mp_remove_publisher(id: u32) -> c_int;
    pub fn sv_mp_remove_all_publishers() -> c_int;
    pub fn sv_mp_get_publisher_count() -> u32;

    // Publisher configuration
    pub fn sv_mp_configure_publisher(
        id: u32,
        svID: *const c_char,
        appID: u16,
        confRev: u32,
        smpSynch: u8,
        srcMAC: *const u8,
        dstMAC: *const u8,
        vlanPriority: c_int,
        vlanID: c_int,
        sampleRate: u64,
        frequency: f64,
        voltageAmplitude: f64,
        currentAmplitude: f64,
        asduCount: u8,
        channelCount: u8,
    ) -> c_int;
    pub fn sv_mp_set_publisher_equations(id: u32, equations: *const c_char) -> c_int;

    // Lifecycle
    pub fn sv_mp_start_all() -> c_int;
    pub fn sv_mp_stop_all() -> c_int;
    pub fn sv_mp_reset_all() -> c_int;
    pub fn sv_mp_is_running() -> c_int;

    // Global settings
    pub fn sv_mp_set_send_mode(mode: c_int) -> c_int;
    pub fn sv_mp_get_send_mode() -> c_int;
    pub fn sv_mp_set_duration(
        seconds: u32,
        repeat: c_int,
        infinite: c_int,
        count: u32,
    ) -> c_int;
    pub fn sv_mp_get_remaining_seconds() -> u32;
    pub fn sv_mp_get_current_repeat_cycle() -> u32;
    pub fn sv_mp_is_duration_complete() -> c_int;
    pub fn sv_mp_get_last_error() -> *const c_char;

    // USB frame padding (multi-publisher)
    pub fn sv_mp_set_usb_pad_size(bytes: c_int);
    pub fn sv_mp_get_usb_pad_size() -> c_int;

    // USB min inter-packet gap (multi-publisher)
    pub fn sv_mp_set_usb_min_gap_us(us: c_int);
    pub fn sv_mp_get_usb_min_gap_us() -> c_int;
}

// ============================================================================
// SAFE RUST WRAPPERS
// ============================================================================

/// Get the last error message from npcap
pub fn get_npcap_error() -> String {
    unsafe {
        let ptr = npcap_get_last_error();
        if ptr.is_null() {
            "Unknown error".to_string()
        } else {
            CStr::from_ptr(ptr).to_string_lossy().into_owned()
        }
    }
}

/// Set equations for channels (passed to C++)
pub fn set_equations(equations: &str) -> Result<(), String> {
    let c_equations = CString::new(equations).map_err(|_| "Invalid equations string")?;
    let result = unsafe { npcap_set_equations(c_equations.as_ptr()) };
    if result < 0 {
        Err(get_npcap_error())
    } else {
        Ok(())
    }
}

/// List available network interfaces
pub fn list_interfaces() -> Result<Vec<crate::commands::NetworkInterface>, String> {
    let mut interfaces = vec![NpcapInterface::default(); 32];
    let count = unsafe { npcap_list_interfaces(interfaces.as_mut_ptr(), 32) };
    
    if count < 0 {
        return Err(get_npcap_error());
    }
    
    let mut result = Vec::new();
    for i in 0..(count as usize) {
        let iface = &interfaces[i];
        let name = unsafe { CStr::from_ptr(iface.name.as_ptr()) }
            .to_string_lossy()
            .into_owned();
        let description = unsafe { CStr::from_ptr(iface.description.as_ptr()) }
            .to_string_lossy()
            .into_owned();
        let mac = if iface.has_mac != 0 {
            format!(
                "{:02X}:{:02X}:{:02X}:{:02X}:{:02X}:{:02X}",
                iface.mac[0], iface.mac[1], iface.mac[2],
                iface.mac[3], iface.mac[4], iface.mac[5]
            )
        } else {
            String::new()
        };
        
        result.push(crate::commands::NetworkInterface {
            name,
            description,
            mac,
        });
    }
    
    Ok(result)
}

/// Open a network interface
pub fn open_interface(name: &str) -> Result<(), String> {
    let c_name = CString::new(name).map_err(|_| "Invalid interface name")?;
    let result = unsafe { npcap_open(c_name.as_ptr()) };
    if result < 0 {
        Err(get_npcap_error())
    } else {
        Ok(())
    }
}

/// Close the current interface
pub fn close_interface() {
    unsafe { npcap_close() }
}

/// Check if interface is open
pub fn is_open() -> bool {
    unsafe { npcap_is_open() != 0 }
}

/// Configure the publisher
pub fn publisher_configure(
    sv_id: &str,
    app_id: u16,
    conf_rev: u32,
    smp_synch: u8,
    src_mac: &[u8; 6],
    dst_mac: &[u8; 6],
    vlan_priority: i32,
    vlan_id: i32,
    sample_rate: u64,
    frequency: f64,
    voltage_amplitude: f64,
    current_amplitude: f64,
    asdu_count: u8,
    channel_count: u8,
) -> Result<(), String> {
    let c_sv_id = CString::new(sv_id).map_err(|_| "Invalid svID")?;
    let result = unsafe {
        npcap_publisher_configure(
            c_sv_id.as_ptr(),
            app_id,
            conf_rev,
            smp_synch,
            src_mac.as_ptr(),
            dst_mac.as_ptr(),
            vlan_priority,
            vlan_id,
            sample_rate,
            frequency,
            voltage_amplitude,
            current_amplitude,
            asdu_count,
            channel_count,
        )
    };
    if result < 0 {
        Err(get_npcap_error())
    } else {
        Ok(())
    }
}

/// Start the publisher
pub fn publisher_start() -> Result<(), String> {
    let result = unsafe { npcap_publisher_start() };
    if result < 0 {
        Err(get_npcap_error())
    } else {
        Ok(())
    }
}

/// Stop the publisher
pub fn publisher_stop() -> Result<(), String> {
    let result = unsafe { npcap_publisher_stop() };
    if result < 0 {
        Err(get_npcap_error())
    } else {
        Ok(())
    }
}

/// Check if publisher is running
pub fn publisher_is_running() -> bool {
    unsafe { npcap_publisher_is_running() != 0 }
}

/// Set the send mode (0=auto, 1=sendqueue, 2=sendpacket)
pub fn set_send_mode(mode: i32) -> Result<(), String> {
    let result = unsafe { npcap_set_send_mode(mode) };
    if result < 0 {
        Err(get_npcap_error())
    } else {
        Ok(())
    }
}

/// Get the current send mode (0=auto, 1=sendqueue, 2=sendpacket)
pub fn get_send_mode() -> i32 {
    unsafe { npcap_get_send_mode() }
}

/// Set duration and repeat mode for publishing (BACKEND CONTROLLED!)
/// This ensures all timing happens in C++, not in frontend JavaScript
pub fn set_duration_mode(
    duration_seconds: u32,
    repeat_enabled: bool,
    repeat_infinite: bool,
    repeat_count: u32,
) -> Result<(), String> {
    let result = unsafe {
        npcap_set_duration_mode(
            duration_seconds,
            if repeat_enabled { 1 } else { 0 },
            if repeat_infinite { 1 } else { 0 },
            repeat_count,
        )
    };
    if result < 0 {
        Err(get_npcap_error())
    } else {
        Ok(())
    }
}

/// Get current repeat cycle number
pub fn get_current_repeat_cycle() -> u32 {
    unsafe { npcap_get_current_repeat_cycle() }
}

/// Check if duration has completed
pub fn is_duration_complete() -> bool {
    unsafe { npcap_is_duration_complete() != 0 }
}

/// Get remaining time in seconds
pub fn get_remaining_seconds() -> u32 {
    unsafe { npcap_get_remaining_seconds() }
}

/// Update stats rate calculations
pub fn stats_update_rates() {
    unsafe { npcap_stats_update_rates() }
}

/// Get current stats
pub fn stats_get() -> TransmitStats {
    let mut stats = TransmitStats::default();
    unsafe { npcap_stats_get(&mut stats) };
    stats
}

/// Get session duration in ms
pub fn stats_get_duration_ms() -> u64 {
    unsafe { npcap_stats_get_duration_ms() }
}

/// Format rate as string
pub fn stats_format_rate(bps: f64) -> String {
    let mut buf = [0i8; 64];
    unsafe { npcap_stats_format_rate(bps, buf.as_mut_ptr(), buf.len()) };
    unsafe { CStr::from_ptr(buf.as_ptr()) }
        .to_string_lossy()
        .into_owned()
}

/// Reset stats
pub fn stats_reset() {
    unsafe { npcap_stats_reset() }
}

/// Start stats session
pub fn stats_session_start() {
    unsafe { npcap_stats_session_start() }
}

/// End stats session  
pub fn stats_session_end() {
    unsafe { npcap_stats_session_end() }
}

/// Check if native library is available
pub fn is_native_available() -> bool {
    // If we can call any C function successfully, native is available
    // Try getting error (always works)
    unsafe {
        let ptr = npcap_get_last_error();
        !ptr.is_null() || true  // Always true since library linked at compile time
    }
}

// ============================================================================
// FRAME INSPECTION FUNCTIONS (for FrameViewer)
// ============================================================================

/// Get a sample frame with the given smpCnt value
/// Returns the actual encoded SV frame bytes
pub fn get_sample_frame(smp_cnt: u32) -> Result<Vec<u8>, String> {
    // Max SV frame size is around 200 bytes, allocate 512 to be safe
    let mut buffer = vec![0u8; 512];
    let mut frame_size: usize = 0;
    
    let result = unsafe {
        npcap_get_sample_frame(
            buffer.as_mut_ptr(),
            buffer.len(),
            &mut frame_size,
            smp_cnt,
        )
    };
    
    if result < 0 {
        Err(get_npcap_error())
    } else {
        buffer.truncate(frame_size);
        Ok(buffer)
    }
}

/// Get current channel values (up to 20 channels for IEC 61869-9)
pub fn get_current_channel_values() -> Result<(Vec<i32>, usize), String> {
    let mut values = [0i32; 20];  // Support up to 20 channels
    let result = unsafe { npcap_get_current_channel_values(values.as_mut_ptr()) };
    
    if result < 0 {
        Err(get_npcap_error())
    } else {
        let count = result as usize;  // C++ returns channel count
        Ok((values[..count].to_vec(), count))
    }
}

/// Get current sample count
pub fn get_current_smp_cnt() -> u32 {
    unsafe { npcap_get_current_smp_cnt() }
}

// ============================================================================
// MULTI-PUBLISHER SAFE WRAPPERS
// ============================================================================

/// Get multi-publisher error message
pub fn mp_get_error() -> String {
    unsafe {
        let ptr = sv_mp_get_last_error();
        if ptr.is_null() {
            "Unknown error".to_string()
        } else {
            CStr::from_ptr(ptr).to_string_lossy().into_owned()
        }
    }
}

/// Add a new publisher instance, returns its ID
pub fn mp_add_publisher() -> u32 {
    unsafe { sv_mp_add_publisher() }
}

/// Remove a publisher by ID
pub fn mp_remove_publisher(id: u32) -> Result<(), String> {
    let result = unsafe { sv_mp_remove_publisher(id) };
    if result < 0 { Err(mp_get_error()) } else { Ok(()) }
}

/// Remove ALL publishers (reset for new session)
pub fn mp_remove_all_publishers() -> Result<(), String> {
    let result = unsafe { sv_mp_remove_all_publishers() };
    if result < 0 { Err(mp_get_error()) } else { Ok(()) }
}

/// Get number of publishers
pub fn mp_get_publisher_count() -> u32 {
    unsafe { sv_mp_get_publisher_count() }
}

/// Configure a specific publisher
pub fn mp_configure_publisher(
    id: u32,
    sv_id: &str,
    app_id: u16,
    conf_rev: u32,
    smp_synch: u8,
    src_mac: &[u8; 6],
    dst_mac: &[u8; 6],
    vlan_priority: i32,
    vlan_id: i32,
    sample_rate: u64,
    frequency: f64,
    voltage_amplitude: f64,
    current_amplitude: f64,
    asdu_count: u8,
    channel_count: u8,
) -> Result<(), String> {
    let c_sv_id = CString::new(sv_id).map_err(|_| "Invalid svID")?;
    let result = unsafe {
        sv_mp_configure_publisher(
            id,
            c_sv_id.as_ptr(),
            app_id, conf_rev, smp_synch,
            src_mac.as_ptr(), dst_mac.as_ptr(),
            vlan_priority, vlan_id,
            sample_rate, frequency,
            voltage_amplitude, current_amplitude,
            asdu_count, channel_count,
        )
    };
    if result < 0 { Err(mp_get_error()) } else { Ok(()) }
}

/// Set equations for a specific publisher
pub fn mp_set_publisher_equations(id: u32, equations: &str) -> Result<(), String> {
    let c_eq = CString::new(equations).map_err(|_| "Invalid equations string")?;
    let result = unsafe { sv_mp_set_publisher_equations(id, c_eq.as_ptr()) };
    if result < 0 { Err(mp_get_error()) } else { Ok(()) }
}

/// Start all publishers
pub fn mp_start_all() -> Result<(), String> {
    let result = unsafe { sv_mp_start_all() };
    if result < 0 { Err(mp_get_error()) } else { Ok(()) }
}

/// Stop all publishers
pub fn mp_stop_all() -> Result<(), String> {
    let result = unsafe { sv_mp_stop_all() };
    if result < 0 { Err(mp_get_error()) } else { Ok(()) }
}

/// Check if multi-publisher system is running
pub fn mp_is_running() -> bool {
    unsafe { sv_mp_is_running() != 0 }
}

/// Full reset: stop everything, free all memory, clear all state
pub fn mp_reset_all() -> Result<(), String> {
    let result = unsafe { sv_mp_reset_all() };
    if result < 0 { Err(mp_get_error()) } else { Ok(()) }
}

/// Set send mode for multi-publisher
pub fn mp_set_send_mode(mode: i32) -> Result<(), String> {
    let result = unsafe { sv_mp_set_send_mode(mode) };
    if result < 0 { Err(mp_get_error()) } else { Ok(()) }
}

/// Get send mode for multi-publisher
pub fn mp_get_send_mode() -> i32 {
    unsafe { sv_mp_get_send_mode() }
}

/// Set duration for multi-publisher
pub fn mp_set_duration(seconds: u32, repeat: bool, infinite: bool, count: u32) -> Result<(), String> {
    let result = unsafe {
        sv_mp_set_duration(
            seconds,
            if repeat { 1 } else { 0 },
            if infinite { 1 } else { 0 },
            count,
        )
    };
    if result < 0 { Err(mp_get_error()) } else { Ok(()) }
}

/// Get remaining seconds for multi-publisher
pub fn mp_get_remaining_seconds() -> u32 {
    unsafe { sv_mp_get_remaining_seconds() }
}

/// Get current repeat cycle for multi-publisher
pub fn mp_get_current_repeat_cycle() -> u32 {
    unsafe { sv_mp_get_current_repeat_cycle() }
}

/// Check if duration complete for multi-publisher
pub fn mp_is_duration_complete() -> bool {
    unsafe { sv_mp_is_duration_complete() != 0 }
}

/// Set USB frame padding size (single-publisher)
pub fn set_usb_pad_size(bytes: i32) {
    unsafe { npcap_set_usb_pad_size(bytes) }
}

/// Get USB frame padding size (single-publisher)
pub fn get_usb_pad_size() -> i32 {
    unsafe { npcap_get_usb_pad_size() }
}

/// Set USB frame padding size (multi-publisher)
pub fn mp_set_usb_pad_size(bytes: i32) {
    unsafe { sv_mp_set_usb_pad_size(bytes) }
}

/// Get USB frame padding size (multi-publisher)
pub fn mp_get_usb_pad_size() -> i32 {
    unsafe { sv_mp_get_usb_pad_size() }
}

/// Set USB min inter-packet gap in microseconds (single-publisher)
pub fn set_usb_min_gap_us(us: i32) {
    unsafe { npcap_set_usb_min_gap_us(us) }
}

/// Get USB min inter-packet gap (single-publisher)
pub fn get_usb_min_gap_us() -> i32 {
    unsafe { npcap_get_usb_min_gap_us() }
}

/// Set USB min inter-packet gap (multi-publisher)
pub fn mp_set_usb_min_gap_us(us: i32) {
    unsafe { sv_mp_set_usb_min_gap_us(us) }
}

/// Get USB min inter-packet gap (multi-publisher)
pub fn mp_get_usb_min_gap_us() -> i32 {
    unsafe { sv_mp_get_usb_min_gap_us() }
}
