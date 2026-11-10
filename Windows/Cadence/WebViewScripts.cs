using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;

namespace Cadence.Windows;

static class WebViewScripts
{
    // Runs a script in the page and returns its value as JSON, like WKWebView.evaluateJavaScript.
    // Uses the DevTools protocol so promises can be awaited (callAsyncJavaScript on the Mac),
    // which ExecuteScriptAsync cannot do. Returns ok=false if the script threw or the page went away.
    public static async Task<(bool ok, JsonNode? value)> Evaluate(CoreWebView2? view, string expression, bool awaitPromise = false)
    {
        if (view == null) return (false, null);
        var args = new JsonObject { ["expression"] = expression, ["returnByValue"] = true, ["awaitPromise"] = awaitPromise, ["userGesture"] = true };
        try
        {
            var raw = await view.CallDevToolsProtocolMethodAsync("Runtime.evaluate", args.ToJsonString());
            var result = JsonNode.Parse(raw);
            if (result?["exceptionDetails"] != null) return (false, null);
            return (true, result?["result"]?["value"]?.DeepClone());
        }
        catch { return (false, null); }
    }

    // Equivalent of callAsyncJavaScript(body, arguments: ["request": request]): the body may use
    // `request`, top-level `await` and `return`.
    public static Task<(bool ok, JsonNode? value)> CallAsync(CoreWebView2? view, string body, JsonNode request) =>
        Evaluate(view, "(async function(request){\n" + body + "\n})(" + request.ToJsonString() + ")", awaitPromise: true);

    public static string Literal(string value) => JsonSerializer.Serialize(value);

    // Injected into the Cadence interface before its own scripts. app.js talks to the Mac host through
    // window.webkit.messageHandlers.cadence; this routes the same calls to WebView2's message channel,
    // so the shared interface files need no Windows-specific edits.
    public const string ShellBootstrap = """
        (() => {
          if (location.origin !== 'https://cadence.example') return;
          const postMessage = message => window.chrome?.webview?.postMessage(message);
          Object.defineProperty(window, 'webkit', { value: Object.freeze({ messageHandlers: Object.freeze({ cadence: Object.freeze({ postMessage }) }) }) });
          // A few interface sentences name Mac storage; say what Windows uses instead.
          const swaps = [
            ['Your session is stored by macOS WebKit.', 'Your session is stored by Cadence’s Microsoft Edge engine.'],
            ['Your token stays in macOS Keychain.', 'Your token stays in Windows Credential Manager.'],
            ['keeps queued listens on this Mac', 'keeps queued listens on this PC'],
            ['On this Mac', 'On this PC'],
          ];
          addEventListener('DOMContentLoaded', () => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode())
              for (const [mac, windows] of swaps) if (node.nodeValue.includes(mac)) node.nodeValue = node.nodeValue.replace(mac, windows);
          }, { once: true });
        })();
        """;
}
