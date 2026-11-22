// Headless WebKit runner for development (same engine as Safari).
//
//   swift dev/tools/webkit-run.swift <file.html?query> [--png out.png] [--width 1440] [--height 900]
//         [--wait "js expr returning bool"] [--eval "js expr returning string"] [--full] [--timeout 15]
//         [--visible]
//
// --visible puts the window on screen (nearly transparent, above other
// windows) so WebKit gets a display link: CSS transitions and animations
// then run in real time, as in Safari. Offscreen (the default), WebKit
// freezes them at their first frame, which is why screenshots use ?noanim=1.
//
// Loads a local page, forwards console output to stdout, waits until --wait is
// truthy (--timeout, default 15 s), prints the result of --eval, and optionally saves a
// screenshot. Used to smoke-test and screenshot dev/preview without Safari.

import Cocoa
import WebKit

var args = Array(CommandLine.arguments.dropFirst())
func opt(_ name: String) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    let v = args[i + 1]; args.removeSubrange(i...(i + 1)); return v
}
let fullPage = args.contains("--full"); args.removeAll { $0 == "--full" }
let visible = args.contains("--visible"); args.removeAll { $0 == "--visible" }
let pngPath = opt("--png")
let width = Double(opt("--width") ?? "1440")!
let height = Double(opt("--height") ?? "900")!
let waitExpr = opt("--wait") ?? "document.readyState === 'complete'"
let evalExpr = opt("--eval")
let timeoutSec = Double(opt("--timeout") ?? "15")!
guard let target = args.first else { print("usage: webkit-run <file.html?query> …"); exit(2) }

// A local file (default) or an http(s) URL (e.g. the preview served on
// localhost, for features that need a real origin such as BroadcastChannel).
let isHTTP = target.hasPrefix("http://") || target.hasPrefix("https://")
let parts = target.split(separator: "?", maxSplits: 1).map(String.init)
let fileURL = URL(fileURLWithPath: parts[0]).standardizedFileURL
var comps = URLComponents(url: fileURL, resolvingAgainstBaseURL: false)!
if parts.count > 1 { comps.percentEncodedQuery = parts[1] }
let pageURL = isHTTP ? URL(string: target)! : comps.url!
let rootDir = fileURL.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

final class ConsoleBridge: NSObject, WKScriptMessageHandler {
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        print("[console] \(m.body)")
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

let config = WKWebViewConfiguration()
let bridge = ConsoleBridge()
config.userContentController.add(bridge, name: "console")
config.userContentController.addUserScript(WKUserScript(source: """
  (() => {
    const send = (level, args) => { try { window.webkit.messageHandlers.console.postMessage(level + ': ' + args.map(a => {
      if (a instanceof Error) return a.stack || String(a);
      if (typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
      return String(a); }).join(' ')); } catch {} };
    for (const level of ['log', 'info', 'warn', 'error']) {
      const orig = console[level].bind(console);
      console[level] = (...a) => { send(level, a); orig(...a); };
    }
    window.addEventListener('error', e => send('uncaught', [e.message + ' @ ' + e.filename + ':' + e.lineno]));
    window.addEventListener('unhandledrejection', e => send('unhandled', [e.reason]));
  })();
""", injectionTime: .atDocumentStart, forMainFrameOnly: true))

let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height), configuration: config)
let window = NSWindow(contentRect: webView.frame, styleMask: [.borderless], backing: .buffered, defer: false)
window.contentView = webView
if visible {
    window.setFrameOrigin(NSPoint(x: 0, y: 0))
    window.alphaValue = 0.02
    window.level = .floating
    window.ignoresMouseEvents = true
    window.orderFrontRegardless()
} else {
    window.setFrameOrigin(NSPoint(x: -20000, y: -20000))
    window.orderBack(nil)
}
if isHTTP { webView.load(URLRequest(url: pageURL)) } else { webView.loadFileURL(pageURL, allowingReadAccessTo: rootDir) }

func evalJS(_ js: String, _ done: @escaping (Any?) -> Void) {
    webView.evaluateJavaScript(js) { result, error in
        if let error = error { print("[eval error] \(error)"); done(nil) } else { done(result) }
    }
}

let deadline = Date().addingTimeInterval(timeoutSec)
func finish() {
    let afterEval = {
        guard let png = pngPath else { exit(0) }
        let snap = {
            webView.takeSnapshot(with: nil) { image, error in
                guard let image = image, let tiff = image.tiffRepresentation,
                      let rep = NSBitmapImageRep(data: tiff),
                      let data = rep.representation(using: .png, properties: [:]) else {
                    print("[snapshot error] \(String(describing: error))"); exit(1)
                }
                try! data.write(to: URL(fileURLWithPath: png))
                print("[snapshot] \(png) \(Int(webView.frame.width))x\(Int(webView.frame.height))")
                exit(0)
            }
        }
        if fullPage {
            evalJS("Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)") { h in
                let hh = (h as? Double) ?? height
                window.setContentSize(NSSize(width: width, height: hh))
                webView.frame = NSRect(x: 0, y: 0, width: width, height: hh)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: snap)
            }
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: snap)
        }
    }
    if let e = evalExpr {
        evalJS(e) { r in print("[eval] \(r.map { "\($0)" } ?? "nil")"); afterEval() }
    } else { afterEval() }
}

func poll() {
    evalJS("(() => { try { return !!(\(waitExpr)); } catch (e) { return false; } })()") { r in
        if (r as? Bool) == true { finish() }
        else if Date() > deadline { print("[timeout] wait condition never became true"); finish() }
        else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.1, execute: poll) }
    }
}
DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: poll)
app.run()
