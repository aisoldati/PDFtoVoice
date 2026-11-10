using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

[assembly: AssemblyTitle("VozPDF - Lector de Documentos PDF")]
[assembly: AssemblyDescription("Lector de PDF por voz para Windows")]
[assembly: AssemblyCompany("VozPDF")]
[assembly: AssemblyProduct("VozPDF")]
[assembly: AssemblyCopyright("Copyright © 2026")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace VozPDF
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            try
            {
                string appDataDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "VozPDF"
                );
                Directory.CreateDirectory(appDataDir);
                string htmlPath = Path.Combine(appDataDir, "VozPDF_App.html");

                Assembly asm = Assembly.GetExecutingAssembly();
                using (Stream res = asm.GetManifestResourceStream("web.VozPDF_App.html"))
                {
                    if (res != null)
                    {
                        using (FileStream fs = new FileStream(htmlPath, FileMode.Create, FileAccess.Write, FileShare.Read))
                        {
                            res.CopyTo(fs);
                        }
                    }
                }

                string fileUri = new Uri(htmlPath).AbsoluteUri;
                LaunchAppWindow(fileUri);
            }
            catch
            {
            }
        }

        private static void LaunchAppWindow(string url)
        {
            string[] candidates = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\Chrome\Application\chrome.exe")
            };

            foreach (string browser in candidates)
            {
                if (File.Exists(browser))
                {
                    try
                    {
                        ProcessStartInfo psi = new ProcessStartInfo
                        {
                            FileName = browser,
                            Arguments = "--app=\"" + url + "\" --window-size=1280,840",
                            UseShellExecute = false
                        };
                        Process.Start(psi);
                        return;
                    }
                    catch { }
                }
            }

            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch { }
        }
    }
}
