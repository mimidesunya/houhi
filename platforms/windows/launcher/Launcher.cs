using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

class Program {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

    const uint MB_OK = 0x00000000;
    const uint MB_ICONWARNING = 0x00000030;
    const uint MB_ICONERROR = 0x00000010;

    [STAThread]
    static void Main() {
        try {
            string exeDir = AppDomain.CurrentDomain.BaseDirectory;
            Environment.SetEnvironmentVariable("ELECTRON_RUN_AS_NODE", null);

            string releaseAppDir = Path.Combine(exeDir, "app");
            string releaseElectronPath = Path.Combine(exeDir, "runtime", "electron", "electron.exe");
            string releaseNodePath = Path.Combine(exeDir, "runtime", "node", "node.exe");
            string releaseMainPath = Path.Combine(releaseAppDir, "dist", "src", "gui", "main.js");

            if (Directory.Exists(releaseAppDir) && File.Exists(releaseElectronPath) && File.Exists(releaseMainPath)) {
                Environment.SetEnvironmentVariable("HOUHI_PROJECT_ROOT", releaseAppDir);
                Environment.SetEnvironmentVariable("HOUHI_RELEASE", "1");
                if (File.Exists(releaseNodePath)) {
                    Environment.SetEnvironmentVariable("HOUHI_NODE", releaseNodePath);
                }

                var releasePsi = new ProcessStartInfo {
                    FileName = releaseElectronPath,
                    Arguments = "\"" + releaseAppDir + "\"",
                    WorkingDirectory = releaseAppDir,
                    UseShellExecute = false
                };
                Process.Start(releasePsi);
                return;
            }

            string projectRoot = Path.GetFullPath(Path.Combine(exeDir, ".."));

            if (!Directory.Exists(Path.Combine(projectRoot, "node_modules"))) {
                MessageBoxW(
                    IntPtr.Zero,
                    "node_modules が見つかりません。\n" +
                    "初回起動前にプロジェクトフォルダで以下を実行してください:\n\n" +
                    "    npm install\n\n" +
                    "プロジェクトフォルダ:\n" + projectRoot,
                    "HOUHI - セットアップが必要です",
                    MB_OK | MB_ICONWARNING
                );
                return;
            }

            Process p = new Process();
            p.StartInfo.FileName = "cmd.exe";
            p.StartInfo.Arguments = "/c npm run gui";
            p.StartInfo.WorkingDirectory = projectRoot;
            p.StartInfo.WindowStyle = ProcessWindowStyle.Hidden;
            p.StartInfo.UseShellExecute = true;

            p.Start();
        } catch (Exception ex) {
            MessageBoxW(
                IntPtr.Zero,
                "起動に失敗しました。\n\n" +
                "npm と node がインストールされているか確認してください。\n\n" +
                "エラー詳細:\n" + ex.Message,
                "HOUHI エラー",
                MB_OK | MB_ICONERROR
            );
        }
    }
}
