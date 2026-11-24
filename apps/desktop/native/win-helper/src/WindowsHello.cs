namespace SparkWinHelper;

public sealed unsafe class WindowsHello : IConsentVerifier
{
    public const string VerificationOperationSignature =
        "pinterface({9fc2b0bb-e446-44e2-aa61-9cab8f636af2};enum(Windows.Security.Credentials.UI.UserConsentVerificationResult;i4))";

    public static readonly Guid VerificationOperationIid = new("fd596ffd-2318-558f-9dbe-d21df43764a5");

    private const string ClassName = "Windows.Security.Credentials.UI.UserConsentVerifier";
    private const int CheckAvailabilitySlot = 6;
    private const int RequestVerificationSlot = 7;
    private const int RequestVerificationForWindowSlot = 6;

    private static readonly Guid StaticsIid = new("AF4F3F91-564C-4DDC-B8B5-973447627C65");
    private static readonly Guid InteropIid = new("39E050C3-4E74-441A-8DC0-B81104DF949C");

    public int CheckAvailability()
    {
        using var statics = WinRt.Factory(ClassName, StaticsIid);
        nint operation;
        var check = (delegate* unmanaged[Stdcall]<nint, nint*, int>)statics.Slot(CheckAvailabilitySlot);
        WinRt.Check(check(statics.Pointer, &operation));
        using var pending = new ComObject(operation);
        return WinRt.AwaitEnum(pending);
    }

    public int RequestVerification(string message, nint window)
    {
        using var text = new HString(message);
        using var pending = window != 0 ? ForWindow(text, window) ?? Plain(text) : Plain(text);
        return WinRt.AwaitEnum(pending);
    }

    private static ComObject? ForWindow(HString message, nint window)
    {
        using var statics = WinRt.Factory(ClassName, StaticsIid);
        if (statics.TryAs(InteropIid, out var interop) < 0)
        {
            Console.Error.WriteLine("Windows Hello has no window interop here; asking without the window.");
            return null;
        }
        using (interop)
        {
            nint operation;
            var iid = VerificationOperationIid;
            var request = (delegate* unmanaged[Stdcall]<nint, nint, nint, Guid*, nint*, int>)interop!.Slot(
                RequestVerificationForWindowSlot
            );
            WinRt.Check(request(interop.Pointer, window, message.Handle, &iid, &operation));
            return new ComObject(operation);
        }
    }

    private static ComObject Plain(HString message)
    {
        using var statics = WinRt.Factory(ClassName, StaticsIid);
        nint operation;
        var request = (delegate* unmanaged[Stdcall]<nint, nint, nint*, int>)statics.Slot(RequestVerificationSlot);
        WinRt.Check(request(statics.Pointer, message.Handle, &operation));
        return new ComObject(operation);
    }
}
