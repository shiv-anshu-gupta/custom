fn main() {
    // Build the C++ native library
    let native_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("native")
        .join("src");
    
    let include_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("native")
        .join("include");
    
    // ═══════════════════════════════════════════════════════════════════════
    // MODULAR SOURCE FILES (Refactored from monolithic sv_native.cc)
    // ═══════════════════════════════════════════════════════════════════════
    // Main entry point (uses all modules below)
    let sv_native_src = native_dir.join("sv_native_refactored.cc");
    // Network transmission module (Npcap interface)
    let npcap_transmitter_src = native_dir.join("npcap_transmitter_impl.cc");
    // Packet encoding module (IEC 61850-9-2LE)
    let sv_encoder_src = native_dir.join("sv_encoder_impl.cc");
    // Statistics tracking module
    let sv_stats_src = native_dir.join("sv_stats_impl.cc");
    // Equation processing module
    let equation_processor_src = native_dir.join("equation_processor.cc");
    // Multi-publisher modules
    let sv_publisher_instance_src = native_dir.join("sv_publisher_instance.cc");
    let sv_controller_src = native_dir.join("sv_controller.cc");
    
    // Recompile if any source file changes
    println!("cargo:rerun-if-changed={}", sv_native_src.display());
    println!("cargo:rerun-if-changed={}", npcap_transmitter_src.display());
    println!("cargo:rerun-if-changed={}", sv_encoder_src.display());
    println!("cargo:rerun-if-changed={}", sv_stats_src.display());
    println!("cargo:rerun-if-changed={}", equation_processor_src.display());
    println!("cargo:rerun-if-changed={}", sv_publisher_instance_src.display());
    println!("cargo:rerun-if-changed={}", sv_controller_src.display());
    
    let mut build = cc::Build::new();
    build
        .cpp(true)
        .file(&sv_native_src)
        .file(&npcap_transmitter_src)
        .file(&sv_encoder_src)
        .file(&sv_stats_src)
        .file(&equation_processor_src)
        .file(&sv_publisher_instance_src)
        .file(&sv_controller_src)
        .include(&native_dir)   // For source-relative includes
        .include(&include_dir); // For header files

    // Release-mode optimization flags (all platforms)
    let profile = std::env::var("PROFILE").unwrap_or_default();
    if profile == "release" {
        #[cfg(target_os = "windows")]
        {
            build.flag("/O2").define("NDEBUG", None);
        }
        #[cfg(not(target_os = "windows"))]
        {
            build.flag("-O3").define("NDEBUG", None);
            build.flag("-march=native");
        }
    }

    // Platform-specific compiler flags
    #[cfg(target_os = "windows")]
    {
        build
            .flag("/std:c++17")
            .flag("/EHsc")
            .flag("/MD")            // Use dynamic MSVC runtime
            .define("WIN32", None)
            .define("_WINDOWS", None)
            .define("_CRT_SECURE_NO_WARNINGS", None);
    }

    #[cfg(target_os = "linux")]
    {
        build
            .flag("-std=c++17")
            .flag("-fPIC")
            .flag("-pthread")
            .flag("-funroll-loops");
        // Link against libpcap on Linux
        println!("cargo:rustc-link-lib=pcap");
        println!("cargo:rustc-link-lib=pthread");
    }

    #[cfg(target_os = "macos")]
    {
        build
            .flag("-std=c++17")
            .flag("-fPIC");
        // Link against libpcap on macOS (pre-installed)
        println!("cargo:rustc-link-lib=pcap");
    }

    build.compile("sv_native");

    // Windows: wpcap and Packet are loaded dynamically at runtime (LoadLibrary/GetProcAddress)
    // Linux/macOS: libpcap is linked directly via cargo:rustc-link-lib above

    tauri_build::build()
}
