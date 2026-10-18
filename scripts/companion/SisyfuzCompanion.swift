import AppKit
import WebKit
import Foundation
import Darwin

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
                    let val = sub.withUnsafeBytes { $0.load(as: Int32.self) }
                    args.append(.int32(Int32(bigEndian: val)))
                    offset += 4
                }
            case "f":
                if offset + 4 <= data.count {
                    let sub = data.subdata(in: offset..<offset+4)
                    let val = sub.withUnsafeBytes { $0.load(as: UInt32.self) }
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

        var reuse: Int32 = 1
        setsockopt(socketFd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))

        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr.s_addr = INADDR_ANY.bigEndian

        let bindRes = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(socketFd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
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
        source.setEventHandler { [weak self] in
            guard let self = self, self.socketFd >= 0 else { return }
            var buffer = [UInt8](repeating: 0, count: 65536)
            var clientAddr = sockaddr_in()
            var clientAddrLen = socklen_t(MemoryLayout<sockaddr_in>.size)

            let bytesRead = withUnsafeMutablePointer(to: &clientAddr) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    recvfrom(self.socketFd, &buffer, buffer.count, 0, $0, &clientAddrLen)
                }
            }

            if bytesRead > 0 {
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
        readSource?.cancel()
        readSource = nil
        if socketFd >= 0 {
            close(socketFd)
            socketFd = -1
        }
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

    init(host: String = "127.0.0.1", port: UInt16 = 7001) {
        self.host = host
        self.port = port
        setupSocket()
    }

    private func setupSocket() {
        socketFd = socket(AF_INET, SOCK_DGRAM, 0)
        guard socketFd >= 0 else { return }

        destAddr = sockaddr_in()
        destAddr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        destAddr.sin_family = sa_family_t(AF_INET)
        destAddr.sin_port = port.bigEndian
        inet_pton(AF_INET, host, &destAddr.sin_addr)
    }

    func send(message: OSCMessage) {
        guard socketFd >= 0 else { return }
        let data = message.encode()
        data.withUnsafeBytes { rawPtr in
            guard let ptr = rawPtr.baseAddress else { return }
            withUnsafePointer(to: &destAddr) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    _ = sendto(socketFd, ptr, data.count, 0, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
                }
            }
        }
    }

    deinit {
        if socketFd >= 0 {
            close(socketFd)
            socketFd = -1
        }
    }
}

// MARK: - File Sorter & Storage Guardian REST Bridge
class FileSorterBridge {
    let baseURL: String
    var isOnline: Bool = false
    var activeMode: String = "AUTO"
    var isLocked: Bool = false
    var frontmostApp: String = "Finder"
    var diskPercent: Double = 0.0
    var diskUsedGB: Double = 0.0
    var diskFreeGB: Double = 0.0
    var diskTotalGB: Double = 0.0
    var recentTransactions: [[String: Any]] = []
    var latestScanResult: [String: Any]? = nil
    var latestCleanResult: [String: Any]? = nil

    var onStatusUpdated: (() -> Void)?
    var onModeChangedBySorter: ((String) -> Void)?

    private var pollTimer: Timer?
    private let session: URLSession

    init(baseURL: String = "http://127.0.0.1:7479") {
        self.baseURL = baseURL
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 2.0
        config.timeoutIntervalForResource = 3.0
        self.session = URLSession(configuration: config)
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
        guard let url = URL(string: "\(baseURL)/api/status") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"

        session.dataTask(with: req) { [weak self] data, response, error in
            guard let self = self else { return }
            if let data = data,
               let httpRes = response as? HTTPURLResponse,
               httpRes.statusCode == 200,
               let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                DispatchQueue.main.async {
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

                    // Parse disk / storage metrics
                    var p: Double = 0.0
                    var u: Double = 0.0
                    var f: Double = 0.0
                    var t: Double = 0.0

                    if let disk = json["disk"] as? [String: Any] {
                        p = (disk["percent"] as? NSNumber)?.doubleValue ?? 0.0
                        u = (disk["used"] as? NSNumber)?.doubleValue ?? (disk["used_gb"] as? NSNumber)?.doubleValue ?? 0.0
                        f = (disk["free"] as? NSNumber)?.doubleValue ?? (disk["free_gb"] as? NSNumber)?.doubleValue ?? 0.0
                        t = (disk["total"] as? NSNumber)?.doubleValue ?? (disk["total_gb"] as? NSNumber)?.doubleValue ?? 0.0
                    } else if let storage = json["storage"] as? [String: Any] {
                        p = (storage["percent"] as? NSNumber)?.doubleValue ?? 0.0
                        u = (storage["used"] as? NSNumber)?.doubleValue ?? 0.0
                        f = (storage["free"] as? NSNumber)?.doubleValue ?? 0.0
                        t = (storage["total"] as? NSNumber)?.doubleValue ?? 0.0
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

                    if let history = json["history"] as? [[String: Any]] ?? json["recent_transactions"] as? [[String: Any]] {
                        self.recentTransactions = history
                    }

                    self.onStatusUpdated?()
                }
            } else {
                DispatchQueue.main.async {
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

    func triggerSort(completion: ((Bool, String) -> Void)? = nil) {
        guard let url = URL(string: "\(baseURL)/api/sort") else {
            completion?(false, "Invalid URL")
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"

        session.dataTask(with: req) { data, response, error in
            let success = (response as? HTTPURLResponse)?.statusCode == 200
            var msg = "Sort completed"
            if let data = data, let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
               let m = json["message"] as? String {
                msg = m
            }
            DispatchQueue.main.async {
                completion?(success, msg)
            }
        }.resume()
    }

    func triggerScan(completion: (([String: Any]?) -> Void)? = nil) {
        guard let url = URL(string: "\(baseURL)/api/scan") else {
            completion?(nil)
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"

        session.dataTask(with: req) { [weak self] data, response, error in
            var result: [String: Any]? = nil
            if let data = data,
               let httpRes = response as? HTTPURLResponse,
               httpRes.statusCode == 200,
               let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                result = json
            }
            DispatchQueue.main.async {
                self?.latestScanResult = result
                completion?(result)
            }
        }.resume()
    }

    func triggerClean(category: String = "all", completion: (([String: Any]?) -> Void)? = nil) {
        guard let url = URL(string: "\(baseURL)/api/clean") else {
            completion?(nil)
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["category": category])

        session.dataTask(with: req) { [weak self] data, response, error in
            var result: [String: Any]? = nil
            if let data = data,
               let httpRes = response as? HTTPURLResponse,
               httpRes.statusCode == 200,
               let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                result = json
            }
            DispatchQueue.main.async {
                self?.latestCleanResult = result
                completion?(result)
            }
        }.resume()
    }

    func triggerUndo(completion: ((Bool, String) -> Void)? = nil) {
        guard let url = URL(string: "\(baseURL)/api/undo") else {
            completion?(false, "Invalid URL")
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"

        session.dataTask(with: req) { data, response, error in
            let success = (response as? HTTPURLResponse)?.statusCode == 200
            var msg = "Undo executed"
            if let data = data, let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
               let m = json["message"] as? String {
                msg = m
            }
            DispatchQueue.main.async {
                completion?(success, msg)
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

    // Bridges: OSC and FileSorter
    var oscServer: OSCServer!
    var oscClient: OSCClient!
    var fileSorterBridge: FileSorterBridge!

    // TouchDesigner Record Coordination State
    var isTouchDesignerRecording: Bool = false
    var renderDebounceTimer: Timer?

    // Mode state
    var currentMode: String = "AUTO"

    // Event-driven WebSocket connection & heartbeat
    var webSocketTask: URLSessionWebSocketTask?
    var wsPingTimer: Timer?
    var isConnectingWS = false

    // Project root directory
    let projectDir: String = {
        let currentPath = FileManager.default.currentDirectoryPath
        if FileManager.default.fileExists(atPath: "\(currentPath)/scripts/broadcast.js") {
            return currentPath
        }
        return "/Users/dorusk/RiderProjects/sisyfuz.com"
    }()

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Run as menu bar accessory (no dock icon)
        NSApp.setActivationPolicy(.accessory)

        // Initialize Bridges
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
            button.title = "○ SISYFUZ [IDLE]"
            button.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .bold)
            button.target = self
            button.action = #selector(statusItemClicked(_:))
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }

        buildMenu()
        setupChatHUD()

        // Event-driven real-time push connection to broadcast hub
        connectWebSocket()

        // Auto-open brutalist studio HUD on launch
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
            self?.showChatHUD()
        }
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
            } else if addr == "/sisyfuz/sort" {
                self.triggerSort()
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

        if source != .fileSorter {
            let sorterMode = (normalized == "Live") ? "Work" : normalized
            fileSorterBridge.setMode(mode: sorterMode)
        }

        if source != .osc {
            oscClient.send(message: OSCMessage(address: "/sisyfuz/mode", arguments: [.string(normalized)]))
        }

        // Send mode change via WebSocket to broadcast.js
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
            // TouchDesigner finished recording: Wait 750ms for file handle flush, then trigger sort
            renderDebounceTimer?.invalidate()
            renderDebounceTimer = Timer.scheduledTimer(withTimeInterval: 0.75, repeats: false) { [weak self] _ in
                self?.triggerSort(isFromRenderFinish: true)
            }
        }

        updateMenuState()
    }

    // MARK: - Storage Guardian Triggers
    func triggerSort(isFromRenderFinish: Bool = false) {
        fileSorterBridge.triggerSort { [weak self] success, msg in
            guard let self = self else { return }
            self.oscClient.send(message: OSCMessage(address: "/sisyfuz/sort/status", arguments: [.string(success ? "completed" : "failed")]))

            let toastJs = "window.showHudToast && window.showHudToast('\(isFromRenderFinish ? "RENDER CATALOGED" : "SORT COMPLETE")');"
            self.webView?.evaluateJavaScript(toastJs, completionHandler: nil)
            self.updateMenuState()
        }
    }

    func triggerScan() {
        fileSorterBridge.triggerScan { [weak self] result in
            guard let self = self else { return }
            if let res = result {
                let count = (res["count"] as? NSNumber)?.int32Value ?? Int32((res["items"] as? [Any])?.count ?? 0)
                let mb = (res["size_mb"] as? NSNumber)?.floatValue ?? (res["reclaimable_mb"] as? NSNumber)?.floatValue ?? 0.0
                self.oscClient.send(message: OSCMessage(address: "/sisyfuz/storage/scan_result", arguments: [.int32(count), .float32(mb)]))
            }
            self.updateMenuState()
        }
    }

    func triggerClean(category: String = "all") {
        fileSorterBridge.triggerClean(category: category) { [weak self] result in
            guard let self = self else { return }
            if let res = result {
                let count = (res["purged_count"] as? NSNumber)?.int32Value ?? (res["count"] as? NSNumber)?.int32Value ?? 0
                let mb = (res["freed_mb"] as? NSNumber)?.floatValue ?? 0.0
                self.oscClient.send(message: OSCMessage(address: "/sisyfuz/storage/clean_result", arguments: [.int32(Int32(count)), .float32(mb)]))
            }
            // Trigger file sorter status refresh
            self.fileSorterBridge.pollStatus()
            let toastJs = "window.showHudToast && window.showHudToast('CLEANUP PURGED TO TRASH');"
            self.webView?.evaluateJavaScript(toastJs, completionHandler: nil)
            self.updateMenuState()
        }
    }

    func triggerUndo() {
        fileSorterBridge.triggerUndo { [weak self] success, msg in
            guard let self = self else { return }
            self.fileSorterBridge.pollStatus()
            let toastJs = "window.showHudToast && window.showHudToast('UNDO COMPLETE');"
            self.webView?.evaluateJavaScript(toastJs, completionHandler: nil)
            self.updateMenuState()
        }
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
        oscClient.send(message: OSCMessage(address: "/sisyfuz/telemetry/transactions/count", arguments: [.int32(Int32(b.recentTransactions.count))]))
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
            "transactions_count": b.recentTransactions.count,
            "sorter_online": b.isOnline
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
            updateMenuState()
            menu.popUp(positioning: nil, at: NSPoint(x: 0, y: 0), in: sender)
        } else {
            toggleChatHUD()
        }
    }

    // MARK: - Brutalist Menu Helpers
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
        let sep = NSMenuItem(title: "+------------------------------------+", action: nil, keyEquivalent: "")
        sep.isEnabled = false
        let font = NSFont(name: "Space Mono", size: 10) ?? NSFont.monospacedSystemFont(ofSize: 10, weight: .regular)
        sep.attributedTitle = NSAttributedString(
            string: "+------------------------------------+",
            attributes: [.font: font, .foregroundColor: NSColor(white: 0.35, alpha: 1.0)]
        )
        return sep
    }

    // MARK: - Menu Construction (Brutalist ASCII TUI)
    func buildMenu() {
        menu = NSMenu()
        menu.autoenablesItems = false

        // Header
        let header = makeBrutalistMenuItem(
            title: "+--[ > SISYFUZ // STUDIO ENGINE ]--+",
            color: NSColor(red: 1.0, green: 0.0, blue: 0.5, alpha: 1.0), // #FF0080
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

        // Start / Stop Action (Tag 103)
        let toggleTitle = isBroadcasting ? "[■ STOP_BROADCAST]" : "[▶ START_BROADCAST]"
        let toggleColor = isBroadcasting ? NSColor(red: 1.0, green: 0.25, blue: 0.25, alpha: 1.0) : NSColor(red: 0.0, green: 0.9, blue: 1.0, alpha: 1.0)
        let toggleItem = makeBrutalistMenuItem(
            title: toggleTitle,
            action: #selector(toggleBroadcast),
            key: "s",
            tag: 103,
            color: toggleColor,
            isHeader: true
        )
        menu.addItem(toggleItem)

        // Chat HUD Action
        let chatItem = makeBrutalistMenuItem(
            title: "[TOGGLE_STUDIO_HUD] (⌘K)",
            action: #selector(toggleChatHUD),
            key: "k",
            color: .white
        )
        menu.addItem(chatItem)

        // Stream Links
        let copyLinkItem = makeBrutalistMenuItem(
            title: "[COPY_STREAM_URL]   (⌘C)",
            action: #selector(copyStreamUrl),
            key: "c",
            color: NSColor(white: 0.9, alpha: 1.0)
        )
        menu.addItem(copyLinkItem)

        let openWebItem = makeBrutalistMenuItem(
            title: "[OPEN_IN_BROWSER]   (⌘O)",
            action: #selector(openWebStream),
            key: "o",
            color: NSColor(white: 0.9, alpha: 1.0)
        )
        menu.addItem(openWebItem)

        menu.addItem(makeAsciiSeparator())

        // --- SECTION: MODE SYNCHRONIZATION ---
        let modeHeader = makeBrutalistMenuItem(
            title: "+--[ > MODE SYNCHRONIZATION ]--+",
            color: NSColor(red: 0.0, green: 0.9, blue: 1.0, alpha: 1.0), // Cyan
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

        // --- SECTION: STORAGE GUARDIAN ---
        let storageHeader = makeBrutalistMenuItem(
            title: "+--[ > STORAGE GUARDIAN ]--+",
            color: NSColor(red: 0.0, green: 1.0, blue: 0.4, alpha: 1.0), // Neon Green
            isHeader: true
        )
        storageHeader.isEnabled = false
        menu.addItem(storageHeader)

        // Disk stats item (Tag 301)
        let diskItem = makeBrutalistMenuItem(title: "DISK:    [--% // -- GB FREE]", tag: 301, color: NSColor(white: 0.85, alpha: 1.0))
        diskItem.isEnabled = false
        menu.addItem(diskItem)

        // Frontmost App item (Tag 302)
        let appItem = makeBrutalistMenuItem(title: "APP:     [Finder]", tag: 302, color: NSColor(white: 0.7, alpha: 1.0))
        appItem.isEnabled = false
        menu.addItem(appItem)

        // TD Recorder state (Tag 303)
        let recItem = makeBrutalistMenuItem(title: "TD REC:  [○ IDLE]", tag: 303, color: NSColor(white: 0.7, alpha: 1.0))
        recItem.isEnabled = false
        menu.addItem(recItem)

        // Actions
        menu.addItem(makeBrutalistMenuItem(title: "[▶ TRIGGER_FILE_SORT]", action: #selector(menuTriggerSort), color: NSColor(white: 0.9, alpha: 1.0)))
        menu.addItem(makeBrutalistMenuItem(title: "[⌕ SCAN_EPHEMERAL_FILES]", action: #selector(menuTriggerScan), color: NSColor(white: 0.9, alpha: 1.0)))
        menu.addItem(makeBrutalistMenuItem(title: "[⌫ PURGE_SAFE_TRASH]", action: #selector(menuTriggerClean), color: NSColor(red: 1.0, green: 0.7, blue: 0.0, alpha: 1.0)))
        menu.addItem(makeBrutalistMenuItem(title: "[↺ UNDO_LAST_OPERATION]", action: #selector(menuTriggerUndo), color: NSColor(white: 0.75, alpha: 1.0)))

        menu.addItem(makeAsciiSeparator())

        // --- SECTION: BRIDGES STATUS ---
        let bridgeHeader = makeBrutalistMenuItem(
            title: "+--[ > BRIDGES & TELEMETRY ]--+",
            color: NSColor(white: 0.6, alpha: 1.0),
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

        let sorterItem = makeBrutalistMenuItem(title: "SORTER:  [127.0.0.1:7479 // OFFLINE]", tag: 403, color: NSColor(red: 1.0, green: 0.7, blue: 0.0, alpha: 1.0))
        sorterItem.isEnabled = false
        menu.addItem(sorterItem)

        menu.addItem(makeAsciiSeparator())

        // Quick App Launchers
        menu.addItem(makeBrutalistMenuItem(title: "[LAUNCH_OBS_STUDIO]", action: #selector(openOBS), color: NSColor(white: 0.75, alpha: 1.0)))
        menu.addItem(makeBrutalistMenuItem(title: "[LAUNCH_TOUCHDESIGNER]", action: #selector(openTouchDesigner), color: NSColor(white: 0.75, alpha: 1.0)))

        menu.addItem(makeAsciiSeparator())

        // Quit
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

    @objc func menuTriggerSort() {
        triggerSort()
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

            // App item (302)
            if let appItem = self.menu.item(withTag: 302) {
                let font = NSFont(name: "Space Mono", size: 11) ?? NSFont.monospacedSystemFont(ofSize: 11, weight: .medium)
                appItem.attributedTitle = NSAttributedString(string: "APP:     [\(b.frontmostApp)]", attributes: [.font: font, .foregroundColor: NSColor(white: 0.7, alpha: 1.0)])
            }

            // TD Rec item (303)
            if let recItem = self.menu.item(withTag: 303) {
                let title = self.isTouchDesignerRecording ? "TD REC:  [● RECORDING]" : "TD REC:  [○ IDLE]"
                let color = self.isTouchDesignerRecording ? NSColor(red: 1.0, green: 0.0, blue: 0.5, alpha: 1.0) : NSColor(white: 0.7, alpha: 1.0)
                let font = NSFont(name: "Space Mono", size: 11) ?? NSFont.monospacedSystemFont(ofSize: 11, weight: self.isTouchDesignerRecording ? .bold : .medium)
                recItem.attributedTitle = NSAttributedString(string: title, attributes: [.font: font, .foregroundColor: color])
            }

            // Sorter status (403)
            if let sorterItem = self.menu.item(withTag: 403) {
                let title = b.isOnline ? "SORTER:  [127.0.0.1:7479 // ONLINE]" : "SORTER:  [127.0.0.1:7479 // OFFLINE]"
                let color = b.isOnline ? NSColor(red: 0.0, green: 1.0, blue: 0.4, alpha: 1.0) : NSColor(red: 1.0, green: 0.7, blue: 0.0, alpha: 1.0)
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
                "sorterOnline": b.isOnline,
                "frontmostApp": b.frontmostApp,
                "diskPercent": b.diskPercent,
                "diskUsedGB": b.diskUsedGB,
                "diskFreeGB": b.diskFreeGB,
                "diskTotalGB": b.diskTotalGB,
                "oscInPort": 7000,
                "oscOutPort": 7001
            ]
            if let scanRes = b.latestScanResult {
                stateObj["scanResult"] = scanRes
            }
            if let cleanRes = b.latestCleanResult {
                stateObj["cleanResult"] = cleanRes
            }

            if let jsonData = try? JSONSerialization.data(withJSONObject: stateObj),
               let jsonStr = String(data: jsonData, encoding: .utf8) {
                self.webView?.evaluateJavaScript("window.onCompanionStateUpdate && window.onCompanionStateUpdate(\(jsonStr));", completionHandler: nil)
            }
        }
    }

    // MARK: - Chat HUD Floating Window
    func setupChatHUD() {
        let width: CGFloat = 420
        let height: CGFloat = 660

        let panel = BrutalistHUDPanel(
            contentRect: NSRect(x: 100, y: 100, width: width, height: height),
            styleMask: [.titled, .closable, .resizable, .utilityWindow, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )

        panel.title = "SISYFUZ // LIVE CHAT & TELEMETRY HUD"
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
        contentController.add(self, name: "companion")
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
            case "triggerSort":
                self.triggerSort()
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

        wsPingTimer?.invalidate()
        wsPingTimer = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil

        guard let wsUrl = URL(string: "ws://127.0.0.1:9988/ws") else {
            isConnectingWS = false
            return
        }

        let session = URLSession(configuration: .default)
        let task = session.webSocketTask(with: wsUrl)
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
                self.triggerSort()
            } else if act == "scan" {
                self.triggerScan()
            } else if act == "clean" {
                let cat = json["category"] as? String ?? "all"
                self.triggerClean(category: cat)
            } else if act == "undo" {
                self.triggerUndo()
            }
        }
    }

    func handleWebSocketDisconnect() {
        wsPingTimer?.invalidate()
        wsPingTimer = nil
        webSocketTask = nil
        isConnectingWS = false

        if broadcastProcess == nil && isBroadcasting {
            isBroadcasting = false
            currentViewers = 0
            updateMenuState()
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak self] in
            self?.connectWebSocket()
        }
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
        proc.standardOutput = pipe
        proc.standardError = pipe

        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if let str = String(data: data, encoding: .utf8) {
                if str.contains("trycloudflare.com") {
                    let pattern = "https://[a-zA-Z0-9\\-]+\\.trycloudflare\\.com"
                    if let regex = try? NSRegularExpression(pattern: pattern),
                       let match = regex.firstMatch(in: str, range: NSRange(str.startIndex..., in: str)) {
                        let range = Range(match.range, in: str)!
                        self?.currentLiveUrl = String(str[range])
                    }
                    self?.isBroadcasting = true
                    self?.updateMenuState()
                }
            }
        }

        proc.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
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
        }
    }

    func stopBroadcast() {
        if let url = URL(string: "http://127.0.0.1:9988/api/broadcast/stop") {
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            URLSession.shared.dataTask(with: req).resume()
        }

        if let proc = broadcastProcess, proc.isRunning {
            proc.interrupt()
        }

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

    @objc func quitApp() {
        stopBroadcast()
        oscServer?.stop()
        fileSorterBridge?.stopPolling()
        NSApp.terminate(nil)
    }
}

// MARK: - Main Entry Point
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
