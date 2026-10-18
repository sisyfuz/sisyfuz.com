import AppKit
import WebKit
import Foundation

// MARK: - Sisyfuz Companion Menu Bar Application
class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var statusItem: NSStatusItem!
    var menu: NSMenu!
    var chatWindow: NSPanel?
    var webView: WKWebView?

    // Broadcast child process
    var broadcastProcess: Process?
    var isBroadcasting = false
    var currentLiveUrl: String = ""
    var currentViewers: Int = 0

    // Status polling timer
    var statusTimer: Timer?

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
            button.title = "⚪ SISYFUZ"
            button.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .bold)
        }

        buildMenu()
        setupChatHUD()

        // Start status poller (checks every 2.5s)
        statusTimer = Timer.scheduledTimer(withTimeInterval: 2.5, repeats: true) { [weak self] _ in
            self?.pollBackendStatus()
        }

        // Check if broadcast is already running locally on port 9988
        pollBackendStatus()
    }

    // MARK: - Menu Construction
    func buildMenu() {
        menu = NSMenu()

        // Header
        let headerItem = NSMenuItem(title: "SISYFUZ BROADCAST ENGINE", action: nil, keyEquivalent: "")
        headerItem.isEnabled = false
        menu.addItem(headerItem)

        // Status Item
        let statusTitle = isBroadcasting ? "Status: 🟢 LIVE (60 FPS)" : "Status: ⚪ Idle"
        let statusDisplay = NSMenuItem(title: statusTitle, action: nil, keyEquivalent: "")
        statusDisplay.isEnabled = false
        statusDisplay.tag = 101
        menu.addItem(statusDisplay)

        // Viewers Count Item
        let viewersDisplay = NSMenuItem(title: "Viewers: \(currentViewers)", action: nil, keyEquivalent: "")
        viewersDisplay.isEnabled = false
        viewersDisplay.tag = 102
        menu.addItem(viewersDisplay)

        menu.addItem(NSMenuItem.separator())

        // Start / Stop Action
        let toggleTitle = isBroadcasting ? "Stop Broadcast" : "Start Broadcast"
        let toggleItem = NSMenuItem(title: toggleTitle, action: #selector(toggleBroadcast), keyEquivalent: "s")
        toggleItem.target = self
        toggleItem.tag = 103
        menu.addItem(toggleItem)

        // Chat HUD Action
        let chatItem = NSMenuItem(title: "Open Chat HUD Window...", action: #selector(toggleChatHUD), keyEquivalent: "k")
        chatItem.target = self
        menu.addItem(chatItem)

        menu.addItem(NSMenuItem.separator())

        // Stream Links
        let copyLinkItem = NSMenuItem(title: "Copy Stream URL", action: #selector(copyStreamUrl), keyEquivalent: "c")
        copyLinkItem.target = self
        menu.addItem(copyLinkItem)

        let openWebItem = NSMenuItem(title: "Open Stream in Browser", action: #selector(openWebStream), keyEquivalent: "o")
        openWebItem.target = self
        menu.addItem(openWebItem)

        menu.addItem(NSMenuItem.separator())

        // Quick App Launchers
        let openObsItem = NSMenuItem(title: "Open OBS Studio", action: #selector(openOBS), keyEquivalent: "")
        openObsItem.target = self
        menu.addItem(openObsItem)

        let openTdItem = NSMenuItem(title: "Open TouchDesigner", action: #selector(openTouchDesigner), keyEquivalent: "")
        openTdItem.target = self
        menu.addItem(openTdItem)

        menu.addItem(NSMenuItem.separator())

        // Quit
        let quitItem = NSMenuItem(title: "Quit Companion App", action: #selector(quitApp), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem.menu = menu
    }

    func updateMenuState() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            if let button = self.statusItem.button {
                if self.isBroadcasting {
                    button.title = "🟢 SISYFUZ [LIVE • \(self.currentViewers)]"
                } else {
                    button.title = "⚪ SISYFUZ [IDLE]"
                }
            }

            if let statusItem = self.menu.item(withTag: 101) {
                statusItem.title = self.isBroadcasting ? "Status: 🟢 LIVE (60 FPS)" : "Status: ⚪ Idle"
            }

            if let viewersItem = self.menu.item(withTag: 102) {
                viewersItem.title = "Viewers: \(self.currentViewers)"
            }

            if let toggleItem = self.menu.item(withTag: 103) {
                toggleItem.title = self.isBroadcasting ? "Stop Broadcast" : "Start Broadcast"
            }
        }
    }

    // MARK: - Chat HUD Floating Window
    func setupChatHUD() {
        let width: CGFloat = 360
        let height: CGFloat = 500

        // Create sleek floating NSPanel
        let panel = NSPanel(
            contentRect: NSRect(x: 100, y: 100, width: width, height: height),
            styleMask: [.titled, .closable, .resizable, .utilityWindow, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )

        panel.title = "SISYFUZ // LIVE CHAT HUD"
        panel.isFloatingPanel = true
        panel.level = .floating // Stays on top of OBS and TouchDesigner
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.backgroundColor = NSColor(red: 0.05, green: 0.05, blue: 0.07, alpha: 0.98)
        panel.isMovableByWindowBackground = true
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.center()

        let config = WKWebViewConfiguration()
        let wv = WKWebView(frame: panel.contentView?.bounds ?? .zero, configuration: config)
        wv.autoresizingMask = [.width, .height]
        wv.setValue(false, forKey: "drawsBackground")

        let htmlPath = "\(projectDir)/scripts/companion/ChatHUD.html"
        let htmlUrl = URL(fileURLWithPath: htmlPath)
        wv.loadFileURL(htmlUrl, allowingReadAccessTo: URL(fileURLWithPath: "\(projectDir)/scripts/companion"))

        panel.contentView?.addSubview(wv)
        self.chatWindow = panel
        self.webView = wv
    }

    @objc func toggleChatHUD() {
        guard let window = chatWindow else { return }
        if window.isVisible {
            window.orderOut(nil)
        } else {
            // Reload page on show to re-sync
            if let htmlUrl = URL(string: "file://\(projectDir)/scripts/companion/ChatHUD.html") {
                webView?.loadFileURL(htmlUrl, allowingReadAccessTo: URL(fileURLWithPath: "\(projectDir)/scripts/companion"))
            }
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
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
    }

    // MARK: - Backend Polling
    func pollBackendStatus() {
        guard let url = URL(string: "http://127.0.0.1:9988/api/status") else { return }

        let task = URLSession.shared.dataTask(with: url) { [weak self] data, response, error in
            guard let self = self else { return }
            guard let data = data, error == nil else {
                if self.broadcastProcess == nil && self.isBroadcasting {
                    self.isBroadcasting = false
                    self.updateMenuState()
                }
                return
            }

            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                let active = (json["active"] as? Bool) ?? false
                let viewers = (json["viewers"] as? Int) ?? 0
                let liveUrl = (json["url"] as? String) ?? ""

                self.isBroadcasting = active
                self.currentViewers = viewers
                if !liveUrl.isEmpty {
                    self.currentLiveUrl = liveUrl
                }
                self.updateMenuState()
            }
        }
        task.resume()
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
