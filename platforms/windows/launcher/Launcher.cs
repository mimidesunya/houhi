using System;
using System.Diagnostics;
using System.IO;

class Program {
    static void Main() {
        try {
            // binフォルダから実行される前提
            string binDir = AppDomain.CurrentDomain.BaseDirectory;
            string projectRoot = Path.GetFullPath(Path.Combine(binDir, ".."));

            Process p = new Process();
            p.StartInfo.FileName = "cmd.exe";
            // npm run gui を実行
            p.StartInfo.Arguments = "/c npm run gui";
            p.StartInfo.WorkingDirectory = projectRoot;
            
            // ウィンドウを完全に隠す設定
            p.StartInfo.WindowStyle = ProcessWindowStyle.Hidden;
            p.StartInfo.CreateNoWindow = true;
            p.StartInfo.UseShellExecute = false;

            p.Start();
        } catch (Exception) {
            // エラーハンドリングは最小限
        }
    }
}
