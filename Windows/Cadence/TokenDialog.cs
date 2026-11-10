namespace Cadence.Windows;

// The Windows version of the macOS "Connect ListenBrainz" sheet: a masked field, nothing echoed or logged.
sealed class TokenDialog : Form
{
    private readonly TextBox field = new() { UseSystemPasswordChar = true, PlaceholderText = "ListenBrainz user token", Width = 460 };

    private TokenDialog()
    {
        Text = "Connect ListenBrainz & enable tracking";
        FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = false; ShowInTaskbar = false;
        StartPosition = FormStartPosition.CenterParent; AutoSize = true; AutoSizeMode = AutoSizeMode.GrowAndShrink; Padding = new Padding(16);
        var layout = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, AutoSize = true, WrapContents = false };
        layout.Controls.Add(new Label { Text = "Connect ListenBrainz & enable tracking", Font = new Font(Font, FontStyle.Bold), AutoSize = true, Margin = new Padding(0, 0, 0, 8) });
        layout.Controls.Add(new Label
        {
            Text = "Paste your user token from listenbrainz.org/settings. Cadence will save it in Windows Credential Manager and automatically send qualifying listens from YouTube Music and SoundCloud to this token’s account. Track, artist, album when available, service link, duration, and listening timestamp are shared. Your ListenBrainz listening history is public.",
            MaximumSize = new Size(460, 0), AutoSize = true, Margin = new Padding(0, 0, 0, 12),
        });
        layout.Controls.Add(field);
        var buttons = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, AutoSize = true, Width = 460, Margin = new Padding(0, 12, 0, 0) };
        var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, AutoSize = true };
        var connect = new Button { Text = "Connect && enable", DialogResult = DialogResult.OK, AutoSize = true };
        buttons.Controls.Add(cancel); buttons.Controls.Add(connect);
        layout.Controls.Add(buttons);
        Controls.Add(layout);
        AcceptButton = connect; CancelButton = cancel;
    }

    public static string? Ask(IWin32Window owner)
    {
        using var dialog = new TokenDialog();
        var result = dialog.ShowDialog(owner);
        var value = dialog.field.Text; dialog.field.Clear();
        return result == DialogResult.OK ? value : null;
    }
}
