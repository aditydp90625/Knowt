using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

internal static class Program
{
    private const string KnowtUrl = "http://127.0.0.1:4318";
    private static Process server;

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            if (!IsHealthy()) { StartServer(); WaitForServer(); }
            Process.Start(new ProcessStartInfo(KnowtUrl) { UseShellExecute = true });
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Knowt could not start", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static string Root { get { return AppDomain.CurrentDomain.BaseDirectory; } }

    private static void StartServer()
    {
        string entryPoint = Path.Combine(Root, "app", "dist", "index.js");
        if (!File.Exists(entryPoint)) throw new InvalidOperationException("The Knowt installation is incomplete: the server build is missing.");
        string node = Path.Combine(Root, "runtime", "node.exe");
        if (!File.Exists(node)) throw new InvalidOperationException("The Knowt installation is incomplete: the bundled Node.js runtime is missing.");
        server = Process.Start(new ProcessStartInfo {
            FileName = node, Arguments = "\"" + entryPoint + "\"",
            WorkingDirectory = Path.GetDirectoryName(entryPoint), UseShellExecute = false,
            CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden
        });
        if (server == null) throw new InvalidOperationException("Windows could not start the Knowt server.");
    }

    private static void WaitForServer()
    {
        DateTime deadline = DateTime.UtcNow.AddSeconds(20);
        while (DateTime.UtcNow < deadline)
        {
            if (IsHealthy()) return;
            if (server != null && server.HasExited) throw new InvalidOperationException("The Knowt server stopped during startup.");
            Thread.Sleep(250);
        }
        throw new TimeoutException("Knowt did not become ready within 20 seconds. Port 4318 may already be in use.");
    }

    private static bool IsHealthy()
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(KnowtUrl + "/api/health");
            request.Timeout = 750;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream()))
                return response.StatusCode == HttpStatusCode.OK && reader.ReadToEnd().Contains("\"status\":\"ok\"");
        }
        catch { return false; }
    }
}
