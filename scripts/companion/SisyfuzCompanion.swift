import AppKit
import WebKit
import Foundation

// MARK: - Brutalist HUD Panel (Custom NSPanel with key input support)
class BrutalistHUDPanel: NSPanel {
    override var canBecomeKey: Bool {
        return true
    }
    override var canBecomeMain: Bool {
        return true
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
        // Fallback to known directory
        return "/Users/dorusk/RiderProjects/sisyfuz.com"
    }()

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Run as menu bar accessory (no dock icon)
        NSApp.setActivationPolicy(.accessory)

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

        // Event-driven real-time push connection to broadcast hub (replaces polling)
        connectWebSocket()

        // Auto-open brutalist studio HUD on launch
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
            self?.showChatHUD()
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
            // Direct left-click toggles the brutalist Studio HUD directly beneath menu item
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

        menu.addItem(makeAsciiSeparator())

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

        // Quick App Launchers
        let openObsItem = makeBrutalistMenuItem(
            title: "[LAUNCH_OBS_STUDIO]",
            action: #selector(openOBS),
            color: NSColor(white: 0.75, alpha: 1.0)
        )
        menu.addItem(openObsItem)

        let openTdItem = makeBrutalistMenuItem(
            title: "[LAUNCH_TOUCHDESIGNER]",
            action: #selector(openTouchDesigner),
            color: NSColor(white: 0.75, alpha: 1.0)
        )
        menu.addItem(openTdItem)

        menu.addItem(makeAsciiSeparator())

        // Quit
        let quitItem = makeBrutalistMenuItem(
            title: "[QUIT_COMPANION]    (⌘Q)",
            action: #selector(quitApp),
            key: "q",
            color: NSColor(red: 1.0, green: 0.3, blue: 0.35, alpha: 1.0)
        )
        menu.addItem(quitItem)
    }

    func updateMenuState() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            let viewersStr = String(format: "%02d", self.currentViewers)

            if let button = self.statusItem.button {
                if self.isBroadcasting {
                    button.title = "● SISYFUZ [LIVE • \(viewersStr)]"
                } else {
                    button.title = "○ SISYFUZ [IDLE]"
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

            // Sync state with ChatHUD WebKit view
            let stateObj: [String: Any] = [
                "isBroadcasting": self.isBroadcasting,
                "viewers": self.currentViewers,
                "url": self.currentLiveUrl
            ]
            if let jsonData = try? JSONSerialization.data(withJSONObject: stateObj),
               let jsonStr = String(data: jsonData, encoding: .utf8) {
                self.webView?.evaluateJavaScript("window.onCompanionStateUpdate && window.onCompanionStateUpdate(\(jsonStr));", completionHandler: nil)
            }
        }
    }

    // MARK: - Chat HUD Floating Window
    func setupChatHUD() {
        let width: CGFloat = 400
        let height: CGFloat = 580

        // Create sleek floating NSPanel with custom brutalist styling
        let panel = BrutalistHUDPanel(
            contentRect: NSRect(x: 100, y: 100, width: width, height: height),
            styleMask: [.titled, .closable, .resizable, .utilityWindow, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )

        panel.title = "SISYFUZ // LIVE CHAT HUD"
        panel.isFloatingPanel = true
        panel.level = .floating // Stays on top of OBS and TouchDesigner
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

    // NSWindowDelegate: Keep CPU at near 0.0% when hidden/minimized
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
            default:
                break
            }
        }
    }

    // MARK: - Event-Driven WebSocket Client (Zero-CPU Idle)
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

        // Send host authentication to subscribe to real-time status & stats push
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
        // 15-second heartbeat ping to cleanly detect server shutdown without executing subshells or lsof
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

        // Lightweight reconnect backoff (every 3 seconds)
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

        // Locate node executable
        let nodePath = FileManager.default.fileExists(atPath: "/opt/homebrew/bin/node")
            ? "/opt/homebrew/bin/node"
            : (FileManager.default.fileExists(atPath: "/usr/local/bin/node") ? "/usr/local/bin/node" : "/usr/bin/node")

        proc.executableURL = URL(fileURLWithPath: nodePath)
        proc.arguments = ["scripts/broadcast.js"]

        // Setup environment
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
            // Connect WebSocket to new broadcast instance
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
                self?.connectWebSocket()
            }
        } catch {
            print("Failed to run broadcast.js: \(error)")
        }
    }

    func stopBroadcast() {
        // Send stop command via local HTTP API
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
        NSApp.terminate(nil)
    }
}

// MARK: - Main Entry Point
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
