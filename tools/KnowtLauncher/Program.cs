using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

internal static class Program
{
    private const string KnowtRoot = @"C:\Users\aditya.deshpande\OneDrive - TTPGroup\Documents\Projects\Knowt";
    private const string KnowtUrl = "http://127.0.0.1:4318";
    private const string DefaultMcpUrl = "http://127.0.0.1:4318/mcp";

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--check")
        {
            return IsKnowtHealthy() ? 0 : 1;
        }
        bool startOnly = args.Length == 1 && args[0] == "--start-only";

        try
        {
            if (!IsKnowtHealthy())
            {
                StartKnowtServer();
                WaitForKnowt();
            }

            StartTunnelClientIfConfigured();

            if (!startOnly)
            {
                Process.Start(new ProcessStartInfo(KnowtUrl) { UseShellExecute = true });
            }
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(
                error.Message,
                "Knowt could not start",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }
    }

    private static void StartTunnelClientIfConfigured()
    {
        string autoStart = Environment.GetEnvironmentVariable("KNOWT_TUNNEL_AUTOSTART");
        if (!String.Equals(autoStart, "1", StringComparison.OrdinalIgnoreCase) &&
            !String.Equals(autoStart, "true", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        string tunnelId = Environment.GetEnvironmentVariable("KNOWT_TUNNEL_ID");
        if (String.IsNullOrWhiteSpace(tunnelId))
        {
            throw new InvalidOperationException(
                "KNOWT_TUNNEL_AUTOSTART is enabled, but KNOWT_TUNNEL_ID is not set.");
        }

        if (String.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("CONTROL_PLANE_API_KEY")))
        {
            throw new InvalidOperationException(
                "KNOWT_TUNNEL_AUTOSTART is enabled, but CONTROL_PLANE_API_KEY is not available to the launcher process.");
        }

        if (IsManagedTunnelRunning()) return;

        string mcpUrl = Environment.GetEnvironmentVariable("KNOWT_MCP_SERVER_URL");
        if (String.IsNullOrWhiteSpace(mcpUrl)) mcpUrl = DefaultMcpUrl;

        ProcessStartInfo startInfo = new ProcessStartInfo
        {
            FileName = FindTunnelClientExecutable(),
            Arguments = "run --control-plane.tunnel-id=" + tunnelId + " --mcp.server-url=" + mcpUrl,
            WorkingDirectory = KnowtRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };

        Process process = Process.Start(startInfo);
        if (process == null)
        {
            throw new InvalidOperationException("Windows could not launch tunnel-client.");
        }

        Directory.CreateDirectory(Path.GetDirectoryName(TunnelPidPath));
        File.WriteAllText(TunnelPidPath, process.Id.ToString());
        Thread.Sleep(500);
        if (process.HasExited)
        {
            throw new InvalidOperationException(
                "tunnel-client exited immediately. Run 'pnpm tunnel:doctor' in PowerShell for diagnostics.");
        }
    }

    private static string TunnelPidPath
    {
        get { return Path.Combine(KnowtRoot, "tmp", "knowt-tunnel.pid"); }
    }

    private static bool IsManagedTunnelRunning()
    {
        try
        {
            if (!File.Exists(TunnelPidPath)) return false;
            int processId;
            if (!Int32.TryParse(File.ReadAllText(TunnelPidPath).Trim(), out processId)) return false;
            Process process = Process.GetProcessById(processId);
            return !process.HasExited && process.ProcessName.IndexOf("tunnel-client", StringComparison.OrdinalIgnoreCase) >= 0;
        }
        catch
        {
            return false;
        }
    }

    private static string FindTunnelClientExecutable()
    {
        string configured = Environment.GetEnvironmentVariable("KNOWT_TUNNEL_CLIENT_PATH");
        if (!String.IsNullOrWhiteSpace(configured))
        {
            if (File.Exists(configured)) return configured;
            throw new FileNotFoundException(
                "KNOWT_TUNNEL_CLIENT_PATH does not point to tunnel-client.exe.", configured);
        }

        string path = Environment.GetEnvironmentVariable("PATH") ?? String.Empty;
        foreach (string directory in path.Split(Path.PathSeparator))
        {
            if (String.IsNullOrWhiteSpace(directory)) continue;
            string candidate = Path.Combine(directory.Trim(), "tunnel-client.exe");
            if (File.Exists(candidate)) return candidate;
        }

        throw new FileNotFoundException(
            "tunnel-client.exe could not be found. Install it, add it to PATH, or set KNOWT_TUNNEL_CLIENT_PATH.");
    }

    private static void StartKnowtServer()
    {
        string serverEntryPoint = Path.Combine(KnowtRoot, "apps", "server", "dist", "index.js");
        if (!File.Exists(serverEntryPoint))
        {
            throw new InvalidOperationException(
                "The Knowt production build is missing. Run 'pnpm build' in the Knowt project, then try again.");
        }

        string nodeExecutable = FindNodeExecutable();
        ProcessStartInfo startInfo = new ProcessStartInfo
        {
            FileName = nodeExecutable,
            Arguments = "\"" + serverEntryPoint + "\"",
            WorkingDirectory = KnowtRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };

        Process process = Process.Start(startInfo);
        if (process == null)
        {
            throw new InvalidOperationException("Windows could not launch the Knowt server process.");
        }
    }

    private static string FindNodeExecutable()
    {
        string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string[] candidates =
        {
            Environment.GetEnvironmentVariable("KNOWT_NODE_PATH"),
            @"C:\Program Files\nodejs\node.exe",
            Path.Combine(localAppData, "Programs", "nodejs", "node.exe"),
            Path.Combine(userProfile, "AppData", "Roaming", "nvm", "current", "node.exe"),
            Path.Combine(userProfile, ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "bin", "node.exe")
        };

        foreach (string candidate in candidates)
        {
            if (!String.IsNullOrEmpty(candidate) && File.Exists(candidate)) return candidate;
        }

        throw new FileNotFoundException(
            "Node.js could not be found. Install Node.js 24 or set KNOWT_NODE_PATH to the full path of node.exe.");
    }

    private static void WaitForKnowt()
    {
        DateTime deadline = DateTime.UtcNow.AddSeconds(15);
        while (DateTime.UtcNow < deadline)
        {
            if (IsKnowtHealthy()) return;
            Thread.Sleep(250);
        }

        throw new TimeoutException(
            "Knowt did not become ready within 15 seconds. Check that Node.js is installed and port 4318 is available.");
    }

    private static bool IsKnowtHealthy()
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(KnowtUrl + "/api/health");
            request.Method = "GET";
            request.Timeout = 750;
            request.ReadWriteTimeout = 750;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream()))
            {
                return response.StatusCode == HttpStatusCode.OK && reader.ReadToEnd().Contains("\"status\":\"ok\"");
            }
        }
        catch
        {
            return false;
        }
    }
}
