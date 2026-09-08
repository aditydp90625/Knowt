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
