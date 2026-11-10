using System.Runtime.InteropServices;
using System.Text;

namespace Cadence.Windows;

// Windows Credential Manager stands in for macOS Keychain. The ListenBrainz token never enters
// the web view, localStorage, logs, or history files.
static class TokenStore
{
    private const string Target = "local.cadence.listenbrainz";
    private const int CredTypeGeneric = 1, CredPersistLocalMachine = 2, ErrorNotFound = 1168;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential
    {
        public int Flags; public int Type; public string TargetName; public string? Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
        public int AttributeCount; public IntPtr Attributes; public string? TargetAlias; public string? UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, int type, int flags, out IntPtr credential);
    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref Credential credential, int flags);
    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string target, int type, int flags);
    [DllImport("advapi32.dll")]
    private static extern void CredFree(IntPtr buffer);

    public static string? Read()
    {
        if (!CredRead(Target, CredTypeGeneric, 0, out var pointer)) return null;
        try
        {
            var credential = Marshal.PtrToStructure<Credential>(pointer);
            if (credential.CredentialBlobSize == 0) return null;
            var bytes = new byte[credential.CredentialBlobSize];
            Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
            return Encoding.UTF8.GetString(bytes);
        }
        finally { CredFree(pointer); }
    }

    public static bool Save(string token)
    {
        var bytes = Encoding.UTF8.GetBytes(token);
        var blob = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            var credential = new Credential
            {
                Type = CredTypeGeneric, TargetName = Target, UserName = "user-token", Comment = "Cadence ListenBrainz token",
                CredentialBlob = blob, CredentialBlobSize = bytes.Length, Persist = CredPersistLocalMachine,
            };
            return CredWrite(ref credential, 0);
        }
        finally { Marshal.FreeHGlobal(blob); }
    }

    public static bool Delete() => CredDelete(Target, CredTypeGeneric, 0) || Marshal.GetLastWin32Error() == ErrorNotFound;
}
