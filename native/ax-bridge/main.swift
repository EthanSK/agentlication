import Cocoa
import ApplicationServices

// MARK: - JSON Output Helpers

func jsonString(_ dict: [String: Any]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
          let str = String(data: data, encoding: .utf8) else {
        return "{\"error\": \"Failed to serialize JSON\"}"
    }
    return str
}

func jsonStringPretty(_ dict: [String: Any]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: dict, options: .prettyPrinted),
          let str = String(data: data, encoding: .utf8) else {
        return "{\"error\": \"Failed to serialize JSON\"}"
    }
    return str
}

func outputSuccess(_ data: [String: Any] = [:]) {
    var result: [String: Any] = ["success": true]
    for (k, v) in data { result[k] = v }
    print(jsonString(result))
}

func outputError(_ message: String) {
    print(jsonString(["success": false, "error": message]))
}

func outputJSON(_ data: Any) {
    guard let jsonData = try? JSONSerialization.data(withJSONObject: data, options: []),
          let str = String(data: jsonData, encoding: .utf8) else {
        outputError("Failed to serialize JSON")
        return
    }
    print(str)
}

// MARK: - App Finding

func findApp(named name: String) -> NSRunningApplication? {
    let workspace = NSWorkspace.shared
    let apps = workspace.runningApplications

    // Try exact match first
    if let app = apps.first(where: { $0.localizedName == name }) {
        return app
    }

    // Try case-insensitive match
    if let app = apps.first(where: { ($0.localizedName ?? "").lowercased() == name.lowercased() }) {
        return app
    }

    // Try partial match (contains)
    if let app = apps.first(where: { ($0.localizedName ?? "").lowercased().contains(name.lowercased()) }) {
        return app
    }

    return nil
}

// MARK: - AX Element Helpers

func getAXAttribute(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard result == .success else { return nil }
    return value
}

func getAXStringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
    guard let value = getAXAttribute(element, attribute) else { return nil }
    return value as? String
}

func getAXBoolAttribute(_ element: AXUIElement, _ attribute: String) -> Bool? {
    guard let value = getAXAttribute(element, attribute) else { return nil }
    if let num = value as? NSNumber { return num.boolValue }
    return nil
}

func getAXPosition(_ element: AXUIElement) -> (x: Double, y: Double)? {
    guard let value = getAXAttribute(element, kAXPositionAttribute) else { return nil }
    var point = CGPoint.zero
    if AXValueGetValue(value as! AXValue, .cgPoint, &point) {
        return (x: Double(point.x), y: Double(point.y))
    }
    return nil
}

func getAXSize(_ element: AXUIElement) -> (width: Double, height: Double)? {
    guard let value = getAXAttribute(element, kAXSizeAttribute) else { return nil }
    var size = CGSize.zero
    if AXValueGetValue(value as! AXValue, .cgSize, &size) {
        return (width: Double(size.width), height: Double(size.height))
    }
    return nil
}

func getAXActions(_ element: AXUIElement) -> [String] {
    var actionNames: CFArray?
    let result = AXUIElementCopyActionNames(element, &actionNames)
    guard result == .success, let names = actionNames as? [String] else { return [] }
    return names
}

func getAXChildren(_ element: AXUIElement) -> [AXUIElement] {
    guard let children = getAXAttribute(element, kAXChildrenAttribute) as? [AXUIElement] else {
        return []
    }
    return children
}

// MARK: - Tree Building

func elementToDict(_ element: AXUIElement, depth: Int, maxDepth: Int) -> [String: Any] {
    let role = getAXStringAttribute(element, kAXRoleAttribute) ?? "unknown"
    let title = getAXStringAttribute(element, kAXTitleAttribute) ?? ""
    let description = getAXStringAttribute(element, kAXDescriptionAttribute) ?? ""
    let value = getAXStringAttribute(element, kAXValueAttribute)
    let identifier = getAXStringAttribute(element, kAXIdentifierAttribute)
    let enabled = getAXBoolAttribute(element, kAXEnabledAttribute) ?? true
    let focused = getAXBoolAttribute(element, kAXFocusedAttribute) ?? false
    let actions = getAXActions(element)

    // Use title, description, or value for the "name" field
    let name = !title.isEmpty ? title : (!description.isEmpty ? description : "")

    var dict: [String: Any] = [
        "role": role,
        "name": name,
        "enabled": enabled,
        "actions": actions,
    ]

    if !description.isEmpty && description != name {
        dict["description"] = description
    }
    if let value = value, !value.isEmpty {
        // Truncate very long values
        dict["value"] = value.count > 200 ? String(value.prefix(200)) + "..." : value
    }
    if let identifier = identifier, !identifier.isEmpty {
        dict["identifier"] = identifier
    }
    if focused {
        dict["focused"] = true
    }

    if let pos = getAXPosition(element) {
        dict["position"] = ["x": Int(pos.x), "y": Int(pos.y)]
    }
    if let size = getAXSize(element) {
        dict["size"] = ["width": Int(size.width), "height": Int(size.height)]
    }

    // Recurse into children if within depth limit
    if depth < maxDepth {
        let children = getAXChildren(element)
        if !children.isEmpty {
            dict["children"] = children.map { elementToDict($0, depth: depth + 1, maxDepth: maxDepth) }
        }
    }

    return dict
}

// MARK: - Element Search

/// Find an element by label (name or description), searching recursively.
func findElementByLabel(_ element: AXUIElement, label: String, maxDepth: Int = 15, currentDepth: Int = 0) -> AXUIElement? {
    if currentDepth > maxDepth { return nil }

    let title = getAXStringAttribute(element, kAXTitleAttribute) ?? ""
    let description = getAXStringAttribute(element, kAXDescriptionAttribute) ?? ""
    let role = getAXStringAttribute(element, kAXRoleAttribute) ?? ""
    let value = getAXStringAttribute(element, kAXValueAttribute) ?? ""

    let elementName = !title.isEmpty ? title : description

    // Check exact match
    if elementName.lowercased() == label.lowercased() {
        return element
    }

    // Check contains match
    if !label.isEmpty && elementName.lowercased().contains(label.lowercased()) {
        return element
    }

    // Also check value for text fields
    if !label.isEmpty && role.contains("TextField") && value.lowercased().contains(label.lowercased()) {
        return element
    }

    // Recurse into children
    let children = getAXChildren(element)
    for child in children {
        if let found = findElementByLabel(child, label: label, maxDepth: maxDepth, currentDepth: currentDepth + 1) {
            return found
        }
    }

    return nil
}

/// Find the first focused text field, or the first text field if none focused.
func findTextField(_ element: AXUIElement, maxDepth: Int = 15, currentDepth: Int = 0) -> AXUIElement? {
    if currentDepth > maxDepth { return nil }

    let role = getAXStringAttribute(element, kAXRoleAttribute) ?? ""
    let focused = getAXBoolAttribute(element, kAXFocusedAttribute) ?? false

    if (role == "AXTextField" || role == "AXTextArea" || role == "AXComboBox" || role == "AXSearchField") && focused {
        return element
    }

    let children = getAXChildren(element)
    for child in children {
        if let found = findTextField(child, maxDepth: maxDepth, currentDepth: currentDepth + 1) {
            return found
        }
    }

    return nil
}

/// Find the first text field (focused or not).
func findAnyTextField(_ element: AXUIElement, maxDepth: Int = 15, currentDepth: Int = 0) -> AXUIElement? {
    if currentDepth > maxDepth { return nil }

    let role = getAXStringAttribute(element, kAXRoleAttribute) ?? ""

    if role == "AXTextField" || role == "AXTextArea" || role == "AXComboBox" || role == "AXSearchField" {
        return element
    }

    let children = getAXChildren(element)
    for child in children {
        if let found = findAnyTextField(child, maxDepth: maxDepth, currentDepth: currentDepth + 1) {
            return found
        }
    }

    return nil
}

/// Collect all interactive elements from the tree.
func collectInteractiveElements(_ element: AXUIElement, maxDepth: Int = 10, currentDepth: Int = 0, results: inout [[String: Any]], index: inout Int) {
    if currentDepth > maxDepth { return }

    let role = getAXStringAttribute(element, kAXRoleAttribute) ?? ""
    let title = getAXStringAttribute(element, kAXTitleAttribute) ?? ""
    let description = getAXStringAttribute(element, kAXDescriptionAttribute) ?? ""
    let value = getAXStringAttribute(element, kAXValueAttribute)
    let enabled = getAXBoolAttribute(element, kAXEnabledAttribute) ?? true
    let actions = getAXActions(element)
    let name = !title.isEmpty ? title : description

    // Include elements that have actions (interactive) or are text fields
    let interactiveRoles = ["AXButton", "AXCheckBox", "AXRadioButton", "AXMenuItem",
                            "AXMenuBarItem", "AXTextField", "AXTextArea", "AXComboBox",
                            "AXSearchField", "AXSlider", "AXPopUpButton", "AXTabGroup",
                            "AXTab", "AXLink", "AXDisclosureTriangle", "AXIncrementor"]

    let isInteractive = interactiveRoles.contains(role) ||
                        actions.contains("AXPress") ||
                        actions.contains("AXShowMenu")

    if isInteractive {
        var elem: [String: Any] = [
            "index": index,
            "role": role,
            "name": name,
            "enabled": enabled,
            "actions": actions,
        ]

        if let value = value, !value.isEmpty {
            elem["value"] = value.count > 100 ? String(value.prefix(100)) + "..." : value
        }
        if !description.isEmpty && description != name {
            elem["description"] = description
        }
        if let pos = getAXPosition(element) {
            elem["position"] = ["x": Int(pos.x), "y": Int(pos.y)]
        }
        if let size = getAXSize(element) {
            elem["size"] = ["width": Int(size.width), "height": Int(size.height)]
        }

        results.append(elem)
        index += 1
    }

    let children = getAXChildren(element)
    for child in children {
        collectInteractiveElements(child, maxDepth: maxDepth, currentDepth: currentDepth + 1, results: &results, index: &index)
    }
}

// MARK: - Keyboard Simulation via CGEvent

func typeTextViaCGEvent(_ text: String) {
    let source = CGEventSource(stateID: .combinedSessionState)

    for char in text {
        let str = String(char)
        let utf16 = Array(str.utf16)

        let keyDown = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)
        keyDown?.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
        keyDown?.post(tap: .cgSessionEventTap)

        let keyUp = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
        keyUp?.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
        keyUp?.post(tap: .cgSessionEventTap)

        usleep(10000) // 10ms between keystrokes
    }
}

// MARK: - Commands

func cmdCheckPermission() {
    let trusted = AXIsProcessTrusted()
    outputSuccess(["granted": trusted])
}

func cmdTree(appName: String, depth: Int) {
    guard let app = findApp(named: appName) else {
        outputError("App not found: \(appName)")
        return
    }

    let pid = app.processIdentifier
    let appElement = AXUIElementCreateApplication(pid)
    let tree = elementToDict(appElement, depth: 0, maxDepth: depth)

    let result: [String: Any] = [
        "success": true,
        "appName": app.localizedName ?? appName,
        "pid": pid,
        "tree": tree,
        "timestamp": Int(Date().timeIntervalSince1970 * 1000)
    ]
    print(jsonString(result))
}

func cmdClick(appName: String, label: String) {
    guard let app = findApp(named: appName) else {
        outputError("App not found: \(appName)")
        return
    }

    let pid = app.processIdentifier
    let appElement = AXUIElementCreateApplication(pid)

    guard let element = findElementByLabel(appElement, label: label) else {
        outputError("Element not found with label: \(label)")
        return
    }

    let actions = getAXActions(element)

    if actions.contains("AXPress") {
        let result = AXUIElementPerformAction(element, "AXPress" as CFString)
        if result == .success {
            let role = getAXStringAttribute(element, kAXRoleAttribute) ?? "unknown"
            let name = getAXStringAttribute(element, kAXTitleAttribute) ?? getAXStringAttribute(element, kAXDescriptionAttribute) ?? ""
            outputSuccess(["clicked": "\(role) \"\(name)\"", "action": "AXPress"])
        } else {
            outputError("AXPress failed with code: \(result.rawValue)")
        }
    } else if actions.contains("AXShowMenu") {
        let result = AXUIElementPerformAction(element, "AXShowMenu" as CFString)
        if result == .success {
            outputSuccess(["clicked": label, "action": "AXShowMenu"])
        } else {
            outputError("AXShowMenu failed with code: \(result.rawValue)")
        }
    } else if let pos = getAXPosition(element), let size = getAXSize(element) {
        // Fallback: click via CGEvent at element center
        let centerX = pos.x + size.width / 2
        let centerY = pos.y + size.height / 2
        let point = CGPoint(x: centerX, y: centerY)

        let source = CGEventSource(stateID: .combinedSessionState)
        let mouseDown = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)
        let mouseUp = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)

        mouseDown?.post(tap: .cgSessionEventTap)
        usleep(50000) // 50ms
        mouseUp?.post(tap: .cgSessionEventTap)

        outputSuccess(["clicked": label, "action": "CGEvent click at (\(Int(centerX)), \(Int(centerY)))"])
    } else {
        outputError("No actionable way to click element: \(label). Available actions: \(actions)")
    }
}

func cmdType(appName: String, text: String) {
    guard let app = findApp(named: appName) else {
        outputError("App not found: \(appName)")
        return
    }

    let pid = app.processIdentifier
    let appElement = AXUIElementCreateApplication(pid)

    // First try to find a focused text field
    if let textField = findTextField(appElement) {
        // Try setting value via AX
        let result = AXUIElementSetAttributeValue(textField, kAXValueAttribute as CFString, text as CFTypeRef)
        if result == .success {
            // Also set focused to ensure the app notices the change
            AXUIElementSetAttributeValue(textField, kAXFocusedAttribute as CFString, true as CFTypeRef)
            outputSuccess(["typed": text, "method": "AXSetValue"])
            return
        }
    }

    // Fallback: use CGEvent keyboard simulation
    // Make sure the app is frontmost
    app.activate()
    usleep(100000) // 100ms for app to activate

    typeTextViaCGEvent(text)
    outputSuccess(["typed": text, "method": "CGEvent"])
}

func cmdFocus(appName: String, label: String) {
    guard let app = findApp(named: appName) else {
        outputError("App not found: \(appName)")
        return
    }

    let pid = app.processIdentifier
    let appElement = AXUIElementCreateApplication(pid)

    guard let element = findElementByLabel(appElement, label: label) else {
        outputError("Element not found with label: \(label)")
        return
    }

    let result = AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, true as CFTypeRef)
    if result == .success {
        outputSuccess(["focused": label])
    } else {
        outputError("Failed to focus element: \(label) (error code: \(result.rawValue))")
    }
}

func cmdActions(appName: String, label: String) {
    guard let app = findApp(named: appName) else {
        outputError("App not found: \(appName)")
        return
    }

    let pid = app.processIdentifier
    let appElement = AXUIElementCreateApplication(pid)

    guard let element = findElementByLabel(appElement, label: label) else {
        outputError("Element not found with label: \(label)")
        return
    }

    let actions = getAXActions(element)
    let role = getAXStringAttribute(element, kAXRoleAttribute) ?? "unknown"
    let name = getAXStringAttribute(element, kAXTitleAttribute) ?? getAXStringAttribute(element, kAXDescriptionAttribute) ?? ""

    outputSuccess([
        "element": "\(role) \"\(name)\"",
        "actions": actions
    ])
}

func cmdElements(appName: String, interactiveOnly: Bool) {
    guard let app = findApp(named: appName) else {
        outputError("App not found: \(appName)")
        return
    }

    let pid = app.processIdentifier
    let appElement = AXUIElementCreateApplication(pid)

    var results: [[String: Any]] = []
    var index = 0

    if interactiveOnly {
        collectInteractiveElements(appElement, results: &results, index: &index)
    } else {
        // For all elements, just return the tree at depth 1
        let children = getAXChildren(appElement)
        for child in children {
            collectInteractiveElements(child, maxDepth: 15, results: &results, index: &index)
        }
    }

    let output: [String: Any] = [
        "success": true,
        "appName": app.localizedName ?? appName,
        "count": results.count,
        "elements": results
    ]
    print(jsonString(output))
}

func cmdSetValue(appName: String, label: String, value: String) {
    guard let app = findApp(named: appName) else {
        outputError("App not found: \(appName)")
        return
    }

    let pid = app.processIdentifier
    let appElement = AXUIElementCreateApplication(pid)

    guard let element = findElementByLabel(appElement, label: label) else {
        outputError("Element not found with label: \(label)")
        return
    }

    let result = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFTypeRef)
    if result == .success {
        outputSuccess(["label": label, "value": value])
    } else {
        outputError("Failed to set value on element: \(label) (error code: \(result.rawValue))")
    }
}

func cmdInfo(appName: String) {
    guard let app = findApp(named: appName) else {
        outputError("App not found: \(appName)")
        return
    }

    let pid = app.processIdentifier
    let appElement = AXUIElementCreateApplication(pid)

    // Get windows
    var windows: [[String: Any]] = []
    if let axWindows = getAXAttribute(appElement, kAXWindowsAttribute) as? [AXUIElement] {
        for win in axWindows {
            var winInfo: [String: Any] = [:]
            winInfo["title"] = getAXStringAttribute(win, kAXTitleAttribute) ?? ""
            if let pos = getAXPosition(win) {
                winInfo["position"] = ["x": Int(pos.x), "y": Int(pos.y)]
            }
            if let size = getAXSize(win) {
                winInfo["size"] = ["width": Int(size.width), "height": Int(size.height)]
            }
            windows.append(winInfo)
        }
    }

    // Get menu bar items
    var menuBarItems: [String] = []
    if let menuBarRef = getAXAttribute(appElement, kAXMenuBarAttribute) {
        // AXUIElement is a CFTypeRef so we force-cast
        let menuBar = menuBarRef as! AXUIElement
        let menuChildren = getAXChildren(menuBar)
        for menuItem in menuChildren {
            if let title = getAXStringAttribute(menuItem, kAXTitleAttribute), !title.isEmpty {
                menuBarItems.append(title)
            }
        }
    }

    let result: [String: Any] = [
        "success": true,
        "name": app.localizedName ?? appName,
        "pid": pid,
        "bundleId": app.bundleIdentifier ?? "",
        "windows": windows,
        "menuBarItems": menuBarItems
    ]
    print(jsonString(result))
}

func cmdPerformAction(appName: String, action: String, label: String) {
    guard let app = findApp(named: appName) else {
        outputError("App not found: \(appName)")
        return
    }

    let pid = app.processIdentifier
    let appElement = AXUIElementCreateApplication(pid)

    guard let element = findElementByLabel(appElement, label: label) else {
        outputError("Element not found with label: \(label)")
        return
    }

    let availableActions = getAXActions(element)
    guard availableActions.contains(action) else {
        outputError("Action '\(action)' not available on element '\(label)'. Available: \(availableActions)")
        return
    }

    let result = AXUIElementPerformAction(element, action as CFString)
    if result == .success {
        outputSuccess(["action": action, "element": label])
    } else {
        outputError("Action '\(action)' failed with code: \(result.rawValue)")
    }
}

// MARK: - Main

let args = CommandLine.arguments

guard args.count >= 2 else {
    outputError("Usage: ax-bridge <command> [args...]. Commands: check-permission, tree, click, type, focus, actions, elements, set-value, info, perform")
    exit(1)
}

let command = args[1]

switch command {
case "check-permission":
    cmdCheckPermission()

case "tree":
    guard args.count >= 3 else {
        outputError("Usage: ax-bridge tree <app-name> [--depth N]")
        exit(1)
    }
    let appName = args[2]
    var depth = 5
    if let depthIdx = args.firstIndex(of: "--depth"), depthIdx + 1 < args.count {
        depth = Int(args[depthIdx + 1]) ?? 5
    }
    cmdTree(appName: appName, depth: depth)

case "click":
    guard args.count >= 4 else {
        outputError("Usage: ax-bridge click <app-name> <label>")
        exit(1)
    }
    let appName = args[2]
    let label = args[3]
    cmdClick(appName: appName, label: label)

case "type":
    guard args.count >= 4 else {
        outputError("Usage: ax-bridge type <app-name> <text>")
        exit(1)
    }
    let appName = args[2]
    let text = args[3]
    cmdType(appName: appName, text: text)

case "focus":
    guard args.count >= 4 else {
        outputError("Usage: ax-bridge focus <app-name> <label>")
        exit(1)
    }
    let appName = args[2]
    let label = args[3]
    cmdFocus(appName: appName, label: label)

case "actions":
    guard args.count >= 4 else {
        outputError("Usage: ax-bridge actions <app-name> <label>")
        exit(1)
    }
    let appName = args[2]
    let label = args[3]
    cmdActions(appName: appName, label: label)

case "elements":
    guard args.count >= 3 else {
        outputError("Usage: ax-bridge elements <app-name> [--interactive]")
        exit(1)
    }
    let appName = args[2]
    let interactive = args.contains("--interactive")
    cmdElements(appName: appName, interactiveOnly: interactive)

case "set-value":
    guard args.count >= 5 else {
        outputError("Usage: ax-bridge set-value <app-name> <label> <value>")
        exit(1)
    }
    let appName = args[2]
    let label = args[3]
    let value = args[4]
    cmdSetValue(appName: appName, label: label, value: value)

case "info":
    guard args.count >= 3 else {
        outputError("Usage: ax-bridge info <app-name>")
        exit(1)
    }
    let appName = args[2]
    cmdInfo(appName: appName)

case "perform":
    guard args.count >= 5 else {
        outputError("Usage: ax-bridge perform <app-name> <action> <label>")
        exit(1)
    }
    let appName = args[2]
    let action = args[3]
    let label = args[4]
    cmdPerformAction(appName: appName, action: action, label: label)

default:
    outputError("Unknown command: \(command). Available: check-permission, tree, click, type, focus, actions, elements, set-value, info, perform")
    exit(1)
}
