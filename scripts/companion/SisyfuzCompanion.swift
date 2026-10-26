import AppKit
import WebKit
import Foundation
import Darwin

// Globally ignore SIGPIPE to prevent instant process termination on socket/pipe disconnects
private let _sigpipeIgnored: Void = {
    _ = signal(SIGPIPE, SIG_IGN)
}()

// MARK: - Brutalist HUD Panel (Custom NSPanel with key input support)
class BrutalistHUDPanel: NSPanel {
    override var canBecomeKey: Bool {
        return true
    }
    override var canBecomeMain: Bool {
        return true
    }
}

// MARK: - OSC Types & Codec (OSC 1.0 UDP Protocol)
enum OSCArgument {
    case string(String)
    case int32(Int32)
    case float32(Float)
}

struct OSCMessage {
    let address: String
    let arguments: [OSCArgument]

    func encode() -> Data {
        var data = Data()
        data.append(OSCMessage.padString(address))

        var typeTags = ","
        for arg in arguments {
            switch arg {
            case .string: typeTags.append("s")
            case .int32: typeTags.append("i")
            case .float32: typeTags.append("f")
            }
        }
        data.append(OSCMessage.padString(typeTags))

        for arg in arguments {
            switch arg {
            case .string(let str):
                data.append(OSCMessage.padString(str))
            case .int32(let val):
                var big = val.bigEndian
                data.append(Data(bytes: &big, count: 4))
            case .float32(let val):
                var big = val.bitPattern.bigEndian
                data.append(Data(bytes: &big, count: 4))
            }
        }
        return data
    }

    static func padString(_ str: String) -> Data {
        guard var d = str.data(using: .utf8) else { return Data() }
        d.append(0)
        while d.count % 4 != 0 {
            d.append(0)
        }
        return d
    }

    static func decode(data: Data) -> OSCMessage? {
        guard data.count >= 4 else { return nil }
        var offset = 0
        guard let address = readPaddedString(data: data, offset: &offset), address.hasPrefix("/") else {
            return nil
        }
        guard let typeTag = readPaddedString(data: data, offset: &offset), typeTag.hasPrefix(",") else {
            return OSCMessage(address: address, arguments: [])
        }

        var args: [OSCArgument] = []
        for ch in typeTag.dropFirst() {
            switch ch {
            case "s":
                if let str = readPaddedString(data: data, offset: &offset) {
                    args.append(.string(str))
                }
            case "i":
                if offset + 4 <= data.count {
                    let sub = data.subdata(in: offset..<offset+4)
                    let val = sub.withUnsafeBytes { $0.loadUnaligned(as: Int32.self) }
                    args.append(.int32(Int32(bigEndian: val)))
                    offset += 4
                }
            case "f":
                if offset + 4 <= data.count {
                    let sub = data.subdata(in: offset..<offset+4)
                    let val = sub.withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }
                    args.append(.float32(Float(bitPattern: UInt32(bigEndian: val))))
                    offset += 4
                }
            default:
                break
            }
        }
        return OSCMessage(address: address, arguments: args)
    }

    private static func readPaddedString(data: Data, offset: inout Int) -> String? {
        guard offset < data.count else { return nil }
        var nullIndex: Int? = nil
        for i in offset..<data.count {
            if data[i] == 0 {
                nullIndex = i
                break
            }
        }
        guard let end = nullIndex else { return nil }
        let strData = data.subdata(in: offset..<end)
        let str = String(data: strData, encoding: .utf8)
        var nextOffset = end + 1
        while nextOffset % 4 != 0 {
            nextOffset += 1
        }
        offset = nextOffset
        return str
    }
}

// MARK: - OSC UDP Server (Listens for TouchDesigner)
class OSCServer {
    private var socketFd: Int32 = -1
    private var readSource: DispatchSourceRead?
    let port: UInt16
    var onMessageReceived: ((OSCMessage) -> Void)?

    init(port: UInt16 = 7000) {
        self.port = port
    }

    func start() -> Bool {
        socketFd = socket(AF_INET, SOCK_DGRAM, 0)
        guard socketFd >= 0 else { return false }

        var nosigpipe: Int32 = 1
        setsockopt(socketFd, SOL_SOCKET, SO_NOSIGPIPE, &nosigpipe, socklen_t(MemoryLayout<Int32>.size))

        var reuse: Int32 = 1
        setsockopt(socketFd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))
        setsockopt(socketFd, SOL_SOCKET, SO_REUSEPORT, &reuse, socklen_t(MemoryLayout<Int32>.size))

        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr.s_addr = INADDR_ANY.bigEndian

        let bindRes = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
                bind(socketFd, saPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindRes == 0 else {
            close(socketFd)
            socketFd = -1
            return false
        }

        let flags = fcntl(socketFd, F_GETFL, 0)
        _ = fcntl(socketFd, F_SETFL, flags | O_NONBLOCK)

        let source = DispatchSource.makeReadSource(fileDescriptor: socketFd, queue: DispatchQueue.global(qos: .userInteractive))
        let serverFd = socketFd
        source.setCancelHandler {
            close(serverFd)
        }

        source.setEventHandler { [weak self] in
            guard let self = self, self.socketFd >= 0 else { return }
            while true {
                var buffer = [UInt8](repeating: 0, count: 65536)
                var clientAddr = sockaddr_in()
                var clientAddrLen = socklen_t(MemoryLayout<sockaddr_in>.size)

                let bytesRead = withUnsafeMutablePointer(to: &clientAddr) { ptr in
                    ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
                        recvfrom(self.socketFd, &buffer, buffer.count, 0, saPtr, &clientAddrLen)
                    }
                }

                guard bytesRead > 0 else { break }

                let data = Data(buffer[0..<bytesRead])
                if let osc = OSCMessage.decode(data: data) {
                    DispatchQueue.main.async {
                        self.onMessageReceived?(osc)
                    }
                }
            }
        }
        source.resume()
        self.readSource = source
        return true
    }

    func stop() {
        if let src = readSource {
            src.cancel()
            readSource = nil
        } else if socketFd >= 0 {
            close(socketFd)
        }
        socketFd = -1
    }

    deinit {
        stop()
    }
}

// MARK: - OSC UDP Client (Sends Telemetry & Modes to TouchDesigner)
class OSCClient {
    private var socketFd: Int32 = -1
    let host: String
    let port: UInt16
    private var destAddr = sockaddr_in()
    private let sendLock = NSLock()

    init(host: String = "127.0.0.1", port: UInt16 = 7001) {
        self.host = host
        self.port = port
        setupSocket()
    }

    private func setupSocket() {
        socketFd = socket(AF_INET, SOCK_DGRAM, 0)
        guard socketFd >= 0 else { return }

        var nosigpipe: Int32 = 1
        setsockopt(socketFd, SOL_SOCKET, SO_NOSIGPIPE, &nosigpipe, socklen_t(MemoryLayout<Int32>.size))

        destAddr = sockaddr_in()
        destAddr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        destAddr.sin_family = sa_family_t(AF_INET)
        destAddr.sin_port = port.bigEndian
        inet_pton(AF_INET, host, &destAddr.sin_addr)
    }

    func send(message: OSCMessage) {
        sendLock.lock()
        defer { sendLock.unlock() }
        guard socketFd >= 0 else { return }
        let data = message.encode()
        data.withUnsafeBytes { rawPtr in
            guard let ptr = rawPtr.baseAddress else { return }
            withUnsafePointer(to: &destAddr) { addrPtr in
                addrPtr.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
                    _ = sendto(socketFd, ptr, data.count, 0, saPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
                }
            }
        }
    }

    deinit {
        sendLock.lock()
        defer { sendLock.unlock() }
        if socketFd >= 0 {
            close(socketFd)
            socketFd = -1
        }
    }
}

// MARK: - Models & Configuration Schema (Extensible JSON Storage Guardian)

struct StorageGuardianConfig: Codable {
    var activeTargetId: String
    var targets: [SortTargetConfig]
    var rules: [SortRuleConfig]
    var ephemeralExtensions: [String]
}

struct SortTargetConfig: Codable {
    var id: String
    var label: String
    var path: String?
    var isDynamic: Bool
}

struct SortRuleConfig: Codable {
    var id: String
    var categoryName: String
    var extensions: [String]
    var destinations: [String: String]

    func destinationSubfolder(mode: String) -> String {
        let key = mode.lowercased()
        return destinations[key] ?? destinations["default"] ?? "Sorted/\(categoryName)"
    }
}

struct SortTarget: Codable {
    let id: String
    var label: String
    var path: String?
    var isDynamic: Bool

    var resolvedURL: URL? {
        if let p = path {
            let expanded = (p as NSString).expandingTildeInPath
            return URL(fileURLWithPath: expanded)
        }
        return nil
    }
}

struct SortResult {
    let success: Bool
    let message: String
    let targetName: String
    let sortedCount: Int
    let items: [[String: Any]]
}

// MARK: - Open Files & Active App Detector (Native Cocoa & AppleScript Engine)
class OpenFilesDetector {
    // Tracks the last active application outside of Sisyfuz Companion (thread-safe)
    private static let stateLock = NSLock()
    private static var _lastActiveExternalApp: NSRunningApplication?
    static var lastActiveExternalApp: NSRunningApplication? {
        get {
            stateLock.lock()
            defer { stateLock.unlock() }
            return _lastActiveExternalApp
        }
        set {
            stateLock.lock()
            defer { stateLock.unlock() }
            if let app = newValue, !app.isTerminated {
                _lastActiveExternalApp = app
            } else if newValue == nil {
                _lastActiveExternalApp = nil
            }
        }
    }

    private static var _cachedResult: DetectionResult?
    private static var _lastDetectionTime: TimeInterval = 0
    private static var _isDetectionRunning = false
    private static let scriptQueue = DispatchQueue(label: "com.sisyfuz.scriptQueue", qos: .utility)

    struct DetectionResult {
        let files: [URL]
        let appName: String
        let summary: String
        let isFinderFolder: Bool
    }

    static func resolveTargetApp() -> NSRunningApplication? {
        if let front = NSWorkspace.shared.frontmostApplication, !front.isTerminated {
            let myPid = ProcessInfo.processInfo.processIdentifier
            let bundleId = front.bundleIdentifier ?? ""
            if front.processIdentifier != myPid &&
               bundleId != "com.sisyfuz.companion" &&
               front.localizedName != "SisyfuzCompanion" {
                self.lastActiveExternalApp = front
                return front
            }
        }
        if let last = self.lastActiveExternalApp, !last.isTerminated {
            return last
        }
        return NSWorkspace.shared.runningApplications.first {
            !$0.isTerminated &&
            $0.activationPolicy == .regular &&
            $0.processIdentifier != ProcessInfo.processInfo.processIdentifier &&
            $0.bundleIdentifier != "com.sisyfuz.companion" &&
            $0.localizedName != "SisyfuzCompanion"
        }
    }

    static func detectOpenFiles(forceRefresh: Bool = false) -> DetectionResult {
        let now = Date().timeIntervalSince1970
        stateLock.lock()
        if !forceRefresh, let cached = _cachedResult, (now - _lastDetectionTime) < 2.0 {
            let res = cached
            stateLock.unlock()
            return res
        }

        if _isDetectionRunning {
            // Unlock before resolveTargetApp(): it takes stateLock (non-recursive) itself
            let cached = _cachedResult
            stateLock.unlock()
            return cached ?? DetectionResult(files: [], appName: resolveTargetApp()?.localizedName ?? "Finder", summary: "SCANNING OPEN FILES...", isFinderFolder: false)
        }

        _isDetectionRunning = true
        _lastDetectionTime = now
        let prev = _cachedResult
        stateLock.unlock()

        // Callers off the main thread (sorting) need a real first result, but the main thread must never
        // wait: AppleScript can block for seconds, or indefinitely on a first-run Automation prompt
        if prev == nil && !Thread.isMainThread {
            let res = scriptQueue.sync {
                return performDetection()
            }
            stateLock.lock()
            _cachedResult = res
            _isDetectionRunning = false
            stateLock.unlock()
            return res
        }

        scriptQueue.async {
            let res = performDetection()
            stateLock.lock()
            _cachedResult = res
            _isDetectionRunning = false
            stateLock.unlock()
        }

        return prev ?? DetectionResult(files: [], appName: resolveTargetApp()?.localizedName ?? "Finder", summary: "SCANNING OPEN FILES...", isFinderFolder: false)
    }

    /// Latest detection without triggering AppleScript, for frequent status polling.
    static func cachedDetection() -> DetectionResult? {
        stateLock.lock()
        defer { stateLock.unlock() }
        return _cachedResult
    }

    private static func performDetection() -> DetectionResult {
        let targetApp = resolveTargetApp()
        let appName = targetApp?.localizedName ?? "Finder"

        // 1. Finder: query active selection and front window target
        if appName.lowercased() == "finder" {
            let script = """
            with timeout of 2 seconds
                tell application "Finder"
                    try
                        set selList to {}
                        set sel to selection as alias list
                        repeat with itemRef in sel
                            set end of selList to POSIX path of itemRef
                        end repeat
                        if (count of selList) > 0 then
                            set AppleScript's text item delimiters to linefeed
                            return "SELECTION" & linefeed & (selList as text)
                        end if
                    end try
                    try
                        if (count of Finder windows) > 0 then
                            set winTarget to POSIX path of (target of front Finder window as alias)
                            return "WINDOW" & linefeed & winTarget
                        end if
                    end try
                    return "NONE"
                end tell
            end timeout
            """
            let rawOutput = runAppleScript(script).trimmingCharacters(in: .whitespacesAndNewlines)
            let lines = rawOutput.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }

            if let first = lines.first {
                if first == "SELECTION" {
                    let paths = Array(lines.dropFirst())
                    let urls = paths.map { URL(fileURLWithPath: $0) }.filter { FileManager.default.fileExists(atPath: $0.path) }
                    if !urls.isEmpty {
                        let summary = "FINDER: \(urls.count) SELECTED"
                        return DetectionResult(files: urls, appName: "Finder", summary: summary, isFinderFolder: false)
                    }
                } else if first == "WINDOW", lines.count > 1 {
                    let folderPath = lines[1]
                    let folderURL = URL(fileURLWithPath: folderPath)
                    if FileManager.default.fileExists(atPath: folderURL.path) {
                        let folderName = folderURL.lastPathComponent
                        let summary = "FINDER: [\(folderName.uppercased()) // OPEN FOLDER]"
                        return DetectionResult(files: [folderURL], appName: "Finder", summary: summary, isFinderFolder: true)
                    }
                }
            }

            return DetectionResult(files: [], appName: "Finder", summary: "FINDER: NO OPEN WINDOWS OR SELECTION", isFinderFolder: false)
        }

        // 2. Query scriptable documents in frontmost application
        let safeAppName = appName
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")

        let docScript = """
        with timeout of 2 seconds
            tell application "\(safeAppName)"
                set outList to {}
                try
                    repeat with d in documents
                        set docPath to ""
                        try
                            set docPath to path of d
                        end try
                        if docPath is "" or docPath is missing value then
                            try
                                set docPath to POSIX path of (file of d)
                            end try
                        end if
                        if docPath is "" or docPath is missing value then
                            try
                                set docPath to POSIX path of (file of d as alias)
                            end try
                        end if
                        if docPath is not "" and docPath is not missing value then
                            set end of outList to docPath
                        end if
                    end repeat
                end try
                if (count of outList) = 0 then
                    try
                        repeat with w in windows
                            set docPath to ""
                            try
                                set docPath to path of document of w
                            end try
                            if docPath is "" or docPath is missing value then
                                try
                                    set docPath to POSIX path of (file of document of w)
                                end try
                            end if
                            if docPath is "" or docPath is missing value then
                                try
                                    set docPath to POSIX path of (file of document of w as alias)
                                end try
                            end if
                            if docPath is not "" and docPath is not missing value then
                                set end of outList to docPath
                            end if
                        end repeat
                    end try
                end if
                if (count of outList) > 0 then
                    set AppleScript's text item delimiters to linefeed
                    return (outList as text)
                end if
                return ""
            end tell
        end timeout
        """
        let rawDocs = runAppleScript(docScript).trimmingCharacters(in: .whitespacesAndNewlines)
        if !rawDocs.isEmpty {
            let docLines = rawDocs.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
            let urls = docLines.compactMap { line -> URL? in
                if line.hasPrefix("file://"), let u = URL(string: line) {
                    return u
                }
                return URL(fileURLWithPath: line)
            }.filter { FileManager.default.fileExists(atPath: $0.path) }

            if !urls.isEmpty {
                let summary = "\(appName.uppercased()): \(urls.count) OPEN DOCS"
                return DetectionResult(files: urls, appName: appName, summary: summary, isFinderFolder: false)
            }
        }

        // 3. Web Browsers (Safari / Chrome / Brave / Edge / Arc): check active tab for local file:// URL
        let lowerName = appName.lowercased()
        if lowerName.contains("safari") || lowerName.contains("chrome") || lowerName.contains("brave") || lowerName.contains("edge") || lowerName == "arc" {
            let browserScript: String
            if lowerName.contains("safari") {
                browserScript = """
                with timeout of 2 seconds
                    tell application "Safari"
                        try
                            if (count of documents) > 0 then
                                return URL of front document
                            end if
                        end try
                        return ""
                    end tell
                end timeout
                """
            } else {
                browserScript = """
                with timeout of 2 seconds
                    tell application "\(safeAppName)"
                        try
                            if (count of windows) > 0 then
                                return URL of active tab of front window
                            end if
                        end try
                        return ""
                    end tell
                end timeout
                """
            }
            let rawUrl = runAppleScript(browserScript).trimmingCharacters(in: .whitespacesAndNewlines)
            if rawUrl.hasPrefix("file://"), let fileURL = URL(string: rawUrl), FileManager.default.fileExists(atPath: fileURL.path) {
                let summary = "\(appName.uppercased()): [\(fileURL.lastPathComponent.uppercased()) // ACTIVE TAB]"
                return DetectionResult(files: [fileURL], appName: appName, summary: summary, isFinderFolder: false)
            }
        }

        return DetectionResult(files: [], appName: appName, summary: "\(appName.uppercased()): NO OPEN FILES DETECTED", isFinderFolder: false)
    }

    private static func runAppleScript(_ source: String) -> String {
        return autoreleasepool {
            var error: NSDictionary?
            guard let script = NSAppleScript(source: source) else { return "" }
            let desc = script.executeAndReturnError(&error)
            guard error == nil else { return "" }
            return desc.stringValue ?? ""
        }
    }
}

// MARK: - Native File Sorter & Storage Guardian Engine
class NativeFileSorterEngine {
    static let shared = NativeFileSorterEngine()

    /// Set by the self-test before `shared` is first used, so tests never touch the real config
    static var configPathOverride: URL?

    var configPath: URL {
        if let override = NativeFileSorterEngine.configPathOverride {
            return override
        }
        let projDir = AppDelegate.defaultProjectDir
        let projectConfig = URL(fileURLWithPath: "\(projDir)/scripts/companion/guardian_config.json")
        if FileManager.default.fileExists(atPath: projectConfig.path) {
            return projectConfig
        }
        let userDir = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".sisyfuz")
        let userConfig = userDir.appendingPathComponent("guardian_config.json")
        if FileManager.default.fileExists(atPath: userConfig.path) {
            return userConfig
        }
        if (try? FileManager.default.createDirectory(at: userDir, withIntermediateDirectories: true)) != nil {
            return userConfig
        }
        return projectConfig
    }

    private let stateLock = NSRecursiveLock()

    private var _targets: [SortTarget] = []
    var targets: [SortTarget] {
        get {
            stateLock.lock()
            defer { stateLock.unlock() }
            return _targets
        }
        set {
            stateLock.lock()
            defer { stateLock.unlock() }
            _targets = newValue
        }
    }

    private var _activeTargetId: String = "open_files"
    var activeTargetId: String {
        get {
            stateLock.lock()
            defer { stateLock.unlock() }
            return _activeTargetId
        }
        set {
            stateLock.lock()
            defer { stateLock.unlock() }
            _activeTargetId = newValue
        }
    }

    private var _rules: [SortRuleConfig] = []
    var rules: [SortRuleConfig] {
        get {
            stateLock.lock()
            defer { stateLock.unlock() }
            return _rules
        }
        set {
            stateLock.lock()
            defer { stateLock.unlock() }
            _rules = newValue
        }
    }

    private var _ephemeralExtensions: Set<String> = ["dmg", "pkg", "iso", "crdownload", "part", "tmp"]
    var ephemeralExtensions: Set<String> {
        get {
            stateLock.lock()
            defer { stateLock.unlock() }
            return _ephemeralExtensions
        }
        set {
            stateLock.lock()
            defer { stateLock.unlock() }
            _ephemeralExtensions = newValue
        }
    }

    // Multi-level undo stack: each entry is an array of moves (fromURL, toURL)
    private var _undoStack: [[(from: URL, to: URL)]] = []
    var undoStack: [[(from: URL, to: URL)]] {
        get {
            stateLock.lock()
            defer { stateLock.unlock() }
            return _undoStack
        }
        set {
            stateLock.lock()
            defer { stateLock.unlock() }
            _undoStack = newValue
        }
    }

    private var _transactionHistory: [[String: Any]] = []
    var transactionHistory: [[String: Any]] {
        get {
            stateLock.lock()
            defer { stateLock.unlock() }
            return _transactionHistory
        }
        set {
            stateLock.lock()
            defer { stateLock.unlock() }
            _transactionHistory = newValue
        }
    }

    private var _latestSortResult: [String: Any]? = nil
    var latestSortResult: [String: Any]? {
        get {
            stateLock.lock()
            defer { stateLock.unlock() }
            return _latestSortResult
        }
        set {
            stateLock.lock()
            defer { stateLock.unlock() }
            _latestSortResult = newValue
        }
    }

    private var _latestUndoResult: [String: Any]? = nil
    var latestUndoResult: [String: Any]? {
        get {
            stateLock.lock()
            defer { stateLock.unlock() }
            return _latestUndoResult
        }
        set {
            stateLock.lock()
            defer { stateLock.unlock() }
            _latestUndoResult = newValue
        }
    }

    private var _latestScanResult: [String: Any]? = nil
    var latestScanResult: [String: Any]? {
        get {
            stateLock.lock()
            defer { stateLock.unlock() }
            return _latestScanResult
        }
        set {
            stateLock.lock()
            defer { stateLock.unlock() }
            _latestScanResult = newValue
        }
    }

    private var _latestCleanResult: [String: Any]? = nil
    var latestCleanResult: [String: Any]? {
        get {
            stateLock.lock()
            defer { stateLock.unlock() }
            return _latestCleanResult
        }
        set {
            stateLock.lock()
            defer { stateLock.unlock() }
            _latestCleanResult = newValue
        }
    }

    func pushUndoMoves(_ moves: [(from: URL, to: URL)]) {
        guard !moves.isEmpty else { return }
        stateLock.lock()
        defer { stateLock.unlock() }
        _undoStack.append(moves)
    }

    init() {
        loadConfig()
    }

    func loadConfig() {
        stateLock.lock()
        defer { stateLock.unlock() }
        let fm = FileManager.default
        if fm.fileExists(atPath: configPath.path),
           let data = try? Data(contentsOf: configPath),
           let cfg = try? JSONDecoder().decode(StorageGuardianConfig.self, from: data) {
            self._activeTargetId = cfg.activeTargetId
            self._targets = cfg.targets.map { SortTarget(id: $0.id, label: $0.label, path: $0.path, isDynamic: $0.isDynamic) }
            self._rules = cfg.rules
            self._ephemeralExtensions = Set(cfg.ephemeralExtensions.map { $0.lowercased() })
            return
        }

        // Default targets and rules
        setupDefaultTargets()
        setupDefaultRules()
        saveConfig()
    }

    func saveConfig() {
        stateLock.lock()
        defer { stateLock.unlock() }
        let targetCfgs = _targets.map { SortTargetConfig(id: $0.id, label: $0.label, path: $0.path, isDynamic: $0.isDynamic) }
        let cfg = StorageGuardianConfig(
            activeTargetId: _activeTargetId,
            targets: targetCfgs,
            rules: _rules,
            ephemeralExtensions: Array(_ephemeralExtensions).sorted()
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? encoder.encode(cfg) {
            try? data.write(to: configPath, options: [.atomic])
        }
    }

    func openConfigFile() {
        if !FileManager.default.fileExists(atPath: configPath.path) {
            saveConfig()
        }
        NSWorkspace.shared.open(configPath)
    }

    private func setupDefaultTargets() {
        let fm = FileManager.default
        let dl = fm.urls(for: .downloadsDirectory, in: .userDomainMask).first?.path ?? "~/Downloads"
        let doc = fm.urls(for: .documentDirectory, in: .userDomainMask).first?.path ?? "~/Documents"
        let dsk = fm.urls(for: .desktopDirectory, in: .userDomainMask).first?.path ?? "~/Desktop"

        targets = [
            SortTarget(id: "open_files", label: "CURRENT OPEN FILES", path: nil, isDynamic: true),
            SortTarget(id: "downloads", label: "DOWNLOADS", path: dl, isDynamic: false),
            SortTarget(id: "documents", label: "DOCUMENTS", path: doc, isDynamic: false),
            SortTarget(id: "desktop", label: "DESKTOP", path: dsk, isDynamic: false)
        ]
    }

    private func setupDefaultRules() {
        rules = [
            SortRuleConfig(
                id: "media_renders",
                categoryName: "Video & Renders",
                extensions: ["mov", "mp4", "mkv", "avi", "prores", "webm", "m4v", "gif"],
                destinations: [
                    "live": "Live/Renders",
                    "school": "School/Media",
                    "work": "Work/Renders",
                    "personal": "Personal/Videos",
                    "default": "Sorted/Video"
                ]
            ),
            SortRuleConfig(
                id: "images_stills",
                categoryName: "Images & Stills",
                extensions: ["png", "jpg", "jpeg", "tiff", "exr", "psd", "svg", "webp", "bmp", "heic", "raw"],
                destinations: [
                    "live": "Live/Stills",
                    "school": "School/Images",
                    "work": "Work/Assets",
                    "personal": "Personal/Photos",
                    "default": "Sorted/Images"
                ]
            ),
            SortRuleConfig(
                id: "creative_projects",
                categoryName: "Creative Projects",
                extensions: ["toe", "tox", "blend", "c4d", "aep", "prproj", "max", "hip", "fbx", "obj", "usd"],
                destinations: [
                    "live": "Live/Projects",
                    "work": "Work/Projects",
                    "school": "School/Projects",
                    "personal": "Personal/Projects",
                    "default": "Sorted/Creative"
                ]
            ),
            SortRuleConfig(
                id: "audio_stems",
                categoryName: "Audio & Stems",
                extensions: ["wav", "aif", "aiff", "mp3", "flac", "m4a", "ogg", "mid", "midi"],
                destinations: [
                    "live": "Live/Audio",
                    "school": "School/Audio",
                    "work": "Work/Audio",
                    "personal": "Personal/Music",
                    "default": "Sorted/Audio"
                ]
            ),
            SortRuleConfig(
                id: "documents_readings",
                categoryName: "Documents & PDFs",
                extensions: ["pdf", "doc", "docx", "txt", "md", "rtf", "pages", "keynote", "numbers", "xls", "xlsx", "ppt", "pptx", "epub"],
                destinations: [
                    "school": "School/Readings",
                    "work": "Work/Documents",
                    "personal": "Personal/Documents",
                    "live": "Live/Documents",
                    "default": "Sorted/Documents"
                ]
            ),
            SortRuleConfig(
                id: "code_dev",
                categoryName: "Code & Dev",
                extensions: ["swift", "py", "js", "ts", "jsx", "tsx", "html", "css", "json", "yaml", "yml", "sh", "cpp", "c", "h", "rs", "go", "sql", "ipynb"],
                destinations: [
                    "school": "School/Assignments",
                    "work": "Work/Code",
                    "live": "Live/Code",
                    "personal": "Personal/Code",
                    "default": "Sorted/Code"
                ]
            ),
            SortRuleConfig(
                id: "archives",
                categoryName: "Archives",
                extensions: ["zip", "tar", "gz", "7z", "rar", "bz2", "xz"],
                destinations: [
                    "school": "School/Archives",
                    "work": "Work/Archives",
                    "personal": "Personal/Archives",
                    "default": "Sorted/Archives"
                ]
            ),
            SortRuleConfig(
                id: "ephemeral_installers",
                categoryName: "Installers",
                extensions: ["dmg", "pkg", "iso"],
                destinations: [
                    "default": "Sorted/Installers"
                ]
            )
        ]
        ephemeralExtensions = ["dmg", "pkg", "iso", "crdownload", "part", "tmp"]
    }

    func addCustomTarget(name: String, url: URL) -> SortTarget {
        stateLock.lock()
        defer { stateLock.unlock() }
        let stdPath = url.standardizedFileURL.path
        if let existing = _targets.first(where: { $0.resolvedURL?.standardizedFileURL.path == stdPath }) {
            _activeTargetId = existing.id
            saveConfig()
            return existing
        }
        let id = "custom_" + UUID().uuidString.prefix(6).lowercased()
        let target = SortTarget(id: id, label: name.uppercased(), path: url.path, isDynamic: false)
        _targets.append(target)
        _activeTargetId = id
        saveConfig()
        return target
    }

    func sortActiveTarget(mode: String, completion: @escaping (SortResult) -> Void) {
        sortTarget(targetId: activeTargetId, mode: mode, completion: completion)
    }

    func sortTarget(targetId: String, mode: String, completion: @escaping (SortResult) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }

            if targetId == "open_files" {
                let detection = OpenFilesDetector.detectOpenFiles()
                if detection.files.isEmpty {
                    let res = SortResult(
                        success: true,
                        message: "NO OPEN FILES TO SORT IN \(detection.appName.uppercased())",
                        targetName: "OPEN FILES",
                        sortedCount: 0,
                        items: []
                    )
                    DispatchQueue.main.async { completion(res) }
                    return
                }

                // If Finder has an open folder window with no selection, sort that folder directly
                if detection.isFinderFolder, let folderURL = detection.files.first {
                    self.sortDirectory(url: folderURL, mode: mode, targetName: "FINDER: \(folderURL.lastPathComponent.uppercased())", completion: completion)
                    return
                }

                // Inspect items: distinguish between folders and regular files
                var explicitFiles: [URL] = []
                var directoriesToSort: [URL] = []
                for u in detection.files {
                    var isDir: ObjCBool = false
                    if FileManager.default.fileExists(atPath: u.path, isDirectory: &isDir) {
                        let isPkg = (try? u.resourceValues(forKeys: [.isPackageKey]))?.isPackage ?? false
                        if isDir.boolValue && !isPkg {
                            directoriesToSort.append(u)
                        } else {
                            explicitFiles.append(u)
                        }
                    }
                }

                var totalMoves: [(from: URL, to: URL)] = []
                var totalReports: [[String: Any]] = []

                if !directoriesToSort.isEmpty {
                    for dir in directoriesToSort {
                        let (moves, reports) = self.sortDirectorySynchronous(url: dir, mode: mode)
                        totalMoves.append(contentsOf: moves)
                        totalReports.append(contentsOf: reports)
                    }
                }

                if !explicitFiles.isEmpty {
                    let (moves, reports) = self.executeMoves(files: explicitFiles, mode: mode, baseDestinationFolder: nil)
                    totalMoves.append(contentsOf: moves)
                    totalReports.append(contentsOf: reports)
                }

                if !totalMoves.isEmpty {
                    self.pushUndoMoves(totalMoves)
                    self.recordTransaction(target: "OPEN FILES (\(detection.appName))", count: totalMoves.count)
                }

                let msg = totalMoves.isEmpty ? "ALL ITEMS ARE ALREADY IN ORDER" : "SORTED \(totalMoves.count) FILES IN \(detection.appName.uppercased())"
                let res = SortResult(success: true, message: msg, targetName: "OPEN FILES", sortedCount: totalMoves.count, items: totalReports)
                self.latestSortResult = [
                    "message": res.message,
                    "sorted_count": res.sortedCount,
                    "items": res.items,
                    "target": res.targetName
                ]
                DispatchQueue.main.async { completion(res) }
                return
            }

            guard let target = self.targets.first(where: { $0.id == targetId }),
                  let targetURL = target.resolvedURL,
                  FileManager.default.fileExists(atPath: targetURL.path) else {
                let res = SortResult(
                    success: false,
                    message: "TARGET DIRECTORY NOT FOUND: \(targetId.uppercased())",
                    targetName: targetId,
                    sortedCount: 0,
                    items: []
                )
                DispatchQueue.main.async { completion(res) }
                return
            }

            self.sortDirectory(url: targetURL, mode: mode, targetName: target.label, completion: completion)
        }
    }

    func sortDirectory(url: URL, mode: String, targetName: String, completion: @escaping (SortResult) -> Void) {
        let (moves, reports) = sortDirectorySynchronous(url: url, mode: mode)
        if !moves.isEmpty {
            pushUndoMoves(moves)
            recordTransaction(target: targetName, count: moves.count)
        }
        let msg = moves.isEmpty ? "ALL ITEMS ARE ALREADY IN ORDER IN \(targetName.uppercased())" : "SORTED \(moves.count) FILES IN \(targetName.uppercased())"
        let result = SortResult(
            success: true,
            message: msg,
            targetName: targetName,
            sortedCount: moves.count,
            items: reports
        )
        self.latestSortResult = [
            "message": result.message,
            "sorted_count": result.sortedCount,
            "items": result.items,
            "target": result.targetName
        ]
        DispatchQueue.main.async { completion(result) }
    }

    func sortDirectorySynchronous(url: URL, mode: String) -> (moves: [(from: URL, to: URL)], reports: [[String: Any]]) {
        let fm = FileManager.default
        guard let contents = try? fm.contentsOfDirectory(at: url, includingPropertiesForKeys: [.isRegularFileKey, .isPackageKey, .fileSizeKey], options: [.skipsHiddenFiles]) else {
            return ([], [])
        }

        var filesToSort: [URL] = []
        for item in contents {
            if let res = try? item.resourceValues(forKeys: [.isRegularFileKey, .isPackageKey]),
               (res.isRegularFile == true || res.isPackage == true) {
                let name = item.lastPathComponent
                if !name.hasPrefix(".") && !name.hasSuffix(".download") && !name.hasSuffix(".crdownload") && !name.hasSuffix(".part") && !name.hasSuffix(".tmp") {
                    filesToSort.append(item)
                }
            }
        }

        return executeMoves(files: filesToSort, mode: mode, baseDestinationFolder: url)
    }

    @discardableResult
    func sortExplicitFilesSynchronous(files: [URL], mode: String, baseDestinationFolder: URL? = nil) -> (moves: [(from: URL, to: URL)], reports: [[String: Any]]) {
        return executeMoves(files: files, mode: mode, baseDestinationFolder: baseDestinationFolder)
    }

    func sortExplicitFiles(files: [URL], mode: String, baseDestinationFolder: URL? = nil, targetName: String = "FILES", completion: @escaping (SortResult) -> Void) {
        let (moves, itemReports) = sortExplicitFilesSynchronous(files: files, mode: mode, baseDestinationFolder: baseDestinationFolder)

        if !moves.isEmpty {
            pushUndoMoves(moves)
            recordTransaction(target: targetName, count: moves.count)
        }

        let msg = moves.isEmpty ? "ALL ITEMS ARE ALREADY IN ORDER" : "SORTED \(moves.count) FILES IN \(targetName.uppercased())"
        let result = SortResult(
            success: true,
            message: msg,
            targetName: targetName,
            sortedCount: moves.count,
            items: itemReports
        )
        self.latestSortResult = [
            "message": result.message,
            "sorted_count": result.sortedCount,
            "items": result.items,
            "target": result.targetName
        ]
        DispatchQueue.main.async { completion(result) }
    }

    private func executeMoves(files: [URL], mode: String, baseDestinationFolder: URL?) -> (moves: [(from: URL, to: URL)], reports: [[String: Any]]) {
        let fm = FileManager.default
        var moves: [(from: URL, to: URL)] = []
        var itemReports: [[String: Any]] = []

        for fileURL in files {
            guard fm.fileExists(atPath: fileURL.path) else { continue }
            let ext = fileURL.pathExtension.lowercased()

            guard let rule = rules.first(where: { $0.extensions.contains(ext) }) else {
                continue
            }

            let subfolder = rule.destinationSubfolder(mode: mode)
            let parentDir = fileURL.deletingLastPathComponent().standardizedFileURL

            // Determine root base folder:
            // 1. If baseDestinationFolder is provided (e.g. directory sort), use it
            // 2. Otherwise (e.g. open/explicit files), check if file is inside a known target folder
            // 3. Fallback: use file's parent directory, unless it already ends with subfolder
            let base: URL
            if let explicitBase = baseDestinationFolder {
                base = explicitBase.standardizedFileURL
            } else {
                var matchedTarget: URL? = nil
                for t in targets {
                    if let tURL = t.resolvedURL?.standardizedFileURL,
                       parentDir.path == tURL.path || parentDir.path.hasPrefix(tURL.path + "/") {
                        matchedTarget = tURL
                        break
                    }
                }
                if let matched = matchedTarget {
                    base = matched
                } else if parentDir.path.hasSuffix("/" + subfolder) {
                    // File is already in this subfolder; do not nest further
                    continue
                } else {
                    base = parentDir
                }
            }

            let destFolder = base.appendingPathComponent(subfolder).standardizedFileURL

            // If the file is already inside destFolder, it is already sorted!
            if parentDir.path == destFolder.path {
                continue
            }

            if !fm.fileExists(atPath: destFolder.path) {
                try? fm.createDirectory(at: destFolder, withIntermediateDirectories: true, attributes: nil)
            }

            let filename = fileURL.lastPathComponent
            var targetDestURL = destFolder.appendingPathComponent(filename)

            // Collision avoidance: append _1, _2 until non-colliding
            if fm.fileExists(atPath: targetDestURL.path) && targetDestURL.path != fileURL.path {
                let nameWithoutExt = (filename as NSString).deletingPathExtension
                let extStr = (filename as NSString).pathExtension
                var counter = 1
                while fm.fileExists(atPath: targetDestURL.path) && targetDestURL.path != fileURL.path {
                    let uniqueName = extStr.isEmpty ? "\(nameWithoutExt)_\(counter)" : "\(nameWithoutExt)_\(counter).\(extStr)"
                    targetDestURL = destFolder.appendingPathComponent(uniqueName)
                    counter += 1
                }
            }

            if targetDestURL.path != fileURL.path {
                do {
                    try fm.moveItem(at: fileURL, to: targetDestURL)
                    moves.append((from: fileURL, to: targetDestURL))

                    let size = (try? targetDestURL.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
                    itemReports.append([
                        "name": filename,
                        "source": fileURL.path,
                        "destination": targetDestURL.path,
                        "category": rule.categoryName,
                        "size": size
                    ])
                } catch {
                    print("Error moving \(fileURL.path): \(error)")
                }
            }
        }
        return (moves, itemReports)
    }

    func recordTransaction(target: String, count: Int) {
        let tx: [String: Any] = [
            "action": "sort",
            "target": target,
            "count": count,
            "timestamp": ISO8601DateFormatter().string(from: Date())
        ]
        stateLock.lock()
        defer { stateLock.unlock() }
        _transactionHistory.insert(tx, at: 0)
        if _transactionHistory.count > 30 {
            _transactionHistory.removeLast()
        }
    }

    func undoLastOperation() -> (success: Bool, message: String, restoredCount: Int) {
        stateLock.lock()
        guard let lastMoves = _undoStack.popLast(), !lastMoves.isEmpty else {
            stateLock.unlock()
            return (false, "NO ACTIONS AVAILABLE TO UNDO", 0)
        }
        let currentTargets = _targets
        stateLock.unlock()

        let fm = FileManager.default
        var restoredCount = 0
        var affectedDestDirs: Set<String> = []

        for move in lastMoves.reversed() {
            if fm.fileExists(atPath: move.to.path) {
                let sourceDir = move.from.deletingLastPathComponent()
                if !fm.fileExists(atPath: sourceDir.path) {
                    try? fm.createDirectory(at: sourceDir, withIntermediateDirectories: true, attributes: nil)
                }

                var targetRestoreURL = move.from
                if fm.fileExists(atPath: targetRestoreURL.path) && targetRestoreURL.path != move.to.path {
                    let filename = move.from.lastPathComponent
                    let nameWithoutExt = (filename as NSString).deletingPathExtension
                    let extStr = (filename as NSString).pathExtension
                    var counter = 1
                    while fm.fileExists(atPath: targetRestoreURL.path) && targetRestoreURL.path != move.to.path {
                        let uniqueName = extStr.isEmpty ? "\(nameWithoutExt)_\(counter)" : "\(nameWithoutExt)_\(counter).\(extStr)"
                        targetRestoreURL = sourceDir.appendingPathComponent(uniqueName)
                        counter += 1
                    }
                }

                do {
                    try fm.moveItem(at: move.to, to: targetRestoreURL)
                    restoredCount += 1
                    affectedDestDirs.insert(move.to.deletingLastPathComponent().path)
                } catch {
                    print("Undo error restoring \(move.to.path): \(error)")
                }
            }
        }

        // Clean up empty directories that were left behind
        for dirPath in affectedDestDirs {
            var current = URL(fileURLWithPath: dirPath)
            while let items = try? fm.contentsOfDirectory(atPath: current.path), items.isEmpty {
                let parent = current.deletingLastPathComponent()
                // Stop at root target directory
                let isTargetRoot = currentTargets.contains { ($0.resolvedURL?.standardizedFileURL.path ?? "") == current.standardizedFileURL.path }
                if isTargetRoot || parent.path == current.path { break }
                try? fm.removeItem(at: current)
                current = parent
            }
        }

        let msg = "RESTORED \(restoredCount) OF \(lastMoves.count) FILES TO ORIGINAL LOCATIONS"
        let undoRes: [String: Any] = [
            "success": true,
            "message": msg,
            "restored_count": restoredCount
        ]
        self.latestUndoResult = undoRes
        return (true, msg, restoredCount)
    }

    func scanEphemeral(targetFolder: URL? = nil) -> [String: Any] {
        let fm = FileManager.default
        let folder = targetFolder ?? fm.urls(for: .downloadsDirectory, in: .userDomainMask).first ?? URL(fileURLWithPath: NSHomeDirectory())

        var items: [[String: Any]] = []
        var totalBytes: Int64 = 0

        if let contents = try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.fileSizeKey], options: [.skipsHiddenFiles]) {
            for url in contents {
                let ext = url.pathExtension.lowercased()
                if ephemeralExtensions.contains(ext) {
                    let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
                    totalBytes += Int64(size)
                    items.append([
                        "name": url.lastPathComponent,
                        "path": url.path,
                        "size_mb": Double(size) / (1024 * 1024)
                    ])
                }
            }
        }

        let sizeMB = Double(totalBytes) / (1024 * 1024)
        let scanResult: [String: Any] = [
            "count": items.count,
            "size_mb": sizeMB,
            "reclaimable_mb": sizeMB,
            "items": items
        ]
        self.latestScanResult = scanResult
        return scanResult
    }

    func cleanEphemeral(targetFolder: URL? = nil, completion: @escaping ([String: Any]) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            let fm = FileManager.default
            let scan = self.scanEphemeral(targetFolder: targetFolder)
            guard let items = scan["items"] as? [[String: Any]], !items.isEmpty else {
                let emptyReport: [String: Any] = ["purged_count": 0, "freed_mb": 0.0, "message": "NO EPHEMERAL FILES FOUND"]
                self.latestCleanResult = emptyReport
                DispatchQueue.main.async {
                    completion(emptyReport)
                }
                return
            }

            var purgedCount = 0
            var freedBytes: Int64 = 0

            for item in items {
                if let p = item["path"] as? String {
                    let url = URL(fileURLWithPath: p)
                    if fm.fileExists(atPath: url.path) {
                        do {
                            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
                            try fm.trashItem(at: url, resultingItemURL: nil)
                            purgedCount += 1
                            freedBytes += Int64(size)
                        } catch {
                            print("Error moving to trash: \(error)")
                        }
                    }
                }
            }

            let freedMB = Double(freedBytes) / (1024 * 1024)
            let report: [String: Any] = [
                "purged_count": purgedCount,
                "freed_mb": freedMB,
                "message": "MOVED \(purgedCount) EPHEMERAL FILES TO TRASH (\(String(format: "%.1f", freedMB)) MB RECLAIMED)"
            ]
            self.latestCleanResult = report
            DispatchQueue.main.async { completion(report) }
        }
    }
}

// MARK: - Storage Guardian Embedded REST API Server (Port 7479)
class StorageGuardianHTTPServer {
    var socketFd: Int32 = -1
    let port: UInt16
    private var listenSource: DispatchSourceRead?
    var isRunning: Bool = false

    weak var delegate: AppDelegate?

    init(port: UInt16 = 7479) {
        self.port = port
    }

    func start() -> Bool {
        socketFd = socket(AF_INET, SOCK_STREAM, 0)
        guard socketFd >= 0 else { return false }

        var nosigpipe: Int32 = 1
        setsockopt(socketFd, SOL_SOCKET, SO_NOSIGPIPE, &nosigpipe, socklen_t(MemoryLayout<Int32>.size))

        var reuse: Int32 = 1
        setsockopt(socketFd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))
        setsockopt(socketFd, SOL_SOCKET, SO_REUSEPORT, &reuse, socklen_t(MemoryLayout<Int32>.size))

        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")

        let bindRes = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
                bind(socketFd, saPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindRes == 0 else {
            close(socketFd)
            socketFd = -1
            print("[INFO] Port \(port) is occupied by external daemon or service; operating in bridge mode.")
            return false
        }

        let flags = fcntl(socketFd, F_GETFL, 0)
        _ = fcntl(socketFd, F_SETFL, flags | O_NONBLOCK)

        guard listen(socketFd, 128) == 0 else {
            close(socketFd)
            socketFd = -1
            return false
        }

        let source = DispatchSource.makeReadSource(fileDescriptor: socketFd, queue: DispatchQueue.global(qos: .userInteractive))
        let serverFd = socketFd
        source.setCancelHandler {
            close(serverFd)
        }

        source.setEventHandler { [weak self] in
            guard let self = self, self.socketFd >= 0 else { return }
            while true {
                var clientAddr = sockaddr_in()
                var clientAddrLen = socklen_t(MemoryLayout<sockaddr_in>.size)
                let clientFd = withUnsafeMutablePointer(to: &clientAddr) { ptr in
                    ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
                        accept(self.socketFd, saPtr, &clientAddrLen)
                    }
                }
                guard clientFd >= 0 else { break }

                var nosigpipeVal: Int32 = 1
                setsockopt(clientFd, SOL_SOCKET, SO_NOSIGPIPE, &nosigpipeVal, socklen_t(MemoryLayout<Int32>.size))

                // Clear O_NONBLOCK so recv() honors SO_RCVTIMEO rather than failing immediately with EAGAIN
                let clientFlags = fcntl(clientFd, F_GETFL, 0)
                if clientFlags >= 0 {
                    _ = fcntl(clientFd, F_SETFL, clientFlags & ~O_NONBLOCK)
                }

                var tv = timeval(tv_sec: 5, tv_usec: 0)
                setsockopt(clientFd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
                setsockopt(clientFd, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

                DispatchQueue.global(qos: .userInteractive).async {
                    self.handleClient(fd: clientFd)
                }
            }
        }
        source.resume()
        self.listenSource = source
        self.isRunning = true
        print("[OK] Sisyfuz Storage Guardian REST API listening natively on http://127.0.0.1:\(port)")
        return true
    }

    private func handleClient(fd: Int32) {
        var isClosed = false
        func safeClose() {
            if !isClosed {
                isClosed = true
                close(fd)
            }
        }

        var accumulatedData = Data()
        var buffer = [UInt8](repeating: 0, count: 8192)
        var headerEndIndex: Int? = nil
        var expectedContentLength: Int? = nil

        // Read until full headers and full body are received (or timeout/closed)
        while accumulatedData.count < 1_048_576 { // 1 MB sanity limit
            let readBytes = recv(fd, &buffer, buffer.count, 0)
            if readBytes <= 0 { break }
            accumulatedData.append(contentsOf: buffer[0..<readBytes])

            if headerEndIndex == nil && accumulatedData.count >= 4 {
                let bytes = [UInt8](accumulatedData)
                for i in 0...(bytes.count - 4) {
                    if bytes[i] == 13 && bytes[i+1] == 10 && bytes[i+2] == 13 && bytes[i+3] == 10 {
                        headerEndIndex = i + 4
                        break
                    }
                }
            }

            if let hEnd = headerEndIndex {
                if expectedContentLength == nil {
                    let headerData = accumulatedData.subdata(in: 0..<hEnd)
                    if let headerStr = String(data: headerData, encoding: .utf8) {
                        for line in headerStr.components(separatedBy: "\r\n") {
                            let lower = line.lowercased()
                            if lower.hasPrefix("content-length:") {
                                let parts = line.components(separatedBy: ":")
                                if parts.count >= 2, let len = Int(parts[1].trimmingCharacters(in: .whitespaces)) {
                                    expectedContentLength = len
                                }
                            }
                        }
                    }
                    if expectedContentLength == nil {
                        expectedContentLength = 0
                    }
                }

                let currentBodyLen = accumulatedData.count - hEnd
                if currentBodyLen >= (expectedContentLength ?? 0) {
                    break
                }
            }
        }

        guard let hEnd = headerEndIndex else {
            safeClose()
            return
        }

        let headerData = accumulatedData.subdata(in: 0..<hEnd)
        guard let headerStr = String(data: headerData, encoding: .utf8) else {
            safeClose()
            return
        }

        let lines = headerStr.components(separatedBy: "\r\n")
        guard let firstLine = lines.first else {
            safeClose()
            return
        }

        let parts = firstLine.components(separatedBy: " ")
        guard parts.count >= 2 else {
            safeClose()
            return
        }

        let method = parts[0].uppercased()
        let path = parts[1]

        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            headers[name] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }

        guard Self.isTrustedLocalClient(headers: headers) else {
            sendResponse(fd: fd, status: 403, jsonObject: ["error": "Forbidden: local non-browser clients only"])
            isClosed = true
            return
        }

        var bodyJson: [String: Any] = [:]
        let bodyData = accumulatedData.subdata(in: hEnd..<accumulatedData.count)
        if !bodyData.isEmpty,
           let parsed = (try? JSONSerialization.jsonObject(with: bodyData)) as? [String: Any] {
            bodyJson = parsed
        }

        processRoute(method: method, path: path, body: bodyJson) { [weak self] status, resObj in
            guard let self = self else {
                safeClose()
                return
            }
            self.sendResponse(fd: fd, status: status, jsonObject: resObj)
            isClosed = true
        }
    }

    /// Only the Companion's own bridge and local scripts may use this API. Any web page open in a
    /// browser can reach 127.0.0.1, so requests carrying browser markers (Origin, or Sec-Fetch-Site
    /// other than a manually typed URL) are refused, and a non-loopback Host blocks DNS rebinding.
    static func isTrustedLocalClient(headers: [String: String]) -> Bool {
        if headers["origin"] != nil { return false }
        if let site = headers["sec-fetch-site"], site.lowercased() != "none" { return false }

        guard let host = headers["host"]?.lowercased() else { return false }
        let hostname: String
        if host.hasPrefix("[") {
            hostname = String(host.prefix(through: host.firstIndex(of: "]") ?? host.index(before: host.endIndex)))
        } else {
            hostname = host.components(separatedBy: ":").first ?? host
        }
        return hostname == "127.0.0.1" || hostname == "localhost" || hostname == "[::1]"
    }

    private func processRoute(method: String, path: String, body: [String: Any], reply: @escaping (Int, [String: Any]) -> Void) {
        let cleanPath = path.components(separatedBy: "?").first ?? path
        let sorter = NativeFileSorterEngine.shared

        if cleanPath == "/api/status" && method == "GET" {
            let disk = getDiskUsage()
            // Polled every second by FileSorterBridge, so never trigger AppleScript here; the HUD timer
            // and sort actions refresh the open-files detection
            let detect = OpenFilesDetector.cachedDetection()
            let status: [String: Any] = [
                "status": "online",
                "active_mode": delegate?.currentMode ?? "AUTO",
                "locked": false,
                "frontmost_app": OpenFilesDetector.resolveTargetApp()?.localizedName ?? detect?.appName ?? "Finder",
                "disk": disk,
                "storage": disk,
                "history": sorter.transactionHistory,
                "active_target": sorter.activeTargetId,
                "target_summary": detect?.summary ?? "NO ACTIVE DOCUMENTS",
                "targets": sorter.targets.map { ["id": $0.id, "label": $0.label, "path": $0.path ?? ""] },
                "open_files_count": detect?.files.count ?? 0
            ]
            reply(200, status)
            return
        }

        if cleanPath == "/api/mode" && method == "POST" {
            if let mode = body["mode"] as? String {
                DispatchQueue.main.async { [weak self] in
                    self?.delegate?.setMode(mode, source: .fileSorter)
                }
                reply(200, ["success": true, "mode": mode])
            } else {
                reply(400, ["error": "Missing mode"])
            }
            return
        }

        if cleanPath == "/api/sort" && method == "POST" {
            let target = (body["target"] as? String) ?? sorter.activeTargetId
            let mode = (body["mode"] as? String) ?? delegate?.currentMode ?? "AUTO"

            if let explicitPaths = body["paths"] as? [String], !explicitPaths.isEmpty {
                let urls = explicitPaths.map { URL(fileURLWithPath: $0) }
                sorter.sortExplicitFiles(files: urls, mode: mode) { res in
                    reply(200, [
                        "success": res.success,
                        "message": res.message,
                        "sorted_count": res.sortedCount,
                        "items": res.items
                    ])
                }
                return
            }

            sorter.sortTarget(targetId: target, mode: mode) { res in
                reply(200, [
                    "success": res.success,
                    "message": res.message,
                    "sorted_count": res.sortedCount,
                    "items": res.items
                ])
            }
            return
        }

        if cleanPath == "/api/scan" && method == "GET" {
            let scan = sorter.scanEphemeral()
            reply(200, scan)
            return
        }

        if cleanPath == "/api/clean" && method == "POST" {
            sorter.cleanEphemeral { res in
                reply(200, res)
            }
            return
        }

        if cleanPath == "/api/undo" && method == "POST" {
            let undo = sorter.undoLastOperation()
            reply(200, ["success": undo.success, "message": undo.message, "restored_count": undo.restoredCount])
            return
        }

        if cleanPath == "/api/config" {
            if method == "GET" {
                reply(200, [
                    "active_target": sorter.activeTargetId,
                    "targets": sorter.targets.map { ["id": $0.id, "label": $0.label, "path": $0.path ?? ""] },
                    "rules": sorter.rules.map { [
                        "id": $0.id,
                        "categoryName": $0.categoryName,
                        "extensions": $0.extensions,
                        "destinations": $0.destinations
                    ] },
                    "mode": delegate?.currentMode ?? "AUTO",
                    "config_path": sorter.configPath.path
                ])
            } else if method == "POST" {
                if let t = body["active_target"] as? String {
                    sorter.activeTargetId = t
                }
                sorter.saveConfig()
                reply(200, ["success": true])
            }
            return
        }

        if cleanPath == "/api/open_config" && method == "POST" {
            sorter.openConfigFile()
            reply(200, ["success": true, "path": sorter.configPath.path])
            return
        }

        reply(404, ["error": "Not Found", "path": cleanPath])
    }

    private func getDiskUsage() -> [String: Any] {
        let homeURL = URL(fileURLWithPath: NSHomeDirectory())
        if let values = try? homeURL.resourceValues(forKeys: [.volumeTotalCapacityKey, .volumeAvailableCapacityForImportantUsageKey]) {
            let total = Double(values.volumeTotalCapacity ?? 1) / (1024 * 1024 * 1024)
            let free = Double(values.volumeAvailableCapacityForImportantUsage ?? 0) / (1024 * 1024 * 1024)
            let used = max(0, total - free)
            let percent = total > 0 ? (used / total) * 100.0 : 0.0
            return [
                "percent": percent,
                "used": used,
                "free": free,
                "total": total,
                "used_gb": used,
                "free_gb": free,
                "total_gb": total
            ]
        }
        return ["percent": 0.0, "used": 0.0, "free": 0.0, "total": 0.0]
    }

    private func sendResponse(fd: Int32, status: Int, jsonObject: [String: Any]) {
        defer { close(fd) }

        var nosigpipe: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &nosigpipe, socklen_t(MemoryLayout<Int32>.size))

        let statusText = (status == 200) ? "OK" : (status == 404 ? "Not Found" : (status == 403 ? "Forbidden" : "Error"))
        var bodyData = Data()
        if let d = try? JSONSerialization.data(withJSONObject: jsonObject, options: [.prettyPrinted]) {
            bodyData = d
        }
        let bodyLen = bodyData.count

        let header = "HTTP/1.1 \(status) \(statusText)\r\nContent-Type: application/json\r\nContent-Length: \(bodyLen)\r\nConnection: close\r\n\r\n"

        guard let headerData = header.data(using: .utf8) else { return }
        var fullPacket = headerData
        fullPacket.append(bodyData)

        fullPacket.withUnsafeBytes { rawPtr in
            guard let ptr = rawPtr.baseAddress else { return }
            var totalSent = 0
            let totalLength = fullPacket.count
            while totalSent < totalLength {
                let bytesToSend = totalLength - totalSent
                let sent = send(fd, ptr.advanced(by: totalSent), bytesToSend, 0)
                if sent <= 0 {
                    break
                }
                totalSent += sent
            }
        }
    }

    func stop() {
        if let src = listenSource {
            src.cancel()
            listenSource = nil
        } else if socketFd >= 0 {
            close(socketFd)
        }
        socketFd = -1
        isRunning = false
    }

    deinit {
        stop()
    }
}

// MARK: - File Sorter REST Client Bridge
class FileSorterBridge {
    let baseURL: String
    private let stateLock = NSLock()
    private var _isOnline: Bool = false
    var isOnline: Bool {
        get { stateLock.lock(); defer { stateLock.unlock() }; return _isOnline }
        set { stateLock.lock(); defer { stateLock.unlock() }; _isOnline = newValue }
    }
    private var _activeMode: String = "AUTO"
    var activeMode: String {
        get { stateLock.lock(); defer { stateLock.unlock() }; return _activeMode }
        set { stateLock.lock(); defer { stateLock.unlock() }; _activeMode = newValue }
    }
    private var _isLocked: Bool = false
    var isLocked: Bool {
        get { stateLock.lock(); defer { stateLock.unlock() }; return _isLocked }
        set { stateLock.lock(); defer { stateLock.unlock() }; _isLocked = newValue }
    }
    private var _frontmostApp: String = "Finder"
    var frontmostApp: String {
        get { stateLock.lock(); defer { stateLock.unlock() }; return _frontmostApp }
        set { stateLock.lock(); defer { stateLock.unlock() }; _frontmostApp = newValue }
    }
    private var _diskPercent: Double = 0.0
    var diskPercent: Double {
        get { stateLock.lock(); defer { stateLock.unlock() }; return _diskPercent }
        set { stateLock.lock(); defer { stateLock.unlock() }; _diskPercent = newValue }
    }
    private var _diskUsedGB: Double = 0.0
    var diskUsedGB: Double {
        get { stateLock.lock(); defer { stateLock.unlock() }; return _diskUsedGB }
        set { stateLock.lock(); defer { stateLock.unlock() }; _diskUsedGB = newValue }
    }
    private var _diskFreeGB: Double = 0.0
    var diskFreeGB: Double {
        get { stateLock.lock(); defer { stateLock.unlock() }; return _diskFreeGB }
        set { stateLock.lock(); defer { stateLock.unlock() }; _diskFreeGB = newValue }
    }
    private var _diskTotalGB: Double = 0.0
    var diskTotalGB: Double {
        get { stateLock.lock(); defer { stateLock.unlock() }; return _diskTotalGB }
        set { stateLock.lock(); defer { stateLock.unlock() }; _diskTotalGB = newValue }
    }
    private var _recentTransactions: [[String: Any]] = []
    var recentTransactions: [[String: Any]] {
        get { stateLock.lock(); defer { stateLock.unlock() }; return _recentTransactions }
        set { stateLock.lock(); defer { stateLock.unlock() }; _recentTransactions = newValue }
    }

    var latestScanResult: [String: Any]? {
        get { return NativeFileSorterEngine.shared.latestScanResult }
        set { NativeFileSorterEngine.shared.latestScanResult = newValue }
    }
    var latestCleanResult: [String: Any]? {
        get { return NativeFileSorterEngine.shared.latestCleanResult }
        set { NativeFileSorterEngine.shared.latestCleanResult = newValue }
    }
    var latestSortResult: [String: Any]? {
        get { return NativeFileSorterEngine.shared.latestSortResult }
        set { NativeFileSorterEngine.shared.latestSortResult = newValue }
    }

    var onStatusUpdated: (() -> Void)?
    var onModeChangedBySorter: ((String) -> Void)?

    private var pollTimer: Timer?
    private let session: URLSession
    private var isPolling = false

    init(baseURL: String = "http://127.0.0.1:7479") {
        self.baseURL = baseURL
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 2.0
        config.timeoutIntervalForResource = 3.0
        self.session = URLSession(configuration: config)
    }

    deinit {
        stopPolling()
        session.invalidateAndCancel()
    }

    func startPolling() {
        pollTimer?.invalidate()
        pollStatus()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.pollStatus()
        }
    }

    func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    func pollStatus() {
        guard !isPolling else { return }
        guard let url = URL(string: "\(baseURL)/api/status") else { return }
        isPolling = true
        var req = URLRequest(url: url)
        req.httpMethod = "GET"

        session.dataTask(with: req) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.isPolling = false
                if let data = data,
                   let httpRes = response as? HTTPURLResponse,
                   httpRes.statusCode == 200,
                   let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                    self.isOnline = true
                    let prevMode = self.activeMode
                    if let mode = json["active_mode"] as? String ?? json["mode"] as? String {
                        self.activeMode = mode
                        if prevMode != mode {
                            self.onModeChangedBySorter?(mode)
                        }
                    }
                    if let locked = json["locked"] as? Bool {
                        self.isLocked = locked
                    }
                    if let app = json["frontmost_app"] as? String ?? json["app"] as? String {
                        self.frontmostApp = app
                    }

                    var p: Double = 0.0
                    var u: Double = 0.0
                    var f: Double = 0.0
                    var t: Double = 0.0

                    if let disk = json["disk"] as? [String: Any] {
                        p = (disk["percent"] as? NSNumber)?.doubleValue ?? 0.0
                        u = (disk["used"] as? NSNumber)?.doubleValue ?? (disk["used_gb"] as? NSNumber)?.doubleValue ?? 0.0
                        f = (disk["free"] as? NSNumber)?.doubleValue ?? (disk["free_gb"] as? NSNumber)?.doubleValue ?? 0.0
                        t = (disk["total"] as? NSNumber)?.doubleValue ?? (disk["total_gb"] as? NSNumber)?.doubleValue ?? 0.0
                    }

                    if u > 10_000_000 { u /= (1024 * 1024 * 1024) }
                    if f > 10_000_000 { f /= (1024 * 1024 * 1024) }
                    if t > 10_000_000 { t /= (1024 * 1024 * 1024) }

                    if p == 0 && t > 0 {
                        p = (u / t) * 100.0
                    }

                    self.diskPercent = p
                    self.diskUsedGB = u
                    self.diskFreeGB = f
                    self.diskTotalGB = t

                    if let history = json["history"] as? [[String: Any]] {
                        self.recentTransactions = history
                    }

                    self.onStatusUpdated?()
                } else {
                    if self.isOnline {
                        self.isOnline = false
                        self.onStatusUpdated?()
                    }
                }
            }
        }.resume()
    }

    func setMode(mode: String, completion: ((Bool) -> Void)? = nil) {
        guard let url = URL(string: "\(baseURL)/api/mode") else {
            completion?(false)
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["mode": mode])

        session.dataTask(with: req) { [weak self] data, response, error in
            let success = (response as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async {
                if success {
                    self?.activeMode = mode
                    self?.onStatusUpdated?()
                }
                completion?(success)
            }
        }.resume()
    }
}

// MARK: - Mode Switch Source
enum ModeSwitchSource {
    case user
    case osc
    case webSocket
    case fileSorter
}

// MARK: - WKScriptMessageHandler Weak Proxy (Prevents WebKit Retain Cycles)
class ScriptMessageHandlerWrapper: NSObject, WKScriptMessageHandler {
    weak var delegate: WKScriptMessageHandler?
    init(delegate: WKScriptMessageHandler) {
        self.delegate = delegate
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(userContentController, didReceive: message)
    }
}

// MARK: - Sisyfuz Companion Menu Bar Application
class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler {
    var statusItem: NSStatusItem!
    var menu: NSMenu!
    var chatWindow: BrutalistHUDPanel?
    var webView: WKWebView?

    // Broadcast child process
    var broadcastProcess: Process?
    var isBroadcasting = false
    var currentLiveUrl: String = ""
    var currentViewers: Int = 0

    // Bridges: OSC, Native Sorter Engine & Storage Guardian Server
    var oscServer: OSCServer!
    var oscClient: OSCClient!
    var fileSorterBridge: FileSorterBridge!
    var nativeSorter = NativeFileSorterEngine.shared
    var guardianServer: StorageGuardianHTTPServer!

    // TouchDesigner Record Coordination State
    var isTouchDesignerRecording: Bool = false
    var renderDebounceTimer: Timer?

    // Mode state (thread-safe)
    private let modeLock = NSLock()
    private var _currentMode: String = "AUTO"
    var currentMode: String {
        get {
            modeLock.lock()
            defer { modeLock.unlock() }
            return _currentMode
        }
        set {
            modeLock.lock()
            defer { modeLock.unlock() }
            _currentMode = newValue
        }
    }

    // Latest detected open files info
    var latestOpenFilesSummary: String = "NO ACTIVE DOCUMENTS"
    var latestOpenFilesCount: Int = 0
    var latestOpenAppName: String = "Finder"

    // Latest action reports for HUD (delegated to NativeFileSorterEngine)
    var latestAction: String? = nil
    var latestSortResult: [String: Any]? {
        get { return nativeSorter.latestSortResult }
        set { nativeSorter.latestSortResult = newValue }
    }
    var latestUndoResult: [String: Any]? {
        get { return nativeSorter.latestUndoResult }
        set { nativeSorter.latestUndoResult = newValue }
    }
    var latestScanResult: [String: Any]? {
        get { return nativeSorter.latestScanResult }
        set { nativeSorter.latestScanResult = newValue }
    }
    var latestCleanResult: [String: Any]? {
        get { return nativeSorter.latestCleanResult }
        set { nativeSorter.latestCleanResult = newValue }
    }

    func showToastInHUD(_ message: String) {
        if chatWindow?.isVisible == true,
           let data = try? JSONSerialization.data(withJSONObject: [message]),
           let json = String(data: data, encoding: .utf8) {
            let toastJs = "window.showHudToast && window.showHudToast(\(json)[0]);"
            self.webView?.evaluateJavaScript(toastJs, completionHandler: nil)
        }
    }

    // Event-driven WebSocket connection & heartbeat
    var webSocketTask: URLSessionWebSocketTask?
    var wsPingTimer: Timer?
    var isConnectingWS = false
    var wsReconnectWorkItem: DispatchWorkItem?
    var openFilesRefreshTimer: Timer?
    var broadcastPipe: Pipe?

    private lazy var wsSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 10.0
        config.timeoutIntervalForResource = 10.0
        return URLSession(configuration: config)
    }()

    // Project root directory
    static var defaultProjectDir: String {
        let currentPath = FileManager.default.currentDirectoryPath
        if FileManager.default.fileExists(atPath: "\(currentPath)/scripts/broadcast.js") {
            return currentPath
        }
        return "/Users/dorusk/RiderProjects/sisyfuz.com"
    }
    var projectDir: String {
        return AppDelegate.defaultProjectDir
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        _ = signal(SIGPIPE, SIG_IGN)
        NSApp.setActivationPolicy(.accessory)

        // Track external application activations so Sisyfuz Companion knows what the user was using
        if let currentFront = NSWorkspace.shared.frontmostApplication {
            let myPid = ProcessInfo.processInfo.processIdentifier
            let bundleId = currentFront.bundleIdentifier ?? ""
            if currentFront.processIdentifier != myPid && bundleId != "com.sisyfuz.companion" && currentFront.localizedName != "SisyfuzCompanion" {
                OpenFilesDetector.lastActiveExternalApp = currentFront
            }
        }

        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { notification in
            if let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication {
                let myPid = ProcessInfo.processInfo.processIdentifier
                let bundleId = app.bundleIdentifier ?? ""
                if app.processIdentifier != myPid &&
                   bundleId != "com.sisyfuz.companion" &&
                   app.localizedName != "SisyfuzCompanion" {
                    OpenFilesDetector.lastActiveExternalApp = app
                }
            }
        }

        // Initialize Native Storage Guardian REST Server (Port 7479)
        guardianServer = StorageGuardianHTTPServer(port: 7479)
        guardianServer.delegate = self
        _ = guardianServer.start()

        // Initialize OSC Bridges (Ports 7000/7001) and FileSorterBridge Client
        oscServer = OSCServer(port: 7000)
        oscClient = OSCClient(host: "127.0.0.1", port: 7001)
        fileSorterBridge = FileSorterBridge(baseURL: "http://127.0.0.1:7479")

        setupOSCHandlers()
        setupFileSorterHandlers()

        // Start OSC Listener & Sorter Poller
        _ = oscServer.start()
        fileSorterBridge.startPolling()

        // Setup Menu Bar Status Item
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.title = "○ SISYFUZ [AUTO]"
            button.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .bold)
            button.target = self
            button.action = #selector(statusItemClicked(_:))
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }

        buildMenu()
        setupChatHUD()

        // Connect to broadcast hub
        connectWebSocket()

        // Auto-refresh open files while the HUD is on screen (each refresh sends AppleScript to the
        // frontmost app, so stay quiet in the background)
        openFilesRefreshTimer?.invalidate()
        openFilesRefreshTimer = Timer.scheduledTimer(withTimeInterval: 2.5, repeats: true) { [weak self] _ in
            guard let self = self, self.chatWindow?.isVisible == true else { return }
            self.refreshOpenFilesStatus()
        }

        // Auto-open studio HUD on launch
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
            self?.showChatHUD()
        }
    }

    func refreshOpenFilesStatus() {
        let detection = OpenFilesDetector.detectOpenFiles()
        self.latestOpenFilesCount = detection.files.count
        self.latestOpenAppName = detection.appName
        self.latestOpenFilesSummary = detection.summary
        self.updateMenuState()
    }

    // MARK: - Setup OSC & Sorter Bridges
    func setupOSCHandlers() {
        oscServer.onMessageReceived = { [weak self] msg in
            guard let self = self else { return }
            let addr = msg.address.lowercased()

            if addr == "/sisyfuz/mode" {
                if let first = msg.arguments.first {
                    switch first {
                    case .string(let mode):
                        self.setMode(mode, source: .osc)
                    default:
                        break
                    }
                }
            } else if addr == "/sisyfuz/record" || addr == "/sisyfuz/is_recording" {
                var isRec = false
                if let first = msg.arguments.first {
                    switch first {
                    case .int32(let val):
                        isRec = val == 1
                    case .string(let str):
                        isRec = str == "1" || str.lowercased() == "true"
                    case .float32(let val):
                        isRec = val > 0.5
                    }
                }
                self.handleTouchDesignerRecordingState(isRec)
            } else if addr == "/sisyfuz/sort" || addr == "/sisyfuz/sort/active" {
                if let first = msg.arguments.first, case .string(let target) = first, !target.isEmpty {
                    self.setSortTarget(target)
                }
                self.triggerSortTarget()
            } else if addr == "/sisyfuz/sort/open" {
                self.triggerSortOpenFiles()
            } else if addr == "/sisyfuz/sort/downloads" {
                self.setSortTarget("downloads")
                self.triggerSortTarget()
            } else if addr == "/sisyfuz/sort/documents" {
                self.setSortTarget("documents")
                self.triggerSortTarget()
            } else if addr == "/sisyfuz/sort/desktop" {
                self.setSortTarget("desktop")
                self.triggerSortTarget()
            } else if addr == "/sisyfuz/scan" {
                self.triggerScan()
            } else if addr == "/sisyfuz/clean" {
                var cat = "all"
                if let first = msg.arguments.first, case .string(let c) = first {
                    cat = c
                }
                self.triggerClean(category: cat)
            } else if addr == "/sisyfuz/undo" {
                self.triggerUndo()
            }
        }
    }

    func setupFileSorterHandlers() {
        fileSorterBridge.onStatusUpdated = { [weak self] in
            guard let self = self else { return }
            self.currentMode = self.fileSorterBridge.activeMode
            self.updateMenuState()
            self.broadcastTelemetryToTouchDesigner()
            self.relayTelemetryToWebSocket()
        }

        fileSorterBridge.onModeChangedBySorter = { [weak self] mode in
            guard let self = self else { return }
            self.setMode(mode, source: .fileSorter)
        }
    }

    // MARK: - Mode Switching Engine
    func setMode(_ mode: String, source: ModeSwitchSource) {
        let normalized: String
        let upper = mode.uppercased()
        if upper == "SCHOOL" { normalized = "School" }
        else if upper == "WORK" { normalized = "Work" }
        else if upper == "PERSONAL" { normalized = "Personal" }
        else if upper == "LIVE" { normalized = "Live" }
        else if upper == "TEMP" { normalized = "Temp" }
        else { normalized = "AUTO" }

        self.currentMode = normalized
        self.fileSorterBridge.activeMode = normalized

        // The native sorter reads currentMode directly, so only forward to /api/mode when an external
        // sorter daemon owns port 7479. In-process, that POST re-enters setMode with Live mapped to Work.
        if source != .fileSorter && !guardianServer.isRunning {
            let sorterMode = (normalized == "Live") ? "Work" : normalized
            fileSorterBridge.setMode(mode: sorterMode)
        }

        if source != .osc {
            oscClient.send(message: OSCMessage(address: "/sisyfuz/mode", arguments: [.string(normalized)]))
        }

        let packet: [String: Any] = [
            "type": "mode",
            "mode": normalized
        ]
        if let data = try? JSONSerialization.data(withJSONObject: packet),
           let jsonStr = String(data: data, encoding: .utf8) {
            webSocketTask?.send(.string(jsonStr)) { _ in }
        }

        updateMenuState()
    }

    // MARK: - TouchDesigner Render Coordination
    func handleTouchDesignerRecordingState(_ isRecording: Bool) {
        guard isRecording != isTouchDesignerRecording else { return }
        isTouchDesignerRecording = isRecording

        if isRecording {
            renderDebounceTimer?.invalidate()
            renderDebounceTimer = nil
        } else {
            renderDebounceTimer?.invalidate()
            renderDebounceTimer = Timer.scheduledTimer(withTimeInterval: 0.75, repeats: false) { [weak self] _ in
                self?.triggerSortTarget(isFromRenderFinish: true)
            }
        }

        updateMenuState()
    }

    // MARK: - Target Sorting Triggers

    func setSortTarget(_ targetId: String) {
        nativeSorter.activeTargetId = targetId
        nativeSorter.saveConfig()
        refreshOpenFilesStatus()
        updateMenuState()
    }

    func triggerSortTarget(isFromRenderFinish: Bool = false) {
        let activeTarget = nativeSorter.activeTargetId
        nativeSorter.sortTarget(targetId: activeTarget, mode: currentMode) { [weak self] result in
            guard let self = self else { return }
            self.latestAction = "sort"
            self.latestUndoResult = nil
            self.latestSortResult = [
                "message": result.message,
                "sorted_count": result.sortedCount,
                "items": result.items,
                "target": result.targetName
            ]
            self.oscClient.send(message: OSCMessage(address: "/sisyfuz/sort/status", arguments: [.string(result.success ? "completed" : "failed")]))

            let toastText = isFromRenderFinish ? "RENDER CATALOGED" : result.message
            self.showToastInHUD(toastText)

            self.fileSorterBridge.pollStatus()
            self.refreshOpenFilesStatus()
            self.updateMenuState()
        }
    }

    func triggerSortOpenFiles() {
        nativeSorter.sortTarget(targetId: "open_files", mode: currentMode) { [weak self] result in
            guard let self = self else { return }
            self.latestAction = "sort"
            self.latestUndoResult = nil
            self.latestSortResult = [
                "message": result.message,
                "sorted_count": result.sortedCount,
                "items": result.items,
                "target": "OPEN FILES"
            ]
            self.oscClient.send(message: OSCMessage(address: "/sisyfuz/sort/status", arguments: [.string(result.success ? "completed" : "failed")]))

            self.showToastInHUD(result.message)

            self.fileSorterBridge.pollStatus()
            self.refreshOpenFilesStatus()
            self.updateMenuState()
        }
    }

    func chooseCustomFolder() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Set Target"
        panel.title = "SISYFUZ // CHOOSE TARGET FOLDER"

        panel.begin { [weak self] response in
            guard let self = self, response == .OK, let url = panel.url else { return }
            let folderName = url.lastPathComponent
            _ = self.nativeSorter.addCustomTarget(name: folderName, url: url)

            self.showToastInHUD("TARGET SET TO: \(folderName.uppercased())")
            self.updateMenuState()
        }
    }

    func openRulesConfig() {
        nativeSorter.openConfigFile()
    }

    func reloadRulesConfig() {
        nativeSorter.loadConfig()
        refreshOpenFilesStatus()
        updateMenuState()
        self.showToastInHUD("CONFIG RELOADED")
    }

    func triggerScan() {
        let scan = nativeSorter.scanEphemeral()
        let count = scan["count"] as? Int ?? 0
        let mb = scan["size_mb"] as? Double ?? 0.0

        self.latestAction = "scan"
        oscClient.send(message: OSCMessage(address: "/sisyfuz/storage/scan_result", arguments: [.int32(Int32(count)), .float32(Float(mb))]))

        self.showToastInHUD("SCAN: \(count) EPHEMERAL FILES FOUND")
        updateMenuState()
    }

    func triggerClean(category: String = "all") {
        nativeSorter.cleanEphemeral { [weak self] result in
            guard let self = self else { return }
            let count = result["purged_count"] as? Int ?? 0
            let mb = result["freed_mb"] as? Double ?? 0.0

            self.latestAction = "clean"
            self.oscClient.send(message: OSCMessage(address: "/sisyfuz/storage/clean_result", arguments: [.int32(Int32(count)), .float32(Float(mb))]))

            self.showToastInHUD("PURGED \(count) FILES TO TRASH")
            self.fileSorterBridge.pollStatus()
            self.updateMenuState()
        }
    }

    func triggerUndo() {
        let undo = nativeSorter.undoLastOperation()
        self.latestAction = "undo"
        self.latestSortResult = nil
        self.latestUndoResult = [
            "success": undo.success,
            "message": undo.message,
            "restored_count": undo.restoredCount
        ]
        self.showToastInHUD(undo.message)

        fileSorterBridge.pollStatus()
        refreshOpenFilesStatus()
        updateMenuState()
    }

    // MARK: - Telemetry Broadcasting
    func broadcastTelemetryToTouchDesigner() {
        let b = fileSorterBridge!
        oscClient.send(message: OSCMessage(address: "/sisyfuz/telemetry/disk/used", arguments: [.float32(Float(b.diskUsedGB))]))
        oscClient.send(message: OSCMessage(address: "/sisyfuz/telemetry/disk/free", arguments: [.float32(Float(b.diskFreeGB))]))
        oscClient.send(message: OSCMessage(address: "/sisyfuz/telemetry/disk/total", arguments: [.float32(Float(b.diskTotalGB))]))
        oscClient.send(message: OSCMessage(address: "/sisyfuz/telemetry/disk/percent", arguments: [.float32(Float(b.diskPercent))]))
        oscClient.send(message: OSCMessage(address: "/sisyfuz/telemetry/mode", arguments: [.string(currentMode)]))
        oscClient.send(message: OSCMessage(address: "/sisyfuz/telemetry/frontmost_app", arguments: [.string(b.frontmostApp)]))
        oscClient.send(message: OSCMessage(address: "/sisyfuz/telemetry/transactions/count", arguments: [.int32(Int32(nativeSorter.transactionHistory.count))]))
        oscClient.send(message: OSCMessage(address: "/sisyfuz/telemetry/is_broadcasting", arguments: [.int32(isBroadcasting ? 1 : 0)]))
        oscClient.send(message: OSCMessage(address: "/sisyfuz/telemetry/viewers", arguments: [.int32(Int32(currentViewers))]))
    }

    func relayTelemetryToWebSocket() {
        let b = fileSorterBridge!
        let packet: [String: Any] = [
            "type": "storage_telemetry",
            "disk": [
                "percent": b.diskPercent,
                "used": b.diskUsedGB,
                "free": b.diskFreeGB,
                "total": b.diskTotalGB
            ],
            "mode": currentMode,
            "frontmost_app": b.frontmostApp,
            "is_recording": isTouchDesignerRecording,
            "transactions_count": nativeSorter.transactionHistory.count,
            "sorter_online": b.isOnline || guardianServer.isRunning,
            "active_target": nativeSorter.activeTargetId
        ]
        if let data = try? JSONSerialization.data(withJSONObject: packet),
           let jsonStr = String(data: data, encoding: .utf8) {
            webSocketTask?.send(.string(jsonStr)) { _ in }
        }
    }

    // MARK: - Menu Bar Button Clicks
    @objc func statusItemClicked(_ sender: NSStatusBarButton) {
        guard let event = NSApp.currentEvent else {
            toggleChatHUD()
            return
        }

        let isRightClick = (event.type == .rightMouseUp) || (event.modifierFlags.contains(.control) && event.type == .leftMouseUp)

        if isRightClick {
            refreshOpenFilesStatus()
            menu.popUp(positioning: nil, at: NSPoint(x: 0, y: 0), in: sender)
        } else {
            toggleChatHUD()
        }
    }

    // MARK: - Lineless Brutalist Menu Construction
    func makeBrutalistMenuItem(
        title: String,
        action: Selector? = nil,
        key: String = "",
        tag: Int = 0,
        color: NSColor = .white,
        isHeader: Bool = false
    ) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        item.tag = tag

        let font = NSFont(name: "Space Mono", size: 11) ?? NSFont.monospacedSystemFont(ofSize: 11, weight: isHeader ? .bold : .medium)
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: color
        ]
        item.attributedTitle = NSAttributedString(string: title, attributes: attributes)
        return item
    }

    func makeAsciiSeparator() -> NSMenuItem {
        let sep = NSMenuItem(title: "------------------------------------", action: nil, keyEquivalent: "")
        sep.isEnabled = false
        let font = NSFont(name: "Space Mono", size: 10) ?? NSFont.monospacedSystemFont(ofSize: 10, weight: .regular)
        sep.attributedTitle = NSAttributedString(
            string: "------------------------------------",
            attributes: [.font: font, .foregroundColor: NSColor(white: 0.18, alpha: 1.0)]
        )
        return sep
    }

    func buildMenu() {
        menu = NSMenu()
        menu.autoenablesItems = false

        // Header
        let header = makeBrutalistMenuItem(
            title: "[ > SISYFUZ // STUDIO ENGINE ]",
            color: NSColor(red: 1.0, green: 0.0, blue: 0.5, alpha: 1.0),
            isHeader: true
        )
        header.isEnabled = false
        menu.addItem(header)

        menu.addItem(makeAsciiSeparator())

        // Status Item (Tag 101)
        let statusTitle = isBroadcasting ? "STATUS:  [● LIVE • 60 FPS]" : "STATUS:  [○ STANDBY / IDLE]"
        let statusColor = isBroadcasting ? NSColor(red: 0.0, green: 1.0, blue: 0.4, alpha: 1.0) : NSColor(white: 0.65, alpha: 1.0)
        let statusDisplay = makeBrutalistMenuItem(title: statusTitle, tag: 101, color: statusColor, isHeader: true)
        statusDisplay.isEnabled = false
        menu.addItem(statusDisplay)

        // Viewers Count Item (Tag 102)
        let viewersStr = String(format: "%02d", currentViewers)
        let viewersDisplay = makeBrutalistMenuItem(
            title: "VIEWERS: [\(viewersStr)]",
            tag: 102,
            color: NSColor(white: 0.85, alpha: 1.0)
        )
        viewersDisplay.isEnabled = false
        menu.addItem(viewersDisplay)

        menu.addItem(makeAsciiSeparator())

        // Broadcast Toggle (Tag 103)
        let toggleTitle = isBroadcasting ? "[■ STOP_BROADCAST]" : "[▶ START_BROADCAST]"
        let toggleColor = isBroadcasting ? NSColor(red: 1.0, green: 0.25, blue: 0.25, alpha: 1.0) : NSColor(red: 0.0, green: 0.9, blue: 1.0, alpha: 1.0)
        let toggleItem = makeBrutalistMenuItem(
            title: toggleTitle,
            action: #selector(toggleBroadcast),
            key: "b",
            tag: 103,
            color: toggleColor,
            isHeader: true
        )
        menu.addItem(toggleItem)

        // Studio HUD Toggle
        menu.addItem(makeBrutalistMenuItem(
            title: "[TOGGLE_STUDIO_HUD] (⌘K)",
            action: #selector(toggleChatHUD),
            key: "k",
            color: .white
        ))

        menu.addItem(makeBrutalistMenuItem(
            title: "[COPY_STREAM_URL]   (⌘C)",
            action: #selector(copyStreamUrl),
            key: "c",
            color: NSColor(white: 0.9, alpha: 1.0)
        ))

        menu.addItem(makeBrutalistMenuItem(
            title: "[OPEN_IN_BROWSER]   (⌘O)",
            action: #selector(openWebStream),
            key: "o",
            color: NSColor(white: 0.9, alpha: 1.0)
        ))

        menu.addItem(makeAsciiSeparator())

        // --- SECTION: MODE SYNCHRONIZATION ---
        let modeHeader = makeBrutalistMenuItem(
            title: "[ > MODE SYNCHRONIZATION ]",
            color: NSColor(red: 0.0, green: 0.9, blue: 1.0, alpha: 1.0),
            isHeader: true
        )
        modeHeader.isEnabled = false
        menu.addItem(modeHeader)

        let modes = ["School", "Work", "Personal", "Live", "AUTO"]
        for (idx, m) in modes.enumerated() {
            let tag = 201 + idx
            let item = makeBrutalistMenuItem(
                title: "[\(currentMode == m ? "●" : "○")] \(m.uppercased())",
                action: #selector(selectModeMenuItem(_:)),
                tag: tag,
                color: (currentMode == m) ? NSColor(red: 1.0, green: 0.0, blue: 0.5, alpha: 1.0) : NSColor(white: 0.8, alpha: 1.0)
            )
            menu.addItem(item)
        }

        menu.addItem(makeAsciiSeparator())

        // --- SECTION: STORAGE GUARDIAN // FILE SORTER ---
        let storageHeader = makeBrutalistMenuItem(
            title: "[ > STORAGE GUARDIAN // SORTER ]",
            color: NSColor(red: 0.0, green: 1.0, blue: 0.4, alpha: 1.0),
            isHeader: true
        )
        storageHeader.isEnabled = false
        menu.addItem(storageHeader)

        // Active Target (Tag 310)
        let targetItem = makeBrutalistMenuItem(
            title: "TARGET:  [\(nativeSorter.activeTargetId.uppercased())]",
            tag: 310,
            color: NSColor(red: 0.0, green: 0.9, blue: 1.0, alpha: 1.0)
        )
        targetItem.isEnabled = false
        menu.addItem(targetItem)

        // Open Files Info (Tag 311)
        let openFilesItem = makeBrutalistMenuItem(
            title: "OPEN:    [\(latestOpenFilesSummary)]",
            tag: 311,
            color: NSColor(white: 0.75, alpha: 1.0)
        )
        openFilesItem.isEnabled = false
        menu.addItem(openFilesItem)

        // Disk stats item (Tag 301)
        let diskItem = makeBrutalistMenuItem(title: "DISK:    [--% // -- GB FREE]", tag: 301, color: NSColor(white: 0.85, alpha: 1.0))
        diskItem.isEnabled = false
        menu.addItem(diskItem)

        // Primary Sorting Triggers
        menu.addItem(makeBrutalistMenuItem(
            title: "[▶ SORT_ACTIVE_TARGET]   (⌘S)",
            action: #selector(menuTriggerSortTarget),
            key: "s",
            color: NSColor(red: 0.0, green: 1.0, blue: 0.4, alpha: 1.0),
            isHeader: true
        ))

        menu.addItem(makeBrutalistMenuItem(
            title: "[▶ SORT_OPEN_FILES]      (⌘D)",
            action: #selector(menuTriggerSortOpen),
            key: "d",
            color: NSColor(red: 1.0, green: 0.0, blue: 0.5, alpha: 1.0)
        ))

        menu.addItem(makeBrutalistMenuItem(
            title: "[▶ SORT_DOWNLOADS]",
            action: #selector(menuSortDownloads),
            color: NSColor(white: 0.85, alpha: 1.0)
        ))

        menu.addItem(makeBrutalistMenuItem(
            title: "[▶ SORT_DOCUMENTS]",
            action: #selector(menuSortDocuments),
            color: NSColor(white: 0.85, alpha: 1.0)
        ))

        menu.addItem(makeBrutalistMenuItem(
            title: "[▶ SORT_DESKTOP]",
            action: #selector(menuSortDesktop),
            color: NSColor(white: 0.85, alpha: 1.0)
        ))

        menu.addItem(makeBrutalistMenuItem(
            title: "[+ CHOOSE_CUSTOM_FOLDER...]",
            action: #selector(menuChooseCustomFolder),
            color: NSColor(white: 0.8, alpha: 1.0)
        ))

        menu.addItem(makeBrutalistMenuItem(
            title: "[✎ EDIT_RULES_CONFIG...]",
            action: #selector(menuEditRulesConfig),
            color: NSColor(white: 0.85, alpha: 1.0)
        ))

        menu.addItem(makeBrutalistMenuItem(
            title: "[↺ RELOAD_CONFIG]",
            action: #selector(menuReloadConfig),
            color: NSColor(white: 0.8, alpha: 1.0)
        ))

        menu.addItem(makeBrutalistMenuItem(title: "[⌕ SCAN_EPHEMERAL_FILES]", action: #selector(menuTriggerScan), color: NSColor(white: 0.85, alpha: 1.0)))
        menu.addItem(makeBrutalistMenuItem(title: "[⌫ PURGE_SAFE_TRASH]", action: #selector(menuTriggerClean), color: NSColor(red: 1.0, green: 0.7, blue: 0.0, alpha: 1.0)))
        menu.addItem(makeBrutalistMenuItem(
            title: "[↺ UNDO_LAST_OPERATION]  (⌘Z)",
            action: #selector(menuTriggerUndo),
            key: "z",
            color: NSColor(white: 0.8, alpha: 1.0)
        ))

        menu.addItem(makeAsciiSeparator())

        // --- SECTION: BRIDGES STATUS ---
        let bridgeHeader = makeBrutalistMenuItem(
            title: "[ > BRIDGES & TELEMETRY ]",
            color: NSColor(white: 0.5, alpha: 1.0),
            isHeader: true
        )
        bridgeHeader.isEnabled = false
        menu.addItem(bridgeHeader)

        let oscInItem = makeBrutalistMenuItem(title: "OSC_IN:  [PORT 7000 // LISTENING]", tag: 401, color: NSColor(red: 0.0, green: 0.9, blue: 1.0, alpha: 1.0))
        oscInItem.isEnabled = false
        menu.addItem(oscInItem)

        let oscOutItem = makeBrutalistMenuItem(title: "OSC_OUT: [PORT 7001 // TD LINK]", tag: 402, color: NSColor(red: 0.0, green: 0.9, blue: 1.0, alpha: 1.0))
        oscOutItem.isEnabled = false
        menu.addItem(oscOutItem)

        let sorterItem = makeBrutalistMenuItem(title: "SORTER:  [127.0.0.1:7479 // ONLINE]", tag: 403, color: NSColor(red: 0.0, green: 1.0, blue: 0.4, alpha: 1.0))
        sorterItem.isEnabled = false
        menu.addItem(sorterItem)

        menu.addItem(makeAsciiSeparator())

        menu.addItem(makeBrutalistMenuItem(title: "[LAUNCH_OBS_STUDIO]", action: #selector(openOBS), color: NSColor(white: 0.75, alpha: 1.0)))
        menu.addItem(makeBrutalistMenuItem(title: "[LAUNCH_TOUCHDESIGNER]", action: #selector(openTouchDesigner), color: NSColor(white: 0.75, alpha: 1.0)))

        menu.addItem(makeAsciiSeparator())

        menu.addItem(makeBrutalistMenuItem(
            title: "[QUIT_COMPANION]    (⌘Q)",
            action: #selector(quitApp),
            key: "q",
            color: NSColor(red: 1.0, green: 0.3, blue: 0.35, alpha: 1.0)
        ))
    }

    @objc func selectModeMenuItem(_ sender: NSMenuItem) {
        let modes = ["School", "Work", "Personal", "Live", "AUTO"]
        let idx = sender.tag - 201
        if idx >= 0 && idx < modes.count {
            setMode(modes[idx], source: .user)
        }
    }

    @objc func menuTriggerSortTarget() {
        triggerSortTarget()
    }

    @objc func menuTriggerSortOpen() {
        triggerSortOpenFiles()
    }

    @objc func menuSortDownloads() {
        setSortTarget("downloads")
        triggerSortTarget()
    }

    @objc func menuSortDocuments() {
        setSortTarget("documents")
        triggerSortTarget()
    }

    @objc func menuSortDesktop() {
        setSortTarget("desktop")
        triggerSortTarget()
    }

    @objc func menuChooseCustomFolder() {
        chooseCustomFolder()
    }

    @objc func menuEditRulesConfig() {
        openRulesConfig()
    }

    @objc func menuReloadConfig() {
        reloadRulesConfig()
    }

    @objc func menuTriggerScan() {
        triggerScan()
    }

    @objc func menuTriggerClean() {
        triggerClean(category: "all")
    }

    @objc func menuTriggerUndo() {
        triggerUndo()
    }

    func updateMenuState() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            let viewersStr = String(format: "%02d", self.currentViewers)

            if let button = self.statusItem.button {
                let recTag = self.isTouchDesignerRecording ? " ●TD_REC" : ""
                let modeTag = self.currentMode.uppercased()
                if self.isBroadcasting {
                    button.title = "● SISYFUZ [LIVE • \(viewersStr) // \(modeTag)\(recTag)]"
                } else {
                    button.title = "○ SISYFUZ [\(modeTag)\(recTag)]"
                }
            }

            if let statusItem = self.menu.item(withTag: 101) {
                let statusTitle = self.isBroadcasting ? "STATUS:  [● LIVE • 60 FPS]" : "STATUS:  [○ STANDBY / IDLE]"
                let statusColor = self.isBroadcasting ? NSColor(red: 0.0, green: 1.0, blue: 0.4, alpha: 1.0) : NSColor(white: 0.65, alpha: 1.0)
                let font = NSFont(name: "Space Mono", size: 11) ?? NSFont.monospacedSystemFont(ofSize: 11, weight: .bold)
                statusItem.attributedTitle = NSAttributedString(string: statusTitle, attributes: [.font: font, .foregroundColor: statusColor])
            }

            if let viewersItem = self.menu.item(withTag: 102) {
                let font = NSFont(name: "Space Mono", size: 11) ?? NSFont.monospacedSystemFont(ofSize: 11, weight: .medium)
                viewersItem.attributedTitle = NSAttributedString(string: "VIEWERS: [\(viewersStr)]", attributes: [.font: font, .foregroundColor: NSColor(white: 0.85, alpha: 1.0)])
            }

            if let toggleItem = self.menu.item(withTag: 103) {
                let toggleTitle = self.isBroadcasting ? "[■ STOP_BROADCAST]" : "[▶ START_BROADCAST]"
                let toggleColor = self.isBroadcasting ? NSColor(red: 1.0, green: 0.25, blue: 0.25, alpha: 1.0) : NSColor(red: 0.0, green: 0.9, blue: 1.0, alpha: 1.0)
                let font = NSFont(name: "Space Mono", size: 11) ?? NSFont.monospacedSystemFont(ofSize: 11, weight: .bold)
                toggleItem.attributedTitle = NSAttributedString(string: toggleTitle, attributes: [.font: font, .foregroundColor: toggleColor])
            }

            // Mode items (201..205)
            let modes = ["School", "Work", "Personal", "Live", "AUTO"]
            for (idx, m) in modes.enumerated() {
                if let item = self.menu.item(withTag: 201 + idx) {
                    let isSel = (self.currentMode == m)
                    let title = "[\(isSel ? "●" : "○")] \(m.uppercased())"
                    let color = isSel ? NSColor(red: 1.0, green: 0.0, blue: 0.5, alpha: 1.0) : NSColor(white: 0.8, alpha: 1.0)
                    let font = NSFont(name: "Space Mono", size: 11) ?? NSFont.monospacedSystemFont(ofSize: 11, weight: isSel ? .bold : .medium)
                    item.attributedTitle = NSAttributedString(string: title, attributes: [.font: font, .foregroundColor: color])
                }
            }

            // Active Target (310)
            if let targetItem = self.menu.item(withTag: 310) {
                let font = NSFont(name: "Space Mono", size: 11) ?? NSFont.monospacedSystemFont(ofSize: 11, weight: .bold)
                targetItem.attributedTitle = NSAttributedString(
                    string: "TARGET:  [\(self.nativeSorter.activeTargetId.uppercased())]",
                    attributes: [.font: font, .foregroundColor: NSColor(red: 0.0, green: 0.9, blue: 1.0, alpha: 1.0)]
                )
            }

            // Open Files summary (311)
            if let openItem = self.menu.item(withTag: 311) {
                let font = NSFont(name: "Space Mono", size: 10.5) ?? NSFont.monospacedSystemFont(ofSize: 10.5, weight: .medium)
                openItem.attributedTitle = NSAttributedString(
                    string: "OPEN:    [\(self.latestOpenFilesSummary)]",
                    attributes: [.font: font, .foregroundColor: NSColor(white: 0.75, alpha: 1.0)]
                )
            }

            // Disk item (301)
            let b = self.fileSorterBridge!
            if let diskItem = self.menu.item(withTag: 301) {
                let p = Int(round(b.diskPercent))
                let f = Int(round(b.diskFreeGB))
                let title = String(format: "DISK:    [%02d%% // %d GB FREE]", p, f)
                let color = p > 85 ? NSColor(red: 1.0, green: 0.2, blue: 0.2, alpha: 1.0) : NSColor(white: 0.85, alpha: 1.0)
                let font = NSFont(name: "Space Mono", size: 11) ?? NSFont.monospacedSystemFont(ofSize: 11, weight: .medium)
                diskItem.attributedTitle = NSAttributedString(string: title, attributes: [.font: font, .foregroundColor: color])
            }

            // Sorter status (403)
            let isSorterOnline = b.isOnline || self.guardianServer.isRunning
            if let sorterItem = self.menu.item(withTag: 403) {
                let title = isSorterOnline ? "SORTER:  [127.0.0.1:7479 // ONLINE]" : "SORTER:  [127.0.0.1:7479 // OFFLINE]"
                let color = isSorterOnline ? NSColor(red: 0.0, green: 1.0, blue: 0.4, alpha: 1.0) : NSColor(red: 1.0, green: 0.7, blue: 0.0, alpha: 1.0)
                let font = NSFont(name: "Space Mono", size: 11) ?? NSFont.monospacedSystemFont(ofSize: 11, weight: .medium)
                sorterItem.attributedTitle = NSAttributedString(string: title, attributes: [.font: font, .foregroundColor: color])
            }

            // Sync state with ChatHUD WebKit view
            var stateObj: [String: Any] = [
                "isBroadcasting": self.isBroadcasting,
                "viewers": self.currentViewers,
                "url": self.currentLiveUrl,
                "currentMode": self.currentMode,
                "isTdRecording": self.isTouchDesignerRecording,
                "sorterOnline": isSorterOnline,
                "frontmostApp": self.latestOpenAppName,
                "activeTarget": self.nativeSorter.activeTargetId,
                "targetSummary": self.latestOpenFilesSummary,
                "openFilesInfo": [
                    "app": self.latestOpenAppName,
                    "count": self.latestOpenFilesCount
                ],
                "historyCount": self.nativeSorter.transactionHistory.count,
                "diskPercent": b.diskPercent,
                "diskUsedGB": b.diskUsedGB,
                "diskFreeGB": b.diskFreeGB,
                "diskTotalGB": b.diskTotalGB,
                "oscInPort": 7000,
                "oscOutPort": 7001,
                "configPath": self.nativeSorter.configPath.path,
                "targets": self.nativeSorter.targets.map { [
                    "id": $0.id,
                    "label": $0.label,
                    "path": $0.path ?? "",
                    "isDynamic": $0.isDynamic
                ] },
                "latestAction": self.latestAction ?? ""
            ]

            if let sortRes = self.latestSortResult {
                stateObj["sortResult"] = sortRes
            }
            if let undoRes = self.latestUndoResult {
                stateObj["undoResult"] = undoRes
            }
            if let scanRes = b.latestScanResult {
                stateObj["scanResult"] = scanRes
            }
            if let cleanRes = b.latestCleanResult {
                stateObj["cleanResult"] = cleanRes
            }

            if let jsonData = try? JSONSerialization.data(withJSONObject: stateObj),
               let jsonStr = String(data: jsonData, encoding: .utf8) {
                if self.chatWindow?.isVisible == true {
                    self.webView?.evaluateJavaScript("window.onCompanionStateUpdate && window.onCompanionStateUpdate(\(jsonStr));", completionHandler: nil)
                }
            }
        }
    }

    // MARK: - Chat HUD Floating Window
    func setupChatHUD() {
        let width: CGFloat = 430
        let height: CGFloat = 690

        let panel = BrutalistHUDPanel(
            contentRect: NSRect(x: 100, y: 100, width: width, height: height),
            styleMask: [.titled, .closable, .resizable, .utilityWindow, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )

        panel.title = "SISYFUZ // STUDIO ENGINE & STORAGE GUARDIAN HUD"
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.isMovableByWindowBackground = true
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.standardWindowButton(.closeButton)?.isHidden = true
        panel.standardWindowButton(.miniaturizeButton)?.isHidden = true
        panel.standardWindowButton(.zoomButton)?.isHidden = true
        panel.delegate = self

        let config = WKWebViewConfiguration()
        let contentController = WKUserContentController()
        contentController.add(ScriptMessageHandlerWrapper(delegate: self), name: "companion")
        config.userContentController = contentController

        let wv = WKWebView(frame: panel.contentView?.bounds ?? .zero, configuration: config)
        wv.autoresizingMask = [.width, .height]
        wv.setValue(false, forKey: "drawsBackground")

        let htmlUrl: URL = {
            if let bundleUrl = Bundle.main.url(forResource: "ChatHUD", withExtension: "html") {
                return bundleUrl
            }
            return URL(fileURLWithPath: "\(projectDir)/scripts/companion/ChatHUD.html")
        }()
        wv.loadFileURL(htmlUrl, allowingReadAccessTo: htmlUrl.deletingLastPathComponent())

        panel.contentView?.addSubview(wv)
        self.chatWindow = panel
        self.webView = wv
    }

    func windowWillClose(_ notification: Notification) {
        setHUDActive(false)
    }

    func windowDidMiniaturize(_ notification: Notification) {
        setHUDActive(false)
    }

    func windowDidDeminiaturize(_ notification: Notification) {
        setHUDActive(true)
    }

    private func setHUDActive(_ active: Bool) {
        let js = "window.onHUDVisibilityChange && window.onHUDVisibilityChange(\(active ? "true" : "false"));"
        webView?.evaluateJavaScript(js, completionHandler: nil)
    }

    func positionHUDUnderStatusBarButton() {
        guard let window = chatWindow,
              let button = statusItem.button,
              let btnWindow = button.window else { return }

        let buttonRect = button.convert(button.bounds, to: nil)
        let screenRect = btnWindow.convertToScreen(buttonRect)

        let winWidth = window.frame.width
        let winHeight = window.frame.height

        var targetX = screenRect.midX - (winWidth / 2.0)

        let screen = btnWindow.screen ?? NSScreen.main
        if let screen = screen {
            let visibleFrame = screen.visibleFrame
            if targetX + winWidth > visibleFrame.maxX {
                targetX = visibleFrame.maxX - winWidth - 12
            }
            if targetX < visibleFrame.minX {
                targetX = visibleFrame.minX + 12
            }
        }

        let targetY = screenRect.minY - winHeight - 6
        window.setFrameOrigin(NSPoint(x: targetX, y: targetY))
    }

    func showChatHUD() {
        guard let window = chatWindow else { return }
        positionHUDUnderStatusBarButton()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        setHUDActive(true)
        refreshOpenFilesStatus()
        updateMenuState()
    }

    @objc func toggleChatHUD() {
        guard let window = chatWindow else { return }
        if window.isVisible {
            setHUDActive(false)
            window.orderOut(nil)
        } else {
            showChatHUD()
        }
    }

    // MARK: - WKScriptMessageHandler Bridge
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "companion",
              let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            switch action {
            case "startBroadcast":
                self.startBroadcast()
            case "stopBroadcast":
                self.stopBroadcast()
            case "copyUrl":
                self.copyStreamUrl()
            case "openWebStream":
                self.openWebStream()
            case "openOBS":
                self.openOBS()
            case "openTouchDesigner":
                self.openTouchDesigner()
            case "closeHud":
                self.toggleChatHUD()
            case "setMode":
                if let mode = body["mode"] as? String {
                    self.setMode(mode, source: .user)
                }
            case "setSortTarget":
                if let target = body["target"] as? String {
                    self.setSortTarget(target)
                }
            case "triggerSortTarget":
                if let target = body["target"] as? String {
                    self.nativeSorter.activeTargetId = target
                }
                self.triggerSortTarget()
            case "triggerSortOpen":
                self.triggerSortOpenFiles()
            case "chooseCustomFolder":
                self.chooseCustomFolder()
            case "openConfig":
                self.openRulesConfig()
            case "reloadConfig":
                self.reloadRulesConfig()
            case "triggerScan":
                self.triggerScan()
            case "triggerClean":
                let cat = body["category"] as? String ?? "all"
                self.triggerClean(category: cat)
            case "triggerUndo":
                self.triggerUndo()
            default:
                break
            }
        }
    }

    // MARK: - Event-Driven WebSocket Client
    func connectWebSocket() {
        guard !isConnectingWS else { return }
        isConnectingWS = true

        wsReconnectWorkItem?.cancel()
        wsReconnectWorkItem = nil

        wsPingTimer?.invalidate()
        wsPingTimer = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil

        guard let wsUrl = URL(string: "ws://127.0.0.1:9988/ws") else {
            isConnectingWS = false
            return
        }

        let task = wsSession.webSocketTask(with: wsUrl)
        self.webSocketTask = task
        task.resume()

        let authMsg = URLSessionWebSocketTask.Message.string("{\"type\":\"host_auth\"}")
        task.send(authMsg) { [weak self] error in
            DispatchQueue.main.async {
                self?.isConnectingWS = false
                if error == nil {
                    self?.schedulePingTimer()
                }
            }
        }

        listenToWebSocket()
    }

    func schedulePingTimer() {
        wsPingTimer?.invalidate()
        wsPingTimer = Timer.scheduledTimer(withTimeInterval: 15.0, repeats: true) { [weak self] _ in
            guard let self = self, let task = self.webSocketTask else { return }
            task.sendPing { error in
                if error != nil {
                    DispatchQueue.main.async {
                        self.handleWebSocketDisconnect()
                    }
                }
            }
        }
    }

    func listenToWebSocket() {
        webSocketTask?.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .failure(_):
                DispatchQueue.main.async {
                    self.handleWebSocketDisconnect()
                }
            case .success(let message):
                DispatchQueue.main.async {
                    switch message {
                    case .string(let text):
                        self.handleWebSocketMessage(text)
                    case .data(let data):
                        if let text = String(data: data, encoding: .utf8) {
                            self.handleWebSocketMessage(text)
                        }
                    @unknown default:
                        break
                    }
                }
                self.listenToWebSocket()
            }
        }
    }

    func handleWebSocketMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }

        let msgType = json["type"] as? String ?? ""

        if msgType == "status" {
            let active = (json["active"] as? Bool) ?? false
            let viewers = (json["viewers"] as? Int) ?? 0
            let liveUrl = (json["url"] as? String) ?? ""

            self.isBroadcasting = active
            self.currentViewers = viewers
            if !liveUrl.isEmpty {
                self.currentLiveUrl = liveUrl
            }
            self.updateMenuState()
        } else if msgType == "stats" {
            if let viewers = json["viewers"] as? Int {
                self.currentViewers = viewers
                self.updateMenuState()
            }
        } else if msgType == "mode" || msgType == "set_mode" {
            if let mode = json["mode"] as? String {
                self.setMode(mode, source: .webSocket)
            }
        } else if msgType == "storage_action" {
            let act = json["action"] as? String ?? ""
            if act == "sort" {
                if let target = json["target"] as? String {
                    self.setSortTarget(target)
                }
                self.triggerSortTarget()
            } else if act == "sort_open" {
                self.triggerSortOpenFiles()
            } else if act == "sort_downloads" {
                self.setSortTarget("downloads")
                self.triggerSortTarget()
            } else if act == "sort_documents" {
                self.setSortTarget("documents")
                self.triggerSortTarget()
            } else if act == "scan" {
                self.triggerScan()
            } else if act == "clean" {
                let cat = json["category"] as? String ?? "all"
                self.triggerClean(category: cat)
            } else if act == "undo" {
                self.triggerUndo()
            } else if act == "open_config" {
                self.openRulesConfig()
            }
        }
    }

    func handleWebSocketDisconnect() {
        wsPingTimer?.invalidate()
        wsPingTimer = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        isConnectingWS = false

        if broadcastProcess == nil && isBroadcasting {
            isBroadcasting = false
            currentViewers = 0
            updateMenuState()
        }

        wsReconnectWorkItem?.cancel()
        let workItem = DispatchWorkItem { [weak self] in
            self?.connectWebSocket()
        }
        wsReconnectWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0, execute: workItem)
    }

    // MARK: - Broadcast Process Control
    @objc func toggleBroadcast() {
        if isBroadcasting {
            stopBroadcast()
        } else {
            startBroadcast()
        }
    }

    func startBroadcast() {
        if broadcastProcess != nil { return }

        let proc = Process()
        proc.currentDirectoryPath = projectDir

        let nodePath = FileManager.default.fileExists(atPath: "/opt/homebrew/bin/node")
            ? "/opt/homebrew/bin/node"
            : (FileManager.default.fileExists(atPath: "/usr/local/bin/node") ? "/usr/local/bin/node" : "/usr/bin/node")

        proc.executableURL = URL(fileURLWithPath: nodePath)
        proc.arguments = ["scripts/broadcast.js"]

        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "\(env["PATH"] ?? ""):/opt/homebrew/bin:/usr/local/bin"
        proc.environment = env

        let pipe = Pipe()
        self.broadcastPipe = pipe
        proc.standardOutput = pipe
        proc.standardError = pipe

        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            if let str = String(data: data, encoding: .utf8) {
                if str.contains("trycloudflare.com") {
                    let pattern = "https://[a-zA-Z0-9\\-]+\\.trycloudflare\\.com"
                    if let regex = try? NSRegularExpression(pattern: pattern),
                       let match = regex.firstMatch(in: str, range: NSRange(str.startIndex..., in: str)),
                       let range = Range(match.range, in: str) {
                        let liveUrl = String(str[range])
                        DispatchQueue.main.async {
                            self?.currentLiveUrl = liveUrl
                            self?.isBroadcasting = true
                            self?.updateMenuState()
                        }
                    }
                }
            }
        }

        proc.terminationHandler = { [weak self] _ in
            pipe.fileHandleForReading.readabilityHandler = nil
            try? pipe.fileHandleForReading.close()
            DispatchQueue.main.async {
                self?.broadcastPipe = nil
                self?.broadcastProcess = nil
                self?.isBroadcasting = false
                self?.currentViewers = 0
                self?.updateMenuState()
            }
        }

        do {
            try proc.run()
            self.broadcastProcess = proc
            self.isBroadcasting = true
            updateMenuState()
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
                self?.connectWebSocket()
            }
        } catch {
            print("Failed to run broadcast.js: \(error)")
            pipe.fileHandleForReading.readabilityHandler = nil
            try? pipe.fileHandleForReading.close()
            self.broadcastPipe = nil
            self.broadcastProcess = nil
            self.isBroadcasting = false
            updateMenuState()
        }
    }

    func stopBroadcast() {
        if let url = URL(string: "http://127.0.0.1:9988/api/broadcast/stop") {
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            URLSession.shared.dataTask(with: req).resume()
        }

        if let proc = broadcastProcess {
            proc.terminationHandler = nil
            if proc.isRunning {
                proc.interrupt()
            }
        }

        broadcastPipe?.fileHandleForReading.readabilityHandler = nil
        try? broadcastPipe?.fileHandleForReading.close()
        broadcastPipe = nil
        broadcastProcess = nil

        isBroadcasting = false
        currentViewers = 0
        updateMenuState()
        handleWebSocketDisconnect()
    }

    // MARK: - Quick Actions
    @objc func copyStreamUrl() {
        let url = currentLiveUrl.isEmpty ? "https://sisyfuz.com/live" : currentLiveUrl
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(url, forType: .string)
    }

    @objc func openWebStream() {
        let target = currentLiveUrl.isEmpty ? "https://sisyfuz.com/live" : currentLiveUrl
        if let url = URL(string: target) {
            NSWorkspace.shared.open(url)
        }
    }

    @objc func openOBS() {
        if let obsUrl = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.obsproject.obs-studio") {
            NSWorkspace.shared.openApplication(at: obsUrl, configuration: NSWorkspace.OpenConfiguration())
        }
    }

    @objc func openTouchDesigner() {
        if let tdUrl = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "ca.derivative.TouchDesigner") {
            NSWorkspace.shared.openApplication(at: tdUrl, configuration: NSWorkspace.OpenConfiguration())
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        cleanup()
    }

    private func cleanup() {
        openFilesRefreshTimer?.invalidate()
        openFilesRefreshTimer = nil
        renderDebounceTimer?.invalidate()
        renderDebounceTimer = nil
        wsPingTimer?.invalidate()
        wsPingTimer = nil
        wsReconnectWorkItem?.cancel()
        wsReconnectWorkItem = nil

        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        wsSession.invalidateAndCancel()

        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "companion")

        stopBroadcast()
        oscServer?.stop()
        guardianServer?.stop()
        fileSorterBridge?.stopPolling()
    }

    @objc func quitApp() {
        cleanup()
        NSApp.terminate(nil)
    }
}

// MARK: - Automated Self-Test Verification Suite
func runStorageGuardianSelfTest() {
    print("=== STARTING SISYFUZ STORAGE GUARDIAN SELF-TEST ===")
    let fm = FileManager.default
    let testRoot = fm.temporaryDirectory.appendingPathComponent("sisyfuz_test_sandbox_\(UUID().uuidString.prefix(6))")
    try? fm.createDirectory(at: testRoot, withIntermediateDirectories: true)
    NativeFileSorterEngine.configPathOverride = testRoot.appendingPathComponent("guardian_config.json")

    defer {
        try? fm.removeItem(at: testRoot)
    }

    print("1. Testing StorageGuardianConfig initialization & persistence...")
    let sorter = NativeFileSorterEngine.shared
    assert(!sorter.rules.isEmpty, "Rules should not be empty")
    assert(!sorter.targets.isEmpty, "Targets should not be empty")
    assert(fm.fileExists(atPath: sorter.configPath.path), "Config file must exist at \(sorter.configPath.path)")
    print("   [OK] Config loaded and persisted at \(sorter.configPath.path)")

    print("2. Testing Target & Sandbox Directory Setup...")
    let testDownloads = testRoot.appendingPathComponent("Downloads")
    let testDocuments = testRoot.appendingPathComponent("Documents")
    try! fm.createDirectory(at: testDownloads, withIntermediateDirectories: true)
    try! fm.createDirectory(at: testDocuments, withIntermediateDirectories: true)

    let testFiles: [String: String] = [
        "lecture_slides.pdf": "PDF document content",
        "screen_capture.mov": "Video stream data",
        "model_preview.png": "PNG image data",
        "synth_patch.wav": "Audio sample data",
        "script_pipeline.py": "print('hello')",
        "archive_backup.zip": "Zip archive data",
        "installer_package.dmg": "Apple Disk Image",
    ]

    for (name, content) in testFiles {
        let fileURL = testDownloads.appendingPathComponent(name)
        try! content.data(using: .utf8)!.write(to: fileURL)
    }
    print("   [OK] Created \(testFiles.count) sample files in sandbox Downloads")

    print("3. Testing Directory Sort with Mode-dependent routing ('School' mode)...")
    let (moves1, _) = sorter.sortDirectorySynchronous(url: testDownloads, mode: "School")
    assert(moves1.count >= 6, "Expected at least 6 files sorted, got \(moves1.count)")

    let pdfDest = testDownloads.appendingPathComponent("School/Readings/lecture_slides.pdf")
    let pyDest = testDownloads.appendingPathComponent("School/Assignments/script_pipeline.py")
    let movDest = testDownloads.appendingPathComponent("School/Media/screen_capture.mov")
    let pngDest = testDownloads.appendingPathComponent("School/Images/model_preview.png")
    let wavDest = testDownloads.appendingPathComponent("School/Audio/synth_patch.wav")
    let zipDest = testDownloads.appendingPathComponent("School/Archives/archive_backup.zip")

    assert(fm.fileExists(atPath: pdfDest.path), "PDF must exist at \(pdfDest.path)")
    assert(fm.fileExists(atPath: pyDest.path), "Python script must exist at \(pyDest.path)")
    assert(fm.fileExists(atPath: movDest.path), "MOV video must exist at \(movDest.path)")
    assert(fm.fileExists(atPath: pngDest.path), "PNG must exist at \(pngDest.path)")
    assert(fm.fileExists(atPath: wavDest.path), "WAV audio must exist at \(wavDest.path)")
    assert(fm.fileExists(atPath: zipDest.path), "ZIP archive must exist at \(zipDest.path)")
    print("   [OK] Verified 6 files routed correctly relative to Downloads in 'School' mode")

    print("4. Testing Collision Avoidance (Duplicate File Names)...")
    let duplicatePDF = testDownloads.appendingPathComponent("lecture_slides.pdf")
    try! "Updated duplicate PDF".data(using: .utf8)!.write(to: duplicatePDF)

    let (moves2, _) = sorter.sortDirectorySynchronous(url: testDownloads, mode: "School")
    assert(moves2.count == 1, "Duplicate file should be moved")
    let collisionDest = testDownloads.appendingPathComponent("School/Readings/lecture_slides_1.pdf")
    assert(fm.fileExists(atPath: collisionDest.path), "Collision-avoided file must exist at \(collisionDest.path)")
    assert(fm.fileExists(atPath: pdfDest.path), "Original file must still exist at \(pdfDest.path)")
    print("   [OK] Collision avoidance renamed duplicate to \(collisionDest.lastPathComponent)")

    print("5. Testing Multi-Level Undo...")
    sorter.undoStack.append(moves1)
    sorter.undoStack.append(moves2)

    let undo1 = sorter.undoLastOperation()
    assert(undo1.success, "Undo 1 should succeed: \(undo1.message)")
    assert(fm.fileExists(atPath: duplicatePDF.path), "Duplicate file restored to root")
    print("   [OK] Undo level 1 restored duplicate to original path")

    let undo2 = sorter.undoLastOperation()
    assert(undo2.success, "Undo 2 should succeed: \(undo2.message)")
    for (name, _) in testFiles {
        let orig = testDownloads.appendingPathComponent(name)
        assert(fm.fileExists(atPath: orig.path), "File \(name) must be restored to original root")
    }
    print("   [OK] Undo level 2 restored all 7 original files to Downloads root")

    print("6. Testing Ephemeral Scanner...")
    let scan = sorter.scanEphemeral(targetFolder: testDownloads)
    let scanCount = scan["count"] as? Int ?? 0
    assert(scanCount >= 1, "Expected at least 1 ephemeral file (.dmg), found \(scanCount)")
    print("   [OK] Ephemeral scanner identified \(scanCount) disposable installer(s)")

    print("7. Testing Custom Target Registration & Persistence...")
    let customTarget = sorter.addCustomTarget(name: "PROJECT_ASSETS", url: testDocuments)
    assert(sorter.activeTargetId == customTarget.id, "Active target should switch to new custom target")
    assert(sorter.targets.contains(where: { $0.id == customTarget.id }), "Custom target should be in targets list")

    let reloadedSorter = NativeFileSorterEngine()
    assert(reloadedSorter.targets.contains(where: { $0.id == customTarget.id }), "Reloaded sorter must retain custom target from disk")
    print("   [OK] Custom target persisted across instances via \(sorter.configPath.path)")

    print("8. Testing OpenFilesDetector Target Application Resolution...")
    let targetApp = OpenFilesDetector.resolveTargetApp()
    print("   Detected Target Application: \(targetApp?.localizedName ?? "Finder (Default)")")
    let openFiles = OpenFilesDetector.detectOpenFiles()
    print("   Detection Summary: [\(openFiles.summary)]")
    print("   Files Count: \(openFiles.files.count)")
    assert(!openFiles.summary.isEmpty, "Detection summary must not be empty")
    print("   [OK] OpenFilesDetector resolved without self-referential deadlock")

    print("9. Testing Idempotent Sort / Nesting Prevention...")
    // Sort files in testDownloads (synchronous sorts don't record undo history, so push it like sortDirectory does)
    let (idempotentMoves, _) = sorter.sortDirectorySynchronous(url: testDownloads, mode: "School")
    sorter.pushUndoMoves(idempotentMoves)
    let sortedPdfURL = testDownloads.appendingPathComponent("School/Readings/lecture_slides.pdf")
    assert(fm.fileExists(atPath: sortedPdfURL.path), "Sorted PDF should exist")

    // Attempting to sort already-sorted file must NOT nest it inside School/Readings/School/Readings
    let (nestedMoves, _) = sorter.sortExplicitFilesSynchronous(files: [sortedPdfURL], mode: "School")
    assert(nestedMoves.isEmpty, "Already sorted file must not be moved again (expected 0 moves, got \(nestedMoves.count))")
    let badNestedURL = testDownloads.appendingPathComponent("School/Readings/School/Readings/lecture_slides.pdf")
    assert(!fm.fileExists(atPath: badNestedURL.path), "Must not create recursive nested folders")
    print("   [OK] Idempotent sort verified: no recursive subfolder nesting")

    print("10. Testing Empty Directory Pruning on Undo...")
    let undo3 = sorter.undoLastOperation()
    assert(undo3.success, "Undo 3 should succeed")
    let schoolFolder = testDownloads.appendingPathComponent("School")
    assert(!fm.fileExists(atPath: schoolFolder.path), "Empty destination subdirectories must be pruned on undo")
    print("   [OK] Pruned empty destination directories on undo")

    print("11. Testing Custom Target Deduplication...")
    let existingTarget = sorter.addCustomTarget(name: "PROJECT_ASSETS_DUPE", url: testDocuments)
    assert(existingTarget.id == customTarget.id, "Adding target with same path should return existing target ID")
    let countOfMatching = sorter.targets.filter { $0.resolvedURL?.standardizedFileURL.path == testDocuments.standardizedFileURL.path }.count
    assert(countOfMatching == 1, "Should not duplicate targets with identical paths")
    print("   [OK] Custom target deduplication verified")

    print("12. Testing Read-Only & Locked File Handling...")
    let readOnlyFile = testDownloads.appendingPathComponent("locked_manifest.txt")
    try! "Protected config".data(using: .utf8)!.write(to: readOnlyFile)
    // Make file read-only (POSIX 0444)
    try! fm.setAttributes([.posixPermissions: 0o444], ofItemAtPath: readOnlyFile.path)
    let (movesRO, reportsRO) = sorter.sortDirectorySynchronous(url: testDownloads, mode: "Work")
    // File may move (or skip if unwritable destination); regardless, it should execute cleanly without crashing
    assert(!reportsRO.isEmpty || movesRO.isEmpty, "Read-only file handling should complete gracefully")
    try? fm.setAttributes([.posixPermissions: 0o644], ofItemAtPath: readOnlyFile.path)
    print("   [OK] Read-only / locked file handling completed gracefully without crashing")

    print("13. Testing Concurrent Multi-Threaded State Access (Race Condition Stress Test)...")
    let concurrentGroup = DispatchGroup()
    let concurrentQueue = DispatchQueue.global(qos: .userInitiated)

    for i in 0..<30 {
        concurrentGroup.enter()
        concurrentQueue.async {
            for j in 0..<20 {
                // Read and write transaction history
                sorter.recordTransaction(target: "STRESS_TEST_\(i)_\(j)", count: j)
                _ = sorter.transactionHistory.count

                // Read targets
                _ = sorter.targets.count

                // Push undo moves
                let dummyMove = (from: URL(fileURLWithPath: "/tmp/a_\(i)_\(j)"), to: URL(fileURLWithPath: "/tmp/b_\(i)_\(j)"))
                sorter.pushUndoMoves([dummyMove])
                _ = sorter.undoStack.count

                // Concurrent scan
                _ = sorter.scanEphemeral(targetFolder: testDownloads)
            }
            concurrentGroup.leave()
        }
    }
    concurrentGroup.wait()
    print("   [OK] Concurrent multi-threaded stress test passed with zero race crashes")

    print("14. Testing SIGPIPE Resiliency & Broken Socket Disconnect...")
    let sigpipeServerFd = socket(AF_INET, SOCK_STREAM, 0)
    assert(sigpipeServerFd >= 0, "Server socket creation should succeed")
    var nosigpipeVal: Int32 = 1
    setsockopt(sigpipeServerFd, SOL_SOCKET, SO_NOSIGPIPE, &nosigpipeVal, socklen_t(MemoryLayout<Int32>.size))
    var serverAddr = sockaddr_in()
    serverAddr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    serverAddr.sin_family = sa_family_t(AF_INET)
    serverAddr.sin_port = UInt16(0).bigEndian // Assign ephemeral port
    serverAddr.sin_addr.s_addr = inet_addr("127.0.0.1")
    let bRes = withUnsafePointer(to: &serverAddr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
            bind(sigpipeServerFd, saPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    assert(bRes == 0, "Bind should succeed")
    listen(sigpipeServerFd, 1)
    var assignedAddr = sockaddr_in()
    var assignedLen = socklen_t(MemoryLayout<sockaddr_in>.size)
    _ = withUnsafeMutablePointer(to: &assignedAddr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
            getsockname(sigpipeServerFd, saPtr, &assignedLen)
        }
    }
    let serverPort = UInt16(bigEndian: assignedAddr.sin_port)

    // Connect client
    let clientFd = socket(AF_INET, SOCK_STREAM, 0)
    var clientConnectAddr = sockaddr_in()
    clientConnectAddr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    clientConnectAddr.sin_family = sa_family_t(AF_INET)
    clientConnectAddr.sin_port = serverPort.bigEndian
    clientConnectAddr.sin_addr.s_addr = inet_addr("127.0.0.1")
    let connRes = withUnsafePointer(to: &clientConnectAddr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
            connect(clientFd, saPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    assert(connRes == 0, "Client connect should succeed")

    var acceptedAddr = sockaddr_in()
    var acceptedLen = socklen_t(MemoryLayout<sockaddr_in>.size)
    let acceptedFd = withUnsafeMutablePointer(to: &acceptedAddr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
            accept(sigpipeServerFd, saPtr, &acceptedLen)
        }
    }
    assert(acceptedFd >= 0, "Accept should succeed")
    setsockopt(acceptedFd, SOL_SOCKET, SO_NOSIGPIPE, &nosigpipeVal, socklen_t(MemoryLayout<Int32>.size))

    // Close client abruptly
    close(clientFd)
    usleep(10000) // 10ms to let TCP close handshake process

    // Writing to broken socket must NOT terminate process with SIGPIPE
    let dummyData = [UInt8]("TEST_BROKEN_PIPE".utf8)
    // The first send after the peer closes is usually buffered; a later one fails once the peer's RST lands
    var sawBrokenPipe = false
    for _ in 0..<50 where !sawBrokenPipe {
        sawBrokenPipe = send(acceptedFd, dummyData, dummyData.count, 0) == -1
        if !sawBrokenPipe { usleep(5000) }
    }
    assert(sawBrokenPipe, "Send on closed socket should return -1 with EPIPE")
    close(acceptedFd)
    close(sigpipeServerFd)
    print("   [OK] SIGPIPE resiliency verified: broken pipe safely returned EPIPE without crash")

    print("15. Testing OpenFilesDetector Thread-Safe Concurrency & Caching...")
    let scriptGroup = DispatchGroup()
    var scriptResults: [OpenFilesDetector.DetectionResult] = []
    let scriptQueueLock = NSLock()
    for _ in 0..<10 {
        scriptGroup.enter()
        concurrentQueue.async {
            let res = OpenFilesDetector.detectOpenFiles()
            scriptQueueLock.lock()
            scriptResults.append(res)
            scriptQueueLock.unlock()
            scriptGroup.leave()
        }
    }
    scriptGroup.wait()
    assert(scriptResults.count == 10, "All 10 concurrent detection calls must complete")
    for r in scriptResults {
        assert(!r.summary.isEmpty, "Detection result must have non-empty summary")
    }
    print("   [OK] OpenFilesDetector handled concurrent calls with thread-safe caching")

    print("16. Testing StorageGuardianHTTPServer Delayed Client Handling (O_NONBLOCK Fix)...")
    let testServer = StorageGuardianHTTPServer(port: 7488)
    assert(testServer.start(), "Test server should bind and listen on port 7488")

    let testClientFd = socket(AF_INET, SOCK_STREAM, 0)
    var testServerAddr = sockaddr_in()
    testServerAddr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    testServerAddr.sin_family = sa_family_t(AF_INET)
    testServerAddr.sin_port = UInt16(7488).bigEndian
    testServerAddr.sin_addr.s_addr = inet_addr("127.0.0.1")
    let cRes = withUnsafePointer(to: &testServerAddr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
            connect(testClientFd, saPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    assert(cRes == 0, "Test client connect to port 7488 should succeed")

    // Sleep 50ms before sending request bytes (previously caused immediate closure due to inherited O_NONBLOCK)
    usleep(50000)

    let getReq = "GET /api/status HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"
    _ = getReq.withCString { send(testClientFd, $0, strlen($0), 0) }

    // Read until the server closes (Connection: close): the status body includes history and can exceed one recv
    var responseBuf = [UInt8](repeating: 0, count: 4096)
    var responseData = [UInt8]()
    while true {
        let n = recv(testClientFd, &responseBuf, responseBuf.count, 0)
        if n <= 0 { break }
        responseData.append(contentsOf: responseBuf[0..<n])
    }
    assert(!responseData.isEmpty, "Server must not drop connection on delayed client (got 0 bytes)")
    let respStr = String(decoding: responseData, as: UTF8.self)
    assert(respStr.contains("200 OK"), "Response should be 200 OK")
    assert(respStr.contains("\"status\" : \"online\"") || respStr.contains("\"status\": \"online\"") || respStr.contains("\"status\":\"online\""), "Response should contain online status")
    close(testClientFd)
    print("   [OK] Delayed HTTP client received full 200 OK response without disconnect")

    print("17. Testing Chunked Multi-Packet HTTP POST Request Handling...")
    let chunkedClientFd = socket(AF_INET, SOCK_STREAM, 0)
    let cRes2 = withUnsafePointer(to: &testServerAddr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
            connect(chunkedClientFd, saPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    assert(cRes2 == 0, "Chunked client connect should succeed")

    let postBody = "{\"active_target\":\"downloads\"}"
    let postHeader = "POST /api/config HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: \(postBody.utf8.count)\r\n\r\n"
    // Send headers first
    _ = postHeader.withCString { send(chunkedClientFd, $0, strlen($0), 0) }
    // Wait 25ms to simulate packet fragmentation
    usleep(25000)
    // Send body in second packet
    _ = postBody.withCString { send(chunkedClientFd, $0, strlen($0), 0) }

    var chunkedRespBuf = [UInt8](repeating: 0, count: 2048)
    let chunkedRespBytes = recv(chunkedClientFd, &chunkedRespBuf, chunkedRespBuf.count, 0)
    assert(chunkedRespBytes > 0, "Server should respond to chunked POST")
    let chunkedRespStr = String(decoding: chunkedRespBuf[0..<chunkedRespBytes], as: UTF8.self)
    assert(chunkedRespStr.contains("200 OK"), "Chunked POST response should be 200 OK")
    close(chunkedClientFd)
    print("   [OK] Chunked multi-packet HTTP POST successfully reconstructed and processed")

    print("17b. Testing Browser / DNS-Rebinding Request Rejection...")
    func rawRequest(_ req: String) -> String {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        let res = withUnsafePointer(to: &testServerAddr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
                connect(fd, saPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        assert(res == 0, "Rejection test client connect should succeed")
        _ = req.withCString { send(fd, $0, strlen($0), 0) }
        var buf = [UInt8](repeating: 0, count: 2048)
        let n = recv(fd, &buf, buf.count, 0)
        close(fd)
        return n > 0 ? String(decoding: buf[0..<n], as: UTF8.self) : ""
    }
    let cleanBody = "{}"
    let crossSite = rawRequest("POST /api/clean HTTP/1.1\r\nHost: 127.0.0.1:7488\r\nOrigin: https://evil.example\r\nContent-Type: text/plain\r\nContent-Length: \(cleanBody.utf8.count)\r\n\r\n\(cleanBody)")
    assert(crossSite.contains("403 Forbidden"), "Cross-origin browser POST must be rejected, got: \(crossSite.prefix(40))")
    assert(!crossSite.contains("Access-Control-Allow-Origin"), "API must not send a wildcard CORS header")
    let noCors = rawRequest("GET /api/scan HTTP/1.1\r\nHost: 127.0.0.1:7488\r\nSec-Fetch-Site: cross-site\r\n\r\n")
    assert(noCors.contains("403 Forbidden"), "no-cors cross-site browser GET must be rejected")
    let rebinding = rawRequest("GET /api/config HTTP/1.1\r\nHost: attacker.example:7488\r\n\r\n")
    assert(rebinding.contains("403 Forbidden"), "Non-loopback Host (DNS rebinding) must be rejected")
    let typedUrl = rawRequest("GET /api/status HTTP/1.1\r\nHost: localhost:7488\r\nSec-Fetch-Site: none\r\n\r\n")
    assert(typedUrl.contains("200 OK"), "Manually opened localhost URL should still work")
    let ipv6 = rawRequest("GET /api/status HTTP/1.1\r\nHost: [::1]:7488\r\n\r\n")
    assert(ipv6.contains("200 OK"), "IPv6 loopback Host should be accepted")
    testServer.stop()
    print("   [OK] Browser cross-site, no-cors, and DNS-rebinding requests rejected with 403")

    print("18. Testing Concurrent Result State Synchronization (Race Condition Hardening)...")
    let stateGroup = DispatchGroup()
    for i in 0..<30 {
        stateGroup.enter()
        concurrentQueue.async {
            for j in 0..<20 {
                sorter.latestSortResult = ["count": i * 20 + j, "msg": "sort_\(i)"]
                _ = sorter.latestSortResult?["count"]
                sorter.latestUndoResult = ["count": j, "msg": "undo_\(j)"]
                _ = sorter.latestUndoResult?["msg"]
                sorter.latestScanResult = ["count": j, "size": Double(j)]
                _ = sorter.latestScanResult?["size"]
                sorter.latestCleanResult = ["purged": j]
                _ = sorter.latestCleanResult?["purged"]
            }
            stateGroup.leave()
        }
    }
    stateGroup.wait()
    assert(sorter.latestSortResult != nil, "latestSortResult should be set")
    assert(sorter.latestUndoResult != nil, "latestUndoResult should be set")
    print("   [OK] Concurrent result state synchronization verified with zero race crashes")

    print("\n=== ALL GUARDIAN SELF-TESTS PASSED SUCCESSFULLY! ===")
    try? fm.removeItem(at: testRoot)
    exit(0)
}

// MARK: - Main Entry Point & Self-Test Mode
if CommandLine.arguments.contains("--test") {
    runStorageGuardianSelfTest()
} else {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.run()
}
